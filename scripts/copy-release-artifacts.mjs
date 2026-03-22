import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const releaseDir = path.join(root, "release");
const bundleDirs = [
  path.join(root, "src-tauri", "target", "release", "bundle", "msi"),
  path.join(root, "src-tauri", "target", "release", "bundle", "nsis"),
];

mkdirSync(releaseDir, { recursive: true });

for (const name of readdirSync(releaseDir)) {
  if (/^CreatorAI_.*\.(msi|exe)$/.test(name)) {
    rmSync(path.join(releaseDir, name), { force: true });
  }
}

for (const dir of bundleDirs) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (!/^CreatorAI_.*\.(msi|exe)$/.test(name)) continue;
    const from = path.join(dir, name);
    const to = path.join(releaseDir, name);
    console.log(`[release-copy] ${from} -> ${to}`);
    copyFileSync(from, to);
  }
}
