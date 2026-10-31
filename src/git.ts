import { execFile } from "node:child_process";
import { relative, resolve, sep, extname } from "node:path";
import { realpath } from "node:fs/promises";
import { ConsoleError, type Store } from "./store.ts";
import { inside, readText, imageTypes } from "./files.ts";
import { diffFile } from "./diff.ts";
import type { ChangedFile } from "./changes.ts";

function execute(root: string, args: string[], limit = 4 * 1024 * 1024, input = ""): Promise<Buffer> {
  return new Promise((done, fail) => {
    execFile("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "color.ui=false", "-C", root, ...args],
      { encoding: "buffer", maxBuffer: limit, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) fail(new ConsoleError(stderr?.toString().trim() || error.message, 422));
        else done(stdout);
      }).stdin?.end(input);
  });
}
async function batchBlobs(root: string, objects: string[]) {
  const ids = [...new Set(objects)];
  const texts = new Map<string, string | Error>();
  if (!ids.length) return texts;
  const info = (await execute(root, ["cat-file", "--batch-check"], undefined, ids.join("\n") + "\n")).toString().trimEnd().split("\n");
  const batches: { id: string; size: number }[][] = [];
  let batch: { id: string; size: number }[] = [], bytes = 0;
  for (const line of info) {
    const [id, type, rawSize] = line.split(" "), size = Number(rawSize);
    if (type !== "blob") texts.set(id, new Error("Not a historical text file"));
    else if (size > 2 * 1024 * 1024) texts.set(id, new Error("Historical file exceeds 2 MiB and was not loaded"));
    else {
      // Bound each subprocess's output without falling back to one process per file.
      if (bytes + size > 16 * 1024 * 1024 && batch.length) { batches.push(batch); batch = []; bytes = 0; }
      batch.push({ id, size }); bytes += size;
    }
  }
  if (batch.length) batches.push(batch);
  for (const entries of batches) {
    const data = await execute(root, ["cat-file", "--batch"], entries.reduce((n, e) => n + e.size + 128, 0), entries.map(e => e.id).join("\n") + "\n");
    let offset = 0;
    for (const { id, size } of entries) {
      // Blob contents may contain arbitrary newlines or NULs; only the header is line-delimited.
      const start = data.indexOf(10, offset) + 1;
      const content = data.subarray(start, start + size); offset = start + size + 1;
      if (content.includes(0)) texts.set(id, new Error("Binary historical files have no text view"));
      else {
        try { texts.set(id, new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content)); }
        catch { texts.set(id, new Error("Historical file is not UTF-8 text")); }
      }
    }
  }
  return texts;
}
function hashOf(hash: string) {
  if (!/^[0-9a-f]{40,64}$/i.test(hash)) throw new ConsoleError("Invalid commit hash");
  return hash;
}
export async function gitQuery(store: Store, operation: string, params: URLSearchParams) {
  const root = await realpath(params.get("root") || "");
  if (!store.projects.some(p => p.root === root)) throw new ConsoleError("Project not authorized", 403);
  const top = (await execute(root, ["rev-parse", "--show-toplevel"])).toString().trim();
  const prefix = relative(top, root);
  const repoPath = (path: string) => {
    const absolute = resolve(root, path);
    if (!inside(root, absolute)) throw new ConsoleError("Historical path escapes the project", 403);
    return relative(top, absolute).split(sep).join("/");
  };
  const scoped = (path: string) => inside(root, resolve(top, path));
  const display = (path: string) => relative(root, resolve(top, path)).split(sep).join("/");
  const visible = (path: string) => path.split("/").at(-1) !== ".DS_Store";
  const blob = async (hash: string, path: string) => {
    const tree = (await execute(top, ["ls-tree", "-z", hash, "--", path])).toString();
    const entry = tree.split("\0").find(line => line.slice(line.indexOf("\t") + 1) === path);
    if (!entry) throw new ConsoleError("This file does not exist at that revision", 404);
    const object = entry.split("\t")[0].split(" ");
    if (object[1] !== "blob") throw new ConsoleError("Not a historical text file");
    const size = Number((await execute(top, ["cat-file", "-s", object[2]])).toString());
    if (size > 2 * 1024 * 1024) throw new ConsoleError("Historical file exceeds 2 MiB and was not loaded", 413);
    const data = await execute(top, ["cat-file", "blob", object[2]], 2 * 1024 * 1024 + 1);
    if (data.includes(0)) throw new ConsoleError("Binary historical files have no text view", 415);
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); }
    catch { throw new ConsoleError("Historical file is not UTF-8 text", 415); }
  };
  const totals = (files: { added: number; deleted: number; countable?: boolean }[]) => ({
    added: files.reduce((n, f) => n + f.added, 0), deleted: files.reduce((n, f) => n + f.deleted, 0),
    unavailable: files.filter(f => f.countable === false).length,
  });
  // -z numstat uses two extra NUL fields for a rename; paths themselves may contain tabs/newlines.
  const numstat = (data: string) => {
    const fields = data.split("\0");
    const files = [];
    for (let i = 0; i < fields.length; i++) {
      const match = fields[i].match(/^\n*([\d-]+)\t([\d-]+)\t([\s\S]*)$/);
      if (!match) continue;
      const beforePath = match[3] || fields[++i];
      const afterPath = match[3] || fields[++i];
      if (!afterPath || (!scoped(beforePath) && !scoped(afterPath))) continue;
      if (!visible(scoped(afterPath) ? afterPath : beforePath)) continue;
      // A rename crossing the project boundary is an add/delete in this project.
      const countable = match[1] !== "-" && match[2] !== "-";
      files.push({ path: display(scoped(afterPath) ? afterPath : beforePath), beforePath, afterPath,
        added: countable ? Number(match[1]) : 0, deleted: countable ? Number(match[2]) : 0, countable });
    }
    return files;
  };
  const head = async () => {
    const branch = await execute(top, ["symbolic-ref", "--quiet", "--short", "HEAD"]).then(b => b.toString().trim()).catch(() => "");
    const hash = await execute(top, ["rev-parse", "--verify", "HEAD"]).then(b => b.toString().trim()).catch(() => "");
    return { branch, hash, label: branch || hash.slice(0, 7), unborn: !hash };
  };
  if (operation === "head") return head();
  if (operation === "workspace" || operation === "workspace-file") {
    const current = await head();
    const base = current.hash || (await execute(top, ["hash-object", "-t", "tree", "--stdin"])).toString().trim();
    const groups = [];
    for (const [id, args] of [["staged", ["--cached", base]], ["unstaged", []]] as const) {
      const files = numstat((await execute(top, ["diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", prefix ? "--no-renames" : "-M", ...args])).toString());
      groups.push({ id, files, ...totals(files) });
    }
    const paths = (await execute(top, ["ls-files", "--others", "--exclude-standard", "-z"])).toString().split("\0").filter(p => p && scoped(p) && visible(p));
    const untracked = [];
    for (const path of paths.slice(0, 500)) {
      try {
        const text = await readText(store, root, display(path));
        if (text.partial) throw new Error("File exceeds the text preview limit");
        const diff = diffFile(display(path), "", text.content);
        untracked.push({ path: display(path), beforePath: path, afterPath: path, added: diff.addedLines, deleted: 0, countable: true });
      } catch { untracked.push({ path: display(path), beforePath: path, afterPath: path, added: 0, deleted: 0, countable: false }); }
    }
    groups.push({ id: "untracked", files: untracked, ...totals(untracked) });
    if (operation === "workspace") {
      const files = groups.flatMap(g => g.files);
      return { ...current, groups, count: new Set(files.map(f => f.path)).size, ...totals(files), truncated: paths.length > 500 };
    }
    const group = params.get("group"), path = params.get("path") || "";
    const entry = groups.find(g => g.id === group)?.files.find(f => f.path === path);
    if (!entry) throw new ConsoleError("The working-tree diff changed; refresh and retry", 404);
    const file: ChangedFile & { countable: boolean } = { path, status: "Modified", added: entry.added, deleted: entry.deleted, countable: entry.countable };
    try {
      const present = { before: group !== "untracked" && (group !== "staged" || !!current.hash), after: true };
      const index = async (p: string) => {
        const size = Number((await execute(top, ["cat-file", "-s", ":" + p])).toString());
        if (size > 2 * 1024 * 1024) throw new Error("Staged file exceeds 2 MiB");
        const data = await execute(top, ["show", ":" + p], 2 * 1024 * 1024 + 1);
        if (data.includes(0)) throw new Error("Binary files have no text diff");
        return new TextDecoder("utf-8", { fatal: true }).decode(data);
      };
      const readIndex = (p: string, side: "before" | "after") => index(p).catch(async e => {
        const exists = await execute(top, ["ls-files", "--error-unmatch", "--", p]).then(() => true).catch(() => false);
        if (exists) throw e;
        present[side] = false;
        return "";
      });
      const before = group === "untracked" || (group === "staged" && !current.hash) ? "" : group === "staged"
        ? await blob(base, entry.beforePath).catch(async e => {
          const found = (await execute(top, ["ls-tree", "-z", base, "--", entry.beforePath])).length;
          if (found) throw e; present.before = false; return "";
        }) : await readIndex(entry.beforePath, "before");
      let after = "";
      if (group === "staged") after = await readIndex(entry.afterPath, "after");
      else {
        try {
          const text = await readText(store, root, path);
          if (text.partial) throw new Error("File exceeds 2 MiB");
          after = text.content;
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; present.after = false; }
      }
      file.diff = diffFile(path, before, after);
      file.added = file.diff.addedLines; file.deleted = file.diff.deletedLines;
      file.status = !present.before ? "Added" : !present.after ? "Deleted" : "Modified";
    } catch (e) { file.status = "Unavailable"; file.countable = false; file.notice = e instanceof Error ? e.message : String(e); }
    return file;
  }
  if (operation === "refs") {
    const data = (await execute(top, ["for-each-ref", "--format=%(objectname)%09%(refname:short)", "refs/heads", "refs/remotes", "refs/tags"])).toString();
    return { refs: data.trim().split("\n").filter(Boolean).map(line => { const [hash, name] = line.split("\t"); return { hash, name }; }) };
  }
  if (operation === "log") {
    const ref = params.get("hash");
    if (ref) hashOf(ref);
    const limit = Math.max(1, Math.min(100, Number(params.get("limit") || 50)));
    const skip = Math.max(0, Math.min(100000, Number(params.get("skip") || 0)));
    if (!Number.isInteger(limit) || !Number.isInteger(skip)) throw new ConsoleError("Invalid paging parameters");
    if (!(await head()).hash && !ref) return { commits: [] };
    const data = (await execute(top, ["log", `--max-count=${limit}`, `--skip=${skip}`, "--format=%x00%H%x00%P%x00%aI%x00%an%x00%s%x00", "--numstat", "-z", prefix ? "--no-renames" : "-M", "--diff-merges=first-parent", ref || "HEAD", "--", ...(prefix ? [prefix] : [])])).toString();
    const fields = data.split("\0");
    const commits = [];
    for (let i = 0; i < fields.length;) {
      if (!/^[0-9a-f]{40,64}$/.test(fields[i])) { i++; continue; }
      const [hash, parents, date, author, subject] = fields.slice(i, i + 5); i += 5;
      const stats = [];
      while (i < fields.length && !/^[0-9a-f]{40,64}$/.test(fields[i])) {
        const field = fields[i++]; stats.push(field);
        if (/^\n*[\d-]+\t[\d-]+\t$/.test(field)) stats.push(fields[i++], fields[i++]);
      }
      commits.push({ hash, parents: parents.split(" ").filter(Boolean), date, author, subject, ...totals(numstat(stats.join("\0"))) });
    }
    return { commits };
  }
  const hash = operation === "image" && params.get("group") === "staged" ? "" : hashOf(params.get("hash") || "");
  // Verify an actual commit, not an arbitrary object supplied by a forged URL.
  if (hash) await execute(top, ["cat-file", "-e", hash + "^{commit}"]);
  const path = params.get("path") || "";
  if (operation === "image") {
    const type = imageTypes[extname(path).toLowerCase()];
    if (!type) throw new ConsoleError("Not an image file", 415);
    const data = await execute(top, ["show", `${hash}:${repoPath(path)}`], 16 * 1024 * 1024);
    return { url: `data:${type};base64,${data.toString("base64")}` };
  }
  if (operation === "file") return { path, content: await blob(hash, repoPath(path)), partial: true, historical: true, hash };
  if (operation === "blame") {
    await blob(hash, repoPath(path));
    return { text: (await execute(top, ["blame", "--line-porcelain", hash, "--", repoPath(path)])).toString() };
  }
  if (operation === "commit") {
    const meta = (await execute(top, ["show", "-s", "--format=%P%x00%an%x00%aI%x00%s", hash])).toString().trimEnd().split("\0");
    const metadata = { author: meta[1], date: meta[2], subject: meta[3] };
    const parents = meta[0].split(" ").filter(Boolean);
    const parentIndex = Number(params.get("parent") || 0);
    if (!Number.isInteger(parentIndex) || parentIndex < 0 || (parents.length && parentIndex >= parents.length)) throw new ConsoleError("Invalid parent revision");
    const parent = parents[parentIndex] || null;
    const args = parent
      ? ["diff-tree", "--no-ext-diff", "--no-textconv", "-r", "--no-commit-id", "--raw", "--no-abbrev", "-z", "-M", parent, hash]
      : ["diff-tree", "--root", "-r", "--no-commit-id", "--raw", "--no-abbrev", "-z", hash];
    const parts = (await execute(top, args)).toString().split("\0").filter(Boolean);
    const entries = [];
    for (let i = 0; i < parts.length;) {
      const [, , beforeID, afterID, status] = parts[i++].slice(1).split(" ");
      const beforePath = parts[i++];
      const afterPath = /^[RC]/.test(status) ? parts[i++] : beforePath;
      if (!afterPath || (!scoped(afterPath) && !scoped(beforePath))) continue;
      const target = scoped(afterPath) ? afterPath : beforePath;
      if (!visible(target)) continue;
      const hasBefore = !!parent && status !== "A" && scoped(beforePath);
      const hasAfter = status !== "D" && scoped(afterPath);
      const file: ChangedFile = { path: display(target), status: !hasBefore ? "Added" : !hasAfter ? "Deleted" : "Modified", added: 0, deleted: 0 };
      if (/^[RC]/.test(status)) file.notice = `Original path: ${display(beforePath)}`;
      entries.push({ file, hasBefore, hasAfter, beforeID, afterID });
      if (entries.length >= 500) break;
    }
    const texts = await batchBlobs(top, entries.filter(e => !imageTypes[extname(e.file.path).toLowerCase()]).flatMap(e => [...(e.hasBefore ? [e.beforeID] : []), ...(e.hasAfter ? [e.afterID] : [])]));
    const text = (id: string) => { const value = texts.get(id)!; if (value instanceof Error) throw value; return value; };
    for (const { file, hasBefore, hasAfter, beforeID, afterID } of entries) {
      if (imageTypes[extname(file.path).toLowerCase()]) { file.countable = false; continue; }
      try {
        const before = hasBefore ? text(beforeID) : "";
        const after = hasAfter ? text(afterID) : "";
        file.diff = diffFile(file.path, before, after);
        file.added = file.diff.addedLines; file.deleted = file.diff.deletedLines;
      } catch (e) { file.status = "Unavailable"; file.notice = e instanceof Error ? e.message : String(e); }
    }
    return { hash, parent, parents, files: entries.map(e => e.file), ...metadata, ...(entries.length >= 500 ? { truncated: true } : {}) };
  }
  throw new ConsoleError("Unknown Git query", 404);
}
