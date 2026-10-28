import { readFile } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/migration-patch.mjs /path/to/compact-tool/index.ts");
const original = await readFile(source, "utf8");
const replacement = await readFile(new URL("../migration/compact-tool-display-only/index.ts", import.meta.url), "utf8");
process.stdout.write(createTwoFilesPatch("a/index.ts", "b/index.ts", original, replacement));
