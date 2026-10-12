// The one place production points at. It must match the https entry in
// manifest.json host_permissions, or every request is blocked by Chrome — so
// change it with `node cli/set-api-host.js <host>` from apps/api, which
// rewrites both together, rather than editing either by hand.
const DEFAULT_API_URL = 'https://intelapp.tech/api'

// `apiUrl` in storage overrides the default, and is discarded unless the
// extension actually holds permission to reach it.
//
// That check is not theoretical. An earlier version wrote a development address
// here when it found a development server, and the value outlived the code that
// wrote it: once the update removed both the probe and the permission it needed,
// every install that had ever adopted one was still pointed at a host it could
// no longer reach, failing every request with nothing to explain why.
//
// An override naming a host outside host_permissions can only fail, so keeping
// it is strictly worse than forgetting it.
function permittedApiUrl(url) {
  try {
    const u = new URL(url)
    return chrome.runtime.getManifest().host_permissions
      .includes(`${u.protocol}//${u.host}/*`)
  } catch {
    return false
  }
}

async function getApiUrl() {
  const { apiUrl } = await chrome.storage.local.get(['apiUrl'])
  if (!apiUrl) return DEFAULT_API_URL
  if (permittedApiUrl(apiUrl)) return apiUrl

  await chrome.storage.local.remove('apiUrl')
  return DEFAULT_API_URL
}

async function getToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken'], (res) => resolve(res.authToken))
  })
}

async function post(path, payload) {
  const base = await getApiUrl()
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  })
  return res.json()
}

async function verifyToken(token) {
  return post('/auth/verify', { token })
}

async function runFactCheck(tweetId, tweetText, token) {
  return post('/check', { tweetId, tweetText, token })
}

// A server running FASTCHECK_DEV=1 has no user table and accepts any request,
// so requiring the user to paste a token is pure friction. Ask /health once and
// remember the answer for this worker's lifetime.
//
// Only ever consulted when there is no stored token, so a normal signed-in user
// never pays for this request. It asks the configured host and nothing else:
// the extension used to go looking for a development server when the configured
// one did not answer, which meant shipping a development affordance — and the
// extra permission it needed — to everybody who installed it.
let cachedIsDev = null
let lastProbe = { url: null, reachable: false, dev: false, error: null }

// Returns true only for a server that answers /health with our exact shape.
async function probeHealth(base) {
  const url = `${base.replace(/\/api\/?$/, '')}/health`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const body = await res.json()
    // 'degraded' still means our server answered — it is reporting missing
    // configuration, not absence. Treating that as unreachable would send a
    // signed-out user hunting for a local dev server instead.
    const ours = body?.status === 'ok' || body?.status === 'degraded'
    lastProbe = { url, reachable: ours, dev: ours && body?.dev === true, error: null }
    return lastProbe
  } catch (err) {
    lastProbe = { url, reachable: false, dev: false, error: String(err?.message || err) }
    return lastProbe
  } finally {
    clearTimeout(timer)
  }
}

async function serverIsDev() {
  if (cachedIsDev !== null) return cachedIsDev

  const configured = await getApiUrl()
  const primary = await probeHealth(configured)
  if (primary.dev) {
    cachedIsDev = true
    return true
  }

  cachedIsDev = false
  return false
}

// Resolves the token to send, or null when the user genuinely needs to sign in.
async function resolveToken() {
  const stored = await getToken()
  if (stored) return stored
  return (await serverIsDev()) ? 'dev' : null
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'VERIFY_TOKEN') {
    verifyToken(msg.token)
      .then((result) => {
        // Cached because share cards are drawn locally, on a canvas, with no
        // network call. By the time someone presses Share the handle has to be
        // in hand already — asking for it then would mean a card that fails
        // offline, or worse, one that silently falls back to the bare domain.
        if (result?.valid) chrome.storage.local.set({ handle: result.handle ?? null })
        sendResponse(result)
      })
      .catch(() => sendResponse({ valid: false }))
    return true
  }

  // Read by the card renderer. Kept here rather than read from storage in the
  // content script so there is one place that knows where it lives.
  if (msg.type === 'GET_HANDLE') {
    chrome.storage.local.get(['handle'], (res) => sendResponse({ handle: res.handle ?? null }))
    return true
  }

  if (msg.type === 'FACT_CHECK') {
    resolveToken().then(token => {
      if (!token) return sendResponse({ error: 'not_authenticated' })
      runFactCheck(msg.tweetId, msg.tweetText, token)
        .then(sendResponse)
        .catch(() => sendResponse({ error: 'request_failed' }))
    })
    return true
  }


  // Lets the popup skip onboarding when the server is in dev mode.
  if (msg.type === 'GET_MODE') {
    serverIsDev().then(dev => sendResponse({ dev, probe: lastProbe }))
    return true
  }

  // Why am I seeing the login screen? Answers that without a debugger.
  if (msg.type === 'DIAGNOSE') {
    (async () => {
      cachedIsDev = null
      const configured = await getApiUrl()
      const token = await getToken()
      const dev = await serverIsDev()
      sendResponse({
        configuredApiUrl: configured,
        effectiveApiUrl: await getApiUrl(),
        hasStoredToken: Boolean(token),
        serverIsDev: dev,
        lastProbe
      })
    })()
    return true
  }
})

// The apiUrl can change at runtime; drop the memoised mode so the next call
// re-probes rather than trusting an answer from a different server.
//
// There used to be a second condition here, skipping the write the worker made
// to itself when it adopted a development server. Nothing writes apiUrl any
// more, so the exception is gone with it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.apiUrl) return
  cachedIsDev = null
})