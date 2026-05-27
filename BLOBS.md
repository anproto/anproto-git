# anproto-blobs

**Authenticated non-networked bytes for the ANProto stack.**

## In one paragraph (ELI5)

anproto-blobs is the library that lets the ANProto stack store and
share files of any size — git pushes, audio recordings, photos,
anything — by chopping them into chunks, addressing every chunk by
its sha256 hash, and verifying every byte on receipt no matter where
it came from. The bytes can live in your local cache, on another
peer over WebSocket, in IPFS, in a BitTorrent, on an HTTPS CDN, or
on a USB stick — we don't care, because the hash either matches or
it doesn't, and whoever told you about the blob via a signed ANProto
message is cryptographically on the hook for what they said. The
exact same code runs in a browser tab and on a Deno server, so
wiredove and the git forge are peers in the same little swarm
without anyone running a daemon, joining a DHT, or learning a new
content-addressing format.

---

The blob layer for the anproto stack. Lives in `~/Code/anproto-blobs/`
as a sibling package; `anproto-git` is its first consumer. `wiredove`
and `apds` will adopt it once it's proven here.

The family of taglines:

- **anproto** — Authenticated Non-networked Protocol
- **anproto-blobs** — Authenticated non-networked bytes
- **anproto-git** — Authenticated non-networked git

This document answers four questions, in order:

1. [What's the core design principle?](#core-principle-refuse-to-be-a-storage-system)
2. [How does the strategy work?](#design-at-a-glance)
3. [How does it compare to ssb-blobs, IPFS, git, BitTorrent, and Iroh — is it actually better?](#comparison)
4. [What's the implementation build order?](#build-order)

If you read only one section, read [Core principle](#core-principle-refuse-to-be-a-storage-system).

---

## Core principle: refuse to be a storage system

The most important design decision in this spec is what we refuse to
do.

Every content-addressed system we compare to tries to **be** the
storage system — its own pool of bytes, its own protocol, its own
namespace. They compete with each other (IPFS vs. BitTorrent vs.
Iroh) by adding features within their own walls.

anproto-blobs refuses to compete on storage. It sits one level above:

> **anproto-blobs is the integrity and provenance layer for
> content-addressed bytes from anywhere.**

The bytes can live in our default swarm, in IPFS, in a BitTorrent,
behind an HTTPS URL, on a USB stick, in S3, on a peer's local OPFS,
in a git repo — we don't care. What we provide is:

- **sha256 verification on receipt**, regardless of source.
- **provenance via signed ANProto messages** that bind bytes to
  authors.
- **chunking + manifests** so any combination of sources can serve
  parts of a blob in parallel.
- **isomorphic JS** so the same primitive runs in Deno and in
  browser tabs.

Because we refuse to be the storage system, we can federate over
all of them. Every blob reference in our spec can carry alternate
sources from any existing content-addressed system; our lib fetches
from whichever is reachable and verifies bytes regardless of where
they came from.

The corollary: there is no "anproto-blobs swarm" with a capital S.
There IS an implementation default (the apds-style WebSocket gossip
adapter) but it is just one source among many. Building anproto-blobs
isn't building another network — it's building the polyglot layer
that ties existing networks together with one integrity story.

This shapes everything downstream: the manifest schema, the fetcher,
the storage layer, the comparison story. **Win by not trying to win.**

---

## Spec vs. implementation: one schema, natural build order

The spec is intended to be **coherent in one pass**. Version `1` covers
the baseline manifest shape, and every optional feature listed in this
document is designed in from the start. Implementations should not need
flag days or incompatible rewrites to add support for later features;
if a genuinely incompatible manifest shape appears later, it gets a new
`version` or `type` and older implementations reject it honestly.

What has natural ordering is the **implementation**. Different
consumers need different subsets of the spec at different times
(see [Build order](#build-order) for the concrete sequence). But the
protocol — wire format, manifest schema, message types — is one
document, designed once.

How we make one-shot possible: every optional feature **degrades
gracefully**.

- A `chunks` entry without a `sources` field means "fetch from the
  default source (the impl's wired-in transport)." Impls that don't
  understand source bridges just do what they already do.
- A manifest with an `extends` field means "this version supersedes
  the named earlier version." Impls that don't track extends-chains
  treat the manifest as final; they miss live updates but don't
  break.
- A manifest with `derivedFrom` instead of (or alongside) `chunks`
  means "the bytes are a verified derivation of another blob."
  Impls without a derivation runtime report unavailable; that's
  honest and correct.
- A `blob-tombstone` message arriving at an impl that doesn't
  process tombstones is silently ignored — the bytes stay; no harm.

So: one spec, gracefully-degrading optional features, implementations
add capability over time without protocol churn.

---

## Maximal reuse of apds + anproto

This is the second load-bearing simplification. We don't build a
parallel stack — we **stand on what's already in apds and anproto**.
The whole library is mostly assembling existing primitives.

### What we get for free

| Need | Already in the stack | File |
|---|---|---|
| Isomorphic KV storage (Deno + browser) | Cache API works in both | confirmed via smoketest |
| String hashing (sha256+base64) | `an.hash(string)` | `anproto/an.js:12` |
| Signing | `an.sign(hash, key)` / `an.open(envelope)` | `anproto/an.js:22` |
| Content-addressed message store | `apds.make(data)` / `apds.get(hash)` | `apds/apds.js:236,243` |
| base64 codec | already used | `anproto/lib/base64.js` |
| Gossip wire convention (44-char hash vs binary blob) | already in apds and wiredove | `apds/relay.js`, `wiredove/gossip.js:15` |

### What we add (it's small)

| New piece | Lives in | Approx. LOC |
|---|---|---|
| Binary-aware `cachekv` (Uint8Array values, not strings) | `anproto-blobs/cachekv.js` | ~70 (shipped) |
| `hashBytes(uint8)` — raw-byte sha256 (vs string-encoded) | `anproto-blobs/hash.js` (initially) | ~5 |
| FastCDC chunker | `anproto-blobs/chunker.js` | ~300 |
| Canonical JSON manifest codec | `anproto-blobs/manifest.js` | ~80 |
| `blobs()` factory | `anproto-blobs/blobs.js` | ~80 |
| Source-bridge resolvers (HTTP, IPFS, ...) | `anproto-blobs/sources/*.js` | ~50 each, opt-in |

### Upstream prerequisites (eventually, not now)

`hashBytes` and binary-mode KV "belong" upstream in `anproto/an.js`
and `apds/lib/cachekv.js` + `apds/lib/idbkv.js`. Landing them upstream
forces coordination across Go/Rust/Python ANProto implementations.
That coordination is real work; we shouldn't block on it.

**Plan:** ship binary `cachekv` + `hashBytes` locally in
`anproto-blobs/` for now. Once the lib is proven and stable, upstream
the binary modes to apds and the `hashBytes` split to anproto, then
remove the local copies. Dependency direction stays one-way
(`anproto-blobs` depends on `anproto` + `apds`, never the other way)
the whole time.

### Why this matters

Three independent things follow:

1. **We don't have to defend a second KV abstraction.** apds chose
   Cache API + IndexedDB years ago; we get the isomorphism for free.
2. **Bug surface is small.** Most of the lib's logic is in 80 lines
   of glue plus the chunker. No transport stack, no separate identity
   stack, no separate envelope format.
3. **The lib's footprint in a wiredove bundle is tiny.** No new
   storage backend, no new signing primitives — wiredove already
   ships all of that for apds. anproto-blobs adds maybe 10 KB.

The corollary: when this spec compares against "Iroh's WASM bundle"
or "IPFS's daemon," we're not just smaller because we're newer — we're
smaller because we **structurally refuse to duplicate what apds
already does**.

---

## Goal

A federating integrity-and-provenance layer for content-addressed
bytes that the whole anproto stack can share, with these properties:

- **Big things work.** Git packs up to several GB. Audio files up to ~1 GB.
  No 5 MB ceiling.
- **Re-uploads are nearly free.** Push a slightly-changed pack: only the
  changed bytes hit the wire and the disk.
- **Range reads are cheap.** An `<audio>` element can scrub to second 30
  of a 200 MB podcast without downloading seconds 0–29.
- **One hash function for binary, stack-wide.** `sha256(rawBytes)` →
  base64, 44 chars. Same algorithm anproto-git, wiredove, and apds (after
  the apds string-vs-bytes split — see WORKORDER §apds and string vs
  bytes) all agree on.
- **Library, not daemon.** A Deno/ES-modules package both server and
  browser import. No IPC, no separate process, no extra port.
- **Reuses existing transports.** Whatever apds and wiredove already
  speak — WebSocket, Trystero, HTTP poll — is the transport. The blob
  layer plugs in over it.
- **Provenance from signed messages, not a DHT.** You discover blobs the
  way you already discover anything else in this stack: through messages
  signed by people you (transitively) follow.

Non-goals:

- A global content-addressed namespace. We aren't trying to be a CDN for
  the public internet.
- Incentivized / paid storage. No tokens, no Filecoin analogue.
- A new transport. We use whatever the host app has.
- Mutable pointers / "IPNS for ANProto." Mutability lives in signed
  messages, which already supersede each other by timestamp.

---

## Design at a glance

Two layers, both content-addressed by `sha256(bytes) → base64`.

### Chunk

The atomic stored unit. A variable-size byte range produced by a
content-defined chunker (FastCDC, min 64 KiB, avg 256 KiB, max 2 MiB).
Hashed exactly like a blob is hashed today.

A chunk has no metadata — it is just bytes on disk at
`chunks/<aa>/<bb>/<safe-base64-hash>`.

### Manifest

An ANProto content blob is just bytes addressed by `sha256(bytes)`.
A manifest is one of those content blobs whose bytes are canonical
JSON (JCS / RFC 8785) with `"type":"blob-manifest"` and `"version":1`.
It is not a new artifact class; it is a specific content shape. The
schema is complete from day one — every field below is part of the
protocol, though impls may implement only the subset they need:

```json
{
  "type": "blob-manifest",
  "version": 1,

  "size": 524288000,
  "sha256": "<base64 sha256 of file>",
  "chunker": "fastcdc-64-256-2048",

  "chunks": [
    {
      "hash": "<chunk-hash>",
      "size": 183742
    },
    {
      "hash": "<chunk-hash>",
      "size": 262144,
      "sources": [
        { "kind": "ipfs", "cid": "bafy..." },
        { "kind": "http", "url": "https://cdn.example/a.bin", "offset": 0, "length": 262144 },
        { "kind": "torrent", "infohash": "abc...", "piece": 42, "offset": 0, "length": 262144 },
        { "kind": "s3", "bucket": "anproto", "key": "blobs/abc" }
      ]
    }
  ],

  "mime": "video/mp4",
  "attrs": { "duration": 1800 },

  "extends": "<prev-manifest-hash>",
  "final": false,

  "derivedFrom": {
    "source": "<source-manifest-hash>",
    "op": "<wasm-module-blob-hash>",
    "params": {}
  }
}
```

The manifest is itself stored as ordinary content bytes under its own
hash. It is not recursively wrapped in another manifest, even if a very
large chunk list makes the manifest exceed the small-blob threshold. The
manifest's hash is the blob's external identifier. The `size`, `sha256`,
`chunker`, and the optional fields all go in the manifest body, not in
the hash — so the manifest's hash is just `sha256(manifestBytes)`,
nothing fancier.

The `sha256` field is the **whole-file** sha256 of the assembled bytes
— exactly what `sha256sum file` would produce. It does not affect the
manifest hash; it is published inside the manifest so consumers can
verify the reassembled bytes against an external integrity proof.
See [Integrity model](#integrity-model) below.

**Field-by-field implementation notes:**

- `version: 1` — the manifest schema version. Minor additive fields
  still degrade gracefully; incompatible changes use a new version or
  a new `type`.
- `chunks: [{ hash, size, sources? }, ...]` — canonical manifests MUST
  use object entries and MUST include each chunk's byte `size`. The
  list is ordered by assembled-file offset. `size` is what makes
  range reads possible without fetching earlier chunks.
- **Size sum check.** `sum(chunks[i].size)` MUST equal the manifest's
  top-level `size`. Manifests where the chunk sizes don't add up to
  the declared total size are invalid and MUST be rejected before
  attempting any chunk fetches. Catches transcription/serialization
  bugs cheaply, before any wire I/O.
- `sources:` — see [Source bridges](#source-bridges-federating-other-content-addressed-systems).
- `extends:` and `final:` — see [Live-growing blobs](#live-growing-blobs-streaming-publishing).
- `derivedFrom:` — see [Verifiable derivations](#verifiable-derivations).
  A manifest MUST contain either `chunks` or `derivedFrom`, never
  both. Hybrid combinations are not specified in v1; future shapes
  can add an explicit strategy field.
- All optional fields can be absent or ignored without breaking the
  basic chunk-list resolution path.

### Canonical JSON (JCS) — worked example

Per [Resolved decisions](#resolved-decisions) #2, manifest bytes are
canonical JSON per [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).
This means: object keys sorted lexically, no insignificant whitespace,
strings using the JSON-spec escape rules, numbers in the shortest
round-trippable form, UTF-8 with no BOM.

The pretty-printed manifest above is for human reading. The actual
bytes that get hashed look like this (no line breaks anywhere, keys
sorted, no padding):

```
{"chunker":"fastcdc-64-256-2048","chunks":[{"hash":"AbC...","size":183742},{"hash":"DeF...","size":262144}],"sha256":"XyZ...","size":445886,"type":"blob-manifest","version":1}
```

The hash of the manifest is `sha256(theseExactBytes)`. Any
implementation that emits the same logical manifest with the same
key/value content will produce byte-identical output and therefore
the same hash.

Reference: `JSON.stringify` is NOT canonical (key order is insertion
order, not sorted). Use a JCS serializer. A ~50-line pure-JS impl
ships in `anproto-blobs/manifest.js`; test vectors live in
`anproto-blobs/test/jcs-vectors.json` so a Go/Rust/Python port can
verify byte-for-byte equivalence.

### Manifests and ANProto authentication

The base form of a manifest is an unsigned content blob. Authentication
of "who said this manifest is real" comes from the **referencing
message**: when a signed `git-update` (or `post`, or anything else)
contains `pack: <manifestHash>`, that signed envelope authenticates
the reference. Trust chain:

```
signed envelope ─sig─▶ author identity
        │
        └─references─▶ manifestHash
                          │
                          └─bytes─▶ manifest body (sha256-verifiable)
                                       │
                                       └─references─▶ chunk hashes
                                                         │
                                                         └─bytes─▶ chunks (sha256-verifiable)
```

This is enough for the in-stack case where the manifest always travels
alongside (or downstream of) a signed message that points at it.

For cases where the manifest needs to travel **standalone with its
own authentication** — e.g. handed around on a USB stick or shared
via a one-shot HTTP link without the referencing message in hand —
the manifest can be wrapped in a full ANProto sig envelope, exactly
like any other apds content blob. The lib accepts both forms
transparently when fetching:

```js
// case 1: bytes parse as raw manifest body  → use as-is
// case 2: bytes parse as ANProto sig envelope → verify sig, extract body, use body
```

The unsigned form is the default because it's cheaper (no envelope
overhead, byte-identical regardless of who publishes the same file —
useful for cross-publisher chunk dedup at the manifest level). The
signed form is opt-in for standalone-authentication use cases.

Either way, the actual *chunk* bytes never need signing — they're
self-verifying against their hashes, and the manifest (signed or
referenced-by-signed) binds them to provenance.

### Blob handle

What the rest of the stack passes around. Always a 44-char base64
sha256 — looks identical to today's blob hashes. Could resolve to:

- a single chunk (small-blob fast path; manifest omitted)
- a manifest, which then resolves to N chunks (large-blob path)

The lib figures out which case it is at fetch time by attempting to
parse the bytes as canonical JSON and validate the full `type`,
`version`, `size`, `sha256`, `chunker`, and `chunks` schema.

This makes the small-blob fast path slightly non-trivial: a small file
whose literal bytes are themselves a valid blob manifest would otherwise
be ambiguous. To avoid that, `put()` MUST force the manifest path for
any small input that validates as a `blob-manifest`; the literal bytes
are then stored as a one-chunk file behind a wrapper manifest. In the
normal case, small files stay single chunks and their handle remains the
file's natural sha256.

### Small-blob fast path

If `bytes.length <= manifestThreshold` (proposed: ≤ 1 MiB), `put()`
stores the bytes as a single chunk and returns its hash. No manifest is
written. Wire and disk look identical to today's `anproto-git/blob.js`.

This is what keeps the design compatible with apds today: a 5 KB JSON
body or a 20 KB avatar never grows a manifest. The chunked path only
kicks in for things that actually benefit from it.

### Integrity model

A blob hash and its assembled bytes are bound by **two independent
cryptographic checks**, both end-to-end verifiable from any peer:

1. **Manifest integrity.** `sha256(manifestBytes) == manifestHash`.
   Proves the manifest is exactly what the signer pointed at — its
   chunk list, declared size, declared sha256, and chunker config are
   what the publisher wrote.
2. **Content integrity.** `sha256(assembledBytes) == manifest.sha256`.
   Proves the bytes the consumer reassembles from the chunks match the
   file the publisher claims to have stored.

For the **small-blob fast path** (no manifest) only check (1) applies,
but trivially: the blob hash IS the file's sha256, so external integrity
proofs apply with no extra work.

For the **manifest path** both checks combine to give the same end
property: the 44-char hash, the assembled bytes, and any externally-
published sha256 of the original file all line up.

This is the property IPFS doesn't give you. An IPFS CID for a file is
the hash of a dag-pb wrapper node, not of the file's bytes; `ipfs add
myfile` and `sha256sum myfile` produce unrelated numbers. Same file
added by two IPFS nodes with different chunker settings = different
CIDs. Our manifest hash has the same shape of weakness (different
chunkings → different manifest hashes), but the `sha256` field inside
the manifest is the file's natural hash and is identical regardless of
how the chunker split things, so externally-published file hashes
still verify and applications that care about file identity (not
manifest identity) have a stable handle to use.

Chunk hashes themselves are individually verifiable as they arrive
(`sha256(chunkBytes) == declaredChunkHash`), so a swarm fetch can
detect a bad-actor peer's tampered chunk on receipt rather than only
catching it at end-of-assembly. This is the same property bitswap has
at the block level.

### Library shape

The entire local-storage path is roughly this much code. Federation
sources and transport adapters layer on top; this is the kernel.

```js
import { cachekv }            from 'anproto-blobs/cachekv.js'
import { hashBytes }          from 'anproto-blobs/hash.js'
import { fastCDC }            from 'anproto-blobs/chunker.js'
import { parseManifest, stringifyManifest } from 'anproto-blobs/manifest.js'

const readManifest = (bytes) => {
  try {
    return parseManifest(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

export const blobs = async ({ appId = 'blobs', threshold = 1 << 20 } = {}) => {
  const db = await cachekv(appId)

  const put = async (input) => {
    const bytes = input instanceof Uint8Array ? input
      : new Uint8Array(await new Response(input).arrayBuffer())

    const looksLikeManifest = readManifest(bytes) !== null
    if (bytes.length <= threshold && !looksLikeManifest) {
      const hash = await hashBytes(bytes)
      await db.put(hash, bytes)
      return { hash, size: bytes.length }
    }

    const chunks = []
    for (const chunk of fastCDC(bytes)) {
      const h = await hashBytes(chunk)
      await db.put(h, chunk)
      chunks.push({ hash: h, size: chunk.length })
    }

    const manifest = stringifyManifest({
      type:    'blob-manifest',
      version: 1,
      size:    bytes.length,
      sha256:  await hashBytes(bytes),
      chunker: 'fastcdc-64-256-2048',
      chunks
    })
    const manifestBytes = new TextEncoder().encode(manifest)
    const manifestHash  = await hashBytes(manifestBytes)
    await db.put(manifestHash, manifestBytes)
    return { hash: manifestHash, size: bytes.length }
  }

  const get = async (hash) => {
    const bytes = await db.get(hash)
    if (!bytes) return null
    const m = readManifest(bytes)
    if (!m) return new Response(bytes).body  // single chunk

    return new ReadableStream({
      async start(c) {
        for (const chunk of m.chunks) {
          const cb = await db.get(chunk.hash)
          if (!cb) { c.error(new Error(`missing ${chunk.hash}`)); return }
          if (cb.length !== chunk.size) {
            c.error(new Error(`wrong size ${chunk.hash}`)); return
          }
          c.enqueue(cb)
        }
        c.close()
      }
    })
  }

  const has = async (hash) => db.has(hash)

  return { put, get, has }
}
```

That's the whole local-only library. Federation, signing, transport,
and source bridges are documented in their own sections and layer
on top of this kernel without changing it.

The transport layer (when the caller wants live peer fetching) plugs
in at the boundary where `get(hash)` returns `null`: optionally
delegate to a transport adapter that requests the hash from peers
and writes the answer into `db.put(...)` for the next read.

The transport adapter contract is tiny:

```js
const transport = {
  sendHash(hash, peerId?)         { /* deliver one hash to one or all peers */ },
  sendBlob(bytes, peerId?)        { /* deliver bytes (any size) */ },
  onHash(handler)                 { /* called when a hash arrives */ },
  onBlob(handler)                 { /* called when bytes arrive */ },
  peers()                         { /* list currently-reachable peers */ },
}
```

For anproto-git the adapter wraps WebSocket + HTTP poll. For wiredove
later, it wraps Trystero + WebSocket + HTTP poll. See
[Transport agnosticism](#transport-agnosticism) for the full
treatment.

### Isomorphism (browser ⇄ Deno)

The exact same JavaScript module runs in Deno servers and in browser
tabs, no transpile step, no Node shim, no environment branch. This
is *mostly inherited from apds*: apds already chose Cache API +
IndexedDB as its storage layer years ago, and Cache API is the one
storage primitive both runtimes natively provide. We just reuse it.

Confirmed via smoketest in Deno (May 2026): the
[`cachekv` shipped in `anproto-blobs/cachekv.js`](../anproto-blobs/cachekv.js)
passes binary put/get/has/rm/clear, large (5 MB) roundtrip, missing-
key handling, and overwrite semantics, all using the standard Cache
API that browsers also expose.

| Primitive | Browser | Deno | Notes |
|---|---|---|---|
| `globalThis.caches` (Cache API) | ✓ | ✓ | The default storage backend |
| `crypto.subtle.digest('SHA-256', ...)` | ✓ | ✓ | WebCrypto |
| `Uint8Array`, `ArrayBuffer` | ✓ | ✓ | No `Buffer`. Stack-wide rule. |
| `ReadableStream`, `WritableStream` | ✓ | ✓ | Whatwg streams |
| Canonical JSON parse/emit | ✓ | ✓ | local JCS helper |
| `TextEncoder` / `TextDecoder` | ✓ | ✓ | |
| `WebSocket` | ✓ | ✓ | Same constructor in both |
| `fetch` | ✓ | ✓ | Same API |

### Optional storage backends (perf upgrades)

`cachekv` is the default and handles every M0 use case. Two optional
backends exist for callers who need them:

- **`idbkv`** (browser only) — apds's existing IndexedDB wrapper.
  Faster than Cache API for many small reads/writes. Drop-in
  replacement for `cachekv` in browsers; falls through to `cachekv`
  in Deno (which has no IndexedDB).
- **`opfsStorage`** (browser, M2+) — `navigator.storage.getDirectory()`
  for blobs larger than what the per-origin Cache API quota allows
  (typically a few GB). Drop-in replacement when storage pressure
  matters.

Both honor the same `get/put/has/rm/clear` interface as `cachekv`.
Apps that hit storage-tier ceilings swap backends without changing
the rest of the code.

### Browser performance notes

Two things the kernel doesn't do but apps may want:

1. **FastCDC in a Worker.** Chunking a 500 MB file on the browser
   main thread will jank the UI for seconds. The chunker is pure JS;
   call it from a `Worker` for browser uploads. In Deno we run on the
   main event loop because there's no UI thread to protect.
2. **Persistence request.** Cache API in browsers may be evicted
   under storage pressure unless the page has called
   `navigator.storage.persist()`. Apps that store large blobs
   should request persistence on first significant write.

### Isomorphism discipline

Core stays pure ES modules: no `Buffer`, no `node:*` imports, no WASM
in the core (adapters may use WASM where it earns it), no environment
globals (`Deno.*`, `window.*`), no top-level env-only `await`. CI
runs the test suite in Deno and a browser-like environment; any
divergence fails the build.

---

## Transport agnosticism

ANProto stands for **Authenticated Non-networked Protocol** — bytes
carry their own integrity and (where wrapped in a sig envelope) their
own provenance, so they can travel over **any transport that can move
bytes**. anproto-blobs inherits this property and the spec is written
to preserve it.

### The blobs themselves bake in no transport

A chunk is bytes. A manifest is bytes (an ANProto content blob). Both
verify on receipt because their sha256 matches the hash they were
addressed by. **Nothing about a blob assumes any particular delivery
mechanism.**

Concretely, the following are all valid ways to "transfer" a blob —
the lib doesn't care which one happened:

- A WebSocket message from a peer.
- A WebRTC datachannel message via Trystero.
- A response body from `GET /blob/<hash>`.
- Bytes written to OPFS by a service worker handling a `share_target`
  intent (e.g. "Share to Wiredove" from an Android intent).
- Bytes from a file the user dragged into a `<input type="file">`.
- A USB stick. (`cp blobs/chunks/aa/bb/* /Volumes/mystick/...`)
- A QR-code stream for very small blobs.
- An email attachment.
- A `rsync` of `data/blobs/` between two servers.

In every case the lib's contract is the same: bytes arrive, sha256
them, route by hash. The transport is whoever shipped the bytes.

### Transport adapter: not a protocol, a contract

The "transport adapter" the lib accepts at construction time is a
**library contract for asking peers in a live network** — it is not a
wire protocol. The contract is small:

```js
const transport = {
  sendHash(hash, peerId?)         { /* deliver one hash to one or all peers */ },
  sendBlob(bytes, peerId?)        { /* deliver bytes (any size) */ },
  onHash(handler)                 { /* called when a hash arrives from any peer */ },
  onBlob(handler)                 { /* called when bytes arrive */ },
  peers()                         { /* list currently-reachable peers */ },
}
```

Anything that can do request/response of opaque payloads can implement
this. We will ship reference adapters for:

- **WebSocket** (`wsTransport`) — for apds / anproto-git / wiredove
  long-lived peer links.
- **Trystero / WebRTC** (`trysteroTransport`) — for wiredove
  browser-to-browser.
- **HTTP poll** (`httpPollTransport`) — for asymmetric/firewalled
  peers without a duplex socket.
- **HTTP serve + fetch** (`httpFetchTransport`) — read-through against
  `GET /blob/<hash>` (with `Range:` for chunk-level swarm fetch).
- **In-memory** (`memTransport`) — for tests; two stores backed by
  the same JS map, no wire at all.
- **Stdio** (`stdioTransport`) — for piping between processes,
  scripting, or two-process tests.

Apps can write their own. The transport doesn't have to be a network
transport at all — a `usbTransport` that scans `/Volumes/*/blobs/`
periodically is a legitimate implementation.

### Relationship to apds gossip

apds and wiredove's existing gossip is **utf-8-string-typed**: their
"blob" channel assumes a string body that begins with a 44-char
ANProto pubkey (a signed envelope). Concretely, `wiredove/gossip.js`'s
onBlob handler does `blob.substring(0, 44)` and calls `apds.make(blob)`
— both assume utf-8 strings and would mangle arbitrary binary bytes.

So anproto-blobs **does not piggyback on apds's existing `blob`
channel** for binary chunks. Instead, it runs on its own wire actions
within the same transport infrastructure (same Trystero rooms, same
WebSocket connections, same peer discovery). This is **additive**:
apds messages keep flowing through their existing channel unchanged;
anproto-blobs bytes flow through new actions in parallel. No changes
to apds or wiredove are required for them to coexist.

### The anproto-blobs wire convention: one binary channel

Two actions only:

| Action | Payload | Direction | Meaning |
|---|---|---|---|
| `bhash` | 44-char string | either way | "I want this hash" / "I have this hash" |
| `bbytes` | `Uint8Array` | either way | "Here are bytes — sha256 them; route by hash" |

That's the whole protocol. The receiver of `bbytes`:

1. Computes `sha256(bytes)`.
2. Stores them under that hash via cachekv.
3. Notifies any local fetcher waiting on that hash.

The receiver makes no other interpretation. **Both chunks and
manifests travel through `bbytes` identically** — manifests are bytes
too. Disambiguation between "this is a chunk" and "this is a
manifest" happens at `get()` time, not at the wire, via the
strict `blob-manifest` schema validation described above.

**Inspecting a manifest on the wire**: pure utf-8 round-trip, one
line of code:

```js
new TextDecoder().decode(bbytesPayload)
// → "{\"chunker\":\"fastcdc-64-256-2048\",\"chunks\":[..."
```

So manifests stay human-readable for debugging without ever forcing
them onto a separate text channel.

### Reference transport adapters

We will ship:

- **`trysteroBblobs`** — registers the `bhash` / `bbytes` actions
  inside an existing Trystero room (e.g. wiredove's per-pubkey
  rooms). Coexists with apds gossip in the same room.
- **`wsBblobs`** — text frame = `bhash`, binary frame = `bbytes`.
  Used by anproto-git's server-to-server WebSocket.
- **`httpBblobs`** — read-through against `GET /blob/<hash>` with
  standard HTTP `Range:` header. Browsers and any HTTP client.
- **`memBblobs`** — for tests; two stores backed by the same JS map.

Apps can write their own. The transport doesn't have to be a network
transport at all — a `usbBblobs` that scans `/Volumes/*/blobs/`
periodically is a legitimate implementation.

### Optional batched extensions

For network transports where batching meaningfully helps:

- `bwantlist` — `Uint8Array` carrying a length-prefixed list of hashes;
  receiver enqueues all of them as `bhash` wants.
- `bhaveset` — `Uint8Array` carrying a length-prefixed list of hashes
  the sender claims to hold; for fast intersection on peer connect.

Transports that don't implement these fall through to one-at-a-time
`bhash` — backward-compatible.

### Sneakernet works

Two peers with no network connection at all can exchange a USB stick
of chunk files (`blobs/chunks/`) and each one's existing manifests
will start resolving any chunks now present. No protocol negotiation
required — just copy the bytes into the storage directory and the
lib finds them on next `get(hash)`. This is the "non-networked" in
ANProto, made concrete.

### Boundary: dispatch and routing are app-level

The lib does not decide *which peer* should hold which blob, nor does
it implement routing across many hops. Those are the host
application's responsibility:

- anproto-git uses signed-message subscription to decide which
  authors' manifests to fetch.
- wiredove uses Trystero rooms keyed by pubkey for per-author
  discovery.
- A future bridge could implement gateway-style routing across
  federations.

This keeps the lib small. The interesting routing decisions live in
the apps that already make analogous routing decisions for messages.

---

## Storage layout

### Default: Cache API via `cachekv` (Deno + browser)

The default M0 storage is a flat KV: hash → bytes, via the
[`cachekv`](../anproto-blobs/cachekv.js) wrapper around the standard
Cache API. Same primitive, same code, both environments. The on-disk
representation is whatever the runtime's Cache API implementation
chooses (Deno persists under `~/Library/Caches/deno` or equivalent;
browsers use their own per-origin storage).

Chunks and manifests are stored uniformly under their sha256-base64
hash key. There is no separate "chunks" vs "manifests" directory —
both are bytes, both are keyed by hash, lib disambiguates at read
time via strict `blob-manifest` schema validation.

No filesystem sharding (the Cache API handles that internally). No
atomic-write dance (`cache.put` is atomic per key). No tmpfile-rename
gymnastics.

### Optional: filesystem layout (Deno, large-blob workloads)

For server workloads exceeding Cache API quota or wanting direct
filesystem access (e.g., for `rsync`-based backup, direct
`git index-pack --stdin` piping), an `fsStorage` backend can be
swapped in:

```
data/blobs/
  <aa>/<bb>/<safe-base64-hash>     # chunk OR manifest bytes
```

`<aa>/<bb>` is the first 2 + next 2 base64 chars of the hash with `/`
replaced by `_` and `+` by `-`. Same scheme as today's
`anproto-git/blob.js`.

This is opt-in for cases where direct file access matters; the
default cachekv path needs no filesystem at all.

### Optional: OPFS layout (browser, large-blob workloads)

For browser tabs storing very large blobs (multi-GB beyond Cache API
quota), an `opfsStorage` backend uses
`navigator.storage.getDirectory()` and the same `<aa>/<bb>/<hash>`
sharded layout. Call `navigator.storage.persist()` first to avoid
eviction under storage pressure.

---

## Fetcher behavior

A `get(manifestHash)` call:

1. Local check: `has(manifestHash)?` If yes, open the local file as a
   `ReadableStream` and return.
2. Otherwise, enqueue a single hash-want for the manifest into the host
   transport (the existing wiredove/apds queue path).
3. When the manifest arrives, parse canonical JSON, get `chunks: [...]`.
4. Open a `ReadableStream` for the caller. Internally start a *fetcher
   loop*:
   - Maintain a window of `adaptiveConcurrency()` in-flight chunk-wants
     (see `wiredove/adaptive_concurrency.js` — reuse exactly).
   - Schedule chunks **head-of-line first** so the stream produces bytes
     in order. Bias the window so chunks needed soon get more attention
     than chunks needed later.
   - For each chunk: ask up to two peers in parallel (mirrors
     wiredove's `pickHashTarget` "race two transports" pattern, but
     applied across peers within one transport too).
   - On chunk arrival: validate hash, write to local store, cancel
     duplicate wants for that chunk to other peers, advance the stream
     cursor.
5. When the last chunk lands, close the stream.

For `getRange(hash, start, end)`: same flow, but only enqueue chunks
whose offset ranges intersect `[start, end]`. Compute intersections from
the manifest's ordered `chunks` array, using each entry's required
`size` to compute cumulative offsets without fetching unrelated chunks.

### Bypassing the existing cooldown

`wiredove/network_queue.js:3` enforces `HASH_QUEUE_COOLDOWN_MS = 30000`
— don't re-ask for the same hash within 30 s. This is the right behavior
for single-message gossip but kills swarm parallelism for chunked
blobs. The fetcher talks to the transport adapter **directly**, not
through the top-level queue, so it isn't subject to that cooldown. The
adapter is responsible for letting the fetcher request the same hash
from multiple peers concurrently.

The top-level queue still owns single-hash gossip (small posts, message
envelopes); the fetcher owns chunked-blob bursts.

---

## Garbage collection

A chunk is **live** iff some current signed message transitively
references it.

Transitive reference graph:

```
signed envelope ─references─▶ message body hash
message body    ─references─▶ blob hash (manifest or chunk)
manifest        ─references─▶ chunk hashes (its `chunks: [...]`)
```

A chunk is **collectable** when:

1. No live signed message references it (directly or via a manifest),
   AND
2. The most recent message that did reference it is older than
   `gcGracePeriodMs` (default 30 days), AND
3. A repack/supersede message has propagated for any manifest it was
   part of, if applicable.

In v1 we leave GC off and just monitor disk growth. Same call as
WORKORDER §Blobs makes for the unchunked case: "we'll probably leave GC
turned off in v1 and revisit when storage growth becomes a real
concern."

There is no concept of "pinning." A signed message reference IS a pin.
This is the single biggest UX win over IPFS — see comparison below.

---

## Comparison

### vs. ssb-blobs

ssb-blobs is the secure-scuttlebutt blob layer (see `ssbc/`). It has been
deployed in the wild for ~10 years and is the design our stack
genealogically inherits from.

| Property | ssb-blobs | anproto-blobs |
|---|---|---|
| Hash function | sha256 of raw bytes, base64, prefix `&` and suffix `.sha256` | sha256 of raw bytes, base64, no prefix/suffix |
| File-vs-bytes hash | Blob hash = `sha256(file)` always (no chunking, so the property holds by construction). External sha256 proofs apply directly. | Small blob: same — hash = `sha256(file)`. Large blob: manifest hash ≠ `sha256(file)`, but `sha256` field inside the manifest equals `sha256(file)`, so external proofs verify post-assembly. |
| Chunk integrity | N/A (no chunks). Whole blob verified against its hash on receipt. | Each chunk verifiable against its hash on receipt; full file verified against `manifest.sha256` at end of assembly. |
| Per-blob size cap | ~5 MB (default; configurable but conventionally low) | None at protocol level. Per-server policy. |
| Chunking | No. Each blob is whole. | Yes (FastCDC) for blobs above threshold. |
| Dedup across blobs | None. Two near-identical files = two full copies. | Native via chunk reuse. |
| Range reads | No. | Yes. |
| Streaming reads | Yes (pull-stream). | Yes (`ReadableStream`). |
| Streaming writes | Limited. | Yes — chunker consumes a stream. |
| Discovery | Hops-based: replicate blobs referenced by messages from people within N hops. | Same idea: replicate blobs referenced by your subscription set. (Strictly: we owe a "hops" knob; v1 just uses `subscriptions.json`.) |
| Wire protocol | want/have over secret-handshake muxrpc + pull-streams. | want/have over whatever transport (WS, Trystero, HTTP poll). |
| Stack idioms | pull-stream throughout. Stay away. | async/await + ReadableStream throughout. |
| Maturity | Battle-tested over a decade. | New. Unknowns we'll discover. |
| Sociopolitical | Active community, but the protocol layer is hard to evolve (multi-impl coordination). | Smaller community; protocol is canonical JSON + sha256, evolves easily. |

**ssb-blobs wins on:** decade of production maturity; the 5 MB ceiling
is a free DoS bulwark we have to replicate as host policy; the
"a blob is bytes, hash it, send it" mental model is simpler than ours.

**We win on:** no size ceiling (audio, git packs, anything works);
cross-blob chunk dedup; range reads; no pull-streams (WORKORDER
ground rule #1).

### vs. IPFS

IPFS is the most-deployed content-addressed storage system. Multiple
implementations (Kubo in Go, Helia in JS, others). Default chunker is
fixed-size 256 KiB; UnixFS layers files over a Merkle DAG of those
chunks. Discovery is DHT-driven.

| Property | IPFS | anproto-blobs |
|---|---|---|
| Hash | CID = multibase + multicodec + multihash + digest. Hashes are sha256 by default, blake2b/3 optional. | Just base64(sha256(bytes)). 44 chars. No prefix. |
| File-vs-bytes hash | **File CID ≠ `sha256(file)`.** CID hashes the dag-pb wrapper node, not the raw file. External sha256 proofs don't apply. | **Small blob: hash = `sha256(file)`.** Large blob: manifest hash ≠ `sha256(file)`, BUT the manifest body publishes the file's natural sha256 as a field, so external proofs verify post-assembly. |
| Same file → same hash? | Only if chunker config and DAG layout match exactly. Otherwise two CIDs for the same file. | Manifest hash: same caveat (different chunkings → different manifest hashes). `sha256` field inside the manifest: yes, always the same for a given file. |
| Chunk integrity | Each block verifiable against its CID on receipt. Sound. | Each chunk verifiable against its hash on receipt. Plus full-file verifiable against `manifest.sha256` at end of assembly. |
| File representation | UnixFS dag-pb nodes; chunk = leaf; intermediate nodes = inner DAG. | Flat ordered chunk list in a canonical JSON manifest. No intermediate nodes (until we need them). |
| Chunker | Fixed-size 256 KiB default; rabin chunker is opt-in. | FastCDC default (var. 64K–2M). |
| Discovery | Kademlia DHT, public bootstrap nodes, mDNS for LAN. | Existing app gossip (subscription graph) + signed-message provenance. No DHT. |
| Block transfer | Bitswap. Send want-have/want-block to all connected peers. | Adapter-layer want/have over whatever transport the host provides. |
| Pinning | Manual. `ipfs pin add`. GC eats unpinned blocks. | None. Signed-message references are the pin. GC respects them. |
| Mutability | IPNS (DHT-published). Slow, often unreliable. | None at this layer. Mutability lives in signed-message timestamps. |
| Process model | Daemon. HTTP API. (`ipfs daemon`) | Library. Single ES-module package, in-process. |
| Code size | Helia + deps: many MB. Kubo: tens of MB. | Goal: low thousands of LOC. Sharing apds's existing code paths where possible. |
| Public gateway | Yes (ipfs.io). Any CID resolvable from the open web. | No. Each relay only serves what it has. |
| Incentivized storage | Filecoin overlay. | None. |
| Default visibility | Global. (Anything you `add` is announced.) | Local. Bytes go nowhere until a signed message references them and a peer asks. |

**IPFS wins on:** public global discoverability (DHT); Filecoin paid
storage; mature ecosystem (libraries, gateways, pinning services);
standardization with CID/multiformats.

**We win on:** the file's natural `sha256sum` still works (small-blob
hash IS the file hash; manifest path publishes it as a field — IPFS's
CID is the hash of a UnixFS wrapper, not the file); no DHT, no daemon,
no CIDs; pinning is automatic via signed-message references; default-
local (nothing leaks until a signed message references it).

### vs. git (as a content-addressed store)

Git is the most successful content-addressed store ever built (every
clone, every codebase, every commit, every backup-using-bup). We
already run it for the actual repo serving in anproto-git. Worth
asking carefully why we don't use it as the blob backend.

| Property | git | anproto-blobs |
|---|---|---|
| Hash function | sha1 (sha256 transition exists but is largely unadopted; interop is poor). | sha256, base64, 44 chars. |
| Hash of a file | `sha1("blob " + length + "\0" + bytes)`. Does **not** equal `sha1sum file`. | Small blob: `sha256(bytes)` exactly — matches `sha256sum file`. Large blob: manifest publishes file's natural sha256 as a field. |
| Object types | blob, tree, commit, tag (rich data model). | chunk, manifest (flat). Tree/commit shapes can be layered as new message types — see [DESIGN.md] discussion of `blob-tree` / `blob-commit`. |
| Chunking | None at the object level. Storage layer (packs) does cross-object delta compression. | FastCDC at the byte level (var. 64K–2M). |
| Dedup | Across-pack deltas, very strong for source code, weaker for binary blobs. | Chunk-level dedup, content-defined boundaries — works for any byte stream, including audio/video that doesn't delta well. |
| Pack determinism | Packs are NOT byte-deterministic. Re-emitting the same object set produces a different pack. | Chunks and manifests are deterministic given input bytes + frozen FastCDC seed. The hash of `get(hash)` always equals `hash`. |
| Wire protocol | Smart-HTTP / SSH pack protocol. Negotiates reachability via refs, transfers a delta-compressed pack. Excellent for source-code DAGs. | Generic want/have over whatever transport (WS, Trystero, HTTP poll). No reachability negotiation — chunks are independently addressable. |
| Discovery | Refs in a known repo. No global discovery. | Signed-message references. No global discovery. |
| Auth | Optional GPG/SSH commit signing (often skipped). | Every blob reference rides inside a required-signed ANProto envelope. |
| GC | Reachability from refs. `git gc`. | Reachability from signed messages. Grace period. |
| Browser support | Native: none. Polyfill: isomorphic-git, ~500 KB, slow on large repos. | Native in browser (OPFS storage backend, ES-module lib). |
| Daemon? | No (CLI tool you shell out to). | No (in-process library). |
| Maturity | 20 years, world's most-used tool. | Brand new. |

**Git wins on:** delta compression for source code (gold standard);
smart-HTTP as the most sophisticated content-aware transfer protocol
in production; 20 years of universal mental model and edge-case
handling.

**We win on:** sha256 throughout (git's sha1 + `"blob \0"` wrapper
means `git hash-object` ≠ `sha1sum file`); byte-deterministic recovery
(git can re-pack and produce different bytes for the same objects);
works for non-source data without bloating pack heuristics; runs in a
browser without a git binary or isomorphic-git's weight.

Git keeps owning git data; anproto-blobs owns everything else. The
two coexist cleanly.

### vs. BitTorrent

BitTorrent is the most-deployed swarm-fetch system on the open
internet. Architecturally it's the closest peer to what we're doing —
chunked content, swarm transfer, content addressing. If we're going
to claim "better than IPFS for chunked dedup," we should be honest
about how we stack up against the system that pioneered the wire-level
idea.

| Property | BitTorrent v1 / v2 | anproto-blobs |
|---|---|---|
| Hash | v1: sha1 (per piece + sha1 of info dict = infohash). v2: sha256 + per-file Merkle tree. | sha256 throughout. |
| File-vs-bytes hash | v1: infohash ≠ `sha1(file)`. v2: file root hash IS `sha256`-rooted Merkle of file (close but still not `sha256sum file`). | Small blob: matches `sha256sum file`. Large blob: matches via `manifest.sha256` field. |
| Manifest | `.torrent` file (bencoded metadata: file list, piece hashes, tracker URLs). Static, often distributed out-of-band. | Canonical JSON body inside the ANProto envelope, replicated like any other blob. Live, fetchable via the same gossip as content. |
| Magnet link | `magnet:?xt=urn:btih:<infohash>` — just the hash + optional tracker hints. | Just a 44-char hash. No magnet/URI wrapper. Bare hash IS the identifier. |
| Chunking | Fixed-size pieces (creator-chosen, typically 256 KB – 16 MB; modern v2 also has 16 KB block sublayer). | Variable-size (FastCDC, 64 KB – 2 MB), content-defined boundaries. |
| Cross-torrent dedup | Almost none in v1 (pieces are torrent-scoped). v2's per-file Merkle improves this. | Native — chunk hashes are global; same chunk in two different "torrents" is stored once. |
| Discovery | Trackers (centralized) + Mainline DHT (distributed). | Existing app gossip (subscription graph) + signed-message provenance. |
| Swarm mechanics | Choke/unchoke (tit-for-tat), rarest-first, endgame mode, super seed. Highly tuned. | Simpler: parallel want/have, head-of-line bias, optional 2-peer race. Not at BT's level of refinement. |
| Authenticity / provenance | None in protocol. You trust the magnet link's source. | Every blob reference rides inside a signed ANProto envelope — provenance is the protocol. |
| Process model | Separate client (qBittorrent, Transmission, etc.). | In-process library. |
| Browser support | WebTorrent (BT over WebRTC, requires trackers that bridge to WS). Real, works, but a parallel network from "real" BitTorrent. | Native — same code in wiredove tab as in Deno server. |

**BitTorrent wins on:** 25 years of swarm engineering (choke/unchoke,
endgame, super-seed); massive scale of deployment; standardized
through decades of BEPs.

**We win on:** signed-by-construction provenance (magnet links carry
none); cross-blob chunk dedup via global chunk addressing; no
trackers, no DHT, no bootstrap nodes; browser-native without
WebTorrent's parallel-network workarounds; live-growable manifests.

### vs. Iroh

Iroh (`iroh-blobs`) is the most directly architecturally comparable
*modern* project — built by ex-IPFS engineers at n0 specifically
because IPFS's design choices were not panning out. It does almost
exactly what we're doing, with different cryptographic primitives
and a Rust-first implementation. If anyone asks "why didn't you
just use Iroh?" this section is the answer.

| Property | Iroh | anproto-blobs |
|---|---|---|
| Hash | blake3 | sha256 |
| Verified streaming | **Bao tree** — every byte range of a blob is independently verifiable against the root hash without holding adjacent ranges. | Per-chunk verification on receipt + whole-file `sha256` field at end of assembly. No mid-stream range verification against a single root. |
| Chunking | Bao's fixed 1024-byte sub-chunks for verification; larger blob-level chunks for transfer. | FastCDC variable 64K–2M for both storage and transfer. |
| Identity | Per-peer ed25519 (a "NodeId"). Peers connect peer-to-peer; blob references aren't authored at protocol level. | Per-author ANProto ed25519. Every blob reference rides inside a signed envelope authored by a specific pubkey. |
| Discovery | DNS-over-Pkarr + n0-operated (or self-hosted) relay servers. | Existing signed-message gossip; subscription graph. |
| Transport | QUIC (direct between peers; via relay for NAT). | Adapter-provided — whatever the host runs. |
| Tickets | "Blob tickets" = hash + node discovery info, like magnet links with embedded routing. | Just the 44-char hash. Discovery comes from the signed message that referenced it. |
| Mutability | `iroh-docs`: CRDT-based key-value layer on top of blobs. | None at this layer. Mutability is the messaging layer's job. |
| Implementation | Rust core; JS access via WASM bindings (`@n0-computer/iroh`). | Pure JS / ES modules. Isomorphic Deno + browser. |
| Browser story | WASM bundle wrapping Rust core. Substantial (low MB), foreign idiom in JS code. | Native ES modules + OPFS. Bundle in tens of KB. |
| Maturity | Real Rust engineering, production-grade, a real team and company. | Brand new, single project. |
| Code surface | Large (Rust crate ecosystem). | Small (low thousands of LOC target). |

**Iroh wins on:** Bao verified streaming (any byte range verifies
against the root hash without holding adjacent ranges — genuinely
more elegant than our manifest + per-chunk approach); QUIC transport
with built-in NAT traversal; real Rust performance and a full-time
team behind it; `iroh-docs` CRDT mutable doc layer.

**We win on:** true JS isomorphism (Iroh's "browser support" is a
WASM bundle wrapping the Rust core); stack-wide sha256 (Iroh's blake3
fights our existing stack); external `sha256sum` proofs work against
our hashes; provenance via signed ANProto envelopes; no relay infra
to run; ES modules end-to-end, no FFI/WASM in core.

**We lose honestly on:** no verified mid-stream byte-range integrity
(Bao solves this; we'd need a `blob-manifest-bao` alternative to
match — additive, doesn't break compat); no QUIC; no built-in
mutability layer. The Bao gap is the one to remember — it's the only
place an existing system has something structurally beyond what we
offer.

### Honorable mention

- **Hypercore / dat / Hyperdrive.** Spiritually closest predecessor to
  the "everything is a browsable, replicable, signed repo" vision —
  Beaker Browser made it real for a few years. Closer to our
  signed-message log + future `blob-tree` than to anproto-blobs proper.

---

## Verdict

For the workload this stack is being built around — signed-message
forge state and live social content on a small federation of
operator-run relays, where the same code has to run in a Deno server
and a browser tab — yes, this is the right shape, and structurally
better than the alternatives. ssb-blobs can't carry the bytes; IPFS
adds operational weight (daemon, DHT, CIDs) we don't need; git
doesn't run in browsers; BitTorrent has no signed provenance; Iroh
asks us to swallow Rust+WASM+blake3 instead of staying in stack-native
JS+sha256.

For workloads outside our scope (globally-discoverable petabyte
archives, paid storage incentives, cross-org standardization), we
don't compete — we federate. Source bridges let any of those
ecosystems serve our chunks; our integrity and provenance layers
sit on top. See [Source bridges](#source-bridges-federating-other-content-addressed-systems).

---

## Source bridges: federating other content-addressed systems

This is the load-bearing federation feature. Per the [Core principle](#core-principle-refuse-to-be-a-storage-system),
we refuse to be the storage system; we are the integrity layer over
content-addressed bytes from anywhere. This section is how that gets
realized concretely.

Each chunk entry in a manifest can carry alternate sources beyond the
default "fetch from our transport peers" path:

```json
{
  "chunks": [
    {
      "hash": "<chunk-sha256>",
      "size": 262144,
      "sources": [
        { "kind": "ipfs", "cid": "bafyXyz...", "offset": 0, "length": 262144 },
        { "kind": "torrent", "infohash": "abc...", "piece": 42, "offset": 0, "length": 262144 },
        { "kind": "http", "url": "https://cdn.example/file.bin", "offset": 524288, "length": 262144 },
        { "kind": "s3", "bucket": "anproto", "key": "blobs/abc" },
        { "kind": "magnet", "uri": "magnet:?xt=urn:btih:...", "offset": 0, "length": 262144 },
        { "kind": "git", "repo": "https://github.com/owner/repo.git", "oid": "abc" }
      ]
    }
  ]
}
```

The lib's fetcher tries sources in priority order with concurrent
fallback, sha256-verifying every byte on receipt regardless of
source. **Wrong bytes from any source are rejected the same way
wrong bytes from a peer are.** Trust is in the hash, not the source.
Each source MUST either return exactly the chunk bytes or include enough
source-local `offset` and `length` metadata for the source plugin to
slice exactly those bytes. The returned byte length MUST equal the
chunk entry's `size` before the hash check can pass.

### Source plugin contract

A source plugin is tiny:

```js
const httpSource = {
  kind: 'http',
  async fetch(source, chunk) {
    const { url, offset = 0, length = chunk.size } = source
    const end = offset + length - 1
    const res = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` } })
    return res.body          // ReadableStream; lib verifies sha256 as bytes flow
  },
  async has({ url }) { /* optional: quick availability check */ }
}
```

Apps register plugins at lib construction:

```js
const store = blobs({
  storage:   fsStorage('./blobs'),
  transport: hostTransport,
  sources:   [ ipfsSource, httpSource, torrentSource, ... ]
})
```

We ship reference plugins for:

- `http` — `GET <url>` (with `Range:` for chunk-level fetch).
- `ipfs` — public gateway (`ipfs.io`, configurable to your own).
- `torrent` / `magnet` — via WebTorrent in browser; via a small BT
  client adapter in Deno.
- `s3` — signed-URL fetch via standard AWS API.
- `git` — fetch a git blob object by oid from a remote repo.

Other plugins are app-supplied; the contract is the four-method
interface above.

### What this gets us

We inherit IPFS's global discovery (cite a CID, any peer resolves
via public IPFS gateways), BitTorrent's swarm scale (big public
files point at existing torrents), CDN economics (an `https://...`
source is one mirror among many), zero-cost migration (existing
IPFS pins / torrents / S3 buckets become referenceable without
re-uploading), and operational resilience (if our peer set is
unreachable, alternate sources work). The lib never becomes any of
these systems; we just consume their bytes and verify against our
hash.

### What this is NOT

We are not implementing IPFS, BitTorrent, or any other backing
system. The CID/infohash/URL in a source is for *that system to use*
when fetching; our sha256 is what *we* verify against. Two
independent integrity claims that we cross-check at our edge.

---

## Live-growing blobs (streaming publishing)

Every comparison target assumes a blob is finished at upload time.
Real publishing is rarely like that — podcasters add episodes,
documents grow, chat logs append, live streams stream.

A manifest can be extended by publishing a new manifest with
`extends: <prev-manifest-hash>` and `final: false`:

```json
{
  "type": "blob-manifest",
  "version": 1,
  "size": 524288000,
  "sha256": "<current-file-sha256>",
  "chunker": "fastcdc-64-256-2048",
  "chunks": [
    { "hash": "<hash-1>", "size": 262144 },
    { "hash": "<hash-2>", "size": 262144 },
    { "hash": "<hash-3>", "size": 131072 }
  ],
  "extends": "<prev-manifest-hash>",
  "final": false
}
```

A "live blob" is a chain of manifest versions, each one signed by
the publisher's referencing message. Subscribers follow the chain
via the same gossip path that delivers any other message and
materialize new chunks as they arrive.

### What this enables

Live audio/video playback while still being recorded, append-only
logs as native blobs (chat, sensor data, build logs), and cheap edit
semantics where replacing a section is a new manifest version adding
one chunk.

### Graceful degradation

A minimal impl that doesn't follow `extends` chains treats the most
recently received manifest as final. It misses live updates but
doesn't break. A consumer that does follow chains keeps a small
local index `(currentManifest, watchingForUpdates)` per blob.

---

## Verifiable derivations

The most ambitious feature in the spec, and the one that no other
content-addressed system has anything like. A manifest can declare
itself as a function of other blobs:

```json
{
  "type": "blob-manifest",
  "version": 1,
  "size": 1048576,
  "sha256": "<expected-output-sha256>",
  "chunker": "fastcdc-64-256-2048",
  "derivedFrom": {
    "source": "<input-manifest-hash>",
    "op": "<wasm-module-blob-hash>",
    "params": { "width": 256, "height": 256 }
  }
}
```

The lib runs the WASM module (in a sandbox; both Deno and browser
have `WebAssembly.instantiate` built in), feeds it the input bytes
plus `params`, and verifies the output's sha256 matches the declared
`sha256`. If it matches, the bytes are accepted as if fetched
directly.

A manifest MUST contain either `chunks` or `derivedFrom`, never
both. Hybrid (some chunks stored, some derived) has no clear use case
in v1 and multiple incompatible interpretations (cache? prefix
+ suffix? fallback?). If a real consumer eventually needs it, it
lands additively as an explicit strategy field — not as silent
ambiguity in the base schema.

### What this enables that nobody else has

Lazy materialization (a 4K video's 720p version is a derivation,
not stored bytes); cross-format dedup (FLAC stored once, MP3 derived
on demand); verified thumbnails and extracts (`resize(photo, 256)`,
`slice(podcast, [s, e])` as cryptographically equivalent to running
the verified code); verifiable AI artifacts (a generated image's
"weights + prompt" is a derivation); truth-in-media (edits as
derivation chains back to source).

The closest existing analogue is Nix derivations. No blob store
has anything like this.

### Determinism requirements

WASM modules used as ops MUST be deterministic — same input bytes +
same params produce the same output bytes, byte-for-byte. This means:

- No clocks, no `Date.now()`.
- No random sources (or only from a seed in `params`).
- No filesystem, no network.
- No threading non-determinism (single-threaded WASI subset).
- Floating-point determinism (avoid `f32`/`f64` ops that vary by
  platform; use integer math or explicitly-deterministic FP libs).

These constraints are real but achievable. ffmpeg.wasm, imagemagick-wasm,
sharp's wasm bindings, and many smaller libs already satisfy them or
can be configured to. A "derivation runtime" spec defines the
calling convention.

### Graceful degradation

An impl without a derivation runtime sees the `derivedFrom` field,
recognizes it can't materialize, and reports "needs derivation
runtime" rather than failing silently. Apps that need derived
content load a runtime; apps that don't, don't.

This is the only feature in the spec that's both load-bearing for
"impossibly better" and operationally hard. The protocol slot is
free; the implementation cost is real.

---

## Message types

Manifests are one ANProto message type. The spec defines a small
family of related types:

```json
{
  "type": "blob-manifest",
  "version": 1,
  "size": 0,
  "sha256": "...",
  "chunker": "fastcdc-64-256-2048",
  "chunks": []
}
```

```json
{
  "type": "blob-tombstone",
  "version": 1,
  "target": "<manifest-hash-to-revoke>",
  "reason": "Optional human-readable explanation.",
  "ts": 1779900000000
}
```

Honoring tombstones is per-server policy: an instance can be
configured to drop, retain, or quarantine on receipt. The protocol
just makes the request first-class and verifiable.

```json
{
  "type": "blob-haveset",
  "version": 1,
  "peer": "<peerId>",
  "hashes": [],
  "ts": 1779900000000
}
```

```json
{
  "type": "blob-pin",
  "version": 1,
  "target": "<manifest-hash>",
  "priority": 1,
  "ts": 1779900000000
}
```

All four are valid ANProto signed messages; same envelope as
`post`, `git-update`, etc. Apps that don't process a given type
ignore it.

---

## Build order

This replaces the "v1/v2/v3 protocol" framing. There is one baseline
schema with explicit manifest versions; implementations build features
in the order their consumers need them.

The minimum viable impl is **small** — under 1500 LOC of JS — and
serves anproto-git phase 1. From there, capability accretes as
consumers come online.

| Capability | Consumer that needs it | When |
|---|---|---|
| chunk + manifest core | anproto-git phase 1 (sign on push) | M0 |
| `fsStorage` (Deno) | anproto-git phase 1 | M0 |
| `wsTransport` (apds-shape) | anproto-git phase 3 (peer replication) | M0 |
| Batched want/have JSON envelopes | anproto-git phase 3 | M0 |
| Per-blob hard cap + per-fetch budget | safety baseline | M0 |
| `opfsStorage` (browser) | wiredove integration | M1 |
| `trysteroTransport` | wiredove integration | M1 |
| `httpFetchTransport` + `Range:` reads | browser swarm + relay fallback | M1 |
| `http` source plugin | first federation win | M1 |
| `ipfs` source plugin | meta-store realization | M2 |
| `torrent` / `magnet` source plugins | big-file inheritance | M2 |
| `extends` chain handling (live blobs) | wiredove audio streams | M2 |
| `blob-tombstone` honor policy | operator moderation | M2 |
| `s3` / `git` source plugins | as demand surfaces | on-demand |
| Derivation runtime (WASM sandbox) | cross-format dedup, thumbnails | M3 |
| Reference WASM ops (slice, resize, transcode) | useful derivation library | M3 |
| Tree-of-manifests for >10GB blobs | only if pack sizes demand | on-demand |

**Milestone framing:**

- **M0 — Forge online.** anproto-git phases 1–3 ship. anproto-blobs
  is a small Deno+WS lib. Federation slots in the schema exist
  but no source plugins yet. ~1500 LOC.
- **M1 — Browser parity + first federation.** wiredove can use
  anproto-blobs identically to anproto-git. HTTP source plugin
  works. Range reads, OPFS storage. ~2500 LOC.
- **M2 — The meta-store realized.** IPFS + torrent source plugins.
  Live-growing manifests. Tombstone policy. This is where "win by
  not trying to win" becomes operationally visible.
- **M3 — The moonshot.** Derivation runtime + reference WASM ops.
  Verifiable thumbnails, transcodes, slices. This is the
  "unambiguously beyond any other system" milestone, and the
  hardest engineering work.

**Schema versioning, no flag days.** Version `1` is the baseline
manifest schema. Additive optional fields keep using version `1`;
incompatible changes use a new `version` or a new `type` (for example
`blob-manifest-bao`). Manifests produced at M0 still resolve at M3;
newer manifests either degrade honestly or report "unsupported
manifest version/type."

**No flag days, no deprecations.** Apps that ship at M1 keep working
forever as long as the host they speak to runs at least M0.

The protocol "wins from the getgo" because it was designed once,
holistically, with every feature degrading gracefully. Implementation
build order is just how we get there with finite engineer-hours;
the system is coherent from M0 onward.

---

## Integration with anproto-git

The phases below mirror WORKORDER's phases 1–3. Each one names what
the blob lib needs to support and what changes in anproto-git's own
code.

### Phase 1 — sign on push (blob side)

What anproto-git needs:

- `blobs.put(stream)` that consumes the validated pack as a ReadableStream
  (we already have it post-`git index-pack`).
- Returns `{ hash, size }`. `hash` is what goes into the `git-update`
  message's `pack` field.

What the lib does internally:

- If the pack is small (≤ 1 MiB — rare for real packs but possible for
  trivial pushes), single-chunk fast path. Returned hash IS
  `sha256(packBytes)`.
- Otherwise, FastCDC the stream as it arrives, write chunks to
  `chunks/`, compute the running `sha256(packBytes)` on the way through
  the chunker, build a manifest including that whole-file sha256, store
  the manifest, return manifest hash.

Done when:

- `git-update.pack = <manifestHashOrChunkHash>` is byte-identical to
  what a peer with only `blobs.get(hash)` could verify.
- For a chunked pack: the manifest's `sha256` field equals
  `sha256(originalPackBytes)`, verifiable by piping
  `blobs.get(hash)` into `shasum -a 256`.
- For a single-chunk pack: the hash itself equals
  `sha256(originalPackBytes)`.

### Phase 2 — rebuild from log (blob side)

What anproto-git needs:

- `blobs.get(manifestHash) → ReadableStream` to pipe into `git
  index-pack --stdin` for replay.
- `blobs.has(manifestHash)` so we can skip already-applied updates.

What the lib does:

- Stream from local store if present.
- If not present, fetch (in phase 2 there's no real network yet — fail
  fast; phase 3 enables real fetch).

Done when:

- Delete `repos/` directory; restart server; clone works; commits match
  pre-delete state.

### Phase 3 — peer replication (blob side)

What anproto-git needs:

- Plug its WebSocket peer handling into `blobs.transport` adapter.
- On receiving a `git-update`, parse its manifest hash, enqueue
  fetch.
- During fetch, the lib bursts chunk-wants to all connected peers and
  validates each chunk's hash on arrival.

What the lib does:

- Implements the batched `{type:'want', hashes:[...]}` extension to
  the existing protocol. Falls back to single-hash want if the peer
  doesn't ack the JSON envelope.
- Tracks in-flight per (chunk, peer), dedupes on arrival.

Done when:

- Two-server test: A receives push, manifest + chunks gossip to B
  within 2 s, clone from B succeeds.
- Replication of a 200 MB push between two LAN-local servers completes
  in roughly bandwidth-bound time, not in O(roundtrips × chunks) time.

### Out of scope for the forge milestone

These are useful but not blockers for "fully functional working git
forge":

- OPFS storage backend (browser; needed by wiredove eventually).
- Encrypted chunks (recipient lists; private repos in v2).
- Tree-of-manifests for >10 GB blobs (we'll cross that bridge if pack
  sizes demand it).
- Public HTTP `GET /blob/<hash>` endpoint with `Range:` support (nice
  for browser fallback; defer until wiredove integration).
- Pack repacking (WORKORDER §Blobs `git-repack` message).
- Native chunk dedup *across* repos (currently each push is chunked
  independently; chunks happen to dedupe if their byte boundaries
  align, which FastCDC makes likely).

---

## Resolved decisions

These were open in earlier drafts; closed here so we can ship without
re-arguing them. Each decision is justified, and where a measurement
or future signal could change it, that signal is named.

1. **FastCDC constants: `min=64KB, avg=256KB, max=2MB` ("fastcdc-64-256-2048").**
   Defaults from the FastCDC paper, well-validated by restic. Frozen
   for v1; new constants would ship under a new identifier
   (`fastcdc-...-v2`), never overwrite. Signal-to-change: if the first
   real anproto-git pack-dedup measurement shows <30% reuse on push
   N+1, retune before freezing for outside impls.

2. **Manifest format: canonical JSON (JCS / RFC 8785).**
   Manifest bytes MUST be UTF-8 encoded canonical JSON. Object keys are
   sorted according to JCS, insignificant whitespace is omitted, numbers
   follow the JSON canonicalization rules, and line endings are not part
   of the format. This gives cross-implementation manifest hashes a
   published deterministic base instead of a hand-rolled YAML profile.
   Signal-to-change: only if ANProto itself later standardizes a
   different canonical content encoding stack-wide.

3. **Manifest size threshold for fast path: 1 MiB.** Below 1 MiB,
   store as a single chunk, no manifest. Reasonable default that
   keeps small apds-style content (avatars, messages, posts) on the
   same wire shape as today's blobs. Signal-to-change: if real
   measurement shows most "interesting" content lives just above
   this boundary, drop to 256 KiB.

4. **Default manifest authentication: unsigned.** Manifests are
   ANProto content blobs; authentication comes from the signed
   message that references them. Cheaper, byte-identical across
   publishers (preserves cross-publisher manifest dedup). Opt-in
   signed-envelope wrapping is supported for blobs that need to
   travel standalone with their own provenance.

5. **Wire protocol: two binary actions only (`bhash`, `bbytes`).**
   See [Transport agnosticism](#transport-agnosticism). Manifests
   and chunks both ride `bbytes`. Manifests stay human-readable
   via `TextDecoder` for debugging.

6. **Peer selection in fetcher: race 2 peers per chunk initially,
   adaptively drop to 1.** If both peers respond within RTT budget
   on the first few chunks, the fetcher drops to 1 peer per chunk
   for the rest. If any peer is slow, expand back to 2 (or to the
   next peer). Reuses wiredove's `adaptive_concurrency.js` for the
   cap.

7. **Per-blob hard cap: 5 GB, per-fetch budget: 5 GB.** Both
   configurable per server. Match WORKORDER §Blobs `maxBlobSize`.
   A push or fetch exceeding either is rejected at the host policy
   layer, not the protocol.

8. **Default storage backend: `cachekv` (Cache API).** Works in
   Deno and browser unchanged. `idbkv` (browser-only IndexedDB) and
   `opfsStorage` (browser-only OPFS) are opt-in upgrades for
   workloads that hit Cache API perf or quota limits.

9. **Public HTTP endpoints: ship both `GET /blob/<hash>` and
   `GET /chunk/<hash>`.** Both with standard `Range:` header support.
   The first does manifest resolution server-side (good for naive
   clients); the second exposes raw chunks (faster for browser swarm
   fetch). Costs are nearly identical once the storage layer exists.

10. **GC + `git-repack` interaction: 30-day grace period + 7-day
    no-fetch rule.** A chunk superseded by a repack is dropped only
    after both 30 days have passed *and* no fetch has touched it in
    the last 7 days. Server-configurable. Default conservative.

11. **Reverse lookup by file sha256: deferred to wiredove integration
    (M2).** anproto-git uses manifest-hash references natively
    (`pack: <manifestHash>`). Wiredove later wants to resolve
    `image: <fileSha256>` references — at that point we add a small
    `fileSha256 → [manifestHash, ...]` index and a `bhash-for-file`
    wire verb.

12. **`apds.hashBytes` upstream split: deferred; polyfill locally.**
    Ship `hashBytes` inline in anproto-blobs (~5 lines). When the lib
    is proven and stable, land the upstream split in `anproto/an.js`
    and remove the local copy. Same for the binary-mode `cachekv`
    living in `anproto-blobs/` until upstreamed to `apds`.

13. **No `idbkv` from anproto-blobs in M0.** Use cachekv exclusively;
    add idbkv as an opt-in browser perf upgrade only when actual
    measurement shows Cache API is a bottleneck.

14. **FastCDC implementation: write our own (~300 LOC, no deps).**
    Port the reference C implementation from the paper, but freeze the
    actual gear table, mask rules, normalization behavior, and cutpoint
    conditions in this repo. Ship test vectors before any second
    implementation exists: input bytes, expected chunk boundary offsets,
    chunk hashes, and final manifest hash. Avoids pulling an npm dep
    with unknown maintenance status; chunker determinism is too
    important to delegate.

15. **Default Trystero room for anproto-blobs: per-author pubkey**
    (same as wiredove's existing rooms). Co-located with apds gossip
    on the same room. Anproto-blobs uses its own actions (`bhash`,
    `bbytes`); doesn't touch apds's existing actions.

16. **Manifest entries include chunk sizes.** Every canonical chunk
    entry is `{ hash, size, sources? }`. The size is part of manifest
    integrity, makes range reads possible without fetching earlier
    chunks, and lets fetchers reject wrong-length source responses
    before or during hashing.

17. **Source plugins return exact chunk bytes.** A source entry may
    point at a larger object only if it includes source-local `offset`
    and `length` (or equivalent plugin-specific fields) so the plugin
    can yield exactly the chunk's bytes. The lib verifies both length
    and sha256 before storing the result.

18. **Manifest-looking small files are wrapped.** If small input bytes
    validate as a `blob-manifest`, `put()` stores them through the
    manifest path rather than returning their raw hash. This preserves
    unambiguous `get(hash)` behavior while keeping the normal small-file
    fast path unchanged.

---

## What's not in this spec

- **Encryption.** Per WORKORDER §Blobs "Encrypted blobs," v2+ work.
  Same hashing rules but bytes are ciphertext. Recipient list in the
  referencing signed message.
- **Public-internet gateway.** v2+ if at all. The current scope is
  operator-federated relays, not a global CDN.
- **Mutability.** Out of scope at the blob layer. Mutability is
  already solved at the message layer (latest-timestamp-wins).
- **Pinning service / paid hosting.** Out of scope. If wanted, build
  externally and integrate via signed-message subscription policy.
- **Cross-codebase migration plan.** Not until the forge proves the
  design. After that, port wiredove's image path, then apds's binary
  body handling, then resolve the string-vs-bytes split upstream.
