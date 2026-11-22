import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  tuf = require("./sigstore-tuf.cjs");
export function mirrorURL(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\\%]/.test(value)
  )
    throw Error("approved HTTPS mirror required");
  return url.href.replace(/\/$/, "");
}
async function download(url, max) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 404) return null;
  if (!r.ok || !r.body) throw Error("download");
  const chunks = [];
  let n = 0;
  for await (const chunk of r.body) {
    n += chunk.length;
    if (n > max) throw Error("size");
    chunks.push(chunk);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}
export async function fetchRepository(mirror, previous, bootstrap, pin) {
  mirror = mirrorURL(mirror);
  const repo = {
    bootstrapRoot: bootstrap,
    roots: previous?.repository?.roots?.slice() || [],
  };
  let version = tuf.metadata(repo.roots.at(-1) || bootstrap, "root").signed
    .version;
  try {
    let ended = false;
    for (let n = repo.roots.length; n < 32; n++) {
      const next = await download(
        mirror + "/" + (version + 1) + ".root.json",
        500000,
      );
      if (next === null) {
        ended = true;
        break;
      }
      repo.roots.push(next);
      version++;
    }
    if (!ended) throw Error("rotation budget");
    repo.timestamp = await download(mirror + "/timestamp.json", 500000);
    const ts = tuf.metadata(repo.timestamp, "timestamp");
    const consistent = tuf.metadata(repo.roots.at(-1) || bootstrap, "root")
      .signed.consistent_snapshot;
    repo.snapshot = await download(
      mirror +
        "/" +
        (consistent ? ts.signed.meta["snapshot.json"].version + "." : "") +
        "snapshot.json",
      500000,
    );
    const snapshot = tuf.metadata(repo.snapshot, "snapshot");
    repo.targets = await download(
      mirror +
        "/" +
        (consistent ? snapshot.signed.meta["targets.json"].version + "." : "") +
        "targets.json",
      500000,
    );
    const targets = tuf.metadata(repo.targets, "targets");
    const preliminary = tuf.verifyRepository(
      { ...repo, target: null },
      pin,
      Date.now(),
      previous?.floor,
    );
    if (!preliminary.checkpoint) return { ...repo, target: null };
    const info = targets.signed.targets?.["trusted_root.json"];
    if (info && !/^[a-f0-9]{64}$/.test(info.hashes?.sha256 || ""))
      throw Error("target hash");
    repo.target = info
      ? await download(
          mirror +
            "/targets/" +
            (consistent ? info.hashes?.sha256 + "." : "") +
            "trusted_root.json",
          200000,
        )
      : null;
    return repo;
  } catch (error) {
    error.repository = repo;
    throw error;
  }
}
