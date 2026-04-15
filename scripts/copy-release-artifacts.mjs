import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

export function getBundleDirs(root, platform = process.platform) {
  const dirs = [];

  if (platform === "win32") {
    const base = path.join(root, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "bundle");
    dirs.push(path.join(base, "msi"));
    dirs.push(path.join(base, "nsis"));
    return dirs;
  }

  const base = path.join(root, "src-tauri", "target", "release", "bundle");
  if (platform === "darwin") {
    dirs.push(path.join(base, "dmg"));
    dirs.push(path.join(base, "macos"));
    return dirs;
  }

  if (platform === "linux") {
    dirs.push(path.join(base, "appimage"));
    dirs.push(path.join(base, "deb"));
    dirs.push(path.join(base, "rpm"));
    return dirs;
  }

  return dirs;
}

export function getFilePatterns(platform = process.platform) {
  if (platform === "win32") return ["CreatorAI_*.msi", "CreatorAI_*.exe"];
  if (platform === "darwin") return ["CreatorAI_*.dmg", "CreatorAI.app"];
  if (platform === "linux") return ["CreatorAI_*.appimage", "CreatorAI_*.deb", "CreatorAI_*.rpm"];
  return ["CreatorAI_*"];
}

export function copyReleaseArtifacts({
  root = process.cwd(),
  platform = process.platform,
} = {}) {
  const releaseDir = path.join(root, "release");
  const patterns = getFilePatterns(platform);
  const matchers = patterns.map(globToRegExp);
  const bundleDirs = getBundleDirs(root, platform);

  mkdirSync(releaseDir, { recursive: true });

  for (const name of readdirSync(releaseDir)) {
    if (matchers.some((matcher) => matcher.test(name))) {
      rmSync(path.join(releaseDir, name), { force: true, recursive: true });
    }
  }

  for (const dir of bundleDirs) {
    if (!existsSync(dir)) continue;

    for (const name of readdirSync(dir)) {
      if (!matchers.some((matcher) => matcher.test(name))) continue;

      const from = path.join(dir, name);
      const to = path.join(releaseDir, name);
      console.log(`[release-copy] ${from} -> ${to}`);

      rmSync(to, { force: true, recursive: true });
      if (name.endsWith(".app")) {
        cpSync(from, to, { recursive: true });
      } else {
        copyFileSync(from, to);
      }
    }
  }

  console.log(`\n[release] 当前平台: ${platform}`);
  console.log(`[release] 已复制到: ${releaseDir}`);
}

const entryPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entryPath) {
  copyReleaseArtifacts();
}
