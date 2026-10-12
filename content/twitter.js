let timelineEnabled = true

chrome.storage.local.get(['timelineEnabled'], (res) => {
  timelineEnabled = res.timelineEnabled !== false
})

setInterval(() => {
  try {
    chrome.storage.local.get(['timelineEnabled'], (res) => {
      if (chrome.runtime.lastError) return
      const newVal = res.timelineEnabled !== false
      if (newVal === timelineEnabled) return
      timelineEnabled = newVal
      if (!timelineEnabled) {
        if (!location.href.includes('/status/')) {
          document.querySelectorAll('.fc-wrap').forEach(w => w.remove())
        }
      } else {
        injectButtons()
      }
    })
  } catch {
    // context invalidated, stop polling
  }
}, 1000)

// safeUrl / clampConfidence / el / buildPanelHeader / appendVerdictBody come
// from content/render.js, injected ahead of this file by the manifest.



function setButtonIdle(btn) {
  btn.disabled = false
  btn.replaceChildren(fcCheckIcon(14), 'Intel')
}

function setButtonBusy(btn) {
  btn.disabled = true
  btn.replaceChildren(fcClockIcon(14), 'Checking...')
}

function getTweetId(article) {
  const link = article.querySelector('a[href*="/status/"]')
  if (!link) return null
  const match = link.href.match(/\/status\/(\d+)/)
  return match ? match[1] : null
}

// A quote tweet holds two tweetText nodes: the post, then the post it quotes.
// querySelector took only the first, throwing the quoted one away — and in the
// "@bigaccount announces @project's news" shape, the quoted post IS the
// first-party announcement that settles the claim. Checking the outer text
// alone left the model inferring from search results, and it inferred
// differently on repeat runs.
function getTweetText(article) {
  const parts = [...article.querySelectorAll('[data-testid="tweetText"]')]
    .map(el => fcTextWithLinks(el).trim())
    .filter(Boolean)
  if (!parts.length) return ''

  const [main, ...quoted] = parts
  if (!quoted.length) return main

  // The handle matters: "who announced it" is most of what makes a first-party
  // source primary. Absent if the markup shifts, which is survivable.
  const card = article.querySelector('div[role="link"]')
  const handle = card ? (card.innerText.match(/@[A-Za-z0-9_]{1,15}/) || [''])[0] : ''

  return [main, '[Quoting' + (handle ? ' ' + handle : '') + ']', ...quoted].join('\n\n')
}

function removeExistingPanel() {
  document.querySelectorAll('.fc-panel').forEach(p => p.remove())
}

function createPanel() {
  const panel = document.createElement('div')
  panel.className = 'fc-panel'
  panel.style.cssText = `
    background: #0d0d0f;
    border: 0.5px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 13px 15px;
    margin-top: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    font-size: 12px;
    color: #fff;
    max-width: 480px;
    animation: fcFadeIn 0.15s ease;
  `
  return panel
}

function renderPanel(panel, data) {
  panel.replaceChildren()
  panel.appendChild(buildPanelHeader(() => panel.remove()))
  appendVerdictBody(panel, data)
}

function renderLoading(panel) {
  panel.replaceChildren()
  const row = el('div', 'display:flex;align-items:center;gap:10px;color:rgba(255,255,255,0.5)')
  row.appendChild(el('div', 'width:16px;height:16px;border:2px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;animation:fcSpin 0.7s linear infinite;flex-shrink:0'))
  row.append('Checking sources...')
  panel.appendChild(row)
}

function renderError(panel, message) {
  panel.replaceChildren()
  panel.appendChild(el('p', 'color:#f87171', message))
}

function injectStyles() {
  if (document.getElementById('fc-styles')) return
  const style = document.createElement('style')
  style.id = 'fc-styles'
  style.textContent = `
    @keyframes fcFadeIn { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:translateY(0) } }
    @keyframes fcSpin { to { transform:rotate(360deg) } }
    .fc-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      background: #111113;
      color: #fff;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      transition: background 0.15s;
      margin-top: 8px;
    }
    .fc-btn:hover { background: #222; }
    .fc-btn:disabled { opacity: 0.5; cursor: default; }
  `
  document.head.appendChild(style)
}

function createButton(tweetId) {
  const btn = document.createElement('button')
  btn.className = 'fc-btn'
  btn.dataset.tweetId = tweetId
  setButtonIdle(btn)
  return btn
}

function injectButtons() {
  const isDetailPage = location.href.includes('/status/')

  document.querySelectorAll('article[data-testid="tweet"]').forEach(article => {
    // The DOM is the only source of truth for whether this article already has
    // a button. A tweetId-keyed Set went stale whenever it was cleared on
    // navigation — and X pushes a URL for every image you open — which is how
    // one tweet ended up with several buttons stacked under it.
    if (article.querySelector('.fc-btn')) return

    if (!timelineEnabled && !isDetailPage) return

    const tweetId = getTweetId(article)
    if (!tweetId) return

    const tweetText = getTweetText(article)
    if (!tweetText) return

    const actionBar = article.querySelector('[role="group"]')
    if (!actionBar?.parentElement) return

    const btn = createButton(tweetId)
    const wrapper = document.createElement('div')
    wrapper.className = 'fc-wrap'
    wrapper.appendChild(btn)

    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      removeExistingPanel()

      const panel = createPanel()
      wrapper.appendChild(panel)
      renderLoading(panel)
      setButtonBusy(btn)

      if (!chrome.runtime?.id) {
        renderError(panel, 'Extension reloaded — please refresh the page.')
        setButtonIdle(btn)
        return
      }

      chrome.runtime.sendMessage(
        { type: 'FACT_CHECK', tweetId, tweetText },
        (response) => {
          if (chrome.runtime.lastError || !response || response.error) {
            renderError(panel, fcErrorMessage(response, Boolean(chrome.runtime.lastError)))
          } else {
            renderPanel(panel, response)
          }
          setButtonIdle(btn)
        }
      )
    })

    actionBar.parentElement.appendChild(wrapper)
  })
}

injectStyles()

// X mutates the DOM constantly; coalesce bursts into one pass per frame.
let scheduled = false
function scheduleInject() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    injectButtons()
  })
}

let lastUrl = location.href
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    setTimeout(injectButtons, 500)
    setTimeout(injectButtons, 1500)
  }
  scheduleInject()
})

observer.observe(document.body, { childList: true, subtree: true })
injectButtons()
