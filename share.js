// Turns a verdict into a shareable card, shown in an overlay.
//
// The overlay exists because the card used to be invisible: pressing Share
// copied it and opened a reply box, so you found out what you were about to
// post only after pasting it. Now the card is shown first and posting is one of
// three things you can do with it.
//
// Nothing here posts. Automating the paste and the click would breach X's
// automation rules and risk the account this is meant to promote, and a human
// in the loop also means a bad verdict can simply be skipped.

;(() => {
  const TOAST_MS = 4200
  const Z = '2147483600'

  // The panel renderer is handed the verdict but not the id of the post it came
  // from, and the id is what a reply needs. Both surfaces route their check
  // through sendMessage, so recording it there covers X and the terminals with
  // one hook instead of two.
  let lastCheck = null
  const send = chrome.runtime.sendMessage.bind(chrome.runtime)
  chrome.runtime.sendMessage = function (message, ...rest) {
    if (message && message.type === 'FACT_CHECK') {
      lastCheck = { tweetId: message.tweetId, tweetText: message.tweetText }
    }
    return send(message, ...rest)
  }

  function toast(text, tone = 'ok') {
    document.querySelectorAll('.fc-share-toast').forEach(n => n.remove())
    const n = document.createElement('div')
    n.className = 'fc-share-toast'
    n.textContent = text
    n.style.cssText =
      `position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:${Z};` +
      'background:#111113;color:#fff;border:1px solid rgba(255,255,255,0.14);' +
      'border-radius:10px;padding:11px 16px;font:500 13px/1.4 -apple-system,' +
      'BlinkMacSystemFont,sans-serif;max-width:min(460px,90vw);box-shadow:0 8px 30px rgba(0,0,0,.5);' +
      (tone === 'bad' ? 'border-color:rgba(239,68,68,.5)' : '')
    document.body.appendChild(n)
    setTimeout(() => n.remove(), TOAST_MS)
  }

  async function copyToClipboard(blob) {
    // Clipboard rather than a programmatic file attach: X's composer input is
    // rebuilt often and a DataTransfer attach breaks silently when it changes,
    // whereas paste has worked for years.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  function download(blob, verdict) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `intel-${String(verdict || 'verdict').toLowerCase()}-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Freed later rather than immediately: revoking before the browser has
    // finished reading it cancels the download.
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  // On X, open the reply composer for the post the verdict belongs to.
  function openReplyHere(tweetId) {
    const link = document.querySelector(`a[href*="/status/${tweetId}"]`)
    const article = link && link.closest('article')
    const reply = article && article.querySelector('[data-testid="reply"]')
    if (!reply) return false
    reply.click()
    return true
  }

  async function shareOnX(blob) {
    const tweetId = lastCheck && lastCheck.tweetId
    const real = /^\d{10,25}$/.test(String(tweetId || ''))
    const onX = /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(location.hostname)

    await copyToClipboard(blob)

    if (onX && real && openReplyHere(tweetId)) {
      toast('Card copied. Press Ctrl+V in the reply box, then Post.')
    } else if (real) {
      // Checked from a terminal, so the post is not on this page. Hand over a
      // tab pointing at it; the clipboard is OS-wide and follows.
      window.open(`https://x.com/i/status/${tweetId}`, '_blank', 'noopener')
      toast('Card copied and the post opened. Reply, paste, then Post.')
    } else {
      toast('Card copied to the clipboard. Paste it into a reply.')
    }
  }

  // ── the overlay ───────────────────────────────────────────────────────────
  function overlayButton(label, { primary = false } = {}) {
    const b = document.createElement('button')
    b.textContent = label
    const idle = primary ? '#ffffff' : 'rgba(255,255,255,.07)'
    const hover = primary ? '#e9e9ec' : 'rgba(255,255,255,.13)'
    b.style.cssText =
      'flex:1;padding:11px 16px;border-radius:10px;cursor:pointer;' +
      "font:600 13.5px/1 -apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;" +
      'transition:background .15s ease;' +
      (primary
        ? `background:${idle};color:#0b0b0d;border:1px solid #ffffff;`
        : `background:${idle};color:rgba(255,255,255,.88);border:1px solid rgba(255,255,255,.16);`)
    b.addEventListener('mouseenter', () => { b.style.background = hover })
    b.addEventListener('mouseleave', () => { b.style.background = idle })
    return b
  }

  function openOverlay(blob, data) {
    document.querySelectorAll('.fc-card-overlay').forEach(n => n.remove())
    const url = URL.createObjectURL(blob)

    const backdrop = document.createElement('div')
    backdrop.className = 'fc-card-overlay'
    backdrop.style.cssText =
      `position:fixed;inset:0;z-index:${Z};display:flex;align-items:center;justify-content:center;` +
      'background:rgba(0,0,0,.74);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
      'padding:24px;overflow:auto'

    const sheet = document.createElement('div')
    sheet.style.cssText =
      'width:min(760px,100%);display:flex;flex-direction:column;gap:14px;' +
      "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif"

    const img = document.createElement('img')
    img.src = url
    img.alt = 'Intel verdict card'
    img.style.cssText =
      'width:100%;height:auto;display:block;border-radius:14px;' +
      'border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 70px rgba(0,0,0,.55)'
    sheet.appendChild(img)

    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:10px'

    const copy = overlayButton('Copy')
    copy.addEventListener('click', async () => {
      try {
        await copyToClipboard(blob)
        copy.textContent = 'Copied'
        setTimeout(() => { copy.textContent = 'Copy' }, 1800)
      } catch (err) {
        toast(`Could not copy: ${err.message}`, 'bad')
      }
    })

    const save = overlayButton('Download')
    save.addEventListener('click', () => download(blob, data.verdict))

    const post = overlayButton('Share on X', { primary: true })
    post.addEventListener('click', async () => {
      post.disabled = true
      post.textContent = 'Opening…'
      try {
        await shareOnX(blob)
        close()
      } catch (err) {
        post.disabled = false
        post.textContent = 'Share on X'
        toast(`Could not copy the card: ${err.message}`, 'bad')
      }
    })

    row.append(copy, save, post)
    sheet.appendChild(row)

    const hint = document.createElement('div')
    hint.textContent = 'Press Escape to close'
    hint.style.cssText =
      'text-align:center;font-size:11.5px;color:rgba(255,255,255,.38);letter-spacing:.01em'
    sheet.appendChild(hint)

    backdrop.appendChild(sheet)

    let closing = false
    function close() {
      if (closing) return
      closing = true
      document.removeEventListener('keydown', onKey, true)
      setTimeout(() => URL.revokeObjectURL(url), 30_000)

      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (still || !backdrop.animate) return backdrop.remove()
      const out = backdrop.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 120, easing: 'ease-in', fill: 'forwards' }
      )
      out.onfinish = () => backdrop.remove()
      // Removed regardless if the animation never reports finishing, which it
      // does not when the tab is backgrounded mid-close.
      setTimeout(() => backdrop.remove(), 400)
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }

    // Only the backdrop closes it, never the sheet — a stray click on the card
    // itself should not throw away what you just made.
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close() })
    document.addEventListener('keydown', onKey, true)

    // The host page has its own click handlers, and on the terminals a stray
    // click closes the popup underneath. Nothing in here should reach them.
    for (const type of ['click', 'mousedown', 'keydown']) {
      sheet.addEventListener(type, (e) => e.stopPropagation())
    }

    document.body.appendChild(backdrop)

    // Animated with the Web Animations API rather than a keyframe rule: this
    // runs inside somebody else's page, and injecting a stylesheet there is a
    // collision waiting to happen. Skipped entirely for anyone who has asked
    // for less motion.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!still && backdrop.animate) {
      backdrop.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 140, easing: 'ease-out' }
      )
      sheet.animate(
        [
          { opacity: 0, transform: 'scale(.965) translateY(6px)' },
          { opacity: 1, transform: 'scale(1) translateY(0)' }
        ],
        { duration: 190, easing: 'cubic-bezier(.2,.8,.3,1)' }
      )
    }
  }

  // ── the control in the verdict panel ──────────────────────────────────────
  function shareButton(data) {
    // Set apart by a rule and the panel's own padding, so it reads as an action
    // on the verdict rather than one more line of it.
    const wrap = document.createElement('div')
    wrap.style.cssText =
      'margin:14px -15px -13px;padding:11px 15px 13px;' +
      'border-top:0.5px solid rgba(255,255,255,0.07)'

    const b = document.createElement('button')
    b.className = 'fc-share-btn'
    const idle = 'rgba(255,255,255,0.05)'
    const hover = 'rgba(255,255,255,0.1)'
    b.style.cssText =
      'width:100%;display:inline-flex;align-items:center;justify-content:center;gap:7px;' +
      `padding:8px 12px;background:${idle};color:rgba(255,255,255,0.78);` +
      'border:0.5px solid rgba(255,255,255,0.14);border-radius:9px;' +
      "font:550 12px/1 -apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;" +
      'cursor:pointer;transition:background .15s ease,color .15s ease'
    b.addEventListener('mouseenter', () => {
      b.style.background = hover
      b.style.color = 'rgba(255,255,255,0.95)'
    })
    b.addEventListener('mouseleave', () => {
      b.style.background = idle
      b.style.color = 'rgba(255,255,255,0.78)'
    })

    const NS = 'http://www.w3.org/2000/svg'
    const icon = document.createElementNS(NS, 'svg')
    icon.setAttribute('width', '12')
    icon.setAttribute('height', '12')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('fill', 'none')
    icon.setAttribute('stroke', 'currentColor')
    icon.setAttribute('stroke-width', '2.2')
    icon.setAttribute('stroke-linecap', 'round')
    icon.setAttribute('stroke-linejoin', 'round')
    for (const d of ['M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7', 'M12 3v13', 'M7 8l5-5 5 5']) {
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', d)
      icon.appendChild(path)
    }
    b.appendChild(icon)
    b.appendChild(document.createTextNode('Share card'))

    b.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation() })
    b.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
      b.disabled = true
      b.style.opacity = '0.5'
      try {
        openOverlay(await FC_CARD.toBlob(data), data)
      } catch (err) {
        toast(`Could not build the card: ${err.message}`, 'bad')
      } finally {
        b.disabled = false
        b.style.opacity = '1'
      }
    })

    wrap.appendChild(b)
    return wrap
  }

  // Both surfaces render through appendVerdictBody, so wrapping it once adds
  // the control everywhere rather than editing twitter.js and terminals.js.
  const original = appendVerdictBody
  // eslint-disable-next-line no-global-assign
  appendVerdictBody = function (container, data) {
    original(container, data)
    if (data && typeof data.verdict === 'string' && !data.error) {
      container.appendChild(shareButton(data))
    }
  }
})()
