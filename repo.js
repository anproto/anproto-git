import { an } from "./lib/an.js";

// Repo lifecycle: signed git-repo / git-update messages, identifier helpers.
//
// Identifier convention: <authorPub>/<name>. authorPub is the 44-char base64
// ed25519 pubkey from an.gen(). name is a short slug the author chooses; we
// don't enforce uniqueness across authors.

// Repo identity is (authorPub, name). We deliberately don't join these
// with a single delimiter — base64 pubkeys contain '/' so any naive join
// is ambiguous. When we need a string identifier (URL, message body), we
// pin the layout explicitly: the first 44 chars are always the pubkey.
export const repoId = (authorPub, name) => authorPub + name; // 44 + rest

export const parseRepoId = (id) => {
  if (typeof id !== "string" || id.length < 45) return null;
  const authorPub = id.slice(0, 44);
  const name = id.slice(44);
  if (!name) return null;
  return { authorPub, name };
};

export const validRepoParts = (authorPub, name) =>
  typeof authorPub === "string" && authorPub.length === 44 &&
  typeof name === "string" && name.length > 0 && !name.includes("/");

export const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return "{" + entries
    .map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v))
    .join(",") +
    "}";
};

// Sign a canonical JSON body with an ANProto keypair and return both hashes
// (for storage by hash) and the sig envelope. Mirrors apds.sign without the
// db.put side effects — the caller decides where to put each piece.
export const signMessage = async (keypair, fields) => {
  const body = canonicalJson({
    version: 1,
    ts: Date.now(),
    ...fields,
  });
  const contentHash = await an.hash(body);
  const sig = await an.sign(contentHash, keypair);
  const sigHash = await an.hash(sig);
  return { body, contentHash, sig, sigHash };
};

export const gitRepoMessage = (
  keypair,
  repo,
  description,
  defaultBranch = "refs/heads/main",
) =>
  signMessage(keypair, {
    type: "git-repo",
    repo,
    description,
    defaultBranch,
  });

export const gitUpdateMessage = (
  keypair,
  repo,
  updates,
  pack,
  packSha1,
  numObjects,
  parentUpdate = null,
) =>
  signMessage(keypair, {
    type: "git-update",
    repo,
    updates,
    pack,
    packSha1,
    numObjects,
    parentUpdate,
  });
