import { blob } from "./blob.js";
import { an } from "./lib/an.js";
import { safeHash } from "./log.js";

const root = Deno.args[0] || Deno.cwd();
const messagesRoot = `${root}/messages`;
const blobsRoot = `${root}/blobs`;

const readIndexes = async () => {
  const out = [];
  try {
    for await (const authorDir of Deno.readDir(`${messagesRoot}/by-author`)) {
      if (!authorDir.isDirectory) continue;
      const indexFile =
        `${messagesRoot}/by-author/${authorDir.name}/index.jsonl`;
      try {
        const text = await Deno.readTextFile(indexFile);
        for (const line of text.trim().split("\n")) {
          if (line) {
            out.push({ ...JSON.parse(line), authorDir: authorDir.name });
          }
        }
      } catch (_) {
        continue;
      }
    }
  } catch (_) {
    return [];
  }
  return out;
};

const bodyPath = (sigHash) => {
  const safe = safeHash(sigHash);
  return `${messagesRoot}/by-hash/${safe.slice(0, 2)}/${
    safe.slice(2, 4)
  }/${safe}`;
};

const run = async (cmd) => {
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const { success } = await child.status;
  if (!success) {
    throw new Error(`${cmd.join(" ")} failed`);
  }
};

const verifyPack = async (packHash) => {
  if (!packHash) return 0;
  const store = blob(blobsRoot);
  const bytes = await store.get(packHash);
  if (!bytes) throw new Error(`missing blob ${packHash}`);
  const actualHash = await store.hashBytes(bytes);
  if (actualHash !== packHash) {
    throw new Error(
      `blob hash mismatch: expected ${packHash}, got ${actualHash}`,
    );
  }
  const dir = await Deno.makeTempDir({ prefix: "anproto-git-verify-" });
  try {
    const packPath = `${dir}/incoming.pack`;
    const idxPath = `${dir}/incoming.idx`;
    await Deno.writeFile(packPath, bytes);
    await run(["git", "index-pack", "-o", idxPath, packPath]);
    return bytes.length;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
};

let checkedMessages = 0;
let checkedPacks = 0;
let checkedBytes = 0;

for (const entry of await readIndexes()) {
  const body = await Deno.readTextFile(bodyPath(entry.sigHash));
  const sig = await Deno.readTextFile(
    `${messagesRoot}/by-author/${entry.authorDir}/${entry.ts}-${
      safeHash(entry.sigHash)
    }.sig`,
  );
  const opened = await an.open(sig);
  const bodyHash = await an.hash(body);
  if (opened.slice(-44) !== bodyHash) {
    throw new Error(`signature/body mismatch for ${entry.sigHash}`);
  }
  checkedMessages++;

  const parsed = JSON.parse(body);
  if (parsed.type === "git-update" && parsed.pack) {
    checkedBytes += await verifyPack(parsed.pack);
    checkedPacks++;
  }
}

console.log(
  `verified messages=${checkedMessages} packs=${checkedPacks} bytes=${checkedBytes}`,
);
