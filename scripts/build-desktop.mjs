import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("本轮仅构建 macOS 应用");
const nodeVersion = (await readFile(".node-version", "utf8")).trim();
if (process.versions.node !== nodeVersion) throw new Error("桌面包需要 Node " + nodeVersion + "；请在项目目录运行 fnm install && fnm use 后重试");
const e2e = process.argv.includes("--e2e");
const name = e2e ? "Review Console Test" : "Review Console";
const output = resolve(e2e ? "dist-desktop-test" : "dist-desktop"), destination = join(output, name + ".app");
const executable = join(destination, "Contents/MacOS/ReviewConsole"), backend = join(destination, "Contents/Resources/backend/server.mjs");
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
  await cp(process.execPath, join(resources, "node"));
  const license = join(dirname(dirname(process.execPath)), "LICENSE");
  await cp(license, join(resources, "NODE-LICENSE.txt"));
  const go = process.env.GO_BINARY || "go";
  const tags = e2e ? ["-tags", "e2e"] : [];
  execFileSync(go, ["build", ...tags, "-trimpath", "-o", join(contents, "MacOS/ReviewConsole"), "."], { cwd: "desktop", stdio: "inherit" });
  await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>ReviewConsole</string>
<key>CFBundleIdentifier</key><string>local.pi.review-console${e2e ? ".test" : ""}</string>
<key>CFBundleName</key><string>${name}</string>
<key>CFBundleDisplayName</key><string>${name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
`);
  await writeFile(join(resources, "runtime.json"), JSON.stringify({ nodeVersion, arch: process.arch }, null, 2));
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  await rm(destination, { recursive: true, force: true });
  await rename(app, destination);
  console.log(destination);
} finally {
  await rm(staging, { recursive: true, force: true });
}
