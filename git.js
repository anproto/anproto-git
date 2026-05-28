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
// The ANProto announcement layer stores the incoming pack as a raw-byte blob
// and appends a signed git-update message before the request is handed to Git.

import { blob } from "./blob.js";
import { gitUpdateMessage } from "./repo.js";
import {
  appendMessage,
  latestRepoUpdate,
  repoUpdates,
  safeHash,
  safePathPart,
} from "./log.js";
import { an } from "./lib/an.js";

export const repoDir = (reposRoot, authorPub, name) =>
  `${reposRoot}/${safePathPart(authorPub)}/${name}.git`;

export const repoProjectPath = (authorPub, name) =>
  `${safePathPart(authorPub)}/${name}.git`;

export const ensureBareRepo = async (dir) => {
  try {
    await Deno.lstat(dir);
    return false;
  } catch (_) {
    await Deno.mkdir(dir, { recursive: true });
    const init = new Deno.Command("git", {
      args: ["init", "--bare", "--initial-branch=main", dir],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stderr } = await init.output();
    if (code !== 0) {
      throw new Error(`git init failed: ${new TextDecoder().decode(stderr)}`);
    }
    // http-backend needs this to serve without per-repo config.
    await Deno.writeTextFile(`${dir}/git-daemon-export-ok`, "");
    return true;
  }
};

export const ensureRepoView = async (dir, opts) => {
  try {
    await Deno.lstat(dir);
    return false;
  } catch (_) {
    await ensureBareRepo(dir);
    await rebuildRepoFromLog(dir, opts);
    return true;
  }
};

// Run `git http-backend` as a CGI process. Translate the Deno request to
// the CGI env it expects, pipe the request body into stdin, parse the
// "Status: ..." / header block off the front of stdout, return the rest as
// the response body.
export const httpBackend = async (req, opts) => {
  const { reposRoot, projectPath, pathInfo, service } = opts;
  const url = new URL(req.url);
  const reqBody = req.body
    ? new Uint8Array(await new Response(req.body).arrayBuffer())
    : new Uint8Array();
  let pendingUpdate = null;

  if (service === "git-receive-pack" && req.method === "POST") {
    let err;
    try {
      pendingUpdate = await prepareGitUpdate(reqBody, opts);
    } catch (e) {
      err = e;
    }
    if (err) {
      return new Response(`git-update rejected: ${err.message}`, {
        status: 400,
      });
    }
  }

  const env = {
    GIT_PROJECT_ROOT: reposRoot,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: "/" + projectPath + pathInfo,
    REQUEST_METHOD: req.method,
    QUERY_STRING: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    CONTENT_TYPE: req.headers.get("content-type") || "",
    CONTENT_LENGTH: req.headers.get("content-length") || "",
    REMOTE_ADDR: "127.0.0.1",
    REMOTE_USER: "",
    // Required to let unauthenticated pushes through. Real auth comes from
    // the ANProto sig check on the published message, not from HTTP basic.
    GIT_HTTP_ALLOW_REPACK: "1",
  };

  // Allow receive-pack (push) without HTTP auth in v0.
  // git http-backend gates this on the http.receivepack config of the repo.
  // We pre-set it when the repo is created (see ensureBareRepo).

  const cmd = new Deno.Command("git", {
    args: ["http-backend"],
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();

  // Pipe request body to stdin.
  const writer = child.stdin.getWriter();
  await writer.write(reqBody);
  await writer.close();

  // Collect stdout/stderr.
  const [stdoutBuf, stderrBuf, status] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
    child.status,
  ]);

  if (!status.success) {
    const errText = new TextDecoder().decode(stderrBuf);
    return new Response("git http-backend failed: " + errText, { status: 500 });
  }

  const out = new Uint8Array(stdoutBuf);
  // Header block ends at \r\n\r\n (or \n\n).
  let split = -1;
  for (let i = 0; i < out.length - 3; i++) {
    if (
      out[i] === 13 && out[i + 1] === 10 && out[i + 2] === 13 &&
      out[i + 3] === 10
    ) {
      split = i + 4;
      break;
    }
  }
  if (split === -1) {
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 10 && out[i + 1] === 10) {
        split = i + 2;
        break;
      }
    }
  }
  if (split === -1) {
    return new Response("git http-backend produced no headers", {
      status: 500,
    });
  }

  const headerBlock = new TextDecoder().decode(out.slice(0, split));
  const body = out.slice(split);

  const headers = new Headers();
  let httpStatus = 200;
  for (const line of headerBlock.split(/\r?\n/)) {
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const k = line.slice(0, colon).trim();
    const v = line.slice(colon + 1).trim();
    if (k.toLowerCase() === "status") {
      const code = parseInt(v.split(" ")[0], 10);
      if (Number.isFinite(code)) httpStatus = code;
    } else {
      headers.set(k, v);
    }
  }

  // CORS so a browser-side tool could read JSON endpoints we add later.
  headers.set("Access-Control-Allow-Origin", "*");

  if (
    pendingUpdate && httpStatus >= 200 && httpStatus < 300 &&
    receivePackAccepted(body)
  ) {
    await appendMessage(opts.messagesRoot, pendingUpdate.msg, an);
    console.log(
      `[announce] ${pendingUpdate.updateCount} ref update(s), pack=${
        pendingUpdate.packHash || "none"
      } ${opts.projectPath}`,
    );
  }

  return new Response(body, { status: httpStatus, headers });
};

const receivePackAccepted = (body) => {
  const text = new TextDecoder().decode(body);
  if (text.includes("\nng ") || text.includes("ng refs/")) return false;
  if (text.includes("unpack ok") || text.includes("ok refs/")) return true;
  return false;
};

const ZERO = "0000000000000000000000000000000000000000";

const parseReceivePack = (body) => {
  const updates = [];
  let offset = 0;
  while (offset + 4 <= body.length) {
    const lenStr = new TextDecoder().decode(body.slice(offset, offset + 4));
    offset += 4;
    if (lenStr === "0000") break;
    const len = parseInt(lenStr, 16);
    if (!Number.isFinite(len) || len < 4 || offset + len - 4 > body.length) {
      throw new Error("invalid pkt-line in receive-pack request");
    }
    let line = new TextDecoder().decode(body.slice(offset, offset + len - 4));
    offset += len - 4;
    line = line.replace(/\n$/, "");
    const nul = line.indexOf("\0");
    if (nul !== -1) line = line.slice(0, nul);
    const [oldHash, newHash, ref] = line.split(" ");
    if (!oldHash || !newHash || !ref) continue;
    updates.push({
      ref,
      old: oldHash === ZERO ? null : oldHash,
      new: newHash === ZERO ? null : newHash,
    });
  }
  return { updates, pack: body.slice(offset) };
};

const tmpDir = async () =>
  await Deno.makeTempDir({ prefix: "anproto-git-pack-" });

const removeDir = async (dir) => {
  await Deno.remove(dir, { recursive: true }).catch(() => {});
};

const run = async (cmd, opts = {}) => {
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdin: opts.input ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
    env: opts.env,
  }).spawn();
  if (opts.input) {
    const writer = child.stdin.getWriter();
    await writer.write(opts.input);
    await writer.close();
  }
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.status,
  ]);
  if (!status.success) {
    throw new Error(stderr.trim() || `${cmd.join(" ")} failed`);
  }
  return new Uint8Array(stdout);
};

const runText = async (cmd, opts = {}) =>
  new TextDecoder().decode(await run(cmd, opts));

const hex = (bytes) =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const normalizePack = async (packBytes, repoPath) => {
  const dir = await tmpDir();
  const packPath = `${dir}/incoming.pack`;
  const idxPath = `${dir}/incoming.idx`;
  try {
    await run(
      ["git", "index-pack", "--stdin", "--fix-thin", "-o", idxPath, packPath],
      { input: packBytes, env: { GIT_DIR: repoPath } },
    );
    const [pack, idx] = await Promise.all([
      Deno.readFile(packPath),
      Deno.readFile(idxPath),
    ]);
    const showIndex = new TextDecoder().decode(
      await run(["git", "show-index"], { input: idx }),
    );
    const objectIds = showIndex.trim()
      ? showIndex.trim().split("\n").map((line) =>
        line.trim().split(/\s+/).at(-1)
      )
      : [];
    const packSha1 = pack.length >= 20
      ? hex(pack.slice(pack.length - 20))
      : null;
    return { pack, objectIds, packSha1 };
  } finally {
    await removeDir(dir);
  }
};

const currentRef = async (repoPath, ref) => {
  try {
    return (await runText([
      "git",
      "--git-dir",
      repoPath,
      "rev-parse",
      "--verify",
      ref,
    ])).trim();
  } catch (_) {
    return null;
  }
};

const installPack = async (repoPath, packHash, blobsRoot) => {
  if (!packHash) return;
  const bytes = await blob(blobsRoot).get(packHash);
  if (!bytes) {
    throw new Error(`missing pack blob ${packHash}`);
  }
  const safe = safeHash(packHash);
  const packDir = `${repoPath}/objects/pack`;
  await Deno.mkdir(packDir, { recursive: true });
  const packPath = `${packDir}/pack-${safe}.pack`;
  const idxPath = `${packDir}/pack-${safe}.idx`;
  await Deno.writeFile(packPath, bytes);
  await run(["git", "index-pack", "-o", idxPath, packPath]);
};

const applyUpdates = async (repoPath, updates) => {
  for (const update of updates) {
    const current = await currentRef(repoPath, update.ref);
    if ((current || null) !== update.old) {
      throw new Error(
        `ref ${update.ref} expected ${update.old || ZERO}, found ${
          current || ZERO
        }`,
      );
    }
  }
  for (const update of updates) {
    if (update.new === null) {
      const args = [
        "git",
        "--git-dir",
        repoPath,
        "update-ref",
        "-d",
        update.ref,
      ];
      if (update.old) args.push(update.old);
      await run(args);
    } else {
      await run([
        "git",
        "--git-dir",
        repoPath,
        "update-ref",
        update.ref,
        update.new,
        update.old || ZERO,
      ]);
    }
  }
};

export const rebuildRepoFromLog = async (repoPath, opts) => {
  const repo = { author: opts.authorPub, name: opts.name };
  const updates = await repoUpdates(opts.messagesRoot, repo, an);
  for (const entry of updates) {
    await installPack(repoPath, entry.parsed.pack, opts.blobsRoot);
    await applyUpdates(repoPath, entry.parsed.updates || []);
  }
  return updates.length;
};

const prepareGitUpdate = async (body, opts) => {
  const { updates, pack } = parseReceivePack(body);
  if (updates.length === 0) return null;

  const hasNewObjects = updates.some((update) => update.new !== null);
  let stored = { hash: null, size: 0 };
  let packSha1 = null;
  let numObjects = 0;

  if (hasNewObjects) {
    if (pack.length === 0) {
      throw new Error("receive-pack changed refs without a pack");
    }
    const normalized = await normalizePack(pack, opts.repoPath);
    stored = await blob(opts.blobsRoot).put(normalized.pack);
    packSha1 = normalized.packSha1;
    numObjects = normalized.objectIds.length;
  }

  const msg = await gitUpdateMessage(
    opts.keypair,
    { author: opts.authorPub, name: opts.name },
    updates,
    stored.hash,
    packSha1,
    numObjects,
    (await latestRepoUpdate(
      opts.messagesRoot,
      { author: opts.authorPub, name: opts.name },
      an,
    ))?.sigHash || null,
  );
  return { msg, updateCount: updates.length, packHash: stored.hash };
};
