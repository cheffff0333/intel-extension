const views = {
  onboarding: document.getElementById('view-onboarding'),
  main: document.getElementById('view-main')
}

function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'))
  views[name].classList.remove('hidden')
}

// Onboarding used to appear with no explanation, which made "why am I being
// asked for a token?" impossible to answer without opening a debugger.
function showOnboardingReason(probe) {
  const el = document.getElementById('onboarding-note')
  if (!el) return
  if (!probe) {
    el.textContent = ''
    return
  }
  el.textContent = probe.reachable
    ? `Server at ${probe.url} is live but not in dev mode — a real token is required.`
    : `Could not reach ${probe.url}${probe.error ? ` (${probe.error})` : ''}.`
}

// Module scope. It was local to init(), and a top-level caller outside that
// scope was a ReferenceError that blanked the whole popup.
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null)

async function init() {
  let { authToken, timelineEnabled } = await chrome.storage.local.get(['authToken', 'timelineEnabled'])


  let res = authToken ? await send({ type: 'VERIFY_TOKEN', token: authToken }) : null

  // Either no token, or a token the server rejects — which is also what happens
  // when a stale token from a previous setup is checked against a different
  // server. In both cases, ask whether we are talking to a dev server before
  // demanding a credential the user has no way to obtain.
  if (!res?.valid) {
    const mode = await send({ type: 'GET_MODE' })
    if (mode?.dev) {
      authToken = 'dev'
      await chrome.storage.local.set({ authToken, timelineEnabled: timelineEnabled !== false })
      res = await send({ type: 'VERIFY_TOKEN', token: authToken })
    }
    if (!res?.valid) {
      showOnboardingReason(mode?.probe)
      showView('onboarding')
      return
    }
  }

  const plan = res.plan || 'free'
  // The limit comes from the server. The popup used to hardcode its own copy,
  // which drifted and advertised allowances the API would not honour.
  const limit = res.limit ?? 3
  const used = res.used ?? res.checksToday ?? 0
  // There are no daily quotas. A pack is a number of checks with an expiry
  // date, and the trial never expires at all — "/day" and "Checks today" were
  // describing a reset that does not happen.
  const pack = res.quotaType === 'pack'
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1)

  document.getElementById('plan-badge').textContent = planName
  document.getElementById('plan-badge').className = `plan-badge ${plan}`
  document.getElementById('stat-plan').textContent = pack
    ? `${planName} — ${limit.toLocaleString()} checks`
    : `${planName} — ${limit} free checks`

  const checksRow = document.getElementById('checks-row')
  checksRow.style.display = ''
  document.getElementById('checks-label').textContent = pack ? 'Credits used' : 'Free checks used'
  document.getElementById('stat-checks').textContent = `${used.toLocaleString()} / ${limit.toLocaleString()}`

  // Credits run out on a date, and it is the one thing a number alone cannot
  // tell you.
  const expiryRow = document.getElementById('expiry-row')
  if (pack && res.expiresAt) {
    document.getElementById('stat-expiry').textContent =
      new Date(res.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    expiryRow.hidden = false
  } else {
    expiryRow.hidden = true
  }

  const toggle = document.getElementById('timeline-toggle')
  toggle.checked = timelineEnabled !== false

  showView('main')
}

// The hrefs are real in the markup, so these links work with no JavaScript at
// all. They used to start as "#" and be filled in at runtime, which meant that
// when that lookup failed the link kept href="#" and target="_blank" — and a
// "#" link with target="_blank" opens the page it is already on.

document.getElementById('connect-btn').addEventListener('click', async () => {
  const token = document.getElementById('token-input').value.trim()
  if (!token) return

  const btn = document.getElementById('connect-btn')
  btn.textContent = 'Connecting...'
  btn.disabled = true

  const res = await chrome.runtime.sendMessage({ type: 'VERIFY_TOKEN', token }).catch(() => null)

  if (res?.valid) {
    await chrome.storage.local.set({ authToken: token, timelineEnabled: true })
    init()
  } else {
    btn.textContent = 'Connect'
    btn.disabled = false
    document.getElementById('token-input').style.borderColor = '#ef4444'
    setTimeout(() => document.getElementById('token-input').style.borderColor = '', 2000)
  }
})

document.getElementById('timeline-toggle').addEventListener('change', (e) => {
  chrome.storage.local.set({ timelineEnabled: e.target.checked })
})

document.getElementById('disconnect-btn').addEventListener('click', () => {
  // Remove only the credential. storage.clear() also wiped `apiUrl`, silently
  // sending a local dev setup back to the production server.
  chrome.storage.local.remove(['authToken'], () => showView('onboarding'))
})

init()