// Icons, built as DOM rather than assigned as markup.
//
// These are hardcoded and contain nothing from a response, so innerHTML would
// have been safe here. It is removed anyway: "there is no innerHTML in this
// extension" is a claim a reviewer can check with one grep, and "it is safe
// because that particular string happens to be a constant" is one they have to
// take on trust. The whole point of the extension being readable is that the
// safety claims do not need trust.
const FC_SVG_NS = 'http://www.w3.org/2000/svg'

function fcIcon(size, parts, strokeWidth = 2) {
  const svg = document.createElementNS(FC_SVG_NS, 'svg')
  for (const [k, v] of Object.entries({
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': strokeWidth,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  })) svg.setAttribute(k, v)

  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(FC_SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    svg.appendChild(el)
  }
  return svg
}

const fcCheckIcon = (size, w) => fcIcon(size, [
  ['path', { d: 'M9 12l2 2 4-4' }],
  ['circle', { cx: 12, cy: 12, r: 10 }]
], w)

const fcClockIcon = (size, w) => fcIcon(size, [
  ['circle', { cx: 12, cy: 12, r: 10 }],
  ['path', { d: 'M12 6v6l4 2' }]
], w)

// Shared safe-rendering helpers for the content scripts.
//
// Loaded before twitter.js / terminals.js in each content_scripts entry, so its
// top-level declarations are visible to them (same isolated world, injected in
// manifest order).
//
// The API response is untrusted: it is model-generated from tweet text an
// attacker controls, and a prompt-injected tweet could push HTML through it.
// Nothing from a response is ever assigned to innerHTML.

function safeUrl(raw) {
  if (typeof raw !== 'string') return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

// What went wrong, in words somebody can act on.
//
// This existed as "Request failed. Is the API running?" and it sent a whole
// afternoon chasing a server that was up the entire time. Two of the three
// cases below have nothing to do with the API: a content script orphaned by an
// extension reload cannot reach the worker at all, and a worker that cannot
// reach its configured host is usually an old build pointing somewhere dead.
// An error message that names the wrong cause is worse than a vague one.
function fcErrorMessage(response, runtimeError) {
  // No answer at all. The worker never replied, which after an extension
  // reload or update is what an orphaned content script always sees.
  if (runtimeError || !response) {
    return 'Intel was reloaded or updated. Refresh this page and try again.'
  }
  if (response.error === 'not_authenticated') {
    return 'Not connected. Click the Intel extension icon to log in.'
  }
  // The worker answered, and its own fetch failed.
  if (response.error === 'request_failed') {
    return 'Could not reach the Intel API. Check your connection, and that this ' +
           'is the current version of the extension.'
  }
  return String(response.error)
}

function clampConfidence(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

const VERDICT_COLORS = { TRUE: '#22c55e', FALSE: '#ef4444', UNVERIFIED: '#f59e0b' }
const VERDICT_BGS = {
  TRUE: 'rgba(34,197,94,0.1)',
  FALSE: 'rgba(239,68,68,0.1)',
  UNVERIFIED: 'rgba(245,158,11,0.1)'
}

const SOURCE_STYLE =
  'display:block;font-size:11px;color:#5b9cf6;text-decoration:none;padding:3px 0;' +
  'border-bottom:0.5px solid rgba(255,255,255,0.04);white-space:nowrap;overflow:hidden;' +
  'text-overflow:ellipsis;opacity:0.85'

function el(tag, style, text) {
  const node = document.createElement(tag)
  if (style) node.style.cssText = style
  if (text != null) node.textContent = String(text)
  return node
}

function buildPanelHeader(onClose) {
  const header = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px')
  header.appendChild(el(
    'span',
    'font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.18);font-weight:500',
    'Fact check'
  ))
  const close = el(
    'button',
    'background:none;border:none;color:rgba(255,255,255,0.2);cursor:pointer;font-size:15px;line-height:1;padding:0;font-family:inherit',
    '×'
  )
  close.className = 'fc-close'
  close.addEventListener('click', onClose)
  header.appendChild(close)
  return header
}

// Appends verdict badge, confidence bar, summary and sources to `container`.
// Callers own the surrounding chrome (inline panel vs floating panel).
function appendVerdictBody(container, data) {
  const conf = clampConfidence(data.confidence)
  const verdict = typeof data.verdict === 'string' ? data.verdict : 'NO_CLAIM'
  const color = VERDICT_COLORS[verdict] || 'rgba(255,255,255,0.3)'
  const bg = VERDICT_BGS[verdict] || 'rgba(255,255,255,0.05)'
  const sources = Array.isArray(data.sources) ? data.sources.slice(0, 4) : []

  const verdictRow = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px')
  verdictRow.appendChild(el(
    'div',
    `font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:3px 10px;border-radius:6px;background:${bg};color:${color}`,
    verdict
  ))
  verdictRow.appendChild(el('span', 'font-size:11px;font-weight:500;color:rgba(255,255,255,0.25)', `${conf}%`))
  container.appendChild(verdictRow)

  const track = el('div', 'height:1px;background:rgba(255,255,255,0.06);border-radius:1px;margin-bottom:12px;overflow:hidden')
  track.appendChild(el('div', `height:100%;width:${conf}%;background:${color};border-radius:1px`))
  container.appendChild(track)

  container.appendChild(el(
    'p',
    `font-size:12px;color:rgba(255,255,255,0.72);line-height:1.65;margin-bottom:${sources.length ? '12px' : '0'}`,
    typeof data.summary === 'string' && data.summary ? data.summary : 'No summary available.'
  ))

  if (!sources.length) return

  container.appendChild(el(
    'div',
    'font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.15);font-weight:500;margin-bottom:6px',
    'Sources'
  ))

  for (const s of sources) {
    const href = safeUrl(s?.url)
    const label = (typeof s?.domain === 'string' && s.domain) || href || 'source'

    // A source whose URL fails validation still shows its label, as inert text.
    if (!href) {
      container.appendChild(el('span', SOURCE_STYLE, label))
      continue
    }
    const a = el('a', SOURCE_STYLE, label)
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    container.appendChild(a)
  }
}

// A post's text, with each link replaced by the address it actually points at.
//
// The sites disagree about where the real URL lives. X points its anchors at
// t.co and prints the expanded address into the label; the terminals do the
// opposite, keeping the real href and truncating the label to
// "en.wikipedia.org/wiki/No_ho…". Reading innerText therefore handed X the whole
// URL and the terminals a stump — the same post, two different strings, and one
// side missing evidence the other had. A wikipedia text fragment carrying
// "Shiba Inu named 'Ponsan'" is what settled one real check on X and was absent
// on Axiom, which is how the two produced different verdicts.
//
// innerText is kept as the base because it is what turns <br> into line breaks;
// the labels are swapped out of the resulting string rather than the DOM, so
// nothing on the page is touched.
function fcTextWithLinks(el) {
  if (!el) return ''
  let text = el.innerText || ''
  // Degrade to the plain text rather than throwing. A site can change shape
  // under us, and an exception here kills the whole extraction — no button at
  // all — where a stump of a link only costs some evidence.
  if (typeof el.querySelectorAll !== 'function') return text

  for (const a of el.querySelectorAll('a')) {
    const href = a.getAttribute('href') || ''
    // Only absolute links, and never a shortener — t.co resolves to nothing
    // useful, and the label beside it is already the expanded address.
    if (!/^https?:\/\//i.test(href)) continue
    if (/^https?:\/\/(t\.co|bit\.ly|tinyurl\.com)\//i.test(href)) continue

    const label = (a.innerText || '').trim()
    // Only worth swapping when the label was actually cut short; an untruncated
    // label already says the same thing and replacing it risks a wrong match.
    if (!label || !/[…]|\.\.\.$/.test(label)) continue
    if (text.includes(label)) text = text.replace(label, href)
  }

  return text
}
