import { build } from "esbuild";
import postcss from "postcss";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

await mkdir("dist/web", { recursive: true });
const fingerprint = createHash("sha256");
for (const directory of ["src", "web-src"]) for (const name of (await readdir(directory)).sort()) fingerprint.update(await readFile(directory + "/" + name));
const buildID = fingerprint.digest("hex").slice(0, 16);
const bundledPackages = new Set();
function collect(result) {
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = [...input.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)].at(-1);
    if (match) bundledPackages.add(input.slice(0, match.index + match[0].length));
  }
}
for (const [entry, out] of [["src/server.ts","server"],["src/extension.ts","extension"],["src/cli.ts","cli"]]) {
  collect(await build({
    entryPoints:[entry], outfile:`dist/${out}.mjs`, bundle:true, platform:"node", format:"esm",
    target:"node22", packages:"bundle", external:["@earendil-works/pi-coding-agent","bufferutil","utf-8-validate"],
    banner:{js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'},
    define:{__REVIEW_BUILD__:JSON.stringify(buildID)},
    metafile:true,
  }));
}
for (const name of ["app", "scratch"]) collect(await build({entryPoints:[`web-src/${name}.js`],outfile:`dist/web/${name}.js`,bundle:true,format:"esm",target:"es2022",minify:true,legalComments:"linked",metafile:true}));
const math = await build({entryPoints:["node_modules/katex/dist/katex.min.css"],bundle:true,minify:true,write:false,loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
function scope(css, name) {
  const root=postcss.parse(css);
  root.walkRules(rule=>{
    if(rule.parent.type==="atrule" && /keyframes/.test(rule.parent.name))return;
    rule.selectors=rule.selectors.map(s=>{
      if(s.includes(":root.dark"))return s.replaceAll(":root.dark","html.dark "+name+":not([data-paper=ivory])");
      if(s.includes(":root"))return s.replaceAll(":root",name);
      if(/^body\b/.test(s))return s.replace(/^body\b/,name);
      return name+" "+s;
    });
  });
  if (name === ".diff-surface") root.walkAtRules("media", rule => {
    if (!rule.params.includes("prefers-color-scheme: light")) return;
    rule.walkRules(child => { child.selectors = child.selectors.map(s => "html:not(.dark) " + s); });
    rule.replaceWith(...rule.nodes);
  });
  return root.toString();
}
const styles = math.outputFiles[0].text + "\n" +
  scope(await readFile("web-src/reply.css","utf8"),".reply-pane") + "\n" +
  scope(await readFile("web-src/diff.css","utf8"),".diff-surface") + "\n" +
  await readFile("web-src/style.css","utf8");
await writeFile("dist/web/style.css",styles);
await writeFile("dist/web/index.html",await readFile("web-src/index.html"));
await writeFile("dist/web/bootstrap.js",await readFile("web-src/bootstrap.js"));
await writeFile("dist/web/scratch.html",await readFile("web-src/scratch.html"));
await writeFile("dist/web/scratch.css",await readFile("web-src/scratch.css"));
const notices = ["pi-compact-tool\n"+await readFile("third-party/compact-tool-LICENSE.txt","utf8")];
for (const directory of [...bundledPackages].sort()) {
  const files = await readdir(directory);
  const license = files.find(n=>/^licen[cs]e(?:[.-]|$)/i.test(n));
  const metadata = JSON.parse(await readFile(directory+"/package.json","utf8"));
  const body = license ? await readFile(directory+"/"+license,"utf8")
    : JSON.stringify(metadata,null,2)+"\n"+(files.includes("README.md") ? await readFile(directory+"/README.md","utf8") : "");
  notices.push(metadata.name+"\n"+body);
}
await writeFile("dist/THIRD-PARTY-NOTICES.txt",notices.join("\n\n"));
