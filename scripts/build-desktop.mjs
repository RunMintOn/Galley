import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("本轮仅构建 macOS 应用");
const nodeVersion = "22.23.2";
if (process.versions.node !== nodeVersion) throw new Error("桌面包固定使用 Node " + nodeVersion + "；请用该版本运行构建");
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
const app = resolve("dist-desktop/Review Console.app"), contents = join(app, "Contents"), resources = join(contents, "Resources");
await mkdir(join(contents, "MacOS"), { recursive: true }); await mkdir(resources, { recursive: true });
await cp("dist", join(resources, "backend"), { recursive: true });
await cp(process.execPath, join(resources, "node"));
const license = join(dirname(dirname(process.execPath)), "LICENSE");
await cp(license, join(resources, "NODE-LICENSE.txt"));
const go = process.env.GO_BINARY || "go";
const tags = process.argv.includes("--e2e") ? ["-tags", "e2e"] : [];
execFileSync(go, ["build", ...tags, "-trimpath", "-o", join(contents, "MacOS/ReviewConsole"), "."], { cwd: "desktop", stdio: "inherit" });
await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>ReviewConsole</string>
<key>CFBundleIdentifier</key><string>local.pi.review-console</string>
<key>CFBundleName</key><string>Review Console</string>
<key>CFBundleDisplayName</key><string>Review Console</string>
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
console.log(app);
