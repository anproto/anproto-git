import { encode as b64encode } from './lib/base64.js'

// Filesystem-backed binary blob store keyed by base64(sha256(bytes)).
//
// Unlike apds, which TextEncoder-encodes its input before hashing, this
// store hashes raw bytes. Use it for git packs and anything else binary.

export const blob = (root) => {
  const ensureRoot = async () => {
    await Deno.mkdir(root, { recursive: true })
  }

  const pathFor = (hash) => {
    // base64 can contain '/' — replace before using as a path segment.
    const safe = hash.replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/, '')
    return `${root}/${safe.slice(0, 2)}/${safe.slice(2, 4)}/${safe}`
  }

  const hashBytes = async (bytes) => {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return b64encode(Array.from(new Uint8Array(digest)))
  }

  const obj = {}

  obj.put = async (bytes) => {
    await ensureRoot()
    if (!(bytes instanceof Uint8Array)) {
      bytes = new Uint8Array(bytes)
    }
    const hash = await hashBytes(bytes)
    const file = pathFor(hash)
    await Deno.mkdir(file.substring(0, file.lastIndexOf('/')), { recursive: true })
    try {
      await Deno.lstat(file)
    } catch (_) {
      await Deno.writeFile(file, bytes)
    }
    return { hash, size: bytes.length }
  }

  obj.get = async (hash) => {
    try {
      return await Deno.readFile(pathFor(hash))
    } catch (_) {
      return null
    }
  }

  obj.stream = async (hash) => {
    try {
      const f = await Deno.open(pathFor(hash), { read: true })
      return f.readable
    } catch (_) {
      return null
    }
  }

  obj.has = async (hash) => {
    try {
      await Deno.lstat(pathFor(hash))
      return true
    } catch (_) {
      return false
    }
  }

  obj.hashBytes = hashBytes

  return obj
}
