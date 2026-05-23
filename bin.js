// CLI helper. Two subcommands:
//   anproto-git serve          # start the HTTP server
//   anproto-git create <name>  # generate a keypair + repo URL, print both
//
// Run via `deno run -A bin.js <cmd>`.

import { an } from './lib/an.js'
import { repoId } from './repo.js'

const cmd = Deno.args[0]
const PORT = parseInt(Deno.env.get('PORT') || '9100', 10)
const KEYFILE = Deno.env.get('ANPROTO_GIT_KEYFILE') || `${Deno.cwd()}/keypair.txt`

const loadKey = async () => {
  try {
    return (await Deno.readTextFile(KEYFILE)).trim()
  } catch (_) {
    return null
  }
}

const saveKey = async (k) => {
  await Deno.writeTextFile(KEYFILE, k)
  await Deno.chmod(KEYFILE, 0o600).catch(() => {})
}

if (cmd === 'serve' || cmd === undefined) {
  await import('./serve.js')
} else if (cmd === 'create') {
  const name = Deno.args[1]
  if (!name) {
    console.error('usage: anproto-git create <name>')
    Deno.exit(2)
  }
  let key = await loadKey()
  if (!key) {
    key = await an.gen()
    await saveKey(key)
    console.error(`new keypair written to ${KEYFILE}`)
  }
  const pub = key.substring(0, 44)
  const id = repoId(pub, name)
  const url = `http://127.0.0.1:${PORT}/git/${encodeURIComponent(pub)}/${encodeURIComponent(name)}`
  console.log(`repo id: ${id}`)
  console.log(`remote:  ${url}`)
  console.log()
  console.log(`git remote add anproto ${url}`)
} else if (cmd === 'keygen') {
  const key = await an.gen()
  await saveKey(key)
  console.log(`wrote ${KEYFILE}`)
  console.log(`pubkey: ${key.substring(0, 44)}`)
} else {
  console.error(`unknown command: ${cmd}`)
  console.error(`usage:`)
  console.error(`  anproto-git serve`)
  console.error(`  anproto-git create <name>`)
  console.error(`  anproto-git keygen`)
  Deno.exit(2)
}
