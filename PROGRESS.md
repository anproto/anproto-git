# progress

Append-only log of what landed and when. Newest entry on top.

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
