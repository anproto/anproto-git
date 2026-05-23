// anproto-git HTTP server.
//
// Routes:
//   GET  /git/:author/:name/info/refs?service=git-upload-pack
//   POST /git/:author/:name/git-upload-pack
//   GET  /git/:author/:name/info/refs?service=git-receive-pack
//   POST /git/:author/:name/git-receive-pack
//
// All four delegate to `git http-backend` against a bare repo at
// ./repos/<author>/<name>.git. The bare repo is auto-created on first
// access (POC convenience; in a real deployment, repo creation would be
// gated on a signed git-repo message).

import { ensureBareRepo, httpBackend, repoDir } from './git.js'
import { validRepoParts } from './repo.js'

const REPOS_ROOT = `${Deno.cwd()}/repos`
const BLOBS_ROOT = `${Deno.cwd()}/blobs`
const PORT = parseInt(Deno.env.get('PORT') || '9100', 10)

await Deno.mkdir(REPOS_ROOT, { recursive: true })
await Deno.mkdir(BLOBS_ROOT, { recursive: true })

// Route shape: /git/<author>/<name>/<rest>. author is 44 chars and may
// contain '/' if base64 happens to produce one — but only the trailing
// `=` is special; '/' inside the base64 splits us. We accept up to two
// slashes inside the author segment by requiring the next segment to
// match `<name>.<knownSuffix>`. Simpler approach: require URL-encoded
// author so '/' doesn't collide.
const ROUTE = /^\/git\/([^/]+)\/([^/]+)\/(info\/refs|git-upload-pack|git-receive-pack)$/

const handle = async (req) => {
  const url = new URL(req.url)

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response(LANDING, { headers: { 'content-type': 'text/html' } })
  }

  const m = url.pathname.match(ROUTE)
  if (!m) {
    return new Response('not found', { status: 404 })
  }

  let authorRaw, nameRaw, endpoint
  ;[, authorRaw, nameRaw, endpoint] = m
  const authorPub = decodeURIComponent(authorRaw)
  const name = decodeURIComponent(nameRaw)

  if (!validRepoParts(authorPub, name)) {
    return new Response('invalid repo id', { status: 400 })
  }

  // Determine which service this request is for so the announce hook can
  // tell push from fetch.
  let service
  if (endpoint === 'info/refs') {
    service = url.searchParams.get('service')
    if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
      return new Response('unsupported service', { status: 400 })
    }
  } else {
    service = endpoint
  }

  const dir = repoDir(REPOS_ROOT, authorPub, name)
  await ensureBareRepo(dir)
  // git http-backend reads its own http.receivepack from the repo config
  // before allowing receive-pack. Set it on every request as a no-op-if-set
  // safeguard during the POC.
  await Deno.writeTextFile(`${dir}/config`, GIT_CONFIG).catch(() => {})

  return httpBackend(req, {
    reposRoot: REPOS_ROOT,
    projectPath: `${authorPub}/${name}.git`,
    pathInfo: '/' + endpoint,
    service,
  })
}

const GIT_CONFIG = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = true
[http]
\treceivepack = true
\tuploadpack = true
`

const LANDING = `<!doctype html>
<html><head><meta charset="utf-8"><title>anproto-git</title>
<style>body{font-family:system-ui,sans-serif;max-width:42em;margin:3em auto;padding:0 1em;line-height:1.5}code,pre{background:#f5f5f5;padding:.1em .3em;border-radius:3px}pre{padding:1em;overflow:auto}</style>
</head><body>
<h1>anproto-git</h1>
<p>git over ANProto. Push and pull from signed git repos using a normal git remote.</p>
<p>Endpoints follow <code>/git/&lt;authorPub&gt;/&lt;name&gt;/{info/refs,git-upload-pack,git-receive-pack}</code>.</p>
<p>Try:</p>
<pre>git remote add anproto http://127.0.0.1:${PORT}/git/&lt;authorPub&gt;/scratch
git push anproto HEAD</pre>
<p>See <a href="https://anproto.com">anproto.com</a> and the repo's <code>DESIGN.md</code> for the bigger picture.</p>
</body></html>
`

console.log(`anproto-git listening on http://127.0.0.1:${PORT}`)
console.log(`  repos at ${REPOS_ROOT}`)
console.log(`  blobs at ${BLOBS_ROOT}`)
Deno.serve({ port: PORT }, handle)
