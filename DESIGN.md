# anproto-git design notes

Working notes for getting from this scaffold to a real git remote.

## Goal

```
git push anproto://<authorPub>/<name> HEAD
```

…such that:

1. The push is validated by the receiving server using normal git tooling
   (we don't reinvent pack parsing).
2. The receiving server publishes an ANProto-signed message announcing the
   new refs and the content hash of the validated pack.
3. Any other anproto-git server that replicates the messages + blobs can
   reconstruct the same repo state, end up with the same `git log` output,
   and serve it back to a `git clone`.

(2) is what makes this an "anproto-git" rather than just "another git
server."

## Layers

```
┌─────────────────────────────────────────────────┐
│  smart-HTTP   (info/refs, upload-pack, ...)     │  ← git client talks to this
├─────────────────────────────────────────────────┤
│  git http-backend (spawned per request)         │  ← shells out to git
├─────────────────────────────────────────────────┤
│  bare repo on disk: repos/<author>/<name>.git   │  ← derived view (v0: authoritative)
├─────────────────────────────────────────────────┤
│  binary blob store: blobs/<base64sha256>        │  ← packs land here
├─────────────────────────────────────────────────┤
│  ANProto message store (apds-compatible)        │  ← git-repo / git-update messages
└─────────────────────────────────────────────────┘
```

## Message types

### `type: git-repo`

YAML body, signed with ANProto, published once when a repo is created:

```yaml
type: git-repo
name: anproto-git
description: optional
```

The author's pubkey + repo name form the canonical ID: `<authorPub>/<name>`.
No message-hash-derived identity; pushes are addressed by `<author>/<name>`,
not by a content-hashed handle.

### `type: git-update`

Published after every successful push. Contains the new ref state and a
pointer to the pack blob:

```yaml
type: git-update
repo: <authorPub>/<name>
refs:
  refs/heads/main: <sha1>
  refs/heads/dev: <sha1>
pack: <base64sha256-of-pack-bytes>
index: <base64sha256-of-idx-bytes>
num_objects: 142
```

The `pack` and `index` fields are hashes into the binary blob store. A
replicating peer:

1. Receives the signed `git-update` message
2. Asks for the pack blob by hash
3. Validates: hash matches; pack indexes cleanly via `git index-pack`
4. Unpacks into its own local `repos/<author>/<name>.git`
5. Updates refs to match

## Push flow

```
client                          anproto-git server
  ─ POST /git/A/r/git-receive-pack ────────►
                                  parse pkt-lines for ref updates
                                  body bytes after flush = packfile
                                  spawn: git index-pack --stdin -o idx pack
                                  hash(pack) → packHash
                                  hash(idx)  → idxHash
                                  blob.put(packHash, packBytes)
                                  blob.put(idxHash,  idxBytes)
                                  apply refs in repos/A/r.git
                                  publish signed git-update message
  ◄──── pkt-line "unpack ok" + per-ref "ok" ──
```

This is the same shape as `ssbc/plugins/git-server.js:154-200`
(`normalizeReceivePack`) — we lift the validation/storage flow but swap the
SSB publish/blob calls for ANProto ones.

## Pull flow (v0)

We don't reconstruct from blobs yet. We just delegate to `git http-backend`
against the bare repo on disk. Smart-HTTP "just works."

```
client                          anproto-git server
  ─ GET /git/A/r/info/refs?service=git-upload-pack ──►
                                  spawn: git http-backend (CGI)
                                  env: PATH_INFO, QUERY_STRING, REQUEST_METHOD,
                                       GIT_PROJECT_ROOT=repos/A/r.git,
                                       GIT_HTTP_EXPORT_ALL=1
                                  pipe request body in, response out
  ◄── advertisement ─────────────
```

Same for `git-upload-pack`.

## Pull flow (v1) — what we want eventually

A node that has replicated only the signed messages + blobs (no bare repo)
should be able to serve a clone:

```
on first /git/A/r/info/refs:
  bare = repos/A/r.git
  if not exists:
    git init --bare bare
    for msg in messages of type git-update where repo == "A/r"
      sorted by timestamp ascending:
        fetch blob(msg.pack)
        git index-pack --stdin -o idx into bare/objects/pack/
        apply msg.refs into bare/refs/...
  delegate to git http-backend as in v0
```

This is the SSB-style "state is derived from the log" property. v0 keeps
the bare repo authoritative; v1 makes it cache-on-demand from the log.

## Blob store details

`blob.js` is a thin filesystem store:

```
blobs/
  ab/cd/ef.../<base64sha256>      ← sharded by first 4 hex of hash
```

API:

```js
await blob.put(bytes)        → { hash, size }   // returns base64sha256
await blob.get(hash)         → Uint8Array | null
await blob.stream(hash)      → ReadableStream | null   // for pack streaming
await blob.has(hash)         → boolean
```

Hash is computed over raw bytes (`crypto.subtle.digest("SHA-256", bytes)`),
encoded base64 with the same alphabet as apds (44 chars, ends with `=`).
That keeps the hash namespace aligned: a hash in a signed `git-update`
message is dereferenceable by any apds-compatible store, modulo the
string-vs-bytes hashing difference.

**The string-vs-bytes problem.** `apds.hash("hi")` ≠ `blob.put(bytes_of("hi"))`
because apds runs the string through `TextEncoder` first. For text content
this is invisible. For binary, it matters. anproto-git always uses raw-byte
hashing. If we later want apds and anproto-git to share a single store, the
canonical fix is to make `apds.hash` raw-byte-only and have callers encode
strings themselves. That's a breaking change for the wider ANProto stack —
out of scope here, but worth flagging.

## Multi-writer & conflict resolution

A push from a non-owner is fine to *store* (anyone can publish a signed
`git-update`), but the question is which writer's refs the server
advertises. v0 answer: the repo owner's latest. v1 could surface "branches
pushed by other authors" similar to how git-ssb shows PR branches.

For an MVP, only accept pushes signed by the repo owner. Multi-writer
support is a separate design pass.

## What's deliberately not here

- **In-browser hosting.** Wiredove can subscribe to repo activity (the
  messages) and render JSON-API views, but the pack blobs live on the
  server. Reconsider once apds gets a binary-blob path.
- **Encrypted repos.** SSB has private-box; ANProto doesn't yet. Public
  repos only.
- **Forks/PRs as graph objects.** Out of scope for v0. Would be additional
  message types (`git-fork`, `git-pr`).
- **Issues/comments.** Out of scope. Wiredove already does threaded posts;
  reuse that.

## Build order

1. **Scaffold** ← we are here
2. **Bare-repo + http-backend proxy.** No ANProto layer. Confirm a
   push/clone roundtrip works against a local bare repo.
3. **Push hook.** After a successful receive-pack, validate the pack with
   `index-pack`, store the pack as a blob, publish a signed `git-update`.
4. **Replication.** A second anproto-git server can request messages by
   author and rebuild a bare repo from gossiped pack blobs.
5. **JSON API.** Port the read-only JSON endpoints from
   `ssbc/plugins/git-server.js` (refs/log/commit/tree/blob/diff) so wiredove
   can render repo pages.
6. **Wiredove integration.** Repo browser UI that reads the JSON API.
