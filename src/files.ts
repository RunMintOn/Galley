import { createHash } from "node:crypto";
import { open, opendir, realpath, stat, readFile, mkdir, writeFile, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, extname, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { ConsoleError, type Store } from "./store.ts";

const EDIT_LIMIT = 2 * 1024 * 1024;
const PAGE_BYTES = 256 * 1024;
async function boundedRead(handle: FileHandle, length: number, position: number) {
  const buffer = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const { bytesRead } = await handle.read(buffer, total, length - total, position + total);
    if (!bytesRead) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}
export const ignored = new Set([".git", "node_modules", "dist", "build", ".cache", ".next"]);
export const inside = (root: string, path: string) => {
  const local = relative(root, path);
  return !isAbsolute(local) && local !== ".." && !local.startsWith(".." + sep);
};
export async function projectPath(store: Store, root: string, path = "") {
  const canonical = await realpath(root);
  if (!store.projects.some(p => p.root === canonical)) throw new ConsoleError("项目未授权", 403);
  if (typeof path !== "string" || path.includes("\0")) throw new ConsoleError("路径无效");
  const target = resolve(canonical, path);
  if (!inside(canonical, target)) throw new ConsoleError("路径超出项目", 403);
  const actual = await realpath(target);
  if (!inside(canonical, actual) || relative(canonical, actual).split(sep).includes(".git")) throw new ConsoleError("路径超出可访问范围", 403);
  return actual;
}
export async function tree(store: Store, root: string, path: string) {
  const actual = await projectPath(store, root, path);
  const directory = await opendir(actual);
  const entries: { name: string; directory: boolean; link: boolean }[] = [];
  let truncated = false;
  for await (const item of directory) {
    if (ignored.has(item.name)) continue;
    if (entries.length >= 2000) { truncated = true; break; }
    entries.push({ name: item.name, directory: item.isDirectory(), link: item.isSymbolicLink() });
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { entries, truncated };
}
const imageTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon" };
export async function readImage(store: Store, root: string, path: string) {
  const actual = await projectPath(store, root, path);
  const type = imageTypes[extname(actual).toLowerCase()];
  if (!type) throw new ConsoleError("不是图片文件", 415);
  return { url: `data:${type};base64,${(await readFile(actual)).toString("base64")}` };
}
export async function saveImage(store: Store, body: { root: string; path: string; type: string; data: string }) {
  await projectPath(store, body.root, body.path);
  const ext = Object.keys(imageTypes).find(ext => imageTypes[ext] === body.type);
  if (!ext) throw new ConsoleError("不支持的图片格式", 415);
  const assets = basename(body.path, extname(body.path)) + ".assets";
  const directory = resolve(await projectPath(store, body.root, dirname(body.path)), assets);
  await mkdir(directory, { recursive: true });
  const actual = await projectPath(store, body.root, directory);
  const name = `image-${randomUUID()}${ext}`;
  await writeFile(resolve(actual, name), Buffer.from(body.data, "base64"));
  return { source: assets + "/" + name };
}
const versionOf = (content: Buffer) => createHash("sha256").update(content).digest("hex");
export async function readText(store: Store, root: string, path: string, offset = 0) {
  const actual = await projectPath(store, root, path);
  if (!(await stat(actual)).isFile()) throw new ConsoleError("不是普通文件");
  const handle = await open(actual, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new ConsoleError("不是普通文件");
    const partial = info.size > EDIT_LIMIT;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > info.size || (!partial && offset)) throw new ConsoleError("读取位置无效");
    let data = await boundedRead(handle, Math.min(partial ? PAGE_BYTES : EDIT_LIMIT + 1, info.size - offset), offset);
    if (data.includes(0)) throw new ConsoleError("二进制文件不提供文本视图", 415);
    if (partial && offset + data.length < info.size) {
      const newline = data.lastIndexOf(10);
      if (newline >= 0) data = data.subarray(0, newline + 1);
      else {
        // Preserve a UTF-8 boundary for long lines without allocating the whole file.
        for (let trim = 0; trim < 4; trim++) {
          try { new TextDecoder("utf-8", { fatal: true }).decode(data); break; }
          catch { data = data.subarray(0, data.length - 1); }
        }
      }
    }
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); }
    catch { throw new ConsoleError("文件不是 UTF-8 文本", 415); }
    return {
      path, content, version: partial ? null : versionOf(data), partial, size: info.size, offset,
      nextOffset: offset + data.length < info.size ? offset + data.length : null,
    };
  } finally { await handle.close(); }
}
const saving = new Map<string, Promise<unknown>>();
export async function saveText(store: Store, body: { root: string; path: string; version: string; content: string }) {
  if (typeof body.content !== "string" || Buffer.byteLength(body.content) > EDIT_LIMIT) throw new ConsoleError("编辑文件最大 2 MiB", 413);
  const actual = await projectPath(store, body.root, body.path);
  const previous = saving.get(actual) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const handle = await open(actual, "r+");
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > EDIT_LIMIT) throw new ConsoleError("文件不可编辑", 413);
      const before = await boundedRead(handle, info.size + 1, 0);
      if (before.length !== info.size) throw new ConsoleError("磁盘文件已变化；草稿保留，请重新载入", 409);
      if (versionOf(before) !== body.version) throw new ConsoleError("磁盘文件已变化；草稿保留，请重新载入或确认覆盖", 409);
      const content = Buffer.from(body.content);
      // The descriptor keeps a replaced path from redirecting the write to a new symlink.
      let written = 0;
      while (written < content.length) {
        const { bytesWritten } = await handle.write(content, written, content.length - written, written);
        if (!bytesWritten) throw new ConsoleError("文件写入未完成", 500);
        written += bytesWritten;
      }
      await handle.truncate(content.length);
      return { version: versionOf(content) };
    } finally { await handle.close(); }
  });
  saving.set(actual, next);
  try { return await next; } finally { if (saving.get(actual) === next) saving.delete(actual); }
}
