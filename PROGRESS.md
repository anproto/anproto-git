# progress

Append-only log of what landed and when. Newest entry on top.

## 2026-05-28 — JSON API + minimal forge UI

Pulled Phase 4 forward before peer replication so pushed anproto repos
are browsable.

**Works:**

- JSON API routes under `/git/<pub>/<name>/api/`:
  - `refs`
  - `log?ref=<ref>`
  - `tree?ref=<ref>&path=<path>`
  - `blob?ref=<ref>&path=<path>`
  - `commit/<sha>`
  - `diff/<sha>`
- Repo page at `/git/<pub>/<name>/` with:
  - repo header and clone URL
  - branch selector
  - tree browser
  - README rendering
  - file view
  - commit list
  - commit diff view
- All API/UI reads go through `ensureRepoView`, so deleting `repos/`
  still rebuilds from `messages/` + `blobs/` before serving the page.

**Verified:**

```
$ git push anproto main
$ curl -fsS "$repo/api/refs"
$ curl -fsS "$repo/api/log?ref=refs/heads/main"
$ curl -fsS "$repo/api/tree?ref=refs/heads/main"
$ curl -fsS "$repo/api/blob?ref=refs/heads/main&path=README.md"
$ curl -fsS "$repo/api/diff/<sha>"
```

Opened the repo page in the in-app browser and clicked through tree,
file, commits, and diff views successfully.

**Still open / sharper later:**

- README rendering is intentionally tiny, not full GitHub-flavored
  Markdown.
- Diff rendering is raw patch text for now.
- No author/repo listing page yet; the homepage is still the old landing.
- Phase 3 peer replication is still untouched.

## 2026-05-28 — phase 1 complete, phase 2 replay slice

Finished the rest of phase 1's core mechanics and landed the first
phase 2 rebuild path.

**Works:**

- `parentUpdate` is now populated from the latest verified local
  `git-update` for the repo.
- `GET /git/<pub>/<name>/auth/challenge` issues a canonical JSON
  challenge. With `ANPROTO_GIT_REQUIRE_AUTH=1`, receive-pack requires
  `Authorization: AnProto <sig>` where the sig opens to that challenge's
  body hash.
- `bin.js auth-header <challenge-json-or-file>` signs a challenge with
  the local keypair for use with Git's `http.extraHeader`.
- Delete-only pushes are accepted and logged as `pack: null`,
  `numObjects: 0`.
- Push logging now waits until after `git http-backend` returns an
  accepted receive-pack result, so rejected ref transactions do not enter
  the message log.
- If `repos/<pub>/<name>.git` is missing, the server creates a bare repo
  and replays verified `git-update` messages from `messages/` plus pack
  bytes from `blobs/`.
- `verify.js` / `bin.js verify [data-dir]` checks message signatures,
  body hashes, blob hashes, and pack indexability.

**Verified:**

```
$ git push anproto main
$ git push anproto main          # second commit records parentUpdate
$ git push anproto :main         # delete-only update records pack: null
$ deno run -A verify.js <data-dir>
verified messages=3 packs=2 bytes=446
$ rm -rf <data-dir>/repos
$ git push anproto HEAD:main
$ rm -rf <data-dir>/repos
$ git clone http://127.0.0.1:<port>/git/<pub>/scratch rebuilt
$ git -C rebuilt log --oneline -1
<sha> two
```

Auth-required push was also checked with:

```
$ ANPROTO_GIT_REQUIRE_AUTH=1 PORT=19104 deno run -A serve.js
$ git push anproto main          # rejected
$ curl -fsS <repo-url>/auth/challenge -o challenge.json
$ deno run -A bin.js auth-header challenge.json > header.txt
$ git -c http.extraHeader="$(cat header.txt)" push anproto main
```

**Still open / sharper later:**

- Replay currently applies the locally logged update order. The spec's
  full divergent-chain canonicalization rules still need a dedicated pass.
- Challenge auth is implemented server-side, but there is no polished
  porcelain command that wraps challenge fetch + signed `git push`.
- Phase 3 peer replication is still untouched.

## 2026-05-28 — phase 1 push signing slice

Landed the first real blob-backed push path.

**Works:**

- `git-receive-pack` POST bodies are read once, parsed for pkt-line ref
  updates, then re-fed to `git http-backend` so normal Git push behavior
  still works.
- Incoming pack bytes are validated with `git index-pack --stdin
  --fix-thin`, stored in [blob.js](blob.js), and counted via
  `git show-index`.
- Successful pushes append a signed canonical-JSON `git-update` body and
  ANProto sig envelope under `messages/by-author/` and `messages/by-hash/`.
- The server keypair is loaded from `keypair.txt` or generated on first
  run. Localhost receive-pack rejects pushes whose URL author does not
  match the server pubkey.
- Filesystem paths for base64 pubkeys and hashes are made path-safe so `/`
  and `+` do not create accidental path segments.

**Verified:**

```
$ PORT=19101 deno run -A serve.js
$ git push anproto main
 * [new branch]      main -> main
$ git clone http://127.0.0.1:19101/git/<pub>/scratch clone
$ deno eval '... an.open(sig) ...'
match=true
$ git index-pack -o /tmp/incoming.idx <stored-blob-path>
$ git show-index < /tmp/incoming.idx | wc -l
3
```

**Still open in phase 1:**

- Real challenge/response auth. Current owner check is only the localhost
  scaffold: URL author must match the server keypair.
- `parentUpdate` is still `null`; next pass should derive the latest
  accepted update from the per-author log.
- Delete-only pushes are logged with `pack: null`; replay code needs to
  explicitly support that shape.
- No replay/rebuild from the message log yet — that is still phase 2.

## 2026-05-23 — session 1 handoff (commit pending)

End of session 1. Handing off to another agent — start with
[WORKORDER.md](WORKORDER.md), then this file for status.

Session deliverables beyond the [phase 0 scaffold](#2026-05-23--initial-scaffold-commit-53cc02b):

- [WORKORDER.md](WORKORDER.md) — full phased plan (10 phases) with a
  long Q&A section covering blobs, gossip, identity, multi-writer
  semantics, message schemas, replication wire format, storage layout,
  auth, deployment, moderation, and open questions.
- [PROGRESS.md](PROGRESS.md) — this file.
- git-ssb comparison + code reuse audit (see WORKORDER.md's
  "Code reuse from git-ssb" section). Headline: ~1500 LOC of
  `ssbc/plugins/git-server.js` + `decent/src/modules/git/git-browser.js`
  translates over directly, modulo the no-pull-streams rule.

Ground rules now codified in WORKORDER.md:

1. **No pull-streams.** Anywhere. Even when porting from ssbc.
2. Deno, not Node.
3. No new abstractions until phase 2 forces them.
4. Test against real `git` over real HTTP — no mocks for the protocol.

Three git-ssb patterns folded into the plan:

- Comments on issues/PRs = `type: post` with `root: <issueId>`, not a
  dedicated `git-issue-comment` type. Reuses wiredove's existing thread
  UI. (Matches ssb-issues.)
- Reactions = existing `type: vote`. Same model as
  `ssbc/AGENTS.md`'s vote schema.
- PR field naming = `baseRepo`/`baseBranch`/`headRepo`/`headBranch`,
  matching `ssb-pull-requests/lib/schemas.js` and GitHub vocabulary.

**Next agent's starting move:** phase 1. Concretely, refactor
[git.js](git.js)'s `httpBackend` so we read the request body ourselves,
run `git index-pack --stdin -o tmp.idx tmp.pack` against it, hash the
two outputs into the blob store via [blob.js](blob.js), parse the
pkt-line ref-update section, sign a `git-update` message via
[repo.js](repo.js)'s `gitUpdateMessage`, and append it to a local
message log. Then re-feed the validated pack to `git http-backend` so
the bare repo still ends up populated. See
[`ssbc/plugins/git-server.js:154`](../ssbc/plugins/git-server.js)
`normalizeReceivePack` for the shape, and rewrite its pull-stream
pipelines to async iterators as you port.

DoD for phase 1 lives in [WORKORDER.md](WORKORDER.md#phase-1--sign-on-push).

## 2026-05-23 — initial scaffold (commit `53cc02b`)

Built a Deno HTTP server that delegates git smart-HTTP to `git http-backend`
against a bare repo at `repos/<authorPub>/<name>.git`. Round-tripped a
`clone -> commit -> push -> reclone` and dogfooded by pushing this repo to
itself.

**Works:**

- `git clone http://host/git/<urlencoded-pub>/<name>` against an empty or
  populated repo
- `git push <remote> HEAD:main` and any other ref update
- Auto-creation of the bare repo on first request (POC convenience; will
  gate on a signed `git-repo` message in step 2)
- `bin.js keygen` writes a per-server ANProto keypair
- `bin.js create <name>` prints the remote URL for a chosen repo name
- Filesystem-backed binary blob store keyed by raw-byte sha256, ready for
  pack ingest (not yet called)

**Stubbed:**

- The announce-on-push hook (`git.js:announcePush`) logs to stdout instead
  of publishing a signed `git-update` message
- No replication between servers yet — bare repo on disk is the only state
- No issue / PR / fork / permission message types
- No web UI beyond a one-page landing
- No auth — receive-pack accepts any HTTP client

**Test evidence:**

```
$ deno run -A bin.js keygen
$ PORT=9100 deno run -A serve.js &
$ git remote add anproto http://127.0.0.1:9100/git/<enc-pub>/anproto-git
$ git push anproto main
   * [new branch]      main -> main
$ cd /tmp && git clone http://127.0.0.1:9100/git/<enc-pub>/anproto-git redux
$ git -C redux log --oneline -1
53cc02b Initial scaffold: git-over-ANProto endpoint
```

Server log on push:

```
[announce] push to <pub>/anproto-git.git
```

**Bug caught while building:** `repoId(author, name) = author + '/' + name`
is ambiguous because base64 pubkeys contain `/`. Switched to a fixed-prefix
layout (`repo.js`): first 44 chars are always the pubkey, the rest is the
name. Validators (`validRepoParts`) reject names that contain `/`.

**Architecture findings:**

- `apds.hash` runs input through `TextEncoder().encode()` before SHA-256.
  That's correct for utf8 text but wrong for raw bytes — a git pack hashed
  through that path is not the same hash as a peer would get from
  `crypto.subtle.digest("SHA-256", packBytes)`. anproto-git needs its own
  binary-blob primitives and they need to be promoted upstream eventually.
- git-ssb's push validation flow (`ssbc/plugins/git-server.js:154`
  `normalizeReceivePack`) is the right template: run `git index-pack
  --stdin -o idx pack` to validate, then store pack + idx as blobs. We'll
  port that shape rather than re-derive it.
