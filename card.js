// Draws a verdict as a shareable card. Dev build only.
//
// Layout mirrors cli/preview-card.js exactly: 16:9 so X shows it
// uncropped, block centred between masthead and footer so short and long
// summaries both look composed, and no confidence bar on NO CLAIM — a nearly
// full bar under "no claim" reads at a glance as "90% true", which is the one
// thing a fact-checking card must not do.
//
// The masthead is artwork, not type. It ships as assets/lockup.png and is drawn
// with drawImage; every attempt to set INTEL in a system font looked like a
// different product.

const FC_CARD = (() => {
  const W = 1200, H = 675, M = 84, SCALE = 2

  const COLORS = {
    TRUE: '#22c55e', FALSE: '#ef4444', UNVERIFIED: '#f59e0b', NO_CLAIM: '#9aa3af'
  }

  const CAP = 42, BAR_GAP = 20, BAR_H = 6, LEAD = 38, SRC_GAP = 50
  const REGION_TOP = 176, REGION_BOTTOM = H - 62
  const BODY_FONT = '400 26px "Segoe UI", Helvetica, Arial, sans-serif'
  const MONO = 'Consolas, "IBM Plex Mono", ui-monospace, monospace'

  // FC_LOCKUP is a data URL generated at build time from assets/lockup.png.
  // A chrome-extension:// URL was tried first and failed twice over: it needs a
  // web_accessible_resources entry for every host, and it taints the canvas so
  // toBlob() throws. A data URL has neither problem.
  let logoPromise = null
  function logo() {
    if (!logoPromise) {
      logoPromise = new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        // Loudly, not silently. A missing masthead once rendered a headless
        // card that looked deliberate enough to nearly get posted.
        img.onerror = () => reject(new Error('masthead artwork failed to load'))
        img.src = FC_LOCKUP
      })
    }
    return logoPromise
  }

  // Real measurement rather than an average-character estimate — the reference
  // renderer had to guess because it has no text engine; canvas does not.
  function wrap(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean)
    const lines = []
    let line = ''
    for (const word of words) {
      const next = line ? line + ' ' + word : word
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word }
      else line = next
    }
    if (line) lines.push(line)
    return lines
  }

  // The perspective floor from the landing page: ground, not texture.
  function grid(ctx) {
    ctx.save()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    const horizon = H * 0.79
    for (let i = -14; i <= 14; i++) {
      const a = (1 - Math.min(1, Math.abs(i) / 15)) * 0.18
      if (a < 0.012) continue
      ctx.globalAlpha = a
      ctx.beginPath()
      ctx.moveTo(W / 2 + i * 6, horizon)
      ctx.lineTo((W / 2 + i * 46) * 2.6 - W * 0.8, H)
      ctx.stroke()
    }
    let y = horizon, step = 2
    while (y < H) {
      ctx.globalAlpha = Math.min(0.22, ((y - horizon) / (H - horizon)) * 0.24)
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      step *= 1.46; y += step
    }
    ctx.restore()
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
    else {
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
    }
    ctx.fill()
  }

  // Cached by the service worker when the token was last verified, so drawing a
  // card never waits on the network. Absent simply means no handle claimed, and
  // the card falls back to the bare domain.
  function currentHandle() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_HANDLE' }, (res) => {
          if (chrome.runtime.lastError) return resolve(null)
          resolve(res && typeof res.handle === 'string' ? res.handle : null)
        })
      } catch {
        resolve(null)
      }
    })
  }

  async function draw(data) {
    const canvas = document.createElement('canvas')
    canvas.width = W * SCALE
    canvas.height = H * SCALE
    const ctx = canvas.getContext('2d')
    ctx.scale(SCALE, SCALE)

    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, W, H)
    grid(ctx)

    const raw = String(data.verdict || 'NO_CLAIM').toUpperCase()
    const color = COLORS[raw] || COLORS.NO_CLAIM
    const label = raw.replace(/_/g, ' ')          // NO_CLAIM is an enum, not a word
    const scored = raw !== 'NO_CLAIM'
    const conf = Math.max(0, Math.min(100, Math.round(Number(data.confidence) || 0)))

    const img = await logo()
    const lw = 660, lh = Math.round(img.height * (lw / img.width))
    ctx.drawImage(img, Math.round((W - lw) / 2), 34, lw, lh)

    const barW = W - M * 2
    ctx.font = BODY_FONT
    const lines = wrap(ctx, data.summary, barW).slice(0, 5)

    const names = (Array.isArray(data.sources) ? data.sources : [])
      .map(s => String((s && (s.domain || s.url)) || '')
        .replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''))
      .filter(Boolean).slice(0, 4)

    const blockH = (scored ? CAP + BAR_GAP + BAR_H : CAP + 8)
      + 62 + (lines.length - 1) * LEAD
      + (names.length ? SRC_GAP : 0)
    const top = Math.round(REGION_TOP + ((REGION_BOTTOM - REGION_TOP) - blockH) / 2)

    const verdictY = top + CAP
    ctx.textBaseline = 'alphabetic'
    ctx.font = '800 56px "Arial Black", "Segoe UI", sans-serif'
    ctx.fillStyle = color
    ctx.fillText(label, M, verdictY)

    if (scored) {
      ctx.font = `600 26px ${MONO}`
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.textAlign = 'right'
      ctx.fillText(conf + '%', W - M, verdictY)
      ctx.textAlign = 'left'

      const barY = verdictY + BAR_GAP
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      roundRect(ctx, M, barY, barW, BAR_H, 3)
      ctx.fillStyle = color
      roundRect(ctx, M, barY, Math.max(BAR_H, barW * conf / 100), BAR_H, 3)
    }

    let y = (scored ? verdictY + BAR_GAP + BAR_H : verdictY + 8) + 62
    ctx.font = BODY_FONT
    ctx.fillStyle = 'rgba(255,255,255,0.93)'
    for (const line of lines) { ctx.fillText(line, M, y); y += LEAD }

    if (names.length) {
      const sourcesY = y - LEAD + SRC_GAP
      // Label and names share a size so a shared baseline reads as aligned;
      // at different sizes the small caps looked dropped.
      ctx.font = `600 18px ${MONO}`
      ctx.fillStyle = 'rgba(255,255,255,0.34)'
      ctx.fillText('SOURCES', M, sourcesY)
      ctx.font = `500 18px ${MONO}`
      ctx.fillStyle = 'rgba(255,255,255,0.62)'
      ctx.fillText(names.join('   ·   '), M + 108, sourcesY)
    }

    // The referral link lives here, in the image, and nowhere else. An image is
    // not a link, so a hundred people posting cards produces no URLs for X to
    // correlate as spam — which is the whole reason the handle is drawn rather
    // than put in the reply text.
    const handle = await currentHandle()
    const home = handle ? `intelapp.tech/@${handle}` : 'intelapp.tech'

    ctx.textAlign = 'center'
    ctx.font = '600 22px "Segoe UI", Helvetica, Arial, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(`start checking at ${home}`, W / 2, H - 38)
    ctx.textAlign = 'left'

    return canvas
  }

  async function toBlob(data) {
    const canvas = await draw(data)
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Card could not be encoded')),
        'image/png'
      )
    })
  }

  return { draw, toBlob }
})()
