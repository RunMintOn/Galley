import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/legacy-modes/mode/python";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { c, cpp, java, csharp, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";

const stream = mode => new LanguageSupport(StreamLanguage.define(mode));
const languages = {
  js: javascript(), jsx: javascript({ jsx: true }),
  ts: javascript({ typescript: true }), tsx: javascript({ typescript: true, jsx: true }),
  md: markdown(), go: go(), html: html(), css: css(), json: json(),
  py: stream(python), sh: stream(shell), yaml: stream(yaml), toml: stream(toml),
  rs: stream(rust), dockerfile: stream(dockerFile), sql: stream(standardSQL),
  c: stream(c), cpp: stream(cpp), java: stream(java), cs: stream(csharp), kt: stream(kotlin),
};
const aliases = {
  mjs: "js", cjs: "js", mts: "ts", cts: "ts", markdown: "md", mdx: "md",
  htm: "html", yml: "yaml", bash: "sh", zsh: "sh",
  h: "c", cc: "cpp", cxx: "cpp", hpp: "cpp", kts: "kt",
};

export function languageFor(path) {
  const name = path.split("/").at(-1).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return languages.dockerfile;
  if ([".bashrc", ".zshrc", ".bash_profile", ".zprofile"].includes(name)) return languages.sh;
  const ext = name.split(".").at(-1);
  return languages[aliases[ext] || ext];
}
