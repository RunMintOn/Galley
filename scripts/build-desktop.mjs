import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("本轮仅构建 macOS 应用");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) throw new Error("桌面构建需要 Node 22.19.0 或更高版本；请在项目目录运行 fnm install && fnm use 后重试");
const e2e = process.argv.includes("--e2e");
const name = e2e ? "Galley Test" : "Galley";
const output = resolve(e2e ? "dist-desktop-test" : "dist-desktop"), destination = join(output, name + ".app");
const executable = join(destination, "Contents/MacOS/Galley"), backend = join(destination, "Contents/Resources/backend/server.mjs");
const commands = execFileSync("ps", ["-axo", "command="], { encoding: "utf8" }).split("\n").map(line => line.trim());
if (commands.some(line => line === executable || line.startsWith(executable + " ") || line.endsWith(" " + backend) || line.includes(" " + backend + " "))) {
  throw new Error("目标应用或它的后台服务仍在运行，未覆盖产物。请先正常退出该应用；日用服务用 npm run stop 停止，然后重试构建。");
}
// Build and sign away from the installed app; failed builds leave the previous release intact.
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, ".build-"));
try {
  execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
  const app = join(staging, name + ".app"), contents = join(app, "Contents"), resources = join(contents, "Resources");
  await mkdir(join(contents, "MacOS"), { recursive: true }); await mkdir(resources, { recursive: true });
  await cp("dist", join(resources, "backend"), { recursive: true });
  const go = process.env.GO_BINARY || "go";
  const tags = e2e ? ["-tags", "e2e"] : [];
  execFileSync(go, ["build", ...tags, "-trimpath", "-o", join(contents, "MacOS/Galley"), "."], { cwd: "desktop", stdio: "inherit" });
  await mkdir(join(resources, "AppIcon.iconset"));
  for (const [size, file] of [[16, "icon_16x16"], [32, "icon_16x16@2x"], [32, "icon_32x32"], [64, "icon_32x32@2x"], [128, "icon_128x128"], [256, "icon_128x128@2x"], [256, "icon_256x256"], [512, "icon_256x256@2x"], [512, "icon_512x512"], [1024, "icon_512x512@2x"]]) {
    execFileSync("sips", ["-z", String(size), String(size), "desktop/AppIcon.png", "--out", join(resources, "AppIcon.iconset", file + ".png")], { stdio: "ignore" });
  }
  execFileSync("iconutil", ["-c", "icns", join(resources, "AppIcon.iconset"), "-o", join(resources, "AppIcon.icns")]);
  await rm(join(resources, "AppIcon.iconset"), { recursive: true, force: true });
  await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Galley</string>
<key>CFBundleIdentifier</key><string>local.pi.galley${e2e ? ".test" : ""}</string>
<key>CFBundleName</key><string>${name}</string>
<key>CFBundleDisplayName</key><string>${name}</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleDocumentTypes</key><array><dict>
<key>CFBundleTypeName</key><string>Markdown document</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>net.daringfireball.markdown</string><string>public.markdown</string></array>
<key>CFBundleTypeExtensions</key><array><string>md</string><string>markdown</string><string>mdx</string></array>
</dict></array>
<key>UTImportedTypeDeclarations</key><array><dict>
<key>UTTypeIdentifier</key><string>net.daringfireball.markdown</string>
<key>UTTypeConformsTo</key><array><string>public.plain-text</string></array>
<key>UTTypeDescription</key><string>Markdown document</string>
<key>UTTypeTagSpecification</key><dict><key>public.filename-extension</key><array><string>md</string><string>markdown</string><string>mdx</string></array><key>public.mime-type</key><string>text/markdown</string></dict>
</dict></array>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  await rm(destination, { recursive: true, force: true });
  await rename(app, destination);
  console.log(destination);
} finally {
  await rm(staging, { recursive: true, force: true });
}
