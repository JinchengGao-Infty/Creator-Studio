import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const releaseDir = path.join(root, "release");

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

// 根据平台确定 bundle 目录
function getBundleDirs() {
  const dirs = [];
  const base = path.join(root, "src-tauri", "target", "release", "bundle");

  if (isWindows) {
    dirs.push(path.join(base, "msi"));
    dirs.push(path.join(base, "nsis"));
  } else if (isMac) {
    dirs.push(path.join(base, "dmg"));
    dirs.push(path.join(base, "app"));
    dirs.push(path.join(base, "appimage"));
  } else if (isLinux) {
    dirs.push(path.join(base, "appimage"));
    dirs.push(path.join(base, "deb"));
    dirs.push(path.join(base, "rpm"));
  }

  return dirs;
}

// 根据平台确定文件扩展名
function getFilePatterns() {
  if (isWindows) return ["CreatorAI_*.msi", "CreatorAI_*.exe"];
  if (isMac) return ["CreatorAI_*.dmg", "CreatorAI_*.app"];
  if (isLinux) return ["CreatorAI_*.appimage", "CreatorAI_*.deb", "CreatorAI_*.rpm"];
  return ["CreatorAI_*"];
}

mkdirSync(releaseDir, { recursive: true });

// 清理旧版本
const patterns = getFilePatterns();
for (const name of readdirSync(releaseDir)) {
  if (patterns.some((p) => new RegExp(p.replace("*", ".*")).test(name))) {
    rmSync(path.join(releaseDir, name), { force: true });
  }
}

// 复制新构建
const bundleDirs = getBundleDirs();
const isReleaseBuild = process.argv.includes("--release");

for (const dir of bundleDirs) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const matches = patterns.some((p) => new RegExp(p.replace("*", ".*")).test(name));
    if (!matches) continue;

    const from = path.join(dir, name);
    const to = path.join(releaseDir, name);
    console.log(`[release-copy] ${from} -> ${to}`);
    copyFileSync(from, to);
  }
}

console.log(`\n[release] 当前平台: ${process.platform}`);
console.log(`[release] 已复制到: ${releaseDir}`);

// 输出支持的平台信息
console.log("\n[release] 支持的平台包:");
console.log("  Windows: *.msi, *.exe (NSIS)");
console.log("  macOS:   *.dmg, *.app");
console.log("  Linux:   *.appimage, *.deb, *.rpm");
console.log("\n[release] 要构建其他平台:");
console.log("  - 在 macOS 上运行: npm run tauri:build");
console.log("  - 在 Linux 上运行: npm run tauri:build");
console.log("  - 指定平台: tauri build --target x86_64-pc-windows-msvc");
