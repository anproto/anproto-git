# anproto-git core spec

This is the small protocol kernel for replicating git repositories through
ANProto-signed messages and `anproto-blobs` handles. It deliberately excludes
forge product features such as issues, PRs, reviews, reactions, search, badges,
custom domains, browser gossip, and deployment polish. Those can layer on top
after the git replay model is boring.

## Goals

1. A normal git client can push to and clone from an anproto-git HTTP remote.
2. Every accepted push is represented by a signed ANProto message.
3. A fresh node with only signed messages and referenced blob handles can
   deterministically rebuild the same bare repository.
4. The protocol does not depend on a particular relay, transport, or local
   bare-repo cache.

## Repo identity

A repo id is a structured pair:

```json
{
  "author": "<44-char-anproto-pubkey>",
  "name": "repo-slug"
}
```

`author` is the repo owner's ANProto public key. `name` is 1-64 characters,
contains no `/`, and is compared byte-for-byte. Lowercase slugs are
recommended but not required.

URLs percent-encode the author key:

```text
/git/<urlencoded-author>/<name>
```

Messages MUST use the structured object form, never a concatenated
`<author>/<name>` string. This avoids ambiguity because base64 public keys can
contain `/`.

## Encoding

Core anproto-git message bodies are canonical JSON (JCS / RFC 8785), UTF-8
encoded, wrapped in the standard ANProto signature envelope. Each core message
has:

- `type`
- `version`
- `repo`, when the message is repo-scoped
- `ts`, unix milliseconds from the signer

Implementations MUST verify the ANProto signature before indexing or applying
any message. Implementations SHOULD reject messages with `ts > now + 5min`.

## Message types

### `git-repo`

Creates or announces a repo owned by the signer. Only the signer whose pubkey
equals `repo.author` can authoritatively create the repo.

```json
{
  "type": "git-repo",
  "version": 1,
  "repo": {
    "author": "<owner-pubkey>",
    "name": "anproto-git"
  },
  "description": "git over ANProto",
  "defaultBranch": "refs/heads/main",
  "ts": 1779900000000
}
```

`description` and `defaultBranch` are optional advisory metadata. The repo id
is `repo`, not the message hash.

### `git-update`

Records one accepted git push as an atomic ref transaction plus a handle to the
self-contained pack needed to replay it.

```json
{
  "type": "git-update",
  "version": 1,
  "repo": {
    "author": "<owner-pubkey>",
    "name": "anproto-git"
  },
  "updates": [
    {
      "ref": "refs/heads/main",
      "old": "<40-char-sha1-or-null>",
      "new": "<40-char-sha1-or-null>"
    }
  ],
  "pack": "<anproto-blobs-handle>",
  "packSha1": "<optional-git-pack-sha1>",
  "numObjects": 142,
  "parentUpdate": "<previous-accepted-git-update-sigHash-or-null>",
  "ts": 1779900000000
}
```

Rules:

- The signer MUST be `repo.author` in version 1. Collaborator/multi-writer
  semantics are out of core until owner-only replay is proven.
- `updates` is the complete set of refs changed by this push. Applying a
  `git-update` is all-or-nothing.
- `old` and `new` use full 40-character git sha1 object ids, or `null` for
  ref creation/deletion.
- `pack` is an `anproto-blobs` handle. It can be a single chunk or a manifest.
- `.idx` files are not protocol state. A node MAY cache an index locally, but
  replay MUST be possible from the pack alone.
- `parentUpdate` names the last accepted `git-update` for this repo that the
  signer built on, or `null` for the first update.

## Pack requirements

Accepted packs MUST be self-contained. A replaying node must be able to run
`git index-pack` on the stored pack in an empty bare repo after applying only
earlier accepted `git-update`s.

Implementations satisfy this by one of:

- advertising/forcing `no-thin` and rejecting thin packs;
- or running `git index-pack --fix-thin` and storing the completed pack.

The protocol-level requirement is the result: the `pack` handle points at the
self-contained bytes used for replay.

## Push authorization

Public deployments MUST require owner challenge-response before accepting
`git-receive-pack`.

Flow:

1. Client requests a challenge for `repo`.
2. Server returns a random nonce bound to `repo` and a short expiration.
3. Client signs the nonce with the ANProto key for `repo.author`.
4. Client sends the signature on the receive-pack request.
5. Server accepts only if the signature verifies and the pubkey equals
   `repo.author`.

Unauthenticated receive-pack is allowed only for localhost scaffolding.

## Replay algorithm

Given a repo id:

1. Verify and collect signed `git-repo` and `git-update` messages where
   `repo.author` equals the signer.
2. Sort candidate updates by causal chain from `parentUpdate`.
3. For each update in the selected chain:
   - fetch `pack` through `anproto-blobs`;
   - verify the blob handle;
   - run `git index-pack` into the bare repo;
   - verify every `old` value matches the current ref state;
   - apply all ref changes atomically.
4. Serve the resulting bare repo through normal git smart HTTP.

Arrival order and relay-local filesystem state MUST NOT affect replay.

If two valid owner-authored chains diverge, an implementation MUST preserve
both chains and choose one canonical branch of repo state deterministically:

1. longer valid chain wins;
2. if equal length, later tip `ts` wins;
3. if still tied, lexicographically smaller tip sigHash wins.

Non-canonical chains are not deleted; UIs may expose them as abandoned or
conflicting tips.

## Replication

The protocol requires only that peers can exchange:

- signed ANProto envelopes;
- content bodies referenced by those envelopes;
- `anproto-blobs` bytes referenced by `git-update.pack`.

HTTP poll and WebSocket are the first reference transports. DHT, Trystero,
browser metadata peers, search relays, and public gateways are not core
protocol requirements.

## Tombstones

Repo deletion is a signed request, not an enforceable global delete:

```json
{
  "type": "git-tombstone",
  "version": 1,
  "repo": {
    "author": "<owner-pubkey>",
    "name": "anproto-git"
  },
  "reason": "optional explanation",
  "ts": 1779900000000
}
```

Only a tombstone signed by `repo.author` is authoritative for that repo.
Relays MAY stop serving the repo and garbage-collect local caches. Other
relays may retain already-replicated content.

## Limits

Servers MUST enforce local resource limits before accepting pushes:

- max pack size;
- max repo size;
- max concurrent pushes per repo;
- max messages per author per time window.

These are local policy, not global protocol constants.

## Out of core

The following are intentionally outside this spec:

- issues, PRs, reviews, comments, reactions, and merge policy;
- collaborator permissions and multi-writer repos;
- web UI and JSON browse API;
- global search, topic discovery, custom domains, badges, metrics;
- networked repack messages;
- key rotation and identity claims;
- encrypted/private repos;
- DHT, Trystero, and browser gossip.

