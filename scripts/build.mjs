import { build } from "esbuild";
import postcss from "postcss";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";

await mkdir("dist/web", { recursive: true });
for (const [entry, out] of [["src/server.ts","server"],["src/extension.ts","extension"],["src/cli.ts","cli"]]) {
  await build({
    entryPoints:[entry], outfile:`dist/${out}.mjs`, bundle:true, platform:"node", format:"esm",
    target:"node22", packages:"bundle", external:["@earendil-works/pi-coding-agent","bufferutil","utf-8-validate"],
    banner:{js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'},
  });
}
await build({entryPoints:["web-src/app.js"],outfile:"dist/web/app.js",bundle:true,format:"esm",target:"es2022",minify:true,legalComments:"linked"});
const math = await build({entryPoints:["node_modules/katex/dist/katex.min.css"],bundle:true,minify:true,write:false,loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
function scope(css, name) {
  const root=postcss.parse(css);
  root.walkRules(rule=>{
    if(rule.parent.type==="atrule" && /keyframes/.test(rule.parent.name))return;
    rule.selectors=rule.selectors.map(s=>{
      if(s.includes(":root"))return s.replaceAll(":root",name);
      if(/^body\b/.test(s))return s.replace(/^body\b/,name);
      return name+" "+s;
    });
  });
  return root.toString();
}
const styles = math.outputFiles[0].text + "\n" +
  scope(await readFile("web-src/reply.css","utf8"),".reply-pane") + "\n" +
  scope(await readFile("web-src/diff.css","utf8"),".diff-surface") + "\n" +
  await readFile("web-src/style.css","utf8");
await writeFile("dist/web/style.css",styles);
await writeFile("dist/web/index.html",await readFile("web-src/index.html"));
