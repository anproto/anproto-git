# anproto-git

git-over-ANProto. A Deno HTTP server that lets you push and pull from
ANProto-signed git repos using a normal git remote URL.

The thesis: the only meaningful thing classic SSB still has over
[ANProto](https://anproto.com) is [git-ssb](https://github.com/ssbc) —
signed-feed git hosting that survives without a central forge. This is the
ANProto-native version.

See [SPEC.md](SPEC.md) for the small core protocol: repo identity,
signed push updates, pack/blob references, replay, replication, and push
auth. See [WORKORDER.md](WORKORDER.md) for the product roadmap around
that kernel (issues, PRs, web UI, deployment polish). See [PROGRESS.md](PROGRESS.md)
for what landed when.

## Status

Phase 0 of [WORKORDER.md](WORKORDER.md) — push and clone work against a
single-node bare repo; nothing is signed yet.

Run:

```
deno run -A serve.js
```

Then in another repo:

```
git remote add anproto http://127.0.0.1:9100/git/<authorPub>/<name>
git push anproto HEAD
```

(neither side works yet — see [DESIGN.md](DESIGN.md) for the build plan.)

## What's here

| File | Role |
|---|---|
| `serve.js` | Deno HTTP server. Routes `/git/:author/:name/*` to the smart-HTTP handler |
| `git.js`   | Spawns `git http-backend` for smart-HTTP and announces pushes to the ANProto layer |
| `repo.js`  | Repo lifecycle: creating a repo publishes a signed `git-repo` message; pushes publish `git-update` |
| `blob.js`  | Phase-0 filesystem blob store. The protocol target is `anproto-blobs` handles |
| `bin.js`   | CLI: `create`, `serve` |
| `lib/`     | Pulls `an.js` from anproto, plus local helpers |

## Why a new blob store

`apds.hash(d)` runs `TextEncoder().encode(d)` — strings only, and the store
sits in IndexedDB / Cache API. That's fine for posts and avatars. Git
packfiles are raw binary and can be hundreds of MB; they need:

1. Hashing over raw bytes, not utf8-encoded strings
2. Streaming reads (don't `db.get(hash)` a 200 MB pack into memory)
3. Filesystem persistence on the server (browsers can replicate metadata
   but probably shouldn't carry pack blobs)

`blob.js` is the phase-0 version of that store. The protocol target is
`anproto-blobs`: signed `git-update` messages reference pack bytes by an
`anproto-blobs` handle, which may be a single chunk or a chunked manifest.

## Compared to git-ssb

git-ssb (in `ssbc/plugins/git-server.js`):

- Repo identity = an SSB message hash (the `git-repo` message key)
- Push: index-pack → store pack + idx as SSB blobs → publish `git-update`
- Pull: walks `git-update` chain, rebuilds pack from blobs via `ssb-git-repo`
- Bare repo on disk: **none** — repo state is fully derived from the SSB log

anproto-git (here):

- Repo identity = `{ author, name }` — anproto-native, no message hashes
- Push: index-pack → store pack through `anproto-blobs` → publish ANProto-signed
  `git-update` → also unpack into a bare repo on disk
- Pull: serve from the bare repo via `git http-backend` (fast, correct)
- Bare repo on disk: **the derived view**. Authoritative state is still the
  signed messages + blobs. v1 should make the bare repo rebuildable from
  pure ANProto state, so a fresh node can replicate just the messages and
  reconstruct.

The bare-repo cache is the v0 simplification. It buys us correctness via
`git http-backend` while we figure out the gossip story.

## Core cuts

The core spec intentionally excludes issues, PRs, reviews, reactions,
multi-writer collaborator semantics, DHT/Trystero/browser gossip, global
search, encrypted repos, key rotation, custom domains, badges, metrics,
networked repack messages, and deployment polish. Those are forge product
features or identity-layer work; they should not complicate deterministic
git replay.

MIT
