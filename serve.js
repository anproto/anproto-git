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

import {
  ensureRepoView,
  httpBackend,
  repoDir,
  repoProjectPath,
} from "./git.js";
import { handleApi } from "./json-api.js";
import { canonicalJson, validRepoParts } from "./repo.js";
import { an } from "./lib/an.js";
import { encode as b64encode } from "./lib/base64.js";
import { repoPage } from "./ui.js";

const REPOS_ROOT = `${Deno.cwd()}/repos`;
const BLOBS_ROOT = `${Deno.cwd()}/blobs`;
const MESSAGES_ROOT = `${Deno.cwd()}/messages`;
const PORT = parseInt(Deno.env.get("PORT") || "9100", 10);
const KEYFILE = Deno.env.get("ANPROTO_GIT_KEYFILE") ||
  `${Deno.cwd()}/keypair.txt`;
const REQUIRE_AUTH = Deno.env.get("ANPROTO_GIT_REQUIRE_AUTH") === "1";

await Deno.mkdir(REPOS_ROOT, { recursive: true });
await Deno.mkdir(BLOBS_ROOT, { recursive: true });
await Deno.mkdir(MESSAGES_ROOT, { recursive: true });

const loadKeypair = async () => {
  try {
    return (await Deno.readTextFile(KEYFILE)).trim();
  } catch (_) {
    const keypair = await an.gen();
    await Deno.writeTextFile(KEYFILE, keypair);
    await Deno.chmod(KEYFILE, 0o600).catch(() => {});
    return keypair;
  }
};

const keypair = await loadKeypair();
const serverPub = keypair.slice(0, 44);
const challenges = new Map();

// Route shape: /git/<author>/<name>/<rest>. author is 44 chars and may
// contain '/' if base64 happens to produce one — but only the trailing
// `=` is special; '/' inside the base64 splits us. We accept up to two
// slashes inside the author segment by requiring the next segment to
// match `<name>.<knownSuffix>`. Simpler approach: require URL-encoded
// author so '/' doesn't collide.
const ROUTE =
  /^\/git\/([^/]+)\/([^/]+)\/(info\/refs|git-upload-pack|git-receive-pack)$/;
const REPO_ROUTE = /^\/git\/([^/]+)\/([^/]+)\/?$/;
const API_ROUTE = /^\/git\/([^/]+)\/([^/]+)\/api\/(.+)$/;
const AUTH_ROUTE = /^\/git\/([^/]+)\/([^/]+)\/auth\/challenge$/;

const randomNonce = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64encode(bytes);
};

const challengeBody = (authorPub, name, nonce, expires) =>
  canonicalJson({
    type: "git-auth-challenge",
    version: 1,
    repo: { author: authorPub, name },
    nonce,
    expires,
  });

const issueChallenge = async (authorPub, name) => {
  const nonce = randomNonce();
  const expires = Date.now() + 5 * 60 * 1000;
  const body = challengeBody(authorPub, name, nonce, expires);
  challenges.set(nonce, { body, expires, authorPub, name });
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
};

const verifyAuth = async (req, authorPub, name) => {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^AnProto\s+(.+)$/);
  if (!match) return false;
  const sig = match[1].trim();
  if (sig.slice(0, 44) !== authorPub) return false;
  let opened;
  try {
    opened = await an.open(sig);
  } catch (_) {
    return false;
  }
  const signedHash = opened.slice(-44);
  const now = Date.now();

  for (const [nonce, challenge] of challenges) {
    if (challenge.expires < now) {
      challenges.delete(nonce);
      continue;
    }
    if (challenge.authorPub !== authorPub || challenge.name !== name) continue;
    if (await an.hash(challenge.body) !== signedHash) continue;
    challenges.delete(nonce);
    return true;
  }
  return false;
};

const handle = async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(LANDING, { headers: { "content-type": "text/html" } });
  }

  const authMatch = url.pathname.match(AUTH_ROUTE);
  if (authMatch) {
    const [, authorRaw, nameRaw] = authMatch;
    const authorPub = decodeURIComponent(authorRaw);
    const name = decodeURIComponent(nameRaw);
    if (!validRepoParts(authorPub, name)) {
      return new Response("invalid repo id", { status: 400 });
    }
    if (req.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }
    return issueChallenge(authorPub, name);
  }

  const apiMatch = url.pathname.match(API_ROUTE);
  if (apiMatch) {
    const [, authorRaw, nameRaw, subpath] = apiMatch;
    const authorPub = decodeURIComponent(authorRaw);
    const name = decodeURIComponent(nameRaw);
    if (!validRepoParts(authorPub, name)) {
      return new Response("invalid repo id", { status: 400 });
    }
    const dir = repoDir(REPOS_ROOT, authorPub, name);
    await ensureRepoView(dir, {
      authorPub,
      name,
      blobsRoot: BLOBS_ROOT,
      messagesRoot: MESSAGES_ROOT,
    });
    return handleApi(req, dir, decodeURIComponent(subpath));
  }

  const repoMatch = url.pathname.match(REPO_ROUTE);
  if (repoMatch) {
    const [, authorRaw, nameRaw] = repoMatch;
    const authorPub = decodeURIComponent(authorRaw);
    const name = decodeURIComponent(nameRaw);
    if (!validRepoParts(authorPub, name)) {
      return new Response("invalid repo id", { status: 400 });
    }
    const dir = repoDir(REPOS_ROOT, authorPub, name);
    await ensureRepoView(dir, {
      authorPub,
      name,
      blobsRoot: BLOBS_ROOT,
      messagesRoot: MESSAGES_ROOT,
    });
    return new Response(repoPage({ authorPub, name, port: PORT }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const m = url.pathname.match(ROUTE);
  if (!m) {
    return new Response("not found", { status: 404 });
  }

  let authorRaw, nameRaw, endpoint;
  [, authorRaw, nameRaw, endpoint] = m;
  const authorPub = decodeURIComponent(authorRaw);
  const name = decodeURIComponent(nameRaw);

  if (!validRepoParts(authorPub, name)) {
    return new Response("invalid repo id", { status: 400 });
  }
  if (
    endpoint === "git-receive-pack" && req.method === "POST" &&
    authorPub !== serverPub
  ) {
    return new Response("receive-pack author does not match server keypair", {
      status: 403,
    });
  }
  if (endpoint === "git-receive-pack" && req.method === "POST") {
    const authHeader = req.headers.has("authorization");
    const ok = authHeader ? await verifyAuth(req, authorPub, name) : false;
    if (authHeader && !ok) {
      return new Response("invalid ANProto authorization", { status: 401 });
    }
    if (REQUIRE_AUTH && !ok) {
      return new Response("ANProto authorization required", { status: 401 });
    }
  }

  // Determine which service this request is for so the announce hook can
  // tell push from fetch.
  let service;
  if (endpoint === "info/refs") {
    service = url.searchParams.get("service");
    if (service !== "git-upload-pack" && service !== "git-receive-pack") {
      return new Response("unsupported service", { status: 400 });
    }
  } else {
    service = endpoint;
  }

  const dir = repoDir(REPOS_ROOT, authorPub, name);
  await ensureRepoView(dir, {
    authorPub,
    name,
    blobsRoot: BLOBS_ROOT,
    messagesRoot: MESSAGES_ROOT,
  });
  // git http-backend reads its own http.receivepack from the repo config
  // before allowing receive-pack. Set it on every request as a no-op-if-set
  // safeguard during the POC.
  await Deno.writeTextFile(`${dir}/config`, GIT_CONFIG).catch(() => {});

  return httpBackend(req, {
    reposRoot: REPOS_ROOT,
    blobsRoot: BLOBS_ROOT,
    messagesRoot: MESSAGES_ROOT,
    projectPath: repoProjectPath(authorPub, name),
    pathInfo: "/" + endpoint,
    service,
    repoPath: dir,
    authorPub,
    name,
    keypair,
  });
};

const GIT_CONFIG = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = true
[http]
\treceivepack = true
\tuploadpack = true
[receive]
\tdenyDeleteCurrent = ignore
`;

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
`;

console.log(`anproto-git listening on http://127.0.0.1:${PORT}`);
console.log(`  pubkey ${serverPub}`);
console.log(`  repos at ${REPOS_ROOT}`);
console.log(`  blobs at ${BLOBS_ROOT}`);
console.log(`  messages at ${MESSAGES_ROOT}`);
Deno.serve({ port: PORT }, handle);
