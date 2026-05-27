# anproto-git design notes

This file is implementation orientation. The normative protocol kernel lives
in [SPEC.md](SPEC.md). The broader product roadmap lives in
[WORKORDER.md](WORKORDER.md).

## Goal

```
git push anproto://<authorPub>/<name> HEAD
```

Such that:

1. the receiving server validates the push with normal git tooling;
2. the server publishes a signed `git-update` message;
3. any peer with the signed messages and referenced `anproto-blobs` handles
   can deterministically rebuild the same bare repo and serve `git clone`.

## Layers

```
┌─────────────────────────────────────────────────┐
│  smart-HTTP   (info/refs, upload-pack, ...)     │
├─────────────────────────────────────────────────┤
│  git http-backend / git plumbing                │
├─────────────────────────────────────────────────┤
│  bare repo cache: repos/<author>/<name>.git     │
├─────────────────────────────────────────────────┤
│  anproto-blobs pack storage                     │
├─────────────────────────────────────────────────┤
│  signed ANProto message log                     │
└─────────────────────────────────────────────────┘
```

The bare repo is a cache. Phase 0 treats it as authoritative because that is
the cheapest way to get smart HTTP working; the protocol target is replay
from signed messages plus blob handles.

## Core messages

Only two message types are core:

- `git-repo`
- `git-update`

Both are canonical JSON bodies inside ANProto signature envelopes. Repo ids
are structured objects:

```json
{
  "author": "<44-char-pubkey>",
  "name": "repo-slug"
}
```

Do not concatenate repo ids into `<author>/<name>` inside messages. Base64
pubkeys can contain `/`; URLs percent-encode the author instead.

## Push flow

```
client                          anproto-git server
  ─ POST /git/A/r/git-receive-pack ────────►
                                  authenticate owner challenge
                                  parse pkt-line ref updates
                                  capture packfile
                                  validate / complete pack with git
                                  store self-contained pack via anproto-blobs
                                  apply refs to bare repo cache
                                  publish signed git-update
  ◄──── pkt-line "unpack ok" + per-ref "ok" ──
```

`.idx` files are cache state, not protocol state. A replaying node must be
able to regenerate indexes from the stored pack.

## Replay flow

On first request for a repo, or after deleting `repos/`:

1. initialize a bare repo cache;
2. collect signed `git-update` messages for the repo;
3. select the deterministic canonical update chain per [SPEC.md](SPEC.md);
4. fetch each `pack` through `anproto-blobs`;
5. run `git index-pack`;
6. verify each update's `old` refs before applying `new` refs atomically;
7. delegate to `git http-backend`.

Arrival order and relay-local state must not affect the result.

## Deliberately outside core

Issues, PRs, reviews, reactions, collaborator permissions, key rotation,
encrypted repos, DHT/Trystero/browser gossip, networked repack messages,
search, custom domains, badges, metrics, and deployment polish are not part
of the git replay kernel. Keep those in the work order until the core is
boring.

