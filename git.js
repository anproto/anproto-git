// Smart-HTTP glue. v0 strategy: delegate the actual protocol to
// `git http-backend`, the canonical CGI helper that ships with git. We
// translate Deno's Request <-> CGI env + stdio, run http-backend in front
// of a bare repo on disk, and hand its response back to the client.
//
// On `git-receive-pack` (push), we also (later) want to:
//   1. intercept the validated pack
//   2. hash + store it as a blob
//   3. publish a signed git-update message
//
// v0 just gets http-backend wired up so a normal `git push` / `git clone`
// roundtrip works against the bare repo. The ANProto announcement layer is
// stubbed in announcePush() below — currently a console.log, ultimately a
// blob.put + apds.add of a signed git-update.

import { parseRepoId } from './repo.js'

const textEncoder = new TextEncoder()

export const repoDir = (reposRoot, authorPub, name) =>
  `${reposRoot}/${authorPub}/${name}.git`

export const ensureBareRepo = async (dir) => {
  try {
    await Deno.lstat(dir)
    return false
  } catch (_) {
    await Deno.mkdir(dir, { recursive: true })
    const init = new Deno.Command('git', {
      args: ['init', '--bare', '--initial-branch=main', dir],
      stdout: 'piped',
      stderr: 'piped',
    })
    const { code, stderr } = await init.output()
    if (code !== 0) {
      throw new Error(`git init failed: ${new TextDecoder().decode(stderr)}`)
    }
    // http-backend needs this to serve without per-repo config.
    await Deno.writeTextFile(`${dir}/git-daemon-export-ok`, '')
    return true
  }
}

// Run `git http-backend` as a CGI process. Translate the Deno request to
// the CGI env it expects, pipe the request body into stdin, parse the
// "Status: ..." / header block off the front of stdout, return the rest as
// the response body.
export const httpBackend = async (req, opts) => {
  const { reposRoot, projectPath, pathInfo, service } = opts
  const url = new URL(req.url)

  const env = {
    GIT_PROJECT_ROOT: reposRoot,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: '/' + projectPath + pathInfo,
    REQUEST_METHOD: req.method,
    QUERY_STRING: url.search.startsWith('?') ? url.search.slice(1) : url.search,
    CONTENT_TYPE: req.headers.get('content-type') || '',
    CONTENT_LENGTH: req.headers.get('content-length') || '',
    REMOTE_ADDR: '127.0.0.1',
    REMOTE_USER: '',
    // Required to let unauthenticated pushes through. Real auth comes from
    // the ANProto sig check on the published message, not from HTTP basic.
    GIT_HTTP_ALLOW_REPACK: '1',
  }

  // Allow receive-pack (push) without HTTP auth in v0.
  // git http-backend gates this on the http.receivepack config of the repo.
  // We pre-set it when the repo is created (see ensureBareRepo).

  const cmd = new Deno.Command('git', {
    args: ['http-backend'],
    env,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  })
  const child = cmd.spawn()

  // Pipe request body to stdin.
  const writer = child.stdin.getWriter()
  if (req.body) {
    const reader = req.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) { break }
      await writer.write(value)
    }
  }
  await writer.close()

  // Collect stdout/stderr.
  const [stdoutBuf, stderrBuf, status] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
    child.status,
  ])

  if (!status.success) {
    const errText = new TextDecoder().decode(stderrBuf)
    return new Response('git http-backend failed: ' + errText, { status: 500 })
  }

  const out = new Uint8Array(stdoutBuf)
  // Header block ends at \r\n\r\n (or \n\n).
  let split = -1
  for (let i = 0; i < out.length - 3; i++) {
    if (out[i] === 13 && out[i+1] === 10 && out[i+2] === 13 && out[i+3] === 10) {
      split = i + 4; break
    }
  }
  if (split === -1) {
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 10 && out[i+1] === 10) { split = i + 2; break }
    }
  }
  if (split === -1) {
    return new Response('git http-backend produced no headers', { status: 500 })
  }

  const headerBlock = new TextDecoder().decode(out.slice(0, split))
  const body = out.slice(split)

  const headers = new Headers()
  let httpStatus = 200
  for (const line of headerBlock.split(/\r?\n/)) {
    if (!line) { continue }
    const colon = line.indexOf(':')
    if (colon === -1) { continue }
    const k = line.slice(0, colon).trim()
    const v = line.slice(colon + 1).trim()
    if (k.toLowerCase() === 'status') {
      const code = parseInt(v.split(' ')[0], 10)
      if (Number.isFinite(code)) { httpStatus = code }
    } else {
      headers.set(k, v)
    }
  }

  // CORS so a browser-side tool could read JSON endpoints we add later.
  headers.set('Access-Control-Allow-Origin', '*')

  // Hook for the announce-on-push flow. We don't yet snapshot the pack
  // here — http-backend has already consumed the body and applied it. To
  // do this properly we either:
  //  (a) re-snapshot the new objects by diffing against refs we saw at the
  //      start of the request, or
  //  (b) interpose: read the body ourselves first, run `git index-pack` to
  //      get the pack as a single file, *then* hand the body to http-backend.
  // (b) is what git-ssb does (see ssbc/plugins/git-server.js:154 and
  // ssbc/plugins/git-server.js:579). Worth doing in step 3 of the build order.
  if (service === 'git-receive-pack' && req.method === 'POST') {
    announcePush(opts).catch(err => console.error('announce error:', err))
  }

  return new Response(body, { status: httpStatus, headers })
}

const announcePush = async (opts) => {
  // TODO: hash the new pack, blob.put it, publish a signed git-update message.
  // For now just log so we can confirm the hook fires.
  console.log(`[announce] push to ${opts.projectPath}`)
}
