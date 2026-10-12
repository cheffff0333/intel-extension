let timelineEnabled = true

chrome.storage.local.get(['timelineEnabled'], (res) => {
  timelineEnabled = res.timelineEnabled !== false
})

setInterval(() => {
  try {
    chrome.storage.local.get(['timelineEnabled'], (res) => {
      if (chrome.runtime.lastError) return
      timelineEnabled = res.timelineEnabled !== false
    })
  } catch {}
}, 1000)

function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

// When a popup carries no link to the post, the text is the only identity we
// have. Three terminals extract that text with three different selectors, so
// the same post used to hash three ways behind three prefixes — three cache
// entries, three separate charges, and (before temperature was pinned) three
// chances of a different verdict. Normalising first, and dropping the
// per-terminal prefix, collapses them onto one key.
function fallbackId(text) {
  const normalised = text
    .replace(/\s+/g, ' ')
    .replace(/[…]|\.\.\.$/g, '')
    .trim()
    .toLowerCase()
  return 'q_' + simpleHash(normalised)
}

function getOrCreateFloatingPanel() {
  let panel = document.getElementById('fc-floating-panel')
  if (panel) return panel

  panel = document.createElement('div')
  panel.id = 'fc-floating-panel'
  panel.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 320px;
    background: #0d0d0f;
    border: 0.5px solid rgba(255,255,255,0.1);
    border-radius: 14px;
    padding: 14px 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    font-size: 13px;
    color: #fff;
    z-index: 999999;
    display: none;
    animation: fcSlideIn 0.2s ease;
  `

  document.body.appendChild(panel)
  return panel
}

// safeUrl / clampConfidence / el / buildPanelHeader / appendVerdictBody come
// from content/render.js, injected ahead of this file by the manifest.

function openFloatingPanel() {
  const panel = getOrCreateFloatingPanel()
  panel.style.display = 'block'
  panel.replaceChildren()
  panel.appendChild(buildPanelHeader(() => { panel.style.display = 'none' }))
  return panel
}

function showFloatingLoading() {
  const panel = openFloatingPanel()
  const row = el('div', 'display:flex;align-items:center;gap:10px;color:rgba(255,255,255,0.4)')
  row.appendChild(el('div', 'width:14px;height:14px;border:1.5px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;animation:fcTermSpin 0.7s linear infinite;flex-shrink:0'))
  row.appendChild(el('span', 'font-size:12px', 'Checking sources...'))
  panel.appendChild(row)
}

function showFloatingVerdict(response) {
  const panel = openFloatingPanel()

  if (response.error) {
    panel.appendChild(el('p', 'color:#f87171;font-size:12px', fcErrorMessage(response, false)))
    return
  }

  appendVerdictBody(panel, response)
}

function buildButton() {
  const btn = document.createElement('button')
  btn.className = 'fc-terminal-btn'
  btn.replaceChildren(fcCheckIcon(11, 2.5), 'Intel')
  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    background: #111113;
    color: rgba(255,255,255,0.7);
    border: 0.5px solid rgba(255,255,255,0.12);
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    transition: background 0.15s;
    width: 100%;
    justify-content: center;
  `
  btn.addEventListener('mouseenter', () => btn.style.background = '#1a1a1c')
  btn.addEventListener('mouseleave', () => btn.style.background = '#111113')
  return btn
}

// ── One post, one string, whatever site it came from ────────────────────────
//
// X exposes a semantic hook (data-testid="tweetText") and a quote post is
// simply the second one inside the article. The terminals expose styling
// rather than meaning, but the SHAPE is identical everywhere: a list of body
// text nodes where the first is the post and the rest are what it quotes.
//
// So each site supplies only its own selector, and everything after that is
// shared with the X extractor — same joining, same [Quoting @handle] marker
// the API's rubric recognises. That sameness is the point: it is what lets one
// cached verdict serve every surface instead of each one getting its own
// answer to the same question.
function composeTweetText(parts, handle) {
  const clean = parts.map(t => (t || '').trim()).filter(Boolean)
  if (!clean.length) return ''
  const [main, ...quoted] = clean
  if (!quoted.length) return main
  return [main, '[Quoting' + (handle ? ' ' + handle : '') + ']', ...quoted].join('\n\n')
}

// Who is being quoted. Preferred from the quote link's own href, because that
// cannot accidentally pick up an @mention written in the outer post; the
// nearest @ inside the quote card is the fallback for the sites whose quote
// links use the anonymous /i/status/ form.
function quotedHandle(scope, href) {
  const named = (href || '').match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\//)
  if (named && named[1] !== 'i') return '@' + named[1]
  if (!scope) return ''

  // Match an element whose ENTIRE text is a handle, rather than running a
  // regex over the card's combined text. These sites render the handle and the
  // timestamp as neighbours, so the combined text reads "@DereWah5h" and a
  // regex happily takes the whole thing as the name.
  for (const el of scope.querySelectorAll('a, span, div')) {
    const t = (el.textContent || '').trim()
    if (/^@[A-Za-z0-9_]{1,15}$/.test(t)) return t
  }
  return ''
}


// Which post the popup is actually about.
//
// Padre read the FIRST /status/ link, which on a quote post is the QUOTED
// tweet — so a quote post was stored under the id of the post it quoted, and
// collided with that post's own verdict. A popup names its own post several
// times over (share link, like/repost/reply intents, "read more on X") and the
// quoted one once, so frequency identifies it without depending on DOM order,
// which is what broke.
function mainTweetId(popup) {
  const counts = new Map()
  const intents = new Set()

  for (const a of popup.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || ''
    const intent = href.match(/[?&](?:tweet_id|in_reply_to)=(\d{10,25})/)
    if (intent) {
      counts.set(intent[1], (counts.get(intent[1]) || 0) + 1)
      intents.add(intent[1])
    }
    const status = href.match(/\/status\/(\d{10,25})/)
    if (status) counts.set(status[1], (counts.get(status[1]) || 0) + 1)
  }

  let best = null
  let top = 0
  for (const [id, n] of counts) {
    // An intent link is unambiguous about whose post it is, so it wins a tie.
    const better = n > top || (n === top && intents.has(id) && !intents.has(best))
    if (better) { best = id; top = n }
  }
  return best
}

// The link wrapping the quoted post: a /status/ link naming a different post
// than this one. Structural rather than positional, so it survives a reorder.
function quoteAnchor(popup, mainId) {
  for (const a of popup.querySelectorAll('a[href*="/status/"]')) {
    const m = (a.getAttribute('href') || '').match(/\/status\/(\d{10,25})/)
    if (m && m[1] !== mainId) return a
  }
  return null
}

function attachClickHandler(btn, tweetId, tweetText) {
  btn.addEventListener('mousedown', (e) => {
    e.stopPropagation()
    e.stopImmediatePropagation()
  })

  btn.addEventListener('click', async (e) => {
    e.stopPropagation()
    e.stopImmediatePropagation()
    e.preventDefault()

    if (!chrome.runtime?.id) {
      showFloatingVerdict({ error: 'Extension reloaded — refresh the page.' })
      return
    }

    showFloatingLoading()
    btn.disabled = true
    btn.style.opacity = '0.5'

    chrome.runtime.sendMessage(
      { type: 'FACT_CHECK', tweetId: btn.dataset.tweetId || tweetId, tweetText },
      (response) => {
        btn.disabled = false
        btn.style.opacity = '1'

        if (chrome.runtime.lastError || !response) {
          showFloatingVerdict({ error: fcErrorMessage(response, true) })
          return
        }

        showFloatingVerdict(response)
      }
    )
  })
}

// Axiom. Body text carries an inline wrap style that nothing else in the popup
// uses, and both the post and its quoted half carry it — the same
// [main, ...quoted] list X gives. The old selector was the font size,
// text-[18px], which the quoted half does not share (it renders at 16px), so
// it could never see it.
function getTweetText(popup) {
  const nodes = [...popup.querySelectorAll('span[style*="overflow-wrap"]')]
  if (!nodes.length) {
    const legacy = popup.querySelector('span[class*="text-[18px]"]')
    return legacy ? fcTextWithLinks(legacy).trim() : ''
  }
  const card = nodes.length > 1
    ? (nodes[1].closest('div[class*="border-"]') || nodes[1].parentElement)
    : null
  return composeTweetText(nodes.map(n => fcTextWithLinks(n)), quotedHandle(card, ''))
}

// Ask the page-world half for the post's id. Axiom is the only site needing
// this; the other two put a real /status/ link in the popup.
//
// Answered asynchronously, so the button ships with the text-hash id and is
// upgraded in place when the real one arrives. A click before then still
// works — it just uses the hash, exactly as it did before any of this.
let fcRequestSeq = 0

function requestAxiomTweetId(popup, btn) {
  const reqId = 'fc' + (++fcRequestSeq) + '-' + Date.now().toString(36)
  popup.setAttribute('data-fc-req', reqId)

  const onReply = (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.type !== 'fastcheck:id' || data.reqId !== reqId) return
    window.removeEventListener('message', onReply)
    clearTimeout(timer)
    popup.removeAttribute('data-fc-req')
    if (typeof data.tweetId === 'string' && /^\d{10,25}$/.test(data.tweetId)) {
      btn.dataset.tweetId = data.tweetId
    }
  }

  const timer = setTimeout(() => {
    window.removeEventListener('message', onReply)
    popup.removeAttribute('data-fc-req')
  }, 3000)

  window.addEventListener('message', onReply)
  window.postMessage({ type: 'fastcheck:need-id', reqId }, window.location.origin)
}

function injectIntelButton(popup) {
  if (popup.querySelector('.fc-terminal-btn')) return

  const tweetText = getTweetText(popup)
  if (!tweetText) return

  // Axiom's popup carries no link to the post, so this is null here and the
  // MAIN-world bridge fills it in; see axiom-bridge.js.
  const tweetId = mainTweetId(popup) || fallbackId(tweetText)

  const btn = buildButton()
  btn.style.marginTop = '6px'

  attachClickHandler(btn, tweetId, tweetText)
  requestAxiomTweetId(popup, btn)

  const firstDivider = popup.querySelector('div.mx-\\[16px\\].h-\\[1px\\]')
  if (firstDivider) {
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'padding: 8px 16px 4px;'
    wrapper.appendChild(btn)
    firstDivider.after(wrapper)
  }
}

// Padre. Every piece of text is a MuiTypography-paragraph1 span — author,
// handle, counters, post — so the post is picked by eliminating the rest.
// Anything inside the quote link is excluded, or a short post would let its
// quoted half be mistaken for the post itself.
function padreBodyText(scope, exclude) {
  for (const el of scope.querySelectorAll('span[class*="MuiTypography-paragraph1"]')) {
    if (exclude && exclude.contains(el)) continue
    const text = fcTextWithLinks(el).trim()
    if (text.length > 20 &&
        !text.includes('Replying to') &&
        !text.match(/^\d+$/) &&
        !text.match(/^\d+[smhd]$/) &&
        !text.includes('followers') &&
        !text.includes('PM ·') &&
        !text.includes('AM ·') &&
        !text.includes('Read more') &&
        !text.startsWith('@') &&
        text !== '/') {
      return text
    }
  }
  return ''
}

function getPadreTweetText(popup) {
  const anchor = quoteAnchor(popup, mainTweetId(popup))
  const main = padreBodyText(popup, anchor)
  if (!main) return ''
  const quoted = anchor ? padreBodyText(anchor, null) : ''
  return composeTweetText([main, quoted], quotedHandle(anchor, anchor && anchor.getAttribute('href')))
}

function getPadreTweetId(popup) {
  return mainTweetId(popup)
}

function injectPadreButton(popup) {
  if (popup.querySelector('.fc-terminal-btn')) return

  const tweetText = getPadreTweetText(popup)
  if (!tweetText) return

  const tweetId = getPadreTweetId(popup) || fallbackId(tweetText)
  const btn = buildButton()
  attachClickHandler(btn, tweetId, tweetText)

  const all = popup.querySelectorAll('span[class*="MuiTypography-paragraph1"]')
  let tweetTextEl = null
  for (const el of all) {
    // Both sides must go through the same transformation. tweetText now has its
    // links resolved, so comparing against raw innerText silently stopped
    // matching on any post with a truncated link — and the button went unplaced.
    if (fcTextWithLinks(el).trim() === tweetText) {
      tweetTextEl = el
      break
    }
  }

  if (tweetTextEl) {
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'padding: 4px 0 8px;'
    wrapper.appendChild(btn)
    tweetTextEl.parentElement.insertBefore(wrapper, tweetTextEl)
  }
}

function injectSpinStyle() {
  if (document.getElementById('fc-terminal-styles')) return
  const style = document.createElement('style')
  style.id = 'fc-terminal-styles'
  style.textContent = `
    @keyframes fcTermSpin { to { transform: rotate(360deg) } }
    @keyframes fcSlideIn { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
  `
  document.head.appendChild(style)
}

function scanForPopups() {
  document.querySelectorAll('div.pointer-events-auto.fixed').forEach(popup => {
    if (popup.querySelector('span.text-\\[18px\\]')) injectIntelButton(popup)
  })

  document.querySelectorAll('.padre-no-scroll').forEach(popup => {
    if (popup.querySelector('a[href*="x.com"][href*="/status/"]') &&
        popup.querySelector('span[class*="MuiTypography-paragraph1"]')) {
      injectPadreButton(popup)
    }
  })

  document.querySelectorAll('div.pi-tooltip-container, div[id="_r_ds_"]').forEach(popup => {
    if (popup.querySelector('span.font-mono') || popup.querySelector('[data-sentry-component="CollapsibleText"]')) {
      injectGmgnButton(popup)
    }
  })
}

// GMGN. Post text renders as span.font-mono inside a CollapsibleText, and a
// quoted post is the same thing again inside the quote link — so one
// querySelectorAll gives [main, ...quoted], exactly as on X.
function getGmgnTweetText(popup) {
  const nodes = [...popup.querySelectorAll('span.font-mono')]
  if (!nodes.length) {
    const legacy = popup.querySelector('[data-sentry-component="CollapsibleText"]')
    return legacy ? fcTextWithLinks(legacy).trim() : ''
  }
  const anchor = nodes.length > 1 ? nodes[1].closest('a[href*="/status/"]') : null
  return composeTweetText(
    nodes.map(n => fcTextWithLinks(n)),
    quotedHandle(anchor, anchor && anchor.getAttribute('href'))
  )
}

function getGmgnTweetId(popup) {
  return mainTweetId(popup)
}

function injectGmgnButton(popup) {
  if (popup.querySelector('.fc-terminal-btn')) return

  const tweetText = getGmgnTweetText(popup)
  if (!tweetText) return

  const tweetId = getGmgnTweetId(popup) || fallbackId(tweetText)
  const btn = buildButton()
  btn.style.width = '100%'
  btn.style.margin = '8px 0 4px'

  attachClickHandler(btn, tweetId, tweetText)

  const textEl = popup.querySelector('span.font-mono') ||
                 popup.querySelector('[data-sentry-component="CollapsibleText"]')

  if (textEl) {
    const target = textEl.parentElement.parentElement
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'padding: 0 14px; width: 100%; box-sizing: border-box;'
    wrapper.appendChild(btn)
    target.parentElement.insertBefore(wrapper, target)
    return
  }

  const readMore = popup.querySelector('a[href*="/status/"] div')
  if (readMore?.innerText?.includes('Read more')) {
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'padding: 8px 14px 4px; background: transparent;'
    wrapper.appendChild(btn)
    readMore.closest('a').parentElement.insertBefore(wrapper, readMore.closest('a'))
    return
  }

  const divider = [...popup.querySelectorAll('div.h-\\[1px\\]')].pop()
  if (divider) {
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'padding: 0 14px 8px; background: transparent;'
    wrapper.appendChild(btn)
    divider.after(wrapper)
  }
}

injectSpinStyle()
getOrCreateFloatingPanel()
const observer = new MutationObserver(scanForPopups)
observer.observe(document.body, { childList: true, subtree: true })
scanForPopups()