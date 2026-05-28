const textDecoder = new TextDecoder();

const run = async (cmd) => {
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
  }).spawn();
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

const git = (repoPath, args) => run(["git", "--git-dir", repoPath, ...args]);

const gitText = async (repoPath, args) =>
  textDecoder.decode(await git(repoPath, args));

export const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });

export const jsonError = (message, status = 500) =>
  jsonResponse({ error: message }, status);

const okRef = (ref) =>
  typeof ref === "string" && ref.length > 0 && !ref.startsWith("-") &&
  !ref.includes("..") && !ref.includes("\0");

const cleanPath = (path) => {
  path = path || "";
  if (
    path.startsWith("/") || path.includes("\0") ||
    path.split("/").includes("..")
  ) {
    throw new Error("invalid path");
  }
  return path;
};

const resolveRef = async (repoPath, ref) => {
  ref = ref || "HEAD";
  if (!okRef(ref)) throw new Error("invalid ref");
  return (await gitText(repoPath, ["rev-parse", "--verify", ref])).trim();
};

const objectSpec = (commit, path) => path ? `${commit}:${path}` : `${commit}:`;

const parsePerson = (s) => {
  const m = s.match(/^(.*) <(.*)> (\d+) ([+-]\d+)$/);
  if (!m) return { raw: s };
  return {
    name: m[1],
    email: m[2],
    date: new Date(parseInt(m[3], 10) * 1000).toISOString(),
    tz: m[4],
  };
};

const commitFormat =
  "%H%x1f%P%x1f%an <%ae> %at %ai%x1f%cn <%ce> %ct %ci%x1f%s%x1f%b";

const parseCommit = (text) => {
  const [sha, parents, author, committer, title, body = ""] = text.split(
    "\x1f",
  );
  return {
    sha,
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    author: parsePerson(author),
    committer: parsePerson(committer),
    title,
    body: body.trimEnd(),
  };
};

const refs = async (repoPath) => {
  const rows = (await gitText(repoPath, [
    "for-each-ref",
    "--format=%(refname)%00%(objectname)%00%(committerdate:iso8601)%00%(subject)",
    "refs/heads",
    "refs/tags",
  ])).trim().split("\n").filter(Boolean).map((line) => {
    const [name, sha, date, subject] = line.split("\0");
    return {
      name,
      short: name.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, ""),
      kind: name.startsWith("refs/tags/") ? "tag" : "branch",
      sha,
      date,
      subject,
    };
  });
  let head = null;
  try {
    head = (await gitText(repoPath, ["symbolic-ref", "-q", "HEAD"])).trim();
  } catch (_) {
    head = null;
  }
  return { head, refs: rows };
};

const log = async (repoPath, url) => {
  const ref = url.searchParams.get("ref") || "HEAD";
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "40", 10),
    100,
  );
  const sha = await resolveRef(repoPath, ref);
  const text = await gitText(repoPath, [
    "log",
    `--max-count=${Number.isFinite(limit) ? limit : 40}`,
    `--format=${commitFormat}%x1e`,
    sha,
  ]);
  const commits = text.split("\x1e").map((part) => part.trim()).filter(Boolean)
    .map(parseCommit);
  return { ref, sha, commits };
};

const commit = async (repoPath, sha) => {
  if (!okRef(sha)) throw new Error("invalid commit");
  const detail = parseCommit(
    await gitText(repoPath, ["show", "-s", `--format=${commitFormat}`, sha]),
  );
  const filesText = await gitText(repoPath, [
    "show",
    "--name-status",
    "--format=",
    "--find-renames",
    sha,
  ]);
  const files = filesText.trim().split("\n").filter(Boolean).map((line) => {
    const parts = line.split("\t");
    return {
      status: parts[0],
      path: parts.at(-1),
      oldPath: parts.length > 2 ? parts[1] : null,
    };
  });
  return { ...detail, files };
};

const tree = async (repoPath, url) => {
  const ref = url.searchParams.get("ref") || "HEAD";
  const path = cleanPath(url.searchParams.get("path") || "");
  const sha = await resolveRef(repoPath, ref);
  const out = await git(repoPath, ["ls-tree", "-z", objectSpec(sha, path)]);
  const raw = textDecoder.decode(out);
  const entries = raw.split("\0").filter(Boolean).map((entry) => {
    const tab = entry.indexOf("\t");
    const meta = entry.slice(0, tab).split(" ");
    const name = entry.slice(tab + 1);
    return {
      mode: meta[0],
      type: meta[1],
      sha: meta[2],
      name,
      path: path ? `${path}/${name}` : name,
      isDir: meta[1] === "tree",
    };
  }).sort((a, b) =>
    Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)
  );
  return { ref, sha, path, entries };
};

const blob = async (repoPath, url) => {
  const ref = url.searchParams.get("ref") || "HEAD";
  const path = cleanPath(url.searchParams.get("path") || "");
  if (!path) throw new Error("missing path");
  const sha = await resolveRef(repoPath, ref);
  const spec = objectSpec(sha, path);
  const [type, size, content] = await Promise.all([
    gitText(repoPath, ["cat-file", "-t", spec]),
    gitText(repoPath, ["cat-file", "-s", spec]),
    git(repoPath, ["cat-file", "-p", spec]),
  ]);
  const bytes = content.length;
  const text = bytes > 512 * 1024 ? "" : textDecoder.decode(content);
  return {
    ref,
    sha,
    path,
    type: type.trim(),
    size: parseInt(size.trim(), 10),
    truncated: bytes > 512 * 1024,
    content: text,
  };
};

const diff = async (repoPath, sha) => {
  if (!okRef(sha)) throw new Error("invalid commit");
  const detail = parseCommit(
    await gitText(repoPath, ["show", "-s", `--format=${commitFormat}`, sha]),
  );
  const patch = await gitText(repoPath, [
    "show",
    "--format=",
    "--find-renames",
    "--patch",
    "--stat",
    "--no-ext-diff",
    sha,
  ]);
  return { ...detail, patch };
};

export const handleApi = async (req, repoPath, subpath) => {
  const url = new URL(req.url);
  if (req.method !== "GET") return jsonError("method not allowed", 405);
  try {
    if (subpath === "refs") return jsonResponse(await refs(repoPath));
    if (subpath === "log") return jsonResponse(await log(repoPath, url));
    if (subpath === "tree") return jsonResponse(await tree(repoPath, url));
    if (subpath === "blob") return jsonResponse(await blob(repoPath, url));
    if (subpath.startsWith("commit/")) {
      return jsonResponse(
        await commit(repoPath, decodeURIComponent(subpath.slice(7))),
      );
    }
    if (subpath.startsWith("diff/")) {
      return jsonResponse(
        await diff(repoPath, decodeURIComponent(subpath.slice(5))),
      );
    }
    return jsonError("unknown api endpoint", 404);
  } catch (err) {
    return jsonError(
      err.message,
      /not found|missing|invalid|Needed/.test(err.message) ? 404 : 500,
    );
  }
};
