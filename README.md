# anproto-git

git-over-ANProto. A Deno HTTP server that lets you push and pull from
ANProto-signed git repos using a normal git remote URL.

The thesis: the only meaningful thing classic SSB still has over
[ANProto](https://anproto.com) is [git-ssb](https://github.com/ssbc) —
signed-feed git hosting that survives without a central forge. This is the
ANProto-native version.

See [WORKORDER.md](WORKORDER.md) for the phased plan to turn this into a
full forge (issues, PRs, multi-writer, gossip, web UI). See
[PROGRESS.md](PROGRESS.md) for what landed when.

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
| `blob.js`  | Filesystem-backed binary blob store keyed by sha256 (base64). Separate from apds's string-only store |
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

`blob.js` here is that store. The hash space is the same as apds (base64
sha256, 44 chars) so signed `git-update` messages can reference pack blobs
the same way an apds message references its content.

## Compared to git-ssb

git-ssb (in `ssbc/plugins/git-server.js`):

- Repo identity = an SSB message hash (the `git-repo` message key)
- Push: index-pack → store pack + idx as SSB blobs → publish `git-update`
- Pull: walks `git-update` chain, rebuilds pack from blobs via `ssb-git-repo`
- Bare repo on disk: **none** — repo state is fully derived from the SSB log

anproto-git (here):

- Repo identity = `<authorPub>/<name>` — anproto-native, no message hashes
- Push: index-pack → store pack as binary blob → publish ANProto-signed
  `git-update` → also unpack into a bare repo on disk
- Pull: serve from the bare repo via `git http-backend` (fast, correct)
- Bare repo on disk: **the derived view**. Authoritative state is still the
  signed messages + blobs. v1 should make the bare repo rebuildable from
  pure ANProto state, so a fresh node can replicate just the messages and
  reconstruct.

The bare-repo cache is the v0 simplification. It buys us correctness via
`git http-backend` while we figure out the gossip story.

## Open questions

- **Refs are mutable; ANProto messages are not.** Two pushes from the same
  author to the same repo produce two signed `git-update`s. Which wins?
  Latest timestamp from the repo *owner* is the obvious answer; multi-writer
  repos (PRs) need more thought.
- **Pack rebuilding from gossiped blobs.** v0 keeps the bare repo as source
  of truth and treats gossip as backup. v1 should flip that.
- **Browser participation.** Wiredove can show repo activity and JSON tree
  views over HTTP, but probably can't host repos. Is that OK?
- **Discovery.** SSB git-ssb leans on the gossip log for repo discovery.
  ANProto has no implicit subscription model — repos need to be addressed
  by `<authorPub>/<name>` explicitly. Probably fine.

MIT
