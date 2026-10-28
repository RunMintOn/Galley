import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { ConsoleError, type Store } from "./store.ts";
import { inside } from "./files.ts";
import { diffFile } from "./diff.ts";
import type { ChangedFile } from "./changes.ts";

function execute(root: string, args: string[], limit = 4 * 1024 * 1024): Promise<Buffer> {
  return new Promise((done, fail) => {
    execFile("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "color.ui=false", "-C", root, ...args],
      { encoding: "buffer", maxBuffer: limit, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) fail(new ConsoleError(stderr?.toString().trim() || error.message, 422));
        else done(stdout);
      });
  });
}
function hashOf(hash: string) {
  if (!/^[0-9a-f]{40,64}$/i.test(hash)) throw new ConsoleError("提交 hash 无效");
  return hash;
}
export async function gitQuery(store: Store, operation: string, params: URLSearchParams) {
  const root = await realpath(params.get("root") || "");
  if (!store.projects.some(p => p.root === root)) throw new ConsoleError("项目未授权", 403);
  const top = (await execute(root, ["rev-parse", "--show-toplevel"])).toString().trim();
  const prefix = relative(top, root);
  const repoPath = (path: string) => {
    const absolute = resolve(root, path);
    if (!inside(root, absolute)) throw new ConsoleError("历史路径超出项目", 403);
    return relative(top, absolute).split(sep).join("/");
  };
  const scoped = (path: string) => inside(root, resolve(top, path));
  const display = (path: string) => relative(root, resolve(top, path)).split(sep).join("/");
  const blob = async (hash: string, path: string) => {
    const tree = (await execute(top, ["ls-tree", "-z", hash, "--", path])).toString();
    const entry = tree.split("\0").find(line => line.slice(line.indexOf("\t") + 1) === path);
    if (!entry) throw new ConsoleError("该版本不存在此文件", 404);
    const object = entry.split("\t")[0].split(" ");
    if (object[1] !== "blob") throw new ConsoleError("不是历史文本文件");
    const size = Number((await execute(top, ["cat-file", "-s", object[2]])).toString());
    if (size > 2 * 1024 * 1024) throw new ConsoleError("历史文件超过 2 MiB，未加载", 413);
    const data = await execute(top, ["cat-file", "blob", object[2]], 2 * 1024 * 1024 + 1);
    if (data.includes(0)) throw new ConsoleError("二进制历史文件不提供文本视图", 415);
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); }
    catch { throw new ConsoleError("历史文件不是 UTF-8 文本", 415); }
  };
  if (operation === "refs") {
    const data = (await execute(top, ["for-each-ref", "--format=%(objectname)%09%(refname:short)", "refs/heads", "refs/remotes", "refs/tags"])).toString();
    return { refs: data.trim().split("\n").filter(Boolean).map(line => { const [hash, name] = line.split("\t"); return { hash, name }; }) };
  }
  if (operation === "log") {
    const ref = params.get("hash");
    if (ref) hashOf(ref);
    const limit = Math.max(1, Math.min(100, Number(params.get("limit") || 50)));
    const skip = Math.max(0, Math.min(100000, Number(params.get("skip") || 0)));
    if (!Number.isInteger(limit) || !Number.isInteger(skip)) throw new ConsoleError("分页参数无效");
    const data = (await execute(top, ["log", `--max-count=${limit}`, `--skip=${skip}`, "--format=%H%x00%P%x00%aI%x00%an%x00%s", ref || "HEAD", "--", ...(prefix ? [prefix] : [])])).toString();
    return {
      commits: data.trim().split("\n").filter(Boolean).map(line => {
        const [hash, parents, date, author, subject] = line.split("\0");
        return { hash, parents: parents.split(" ").filter(Boolean), date, author, subject };
      }),
    };
  }
  const hash = hashOf(params.get("hash") || "");
  // Verify an actual commit, not an arbitrary object supplied by a forged URL.
  await execute(top, ["cat-file", "-e", hash + "^{commit}"]);
  const path = params.get("path") || "";
  if (operation === "file") return { path, content: await blob(hash, repoPath(path)), partial: true, historical: true, hash };
  if (operation === "blame") {
    await blob(hash, repoPath(path));
    return { text: (await execute(top, ["blame", "--line-porcelain", hash, "--", repoPath(path)])).toString() };
  }
  if (operation === "commit") {
    const parents = (await execute(top, ["rev-list", "--parents", "-n", "1", hash])).toString().trim().split(" ").slice(1);
    const parentIndex = Number(params.get("parent") || 0);
    if (!Number.isInteger(parentIndex) || parentIndex < 0 || (parents.length && parentIndex >= parents.length)) throw new ConsoleError("父版本无效");
    const parent = parents[parentIndex] || null;
    const args = parent
      ? ["diff-tree", "--no-ext-diff", "--no-textconv", "-r", "--no-commit-id", "--name-status", "-z", "-M", parent, hash]
      : ["diff-tree", "--root", "-r", "--no-commit-id", "--name-status", "-z", hash];
    const parts = (await execute(top, args)).toString().split("\0").filter(Boolean);
    const files: ChangedFile[] = [];
    for (let i = 0; i < parts.length;) {
      const status = parts[i++], beforePath = parts[i++];
      const afterPath = /^[RC]/.test(status) ? parts[i++] : beforePath;
      if (!afterPath || (!scoped(afterPath) && !scoped(beforePath))) continue;
      const target = scoped(afterPath) ? afterPath : beforePath;
      const hasBefore = !!parent && status !== "A" && scoped(beforePath);
      const hasAfter = status !== "D" && scoped(afterPath);
      const file: ChangedFile = { path: display(target), status: !hasBefore ? "Added" : !hasAfter ? "Deleted" : "Modified", added: 0, deleted: 0 };
      try {
        const before = hasBefore ? await blob(parent!, beforePath) : "";
        const after = hasAfter ? await blob(hash, afterPath) : "";
        file.diff = diffFile(file.path, before, after);
        file.added = file.diff.addedLines; file.deleted = file.diff.deletedLines;
        if (/^[RC]/.test(status)) file.notice = `原路径：${display(beforePath)}`;
      } catch (e) { file.status = "Unavailable"; file.notice = e instanceof Error ? e.message : String(e); }
      files.push(file);
      if (files.length >= 500) return { hash, parent, parents, files, truncated: true };
    }
    return { hash, parent, parents, files };
  }
  throw new ConsoleError("未知 Git 查询", 404);
}
