import { an } from './lib/an.js'

// Repo lifecycle: signed git-repo / git-update messages, identifier helpers.
//
// Identifier convention: <authorPub>/<name>. authorPub is the 44-char base64
// ed25519 pubkey from an.gen(). name is a short slug the author chooses; we
// don't enforce uniqueness across authors.

// Repo identity is (authorPub, name). We deliberately don't join these
// with a single delimiter — base64 pubkeys contain '/' so any naive join
// is ambiguous. When we need a string identifier (URL, message body), we
// pin the layout explicitly: the first 44 chars are always the pubkey.
export const repoId = (authorPub, name) => authorPub + name  // 44 + rest

export const parseRepoId = (id) => {
  if (typeof id !== 'string' || id.length < 45) { return null }
  const authorPub = id.slice(0, 44)
  const name = id.slice(44)
  if (!name) { return null }
  return { authorPub, name }
}

export const validRepoParts = (authorPub, name) =>
  typeof authorPub === 'string' && authorPub.length === 44 &&
  typeof name === 'string' && name.length > 0 && !name.includes('/')

// Build the YAML body for a git-repo message. apds.compose would do this
// for us but we don't want to drag the whole apds object graph in; the body
// shape is small enough to write by hand.
const yamlBody = (fields) => {
  const lines = []
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) { continue }
    if (typeof v === 'string' && /[\n:]/.test(v)) {
      lines.push(`${k}: |\n  ${v.replace(/\n/g, '\n  ')}`)
    } else if (typeof v === 'object') {
      lines.push(`${k}:`)
      for (const [k2, v2] of Object.entries(v)) {
        lines.push(`  ${k2}: ${v2}`)
      }
    } else {
      lines.push(`${k}: ${v}`)
    }
  }
  return lines.join('\n') + '\n'
}

// Sign a YAML body with an ANProto keypair and return both the content blob
// (for storage by hash) and the sig envelope. Mirrors apds.sign without the
// db.put side effects — the caller decides where to put each piece.
export const signMessage = async (keypair, fields) => {
  const body = yamlBody(fields)
  const contentHash = await an.hash(body)
  const sig = await an.sign(contentHash, keypair)
  const sigHash = await an.hash(sig)
  return { body, contentHash, sig, sigHash }
}

export const gitRepoMessage = (keypair, name, description) =>
  signMessage(keypair, {
    type: 'git-repo',
    name,
    description,
  })

export const gitUpdateMessage = (keypair, repo, refs, pack, index, numObjects) =>
  signMessage(keypair, {
    type: 'git-update',
    repo,
    refs,
    pack,
    index,
    num_objects: numObjects,
  })
