import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  console.error(`[release-copy] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[release-copy] PASS: ${message}`);
}

export async function runReleaseCopySuite({ rootDir }) {
  const cwd = path.resolve(rootDir.pathname);
  const scriptUrl = pathToFileURL(path.join(cwd, "scripts", "copy-release-artifacts.mjs")).href;
  const { copyReleaseArtifacts } = await import(scriptUrl);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "creatorai-release-copy-"));

  try {
    const dmgDir = path.join(tempRoot, "src-tauri", "target", "release", "bundle", "dmg");
    const macosDir = path.join(tempRoot, "src-tauri", "target", "release", "bundle", "macos");
    const oldReleaseApp = path.join(tempRoot, "release", "CreatorAI.app");
    const newBundleApp = path.join(macosDir, "CreatorAI.app");
    const newBundleAppContents = path.join(newBundleApp, "Contents", "Info.txt");
    const oldReleaseAppContents = path.join(oldReleaseApp, "Contents", "Info.txt");
    const dmgPath = path.join(dmgDir, "CreatorAI_9.9.9_aarch64.dmg");

    mkdirSync(path.dirname(oldReleaseAppContents), { recursive: true });
    mkdirSync(path.dirname(newBundleAppContents), { recursive: true });
    mkdirSync(dmgDir, { recursive: true });

    writeFileSync(oldReleaseAppContents, "old-app");
    writeFileSync(newBundleAppContents, "new-app");
    writeFileSync(dmgPath, "new-dmg");

    copyReleaseArtifacts({ root: tempRoot, platform: "darwin" });

    if (!existsSync(path.join(tempRoot, "release", "CreatorAI.app"))) {
      fail("CreatorAI.app was not copied into release directory");
    }
    if (!existsSync(path.join(tempRoot, "release", "CreatorAI_9.9.9_aarch64.dmg"))) {
      fail("DMG was not copied into release directory");
    }

    const copiedAppMarker = readFileSync(
      path.join(tempRoot, "release", "CreatorAI.app", "Contents", "Info.txt"),
      "utf8",
    );
    if (copiedAppMarker !== "new-app") {
      fail(`Expected copied app contents to be replaced with new bundle, got: ${copiedAppMarker}`);
    }

    pass("macOS release copy updates both .app bundle and .dmg");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
