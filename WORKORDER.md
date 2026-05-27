# anproto-git work order

The plan to take this from "scaffold that signs nothing" to a hostable,
replicating git remote, then later to a fuller forge product.

The protocol kernel is intentionally small and lives in [SPEC.md](SPEC.md):
repo identity, signed repo creation, signed git updates, self-contained pack
references, deterministic replay, replication, tombstones, and owner push
auth. This work order is broader than the protocol. Issues, PRs, reviews,
reactions, multi-writer collaborators, browser gossip, search, custom domains,
metrics, badges, encrypted repos, key rotation, and deployment polish are
roadmap/product notes unless [SPEC.md](SPEC.md) says otherwise.

This document has two halves:

1. [Phased build order](#phased-build-order) — milestones with concrete
   deliverables, in the order to do them.
2. [Product / implementation Q&A](#product--implementation-qa) — design
   notes that may inform later specs, but are not protocol by themselves.

Keep this document append-mostly. When a phase ships, mark it done in
[PROGRESS.md](PROGRESS.md) but leave the work order text intact so the
reasoning trail is still readable.

---

## Vision

> Anyone runs `anproto-git serve` on a box they own. They get a public git
> remote (`http://their-host/git/<their-pub>/<repo>`) that accepts authorized
> owner pushes, serves clones, and replicates signed git updates with other
> nodes so a follower can rebuild the repo without ever talking to the
> original host.

The official relay at `git.anproto.com` is just one node among equals. It
doesn't hold authority; it holds a copy.

Non-goals:

- A protocol-level rewrite of git. We use stock git over the wire.
- A new social network. Posts, follows, replies stay in apds/wiredove.
- A full forge in the core protocol. Issues, PRs, review, search, and UI are
  product layers.
- Built-in CI. We can ship hook-points for external CI; running CI is out
  of scope.
- Private repos in v1. Encrypted refs/blobs come later.

---

## Ground rules

These are load-bearing. Break them and you're working against the stack
rather than with it.

1. **No pull-streams.** The anproto stack (`anproto/`, `apds/`, `wiredove/`)
   is async/await + ES modules + `ReadableStream` native. The ssbc
   ecosystem we're porting from uses pull-streams everywhere; rewrite
   those pipelines to async iterators on the way in. Never add
   `pull-stream`, `pull-paramap`, `pull-cat`, `stream-to-pull-stream`,
   etc. to this codebase.
2. **Deno, not Node.** Matches anproto / apds / wiredove. Run with
   `deno run -A`. Use `Deno.Command`, `Deno.serve`, `Deno.readFile`,
   not `child_process` / `http` / `fs`.
3. **No new abstractions until phase 2.** v0 keeps the bare repo
   authoritative; phase 1 adds signed messages alongside. Don't build
   the "rebuild repo from blobs" generality until phase 2 forces it.
4. **Test against real `git` over real HTTP.** No mocks for the protocol
   surface. Spin up a real Deno server in a temp dir and run real
   `git clone` / `git push` against it. Mocks drift; the protocol
   doesn't.

---

## Architecture

Five layers, top to bottom. Each is replaceable.

```
┌─────────────────────────────────────────────────────────────┐
│ git client / web browser / wiredove                         │
├─────────────────────────────────────────────────────────────┤
│ smart-HTTP (+ later JSON API / web UI)    serve.js          │
│   /git/<author>/<name>/{info/refs, git-upload-pack, ...}    │
├─────────────────────────────────────────────────────────────┤
│ Git engine (per-repo bare repo on disk)    git.js           │
│   spawns `git http-backend`, `git index-pack`, etc          │
├─────────────────────────────────────────────────────────────┤
│ ANProto layer    repo.js, messages.js                       │
│   signs+publishes git-repo, git-update                      │
│   reads back from local message log to derive forge state   │
├─────────────────────────────────────────────────────────────┤
│ Storage    anproto-blobs, log.js                            │
│   self-contained pack blobs                                 │
│   per-author signed-message log                             │
├─────────────────────────────────────────────────────────────┤
│ Replication    gossip.js                                    │
│   WebSocket + HTTP poll, hash-driven, peer-to-peer          │
└─────────────────────────────────────────────────────────────┘
```

The bare repo on disk is a **cache** of the ANProto state, not the
authoritative store. v0 inverts this (bare repo is authoritative, ANProto
layer is a side-effect log) because that's the cheapest way to get smart-
HTTP working. v1 onward inverts back: a fresh node with no bare repos but
with the signed message log can reconstruct every repo from gossiped pack
blobs.

---

## Porting notes from git-ssb

Estimated ~1500 LOC of git-ssb code translates over (subject to the
no-pull-streams rule — rewrite as you port).

| Source | LOC | Reuse | Notes |
|---|---|---|---|
| `ssbc/plugins/git-server.js` | 1088 | ~70% direct | pkt-line parsing, sideband, `buildRefAdvert`, `normalizeReceivePack`, the LCS diff engine, all the JSON read handlers. SSB-specific calls (`sbot.publish`, `repo.addSSBBlob`, `gitRepo.getRepo`) get swapped for `messages.publish(envelope)`, `blob.put(bytes)`, and `bareRepoPath(authorPub, name)` respectively. |
| `ssbc/decent/src/modules/git/git-browser.js` | 1311 | ~50% | Rendering for refs/tree/blob/diff/log. Consumes the same JSON API shape. Needs modernization (depject + `var` → ES modules + async/await). |
| `ssb-issues/lib/schemas.js` | ~70 | reference | Message shape reference for our `git-issue-*`. Already aligned. |
| `ssb-pull-requests/lib/schemas.js` | ~40 | reference | PR field names (`baseRepo`/`baseBranch`/`headRepo`/`headBranch`) ported as-is. |
| `ssbc/node_modules/ssb-git-repo/lib/repo.js` | 1282 | 0% direct | Reconstructs a git repo from SSB messages + blobs. Phase 2 needs equivalent capability but our approach is simpler: replay packs into a bare repo on disk. Worth reading for the pack-chain reasoning; don't copy. |
| `pull-git-pack`, `pull-git-packidx-parser`, etc. | n/a | 0% | We shell out to `git index-pack` and friends. Skip. |
| `git-remote-ssb`, `git-ssb` CLI, `git-ssb-web` | n/a | 0% | Obsolete (`ssb://` scheme) or superseded. |

Three patterns from git-ssb that this work order has already folded in:

1. **Comments as `type: post` with `root: <issueId>`.** Not a dedicated
   `git-issue-comment` type. Reuses wiredove's thread UI for free.
2. **Reactions via existing `type: vote`** with `link` pointing at
   issue/PR/commit hashes.
3. **PR field naming**: `baseRepo`/`baseBranch`/`headRepo`/`headBranch`
   (matches `ssb-pull-requests/lib/schemas.js` and GitHub vocabulary).

---

## Phased build order

Each phase has a **definition of done** that's testable, not aspirational.
Don't move to the next phase until the current one passes its DoD.

### Phase 0 — scaffold (✅ shipped)

See [PROGRESS.md](PROGRESS.md). Status: `git push` and `git clone` work
against a single-node bare repo. Nothing is signed yet.

### Phase 1 — owner-authenticated sign on push

**Goal:** every successful owner-authorized push produces a signed
`git-update` ANProto message and an `anproto-blobs` handle for a
self-contained pack.

Concrete steps:

1. Refactor `git.js`. Currently `httpBackend` lets `git http-backend`
   consume the request body directly. To capture the pack, we have to read
   the body ourselves first, then *re-feed* it to http-backend via stdin.
2. Require the owner challenge/response from [SPEC.md](SPEC.md) before
   accepting public receive-pack requests. Localhost scaffolding may bypass.
3. Before re-feeding, validate the incoming pack and store a self-contained
   pack. Either force `no-thin` or run `git index-pack --fix-thin` and store
   the completed bytes.
4. Store the pack via `anproto-blobs`. `.idx` files are local cache state,
   not required protocol references.
5. Parse the pkt-line ref-update section to extract `{ref, old, new}`
   triples — also mirrored from git-ssb.
6. Build a canonical JSON `git-update` message body via
   `repo.js:gitUpdateMessage` and
   sign with the server's keypair.
7. Append the signed envelope to `log/by-author/<pub>/<ts>-<sigHash>.sig`.

**Definition of done:** push to a fresh repo, then `cat log/by-author/<pub>/*.sig
| head` shows the signed envelope, the message verifies, its `pack` field is
an `anproto-blobs` handle whose bytes hash/validate, and replay can regenerate
the git index from the stored pack.

### Phase 2 — rebuild from log

**Goal:** delete the bare repo on disk, restart the server, request
`/info/refs`, and have the server transparently rebuild the bare repo from
the signed `git-update` messages + pack blobs.

Concrete steps:

1. On first request for a repo, check if `repos/<pub>/<name>.git` exists.
   If not, `git init --bare` it.
2. Query the local message log for `type=git-update`, `repo=<pub>/<name>`,
   sorted by `ts` ascending.
3. Select the deterministic canonical update chain described in
   [SPEC.md](SPEC.md).
4. For each message, fetch `pack` via `anproto-blobs`, run `git index-pack`
   to install it, verify each `old` ref, then apply all `new` refs
   atomically.
5. Done — http-backend can now serve from this rebuilt repo.

**Definition of done:** push a few commits to a repo, delete the
`repos/` directory, restart the server, `git clone` succeeds and produces
the same history.

### Phase 3 — peer replication

**Goal:** two anproto-git servers can be configured to peer with each
other. After a push on server A, server B's local log gains the same
`git-update` envelope and pack blob, and server B can serve a clone of the
same repo.

Concrete steps:

1. WebSocket protocol borrowed from `apds/serve.js`. Peers exchange:
   - hashes (44-char strings) = "I have / I want this"
   - blob bytes / signed envelopes as bodies for asked-for hashes
2. New `peers.json` config: list of peer URLs. On startup, dial them all,
   keep them connected, reconnect with backoff.
3. New endpoint `POST /sync/since?author=<pub>&ts=<ms>` returns all
   message envelopes from that author since that ts. Used for HTTP poll
   fallback if a peer can't keep a socket open.
4. On receive: verify the signature, dedupe by sigHash, append to local
   log, then if there is a `pack` reference ask for it via `anproto-blobs`.
5. Selective replication: a server only replicates authors+repos it has
   opted into via `subscriptions.json` (or `*` for a public relay).

**Definition of done:** two-server test in `test/replication.js`:
   - start A and B configured as peers
   - push to A
   - wait <2s
   - clone from B; same history.

### Phase 4 — JSON API + minimal web UI

**Goal:** browse a repo in a browser. Port the JSON read endpoints from
`ssbc/plugins/git-server.js` (`handleJsonRefs`, `handleJsonLog`,
`handleJsonCommit`, `handleJsonTree`, `handleJsonBlob`, `handleJsonDiff`)
and serve a small static SPA that renders them.

Concrete steps:

1. Port the JSON handlers. Drop the SSB-specific calls; substitute
   shelling out to `git cat-file`, `git ls-tree`, `git log`.
2. Wireframe pages: repo home (README + tree), file view, commit list,
   commit diff, branch list, tag list.
3. Use the existing `apds/lib/marked.esm.js` for README rendering and
   `lib/h.js` (if we port it) for DOM construction.

**Definition of done:** open `http://server/git/<pub>/anproto-git/` in
Chrome, see the README rendered, click "DESIGN.md", see the file, click a
commit, see the diff.

### Product phase 5 — issues (out of core)

**Goal:** open / comment / close issues on any anproto-git repo, with no
extra infrastructure beyond what's already running.

Message types added (see [Message schema](#message-schema)):

- `git-issue-open`
- `git-issue-update`
- (comments are `type: post` with `root: <issueId>` — no new type)
- (reactions are `type: vote` with `link: <issueId>` — no new type)

Concrete steps:

1. Implement `git-issue-open` and `git-issue-update` in `repo.js`.
2. Index on receive: for each `git-issue-*` message, update an in-memory
   `issues[repoId][issueId]` derived view, persisted to
   `cache/issues.json` periodically (apds pattern). Walk
   `type: post` messages whose `root` matches a known issueId to build
   the comment thread; walk `type: vote` messages whose `link` matches
   to build reaction counts.
3. UI: issue list, issue detail with comment thread, "new issue" form.
   Comment composer reuses wiredove's existing post composer.
4. Permissions: anyone can open or comment; only repo owner can change
   state via `git-issue-update`.

**Definition of done:** open issue from server A, see it on server B via
gossip, comment from B, see comment back on A.

### Product phase 6 — PRs and forks (out of core)

**Goal:** fork a repo, push to your fork, open a PR against the original.

Message types added:

- `git-fork`
- `git-pr-open`
- `git-pr-update`
- `git-pr-review` (optional, can ride on `git-issue-comment` in v1)

Concrete steps:

1. **Fork** = `git-fork` message naming `forkOf: <pub>/<name>`. The forker
   just starts pushing to their own author/repo URL. No server-side copy
   step.
2. **PR open** = signed message naming `(sourceAuthor, sourceRepo,
   sourceRef, targetAuthor, targetRepo, targetRef, title, body)`. The PR
   ID = the sigHash of the open message.
3. **Replication of source pack:** when a target-repo server first sees a
   PR, it pulls the source author's pack blobs over gossip. This is the
   "I need this commit graph but it's not mine" path; same primitive as
   any cross-author replication.
4. **Merge** = the target owner publishes a `git-update` on the target
   repo containing the merge commit (built locally with `git merge`),
   plus a `git-pr-update` with `state: merged, mergeCommit: <sha>`.
5. UI: PR list, PR detail with commits + comments + diff, merge button
   for the owner.

**Definition of done:** A forks B's repo, A pushes a commit to A's fork,
A opens a PR, B merges, the merge commit shows up on B's main branch.

### Product phase 7 — collaborators and permissions (out of core)

**Goal:** extend the core owner-only push auth to collaborator keys.

Concrete steps:

1. Challenge/response. Client requests `GET /git/<repo>/auth/challenge`;
   server returns a random 32-byte nonce. Client signs nonce with anproto
   key, sends sig in the `Authorization: AnProto <pub><sig>` header on
   the push request.
2. Server checks: is this pub the repo owner? Or named in a published
   `git-permissions` message for this repo?
3. Refuse push if not.
4. `git-permissions` message schema: `{repo, grants: [pub, ...]}`.
   Latest message from the repo owner wins.
5. CLI helper: `anproto-git push` wraps `git push` with the
   challenge/response dance so users don't see it.

**Definition of done:** unauthorized push to someone else's repo on
`git.anproto.com` returns 401. Authorized collaborator push succeeds.

### Product phase 8 — discovery and bootstrap (out of core)

**Goal:** a brand new node can find peers and start replicating without
hand-editing `peers.json`.

Concrete steps:

1. Built-in relay list: hardcoded `bootstrap.json` of well-known relays
   (`git.anproto.com`, plus 1-2 mirrors). Editable.
2. Optional trystero-torrent rooms per repo (matches wiredove). Lets
   browser-side wiredove subscribe to repo activity in real time.
3. Author-level discovery: `GET /authors/<pub>/repos` returns all repos
   that author has published.
4. Repo search across local index. Server operator decides whether their
   instance exposes a global search.

**Definition of done:** clone fresh node → it dials bootstrap → it pulls
my author's recent messages → I can browse my profile and repos.

### Product phase 9 — CLI ergonomics

**Goal:** a developer's day involves `anproto-git` commands, not `curl`
incantations.

CLI surface:

```
anproto-git keygen
anproto-git serve [--port 9100] [--data-dir ./data]
anproto-git create <name> [--description "..."]
anproto-git clone <author>/<name>          # uses default relay
anproto-git fork <author>/<name>
anproto-git pr <branch> -> <target>:<branch>
anproto-git issue open <repo> "title"
anproto-git issue comment <issue-id> "body"
anproto-git list <author>                  # list an author's repos
anproto-git sync                           # one-shot pull from peers
```

Wraps either local server's HTTP API or a configured remote relay.

### Product phase 10 — polish

- Custom domain support (Host header → author resolution table)
- Backup CLI: `anproto-git export <repo> > backup.tar.zst`
- Metrics endpoint `/metrics` (Prometheus format)
- Pack repacking job for storage compaction
- README badges (`https://git.anproto.com/badge/<pub>/<repo>/commits`)

---

## Product / implementation Q&A

### Identity

**Q: One keypair per server or per user?**
A: Per user. The server runs under the operator's identity in v0
(`keypair.txt`). When we add multi-user hosting, each user gets their own
keypair stored encrypted at rest (web2 login → web3 keys, à la apds's
roadmap item).

**Q: Where do keys live?**
A: v0: `keypair.txt`, mode 0600, in the data dir. v1: OS keychain via
`keytar` (Node) or `deno_keychain` (third-party). v2: hardware token /
mobile-app signing (a phone running anproto can hold the master key).

**Q: Key rotation?**
A: Publish `type: identity-rotate` message signed by old key, naming new
pubkey. Followers carry the link. Old pubkey marked retired. Repos under
old pubkey stay reachable forever (immutable); new pushes go under new
pub. No automatic repo "rename" — owner publishes a `git-repo` under the
new pub naming `previousOwner: <oldPub>`.

**Q: Multiple devices per identity?**
A: Same key on multiple devices works. Conflict resolution falls out
naturally because each message has a ts and a sig; whichever ts wins
wins. For real multi-device sync, store the keypair encrypted in apds
and unlock with a passphrase on each device.

**Q: Key backup / recovery?**
A: A keypair is 32 bytes of secret. Print the BIP39-style mnemonic on
keygen. Lose it, you lose the identity — no recovery. Same as SSB. Same
as Nostr.

**Q: Web of trust / verified identity?**
A: Out of scope. Optional `type: identity-claim` message ("this pub is
also @evbogue on github, here's a proof") can be added without protocol
changes.

### Repos

**Q: Repo identity?**
A: `(authorPub, name)`. authorPub is 44-char base64 ed25519. name is a
slug (1-64 chars, no `/`, lowercase recommended but not enforced).

**Q: Renaming a repo?**
A: Publish a new `git-repo` message with the new name + field
`renamedFrom: <oldName>`. Servers redirect requests for the old name.
The bare repo on disk gets `git mv`-equivalent (just rename the
directory; the URL changes). History is preserved because the underlying
commits don't change.

**Q: Forking?**
A: Just push to your own `<yourPub>/<repoName>`. Optionally publish a
`git-fork` message naming the source so UIs can show the fork graph.
There is no server-side copy step — your first push carries the full
history pack.

**Q: Deleting a repo?**
A: Publish `git-tombstone` referencing the repo. Compliant servers stop
serving and GC the bare repo + blobs. Already-replicated copies on other
servers may or may not honor the tombstone — there is no enforcement.
This is content-addressed, signed, immutable storage; deletion is
**unreliable by design**. Be careful what you push.

**Q: Visibility?**
A: v1 = public only. v2 = encrypted refs/blobs using `recps`-style
recipient list à la SSB private-box. Repo metadata (existence, name) is
always discoverable; only contents are encrypted.

**Q: Size limits?**
A: Per-server policy. `config.json` has `maxRepoSize` and
`maxBlobSize`. Defaults: 5 GB per repo, 500 MB per single blob. A push
exceeding the limit gets a 413 response. The author's other servers may
accept it; this is local policy, not protocol.

**Q: Repo settings?**
A: A `git-repo-settings` message owned by the repo owner. Schema:
`{repo, defaultBranch, license, topics, allowForks, ...}`. Settings are
mutable; latest message wins.

**Q: Discoverability — list all repos by an author?**
A: Query the local message log for `type: git-repo` from that author.
Server exposes `GET /authors/<pub>/repos` returning the list.

**Q: Discoverability — find a repo by name without knowing the author?**
A: You can't. Like SSB, there's no global namespace. Use a search relay
that indexes message bodies.

### Refs and pushes

**Q: Atomic multi-ref push?**
A: Yes. The `git-update` message names every ref changed in one push.
Either all apply or none.

**Q: Ref deletion?**
A: `refs[name] = null` (or the all-zeros sha1, which we normalize to
null on parse).

**Q: Force push?**
A: Allowed. A `git-update` with a `new` sha that isn't a descendant of
the previously advertised `new` is a force push. Clients can detect via
`git fetch --prune` and warn. Some repo-settings flag could disable
force-push on protected branches; v2 work.

**Q: Tags?**
A: `refs/tags/*` just work — they're refs. Annotated tags (those with a
tag object) work too; the tag object is part of the pack.

**Q: Protected branches?**
A: v2. Schema: `git-repo-settings` includes `{protectedBranches: ['main']}`
and the server refuses a push that's not a fast-forward on those. PR
merge is the only path.

**Q: Submodules?**
A: They work as long as the submodule URL is reachable. If the submodule
is also an anproto-git repo, the URL form `http://relay/git/<pub>/<name>`
just works.

**Q: LFS?**
A: Out of scope. If a repo really needs LFS, it can use a separate LFS
server URL; nothing in anproto-git prevents it.

### Multi-writer

**Q: Who can push to a repo?**
A: The owner always. Anyone listed in the latest `git-permissions`
message published by the owner. Nobody else.

**Q: Two collaborators push at the same time — who wins?**
A: Both pushes succeed at the server level (each produces a signed
`git-update`). The bare repo applies whichever arrives first. The second
push, if non-fast-forward, is rejected at git protocol level and the
collaborator re-pulls and rebases. Same as GitHub.

**Q: Two servers receive different pushes from the same owner around the
same time — which wins after gossip?**
A: Latest timestamp from the **owner's** signed messages wins. If
timestamps tie, sigHash (lex sort) breaks the tie. Loser's commits
aren't lost — they're still referenced by their own `git-update`
message; UIs can show them as "abandoned branch tips" if relevant.

**Q: PR-style flow without collaborator permissions?**
A: Fork the repo. Push to your fork. Open a `git-pr-open` message.
The PR is a request — the target owner can accept by publishing a merge
`git-update` on the target repo. Nothing magical.

**Q: Code review / approval?**
A: `git-pr-review` message with `state: approved | changes-requested |
comment` and a body. Multiple reviewers can publish; UI aggregates.
Merge button is enabled per repo-settings policy (e.g. "1 approval
required").

### Blobs

**Q: What goes in the blob store?**
A: Protocol state stores self-contained git pack files through
`anproto-blobs`. Git index (`.idx`) files are local cache artifacts that
can be regenerated from packs. Later product features may also store image
attachments, large markdown previews, or other binary content by blob
handle.

**Q: How is a blob hashed?**
A: `crypto.subtle.digest("SHA-256", bytes)` → base64-encoded → 44 chars.
Hashing is over raw bytes, not utf8-encoded strings. **This is different
from `apds.hash`**, which TextEncoders the input. Reconciliation work
(probably in apds proper) is needed so both hashing modes can coexist;
see [`apds` and string vs bytes](#apds-and-string-vs-bytes) below.

**Q: Storage layout?**
A: Core pack storage follows `anproto-blobs`. The old `blob.js`
filesystem layout is phase-0 scaffolding only.

**Q: Streaming?**
A: Yes for reads. `blob.stream(hash)` returns a `ReadableStream` so the
HTTP handler can pipe a 200 MB pack to the client without buffering it
in RAM. Writes are buffered (we need the whole bytes to hash them
anyway).

**Q: Deduplication?**
A: Native. Hash collision = same blob. `blob.put` is idempotent — if the
file exists at the target path, skip.

**Q: Garbage collection?**
A: Refcount by message references. Every core `git-update` references a
`pack` blob handle. A blob is collectable when no current message
references it AND its referencing messages are older than a configurable
grace period (default 30 days). The grace period exists so a freshly
replicated peer can still find historical packs.

In practice we'll probably leave GC turned off in v1 and revisit when
storage growth becomes a real concern. Git itself is content-addressed
and dedupes well; pack reuse across pushes is meaningful.

**Q: Pack repacking — can a server consolidate 100 small packs into one
big one?**
A: Yes, locally. A server can run normal `git gc` or repack its bare-repo
cache. Networked `git-repack` messages are deliberately out of core until
storage pressure proves they are needed.

**Q: What about loose objects?**
A: Server-side everything is always in packs (because that's what
`git index-pack` produces). The bare repo on disk may have loose objects
after operations like `git gc --auto`; we don't care because we serve
via http-backend which reads either form.

**Q: Streaming pulls?**
A: http-backend already streams. Our role is just to not buffer between
http-backend's stdout and the HTTP response. v0 currently buffers — fix
in phase 1 cleanup.

**Q: Bandwidth limits?**
A: Server policy, `maxBytesPerHourPerIP`. Not in v0/v1.

**Q: Encrypted blobs?**
A: Same hashing rule, but the bytes are ciphertext. Recipient list is
in the referencing message, encrypted to multiple pubkeys' boxes. v2+.

**Q: Pack signing — do we sign packs separately?**
A: No. The `git-update` message that references a pack is the signed
artifact. The pack hash inside that signed message is what authorizes
the bytes — find a pack whose sha256 matches and you have what the
signer pointed to.

**Q: Multiple packs per push?**
A: Out of core. Version 1 `git-update` has one self-contained `pack`
handle. Splitting very large pushes can be revisited after the simple
replay path is proven.

### Messages

**Q: Message format?**
A: Core anproto-git messages are canonical JSON bodies wrapped in ANProto
signature envelopes; see [SPEC.md](SPEC.md). Product-layer message sketches
below are non-normative until promoted into their own specs.

**Q: Storage?**
A: Per-author append log: `messages/by-author/<pub>/<ts>-<sigHash>.sig`.
Plus a content blob `messages/by-hash/<sigHash>` containing the bytes
referenced by the sig (for messages whose content isn't inline).

**Q: Indexing?**
A: On startup and on receive, build in-memory derived views:
- `repos[repoId] = {ownerPub, name, settings, latestUpdate}`
- `refs[repoId] = {name: sha1, ...}` derived from latest git-update
- `issues[repoId][issueId] = {title, body, state, comments: [...]}`
- `prs[repoId][prId] = {...}`

Persist periodically (`derived.json`) like apds's `openedLog`. Rebuild
from log on startup if missing.

**Q: Append-only?**
A: Yes — once stored, never mutated. State changes are new messages that
supersede old ones; old ones still readable.

**Q: Message size limits?**
A: Soft 64 KiB per message body. Larger payloads go through the blob
store and the message references by hash. Same pattern as SSB.

#### Product message sketches

Core `git-repo`, `git-update`, and `git-tombstone` live in
[SPEC.md](SPEC.md). The sketches below are roadmap notes for forge product
features. They are not core protocol and should use structured repo ids
before implementation.

```yaml
# Already used by apds/wiredove. Kept here for completeness.
type: post
text: |
  hello world
```

```yaml
type: git-repo-settings
repo: { author: <pub>, name: <slug> }
defaultBranch: main
protectedBranches: [main]
allowForks: true
mergeStrategy: rebase     # rebase | merge | squash
```

```yaml
type: git-permissions
repo: { author: <pub>, name: <slug> }
grants:
  - <collaboratorPub1>
  - <collaboratorPub2>
```

```yaml
type: git-fork
forkOf: { author: <sourcePub>, name: <sourceSlug> }
repo: { author: <forkPub>, name: <forkSlug> }
```

PR field names mirror git-ssb (`ssb-pull-requests/lib/schemas.js`) and
GitHub's vocabulary: **base** = the repo being merged into, **head** = the
fork the changes come from.

```yaml
type: git-pr-open
id: <sigHash>             # the message's own hash (filled in after sign)
baseRepo: { author: <pub>, name: <slug> }
baseBranch: refs/heads/main
headRepo: { author: <pub>, name: <slug> }
headBranch: refs/heads/feature-x
title: Add WebSocket gossip
body: |
  Implements phase 3 of the work order. See …
```

```yaml
type: git-pr-update
pr: <prId>
state: open               # open | merged | closed
mergeCommit: <sha1>       # if merged
```

```yaml
type: git-pr-review
pr: <prId>
state: approved           # approved | changes-requested | comment
body: |
  Looks good, two nits inline.
```

```yaml
type: git-issue-open
id: <sigHash>
repo: { author: <pub>, name: <slug> }
title: clone fails on empty repo
body: |
  Reproduction steps:
  …
labels: [bug]
```

```yaml
# Comments on an issue or PR are NOT a new message type. Reuse the
# existing apds/wiredove `type: post` with `root: <issueId or prId>`,
# the same way ssb-issues threads issues with regular SSB posts. This
# means wiredove's existing reply/thread UI Just Works for forge
# conversations, no parallel comment renderer needed.
type: post
root: <issueId or prId>
text: |
  fixed in commit abc123
```

```yaml
type: git-issue-update
issue: <issueId>
state: closed             # open | closed
assignee: <pub>           # optional
labels: [bug, wontfix]    # optional, replaces
```

```yaml
# Reactions on issues/PRs/commits use apds's existing `type: vote`,
# again matching ssb-issues / ssbc/AGENTS.md's vote schema. The `link`
# can point at any signed message hash OR a bare git sha1 (for commit
# reactions).
type: vote
vote:
  link: <issueId | prId | commitSha1 | reviewId>
  value: 1                # 1 = react, 0 = retract, -1 = downvote
  reason: "🚀"            # emoji label
```

Core tombstones live in [SPEC.md](SPEC.md). Networked repack messages and
identity rotation are deliberately out of core.

### Replication / gossip

**Q: How do messages get from server A to server B?**
A: Two transports, both modeled on apds:
1. **WebSocket** for persistent peers (like apds's `apdsbot`). Bi-di
   hash exchange: peer sends `<hash>`, other peer responds with the
   blob; either side can send a new envelope unsolicited.
2. **HTTP poll** for asymmetric/firewalled peers. `GET
   /sync/since?author=<pub>&since=<ts>` returns up to N envelopes.
   Mirror of `apds/serve.js`'s `/gossip/poll`.

**Q: How do we know which authors to replicate?**
A: `subscriptions.json` per server:
```json
{
  "authors": ["pub1", "pub2"],
  "repos": ["pub3/specific-repo"],
  "public": false
}
```
`public: true` = replicate everything offered. `authors` = always pull
this person's whole feed. `repos` = pull only updates touching these
repos.

**Q: How do peers find each other?**
A: v1: `peers.json` listing peer URLs by hand. v2: per-repo trystero
rooms (so wiredove can subscribe to repo activity in-browser without a
server). v3: a small DHT keyed on author pubkey, optional.

**Q: What does the WebSocket protocol look like, concretely?**
A: Same wire format as apds:
- 44-char string → "request the blob with this hash"
- Anything longer → "here's a blob (or signed envelope)"
- Recipient computes the sha256 of incoming bodies; if it matches a
  pending request hash, it stores under that hash. If it's a signed
  envelope, the recipient does `an.open(msg)`, extracts the content
  hash, and may request that blob too.

We extend the wire format only as needed:
- Add a `{type: 'want', hashes: [...]}` JSON envelope to batch requests
  (apds sends one hash at a time, fine for chat, costly for git's many
  small references)
- Add `{type: 'have', hashes: [...]}` for initial peer sync to avoid
  round-tripping per object

**Q: How do we authenticate peer messages?**
A: Every signed envelope is verifiable end-to-end (`an.open` checks the
sig against the embedded pubkey). The transport peer is untrusted; we
verify, then accept. Same model as SSB.

**Q: Backpressure?**
A: Per-peer queue with a size cap. Drop oldest non-essential traffic
(want/have negotiation) when queue fills; never drop envelopes we
haven't acked.

**Q: Backfill on first peering?**
A: Each peer advertises `{author, latestTs}` per author they have on
connect. The other side requests via `/sync/since` for any authors it
wants. After backfill, switch to live push.

**Q: Selective per-repo gossip?**
A: Repo subscription works by filtering at the `git-update` level: if I
subscribe to repo X but not author Y, and Y publishes a `git-pr-open`
against X, I want that PR. So the rule is: replicate the **referenced**
repo's activity, not just the publisher's. Builds a small graph
traversal into the gossip layer.

### Storage layout

```
data/
  config.json                  # port, peers, subscriptions, limits
  keypair.txt                  # this server's identity (chmod 600)
  peers.json                   # known peer relays
  subscriptions.json           # what we replicate
  repos/
    <authorPub>/
      <name>.git/              # bare repo, derived from message log
      <name>.meta.json         # cached settings/refs/etc
  blobs/
    <aa>/<bb>/<full-base64hash>
  messages/
    by-author/
      <authorPub>/
        <ts>-<sigHash>.sig
        index.jsonl            # `(ts, sigHash, type, repo)` lines, append-only
    by-hash/
      <aa>/<bb>/<sigHash>      # the message body content blob
  derived/
    refs.json
    issues.json
    prs.json
    lastSync.json
```

Atomic update rule: write to `<path>.tmp` then `rename` to final. POSIX
guarantees rename atomicity within a filesystem.

### Discovery

**Q: How does a user share a repo URL?**
A: `http://relay.example.com/git/<urlencoded-pub>/<name>`. The relay
hosts a copy. Anyone can clone, and the repo will work even if the
original publisher is offline.

**Q: How does a user share a *publisher-independent* repo URL?**
A: `anproto-git://<pub>/<name>`. CLI tools resolve via the user's
configured default relay (or any relay that has it). Web tools can use
`https://git.anproto.com/git/<pub>/<name>` as the canonical form, with
relay.anproto.com automatically replicating.

**Q: How do you find a repo by topic / search?**
A: Out of scope at protocol layer. Any relay can run a search index
over the messages it has and expose `/search?q=...`. v2.

**Q: Repo listings on the home page?**
A: `git.anproto.com/` shows recent pushes (i.e. the `git-update`
firehose, filtered to repos the relay actually serves). Like a Twitter
home feed but for code.

### UI / web frontend

**Q: SPA or server-rendered?**
A: Server-rendered HTML for the JSON-derived views (fast first paint,
crawlable, no build step), with progressive enhancement for interactive
bits (issue composer, diff viewer). Matches `apds/render.js`'s
philosophy.

**Q: Markdown rendering?**
A: Reuse `apds/lib/marked.esm.js`. Server-side render to HTML; sanitize
with a small allowlist.

**Q: Syntax highlighting?**
A: shiki or prismjs as a static bundle. v2.

**Q: Wiredove integration?**
A: Wiredove subscribes to a user's pubkey via trystero/apds and gets
`git-update`, `git-issue-open`, `git-pr-open` messages just like posts.
Render them with a custom template (`type: git-update` → "Ev pushed 3
commits to anproto-git/main", linking to the relay's web UI). New work
in wiredove only — anproto-git doesn't need to know wiredove exists.

### Auth and security

**Q: Push auth?**
A: Per phase 7: challenge-response, signed with anproto key.
`Authorization: AnProto <pub> <sig>` header on the receive-pack POST.

**Q: Clone auth?**
A: v1: clones are unauthenticated, repos are public. v2: for encrypted
repos, client signs a challenge to prove they hold a recipient key.

**Q: Spam / DoS on push?**
A: Per-IP rate limits at HTTP layer. Per-pub rate limits at message
layer (server-side policy: max N `git-update`s per author per hour;
relay can drop excess).

**Q: Spam / DoS on issues?**
A: Anyone can open an issue. Per-server moderation: relay operator
publishes `type: server-block <pub>` and stops accepting messages from
that pub. Other relays may or may not honor. Sock-puppet pubs are
trivially generated so this is partial — real defense is webs of trust
or proof-of-work / proof-of-stake gating, both out of scope v1.

**Q: Malicious pack files?**
A: `git index-pack` validates pack integrity before we accept. Malicious
*content* (offensive README, etc.) is moderation, see above.

**Q: Resource exhaustion?**
A: Per-repo size limit. Per-blob size limit. Per-author message count
limit. Per-server total disk budget; oldest-non-essential-first
eviction when over.

**Q: HTTPS?**
A: Reverse proxy (caddy/nginx) terminates TLS. anproto-git serves
plaintext HTTP on localhost. Caddy auto-provisions Let's Encrypt; one
line of config.

**Q: Tor / I2P / mesh?**
A: Works because we're HTTP. `anproto-git serve --port 9100` behind a
Tor hidden service is a one-liner. Not officially supported but not
blocked either.

### CLI

See [Phase 9](#phase-9--cli-ergonomics). Implementation note: the CLI
wraps `git` for the actual push/clone (because git already does smart-
HTTP) and `fetch()` for everything else (issues, PRs, repo metadata).
Optional helper: `anproto-git push` automates the challenge-response so
the user doesn't need a credential helper.

### Deployment

**Q: How does someone run this?**
A: v0: clone, install Deno, `deno run -A serve.js`. v1:
`deno compile -A serve.js -o anproto-git` produces a single binary.
v2: docker image, systemd unit, Caddy snippet — all in
`deploy/` directory.

**Q: Hosting at git.anproto.com?**
A: Same binary on a VPS behind Caddy. peers.json points at every other
known instance. subscriptions.json is `public: true` so the relay
replicates the whole network.

**Q: Self-hosting at user.example.com?**
A: Same binary, different config. peers.json may include
git.anproto.com to inherit network presence; subscriptions limits to
the user's own pubkey + people they follow.

**Q: Custom domain → user mapping?**
A: v2: Caddy or anproto-git reads `Host:` header and maps
`user.example.com` → "show only `<thatUser'sPub>`'s repos at /". UI
treats the user as implicit.

**Q: Backups?**
A: Tar `data/`. Or: peer with another anproto-git instance you own and
let gossip do it.

**Q: Migration to a new server?**
A: `tar c data/ | ssh new-host 'tar x'`. Or peer the two servers and
let one drain into the other.

### apds and string vs bytes

**Q: Why isn't blob.js just `apds.make`?**
A: `apds.hash` does `TextEncoder().encode(d)` before sha256. A git pack
is binary; hashing it through TextEncoder would produce a different
hash than a peer running `sha256sum file.pack` would compute. The
hashes must match across implementations or replication breaks.

**Q: How do we reconcile?**
A: Push a change upstream into apds: split `apds.hash(string)` and
`apds.hashBytes(uint8array)`. Text message bodies use the string path;
binary blobs use the byte path. anproto-git core messages are canonical
JSON strings, and pack bytes go through `anproto-blobs` / `hashBytes`.

This is a small upstream change but it touches every implementation of
ANProto (Go, Rust, Python). Coordinate before shipping.

**Q: Can anproto-git proceed before that upstream change?**
A: Yes. anproto-git's phase-0 `blob.js` does raw-byte hashing today, and
the protocol target is `anproto-blobs`. The hash space is base64-sha256
either way; messages reference blobs by handle/hash; the only thing that
breaks is using `apds.make()` for binary content, which we don't do.
Cleanup is a soft dependency.

### Performance

**Q: Big repos?**
A: Streaming end-to-end. v0 buffers because http-backend output goes
through `new Response(child.stdout).arrayBuffer()`; fix in phase 1.

**Q: Cold-start rebuild from log?**
A: For a repo with N pushes, we replay N packs. Each `git index-pack
--verify` is roughly linear in pack size. For ~100 pushes over a year
on a normal repo this is seconds. We can also cache the bare repo on
disk; rebuild only triggers on cache-miss.

**Q: Index growth?**
A: Per-author `index.jsonl` is one line per message. 1KB/line × 10
messages/day × 365 = ~3.5 MB/year/author. Trivial. Random access by
sigHash is `by-hash/<aa>/<bb>/<hash>`; O(1) filesystem lookup.

**Q: Many concurrent clones?**
A: http-backend forks a process per request — that's the bottleneck.
Worth measuring; if it's the limit, write a Deno-native `upload-pack`
implementation (we already have most of the protocol parsing reading
`ssbc/plugins/git-server.js`).

**Q: Many concurrent pushes to the same repo?**
A: Per-repo lock around the receive-pack handler. Pushes serialize;
each one waits its turn. Race-free.

### Testing

Per-phase smoke tests. All in `test/`, runnable via `deno test`.

```
test/
  smoke.js            # phase 0: clone + push + reclone roundtrip
  sign-on-push.js     # phase 1: pushed blobs hash-match, message verifies
  rebuild.js          # phase 2: delete bare repos, restart, clone works
  replication.js      # phase 3: two-server pubsub
  json-api.js         # phase 4: refs/log/tree/blob JSON shape
  issues.js           # phase 5: open/comment/close round-trip
  prs.js              # phase 6: fork + PR + merge end-to-end
  auth.js             # phase 7: unauthorized push rejected
```

Each test spins up real Deno servers in temp dirs and exercises the
real HTTP API. No mocks for the protocol surface — too much risk of
mocks drifting from real git behavior. (Same lesson as ssbc/AGENTS.md's
"don't mock the database" feedback.)

### Open questions / unknowns

These don't have answers yet. They block phase 2+ if not resolved.

1. **Rebuild from log: are all packs self-contained?**
   git-ssb sets `no-thin` in capabilities to force complete packs from
   clients. We need to do the same in our advertisement. Without it,
   clients may send thin packs that reference objects already on the
   server; if we then replay packs on a fresh node in a different
   order, we may try to apply a thin pack before its base objects are
   present. Test in phase 2.

2. **Atomic ref updates across packs.**
   Currently each `git-update` is atomic, but if two pushes happen and
   one fails partway through write, what state is the bare repo in?
   Probably need per-repo write lock + write-pack-then-update-refs
   order. Standard git semantics; worth verifying we get it for free
   from http-backend.

3. **Pack chain bloat.**
   100 small pushes = 100 small pack blobs. Replaying takes 100×
   `index-pack` invocations. A periodic repack job (phase 10) helps,
   but until then, what's the practical limit? Benchmark at phase 2.

4. **Trystero in browser for repo gossip.**
   Wiredove uses trystero. Browsers can hold an apds-style log of
   messages but not pack blobs (size). Can a browser meaningfully
   participate in repo gossip as a metadata-only peer? Probably yes;
   design pending.

5. **Cross-relay link integrity.**
   A `git-pr-open` references a `sourceRepo` that may live on a
   different relay. How does the target relay fetch the source's pack
   if its peer set doesn't include the source relay? Option A: PRs
   include the pack hash inline, and any peer holding that hash will
   serve it. Option B: target relay HTTP-fetches the pack from the
   source relay's blob endpoint. Probably A; cleaner.

6. **Encrypted repos.**
   v2+. Need to design the recipient-list scheme (per-message `recps`,
   à la SSB private-box) and decide whether pack blobs are encrypted
   as a whole or per-object. Almost certainly per-pack — git already
   gives us the natural unit.

7. **Message log compaction.**
   At some point per-author logs grow large. SSB's solution: nothing —
   you keep everything. ANProto's: ?

8. **Tombstones across the network.**
   A tombstone is a *request*. No node is obligated to honor it. UX
   question: do UIs render tombstoned content with a "redacted by
   author" placeholder, or hide entirely? Probably a config flag.

9. **Anonymous read with rate limits.**
   Public clones are anonymous. A bot could clone the same big repo
   1000 times. Per-IP throttling at the HTTP layer covers most of it;
   nothing protocol-level required.

10. **Time-skewed signers.**
    A signer with a wildly wrong clock writes confusing `ts` fields.
    Soft policy: reject messages with `ts > now + 5 min` or `ts <
    epoch + first-valid-ANProto-message-ts`. Document in protocol.

---

## What this document is not

- The protocol spec. The core protocol lives in [SPEC.md](SPEC.md); schemas
  in this work order are product sketches unless promoted there.
- A timeline. No dates because we don't know the cadence yet.
- A contract. Things will change as we hit phases and learn.

When a design decision in this doc turns out wrong, **update the doc**
rather than working around it. The doc is the shared model; if it
drifts from reality, future-us will plan against the wrong picture.
