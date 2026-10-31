import { cp, lstat, mkdir, opendir, readlink, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { ignored, inside, projectPath } from "./files.ts";
import { ConsoleError, type Store } from "./store.ts";

const execute = promisify(execFile);
type Item = { root: string; path: string };
type Move = { from: Item; to: Item };
type Request = {
  action: "file" | "folder" | "rename" | "copy" | "move" | "duplicate" | "trash";
  root: string; path?: string; parent?: string; name?: string; targetRoot?: string;
};
type Result = {
  root: string; path: string; directory: boolean; message: string; undo: string;
  move?: Move; removed?: Item;
};
type Undo = { id: string; current: string; original?: string; version: string; result: Result };

// Foundation returns the actual wastebasket URL, including any collision suffix.
const trashScript = `ObjC.import("Foundation");
function run(argv) {
  const result = $(), error = $();
  if (!$.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(argv[0]), result, error))
    throw new Error(ObjC.unwrap(error.localizedDescription));
  return JSON.stringify(ObjC.unwrap(result.path));
}`;
async function trash(path: string) {
  const { stdout } = await execute("/usr/bin/osascript", ["-l", "JavaScript", "-e", trashScript, path]);
  return JSON.parse(stdout) as string;
}
async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function vacant(path: string) {
  if (await exists(path)) throw new ConsoleError(`${basename(path)} already exists. Choose a different name.`, 409);
}
function validName(name = "") {
  if (!name.trim() || name === "." || name === ".." || /[/\\\0]/.test(name) || name === ".git") throw new ConsoleError("Enter a valid file or folder name");
  return name;
}
// Metadata covers descendants too: undoing a copied folder must not discard later edits.
async function version(path: string) {
  const hash = createHash("sha256");
  async function visit(path: string) {
    const info = await lstat(path);
    hash.update(JSON.stringify([path, info.mode, info.size, info.mtimeMs]));
    if (info.isSymbolicLink()) hash.update(await readlink(path));
    if (info.isDirectory()) {
      const entries = [];
      for await (const item of await opendir(path)) entries.push(item.name);
      for (const name of entries.sort()) await visit(join(path, name));
    }
  }
  await visit(path);
  return hash.digest("hex");
}
async function move(from: string, to: string) {
  try { await rename(from, to); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") throw new ConsoleError("Moving between disks is not supported. Copy the item instead.");
    throw error;
  }
}

export function createFileActions(store: Store) {
  let last: Undo | undefined;
  async function entry(root: string, path = "") {
    if (!path || path === "." || path.split("/").includes(".git")) throw new ConsoleError("Choose a file or folder, not the project root");
    return join(await projectPath(store, root, dirname(path)), validName(basename(path)));
  }
  async function target(root: string, parent = "", name: string) {
    return join(await projectPath(store, root, parent), validName(name));
  }
  return {
    async info(root: string, path: string) {
      const base = await projectPath(store, root), absolute = resolve(base, path);
      if (!inside(base, absolute)) throw new ConsoleError("Path escapes the project", 403);
      const present = await exists(absolute);
      return { absolute, exists: present, directory: present && (await lstat(absolute)).isDirectory() };
    },
    async search(root: string) {
      const base = await projectPath(store, root), files: string[] = [];
      async function visit(path: string) {
        for await (const item of await opendir(join(base, path))) {
          if (ignored.has(item.name)) continue;
          const child = path ? path + "/" + item.name : item.name;
          if (item.isDirectory()) await visit(child);
          else files.push(child);
        }
      }
      await visit("");
      return files.sort();
    },
    async system(root: string, path: string, action: string) {
      const actual = await projectPath(store, root, path);
      if (action === "reveal") await execute("/usr/bin/open", ["-R", actual]);
      else if (action === "open") await execute("/usr/bin/open", [actual]);
      else if (action === "terminal") await execute("/usr/bin/open", ["-a", "Terminal", (await lstat(actual)).isDirectory() ? actual : dirname(actual)]);
      else throw new ConsoleError("Unknown system action");
      return {};
    },
    async perform(body: Request): Promise<Result> {
      const action = body.action, root = body.targetRoot || body.root;
      let path: string, actual: string, original: string | undefined, change: Move | undefined, removed: Item | undefined;
      let directory = action === "folder";
      const from = { root: body.root, path: body.path || "" };
      if (action === "file" || action === "folder") {
        path = body.parent ? body.parent + "/" + validName(body.name) : validName(body.name);
        actual = await target(root, body.parent, body.name!);
        await vacant(actual);
        if (action === "folder") await mkdir(actual);
        else await writeFile(actual, "", { flag: "wx" });
      } else {
        const source = await entry(body.root, body.path);
        const info = await lstat(source); directory = info.isDirectory();
        if (action === "trash") {
          original = source; actual = await trash(source); path = body.path!;
          removed = from;
        } else {
          const parent = action === "rename" || action === "duplicate" ? dirname(body.path!) : body.parent || "";
          let name = validName(body.name || basename(body.path!));
          if (action === "duplicate") {
            const ext = directory ? "" : extname(name), stem = name.slice(0, name.length - ext.length);
            let count = 1;
            do { name = `${stem} copy${count === 1 ? "" : " " + count}${ext}`; count++; }
            while (await exists(await target(root, parent, name)));
          }
          path = parent && parent !== "." ? parent + "/" + name : name;
          actual = await target(root, parent, name);
          if (directory && inside(source, actual)) throw new ConsoleError("A folder cannot be copied or moved into itself");
          await vacant(actual);
          if (action === "rename" || action === "move") {
            original = source; await move(source, actual);
            change = { from, to: { root, path } };
          } else if (action === "copy" || action === "duplicate") {
            await cp(source, actual, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
          } else throw new ConsoleError("Unknown file action");
        }
      }
      const labels = { file: "Created", folder: "Created folder", rename: "Renamed", move: "Moved", copy: "Copied", duplicate: "Duplicated", trash: "Moved to Trash" };
      const result: Result = { root, path, directory, message: `${labels[action]} ${basename(path)}`, undo: randomUUID(), move: change, removed };
      last = { id: result.undo, current: actual, original, version: await version(actual), result };
      return result;
    },
    async undo(id: string) {
      if (!last || last.id !== id) throw new ConsoleError("Only the most recent file operation can be undone", 409);
      const operation = last;
      if (!await exists(operation.current) || await version(operation.current) !== operation.version) throw new ConsoleError("The item has changed since this operation. Undo would affect newer changes.", 409);
      if (operation.original) {
        await vacant(operation.original);
        await move(operation.current, operation.original);
      } else await trash(operation.current);
      last = undefined;
      const previous = operation.result;
      return {
        message: "Undone: " + previous.message,
        move: previous.move ? { from: previous.move.to, to: previous.move.from } : undefined,
        removed: !operation.original ? { root: previous.root, path: previous.path } : undefined,
        restored: previous.removed,
      };
    },
  };
}
