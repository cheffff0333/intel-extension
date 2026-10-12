# Intel

A Chrome extension that fact-checks the narrative behind a memecoin post, in
place, on the sites where people actually read those posts.

Press the button under a post on X, or inside the coin pop-up on Axiom, GMGN or
Padre, and it returns a verdict — `TRUE`, `FALSE`, `UNVERIFIED` or `NO_CLAIM` —
with a confidence figure, a short summary, and the sources it used.

The point is speed. Someone good at this can read a post, find the project, dig
up the first-party source and decide whether the claim holds in a couple of
minutes. The extension is only useful if it gets to the same answer faster than
that, which is why the verdict renders where the post already is rather than in
a tab you have to go to.

## Install

**From the Chrome Web Store:**
https://chromewebstore.google.com/detail/intel/fcmifpbaecbclhmmejfndpjiilimloni

**From source:**

```bash
node build.js
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load
unpacked**, and select the `dist/` folder.

Node 18+. No dependencies and no install step — `build.js` only copies files and
generates one of them.

## Why there is a build step at all

The share-card masthead ships as a base64 data URL in a generated
`lockup-data.js`, rather than as an image file in the extension.

A `chrome-extension://` image needs a `web_accessible_resources` entry for every
host the extension runs on. Miss one and it silently fails to load, which is
what happened on the terminals. Worse, even where it does load it taints the
canvas, so `toBlob()` throws when the card is turned into an image. A data URL
is same-origin everywhere and taints nothing.

`build.js` also lists the files it ships explicitly rather than globbing the
tree, so a stray file left lying around cannot end up in a release.

## What it sends

When you press the button, and only then:

- the post's id
- the post's text, as rendered — including the quoted post, if there is one
- your auth token, so the check can be billed to your account

That goes to `https://intelapp.tech/api/check`, which runs the check and returns
the verdict. Nothing is sent while you browse, nothing is posted on your behalf,
and nothing is read from the clipboard.

The server reads the post's canonical text from X by id and prefers that over
the scraped copy, so the same post checked on X and on Axiom gets one verdict
rather than two slightly different ones.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Holds the auth token and the toggle for whether buttons appear in the X timeline. |
| `clipboardWrite` | After a check, "Share card" turns the verdict into an image and writes it to the clipboard, so you can paste it into a reply yourself. Nothing is read from the clipboard, and nothing is posted automatically. |
| Host access to `x.com`, `twitter.com`, `axiom.trade`, `gmgn.ai`, `padre.gg`, `trade.padre.gg` | Where the button is injected and the post is read. |
| Host access to `intelapp.tech` | The API the check is sent to. |

An extension may only talk to hosts listed in its own manifest, and that applies
to redirect targets too — worth knowing if you fork this and point it somewhere
else.

## Layout

```
manifest.json              MV3 manifest
background/
  service-worker.js        auth, the API call, dev-server detection
content/
  render.js                shared: verdict panel, icons, link resolution
  twitter.js               X: button injection, quote-post extraction
  terminals.js             Axiom, GMGN, Padre: pop-up detection, extraction
  axiom-bridge.js          runs in the PAGE world, reads the post id (see below)
popup/                     sign-in and settings
card.js                    draws the share card on a canvas
share.js                   the share overlay: copy, download, open a reply
build.js                   assembles dist/
```

### The Axiom bridge

Axiom's coin pop-up contains no link to the post it is showing — the "Read more
on X" control is a button with a click handler, and the only anchors point at
the author's profile. The id exists, but only inside React's internals, and a
normal content script cannot see those: it shares the DOM but gets its own
JavaScript world, so properties the page sets on a node are invisible to it.

`content/axiom-bridge.js` therefore runs in the page's own world with the single
job of reading that id and passing it back. It reads; it never writes to the
page, and it only answers the extension's own request messages.

Without it, Axiom falls back to hashing the post's text, which means the same
post checked on Axiom and on X lands in two different cache entries and gets
checked — and charged for — twice.

## What is not here

The API is not in this repository. It holds the model credentials and the
billing, and it is not open source. You need an account at
[intelapp.tech](https://intelapp.tech) for the extension to do anything; checks
cost credits, and new accounts get a few free.

If you want to point a fork at your own backend, the contract is one `POST` to
`/api/check` with `{ tweetId, tweetText }` and a bearer token, returning
`{ verdict, confidence, summary, sources }`. You will also need to add your host
to `host_permissions` in the manifest and to `DEFAULT_API_URL` in the service
worker.

## Contributing

Issues and pull requests are welcome, particularly:

- **site adapters that have drifted.** These sites change their markup without
  warning, and a selector that stops matching means the button silently stops
  appearing. If you can include a saved copy of the pop-up markup, that is worth
  more than a description of it.
- **new terminals.** The shape to copy is in `content/terminals.js`: find the
  pop-up, find the post text, find the post id, inject the button.

Please do not open issues about verdict quality here — that is the server's
judgement, not the extension's, and nothing in this repository would change it.

## Licence

MIT. See [LICENSE](LICENSE).
