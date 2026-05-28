export const safeHash = (hash) =>
  hash.replace(/\//g, "_").replace(/\+/g, "-").replace(/=+$/, "");

export const safePathPart = safeHash;

const byHashPath = (root, sigHash) => {
  const safe = safeHash(sigHash);
  return `${root}/by-hash/${safe.slice(0, 2)}/${safe.slice(2, 4)}/${safe}`;
};

const parseSignedHash = async (sig, an) => {
  const opened = await an.open(sig);
  return opened.slice(-44);
};

export const appendMessage = async (root, msg, an) => {
  const author = msg.sig.slice(0, 44);
  const safeAuthor = safePathPart(author);
  const ts = JSON.parse(msg.body).ts;
  const name = `${ts}-${safeHash(msg.sigHash)}`;
  const authorDir = `${root}/by-author/${safeAuthor}`;
  const hashDir = byHashPath(root, msg.sigHash).replace(/\/[^/]+$/, "");
  await Deno.mkdir(authorDir, { recursive: true });
  await Deno.mkdir(hashDir, { recursive: true });
  await Deno.writeTextFile(`${authorDir}/${name}.sig`, msg.sig);
  await Deno.writeTextFile(`${hashDir}/${safeHash(msg.sigHash)}`, msg.body);
  await Deno.writeTextFile(
    `${authorDir}/index.jsonl`,
    JSON.stringify({
      ts,
      sigHash: msg.sigHash,
      contentHash: msg.contentHash,
      contentHashFromSig: await parseSignedHash(msg.sig, an),
      type: JSON.parse(msg.body).type,
      repo: JSON.parse(msg.body).repo,
    }) + "\n",
    { append: true },
  );
};

const readIndex = async (root, author) => {
  const file = `${root}/by-author/${safePathPart(author)}/index.jsonl`;
  try {
    const text = await Deno.readTextFile(file);
    return text.trim()
      ? text.trim().split("\n").map((line) => JSON.parse(line))
      : [];
  } catch (_) {
    return [];
  }
};

export const readSignedMessages = async (root, author, an) => {
  const entries = await readIndex(root, author);
  const out = [];
  for (const entry of entries) {
    try {
      const [body, sig] = await Promise.all([
        Deno.readTextFile(byHashPath(root, entry.sigHash)),
        Deno.readTextFile(
          `${root}/by-author/${safePathPart(author)}/${entry.ts}-${
            safeHash(entry.sigHash)
          }.sig`,
        ),
      ]);
      const opened = await an.open(sig);
      const bodyHash = await an.hash(body);
      if (opened.slice(-44) !== bodyHash) continue;
      const parsed = JSON.parse(body);
      out.push({ ...entry, body, parsed, sig });
    } catch (_) {
      continue;
    }
  }
  return out;
};

export const repoUpdates = async (root, repo, an) => {
  const messages = await readSignedMessages(root, repo.author, an);
  return messages
    .filter(({ parsed, sig }) =>
      sig.slice(0, 44) === repo.author &&
      parsed.type === "git-update" &&
      parsed.repo?.author === repo.author &&
      parsed.repo?.name === repo.name
    )
    .sort((a, b) =>
      a.parsed.ts - b.parsed.ts || a.sigHash.localeCompare(b.sigHash)
    );
};

export const latestRepoUpdate = async (root, repo, an) => {
  const updates = await repoUpdates(root, repo, an);
  return updates.at(-1) || null;
};
