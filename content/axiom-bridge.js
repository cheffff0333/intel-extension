// Runs in the PAGE's JavaScript context, not the extension's.
//
// Axiom's popup contains no link to the post it is showing — the "Read more on
// X" control is a button with a click handler, and the only anchors point at
// the author's profile. The id is there, but only inside React's internals,
// and a normal content script cannot see those: it shares the DOM but gets its
// own JavaScript world, so properties the page sets on a node are invisible to
// it. Verified rather than assumed — scanning for __react keys returns matches
// on the page and nothing in the extension's world.
//
// So this half runs in the page's world with the sole job of reading that id
// and handing it back. It reads; it never writes to the page, and it answers
// only the extension's own request messages.
//
// Without it, Axiom falls back to hashing the post's text, which means the same
// post checked on Axiom and on X lands in two different cache entries and gets
// checked (and paid for) twice.

;(() => {
  const REQUEST = 'fastcheck:need-id'
  const RESPONSE = 'fastcheck:id'
  const ID = /^\d{10,25}$/

  // React hangs a fiber off the DOM node. The post id lives on a component
  // several levels above the popup, under a prop named tweetId or inside a
  // status URL, so walk up until one turns up.
  function findTweetId(el) {
    let fiber = null
    for (const key in el) {
      if (key.startsWith('__reactFiber')) { fiber = el[key]; break }
    }
    if (!fiber) return null

    const seen = new WeakSet()
    const dig = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return null
      seen.add(obj)
      for (const key of Object.keys(obj)) {
        const value = obj[key]
        if (typeof value === 'string' && value.length < 300) {
          const url = value.match(/\/status\/(\d{10,25})/)
          if (url) return url[1]
          if (ID.test(value) && /(^|[^a-z])(tweet|status|post)?id$/i.test(key)) return value
        } else if (value && typeof value === 'object') {
          const found = dig(value, depth + 1)
          if (found) return found
        }
      }
      return null
    }

    for (let hop = 0; fiber && hop < 30; hop++, fiber = fiber.return) {
      const found = fiber.memoizedProps && dig(fiber.memoizedProps, 0)
      if (found) return found
    }
    return null
  }

  window.addEventListener('message', (event) => {
    // Only our own page, only our own message shape.
    if (event.source !== window) return
    const data = event.data
    if (!data || data.type !== REQUEST || typeof data.reqId !== 'string') return

    let tweetId = null
    try {
      const el = document.querySelector('[data-fc-req="' + CSS.escape(data.reqId) + '"]')
      if (el) tweetId = findTweetId(el)
    } catch {
      // A React internal shape change must not throw inside the page.
    }

    window.postMessage({ type: RESPONSE, reqId: data.reqId, tweetId }, window.location.origin)
  })
})()
