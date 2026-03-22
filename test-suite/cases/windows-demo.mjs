import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function assertPath(path, message) {
  if (!existsSync(path)) {
    console.error(`[windows-demo] ${message}: ${path}`);
    process.exit(1);
  }
}

export async function runWindowsDemoSuite({ rootDir }) {
  const root = fileURLToPath(rootDir);
  const debugExe = join(root, "src-tauri", "target", "debug", "creatorai-v2.exe");
  const releaseMsi = join(root, "release", "CreatorAI_0.1.12_x64_en-US.msi");
  const installedExe = join("C:\\Program Files\\CreatorAI", "creatorai-v2.exe");

  console.log("\n[windows-demo] Validate Windows demo launch target");
  assertPath(debugExe, "Debug executable not found");
  assertPath(releaseMsi, "Windows MSI release artifact not found");
  assertPath(installedExe, "Installed Windows demo executable not found");

  accessSync(installedExe, constants.R_OK);

  console.log(`[windows-demo] Debug executable exists: ${debugExe}`);
  console.log(`[windows-demo] Release MSI exists: ${releaseMsi}`);
  console.log(`[windows-demo] Installed demo executable exists: ${installedExe}`);
  console.log("[windows-demo] Rule: do not use src-tauri/target/debug/creatorai-v2.exe for demos; use the installed executable.");
  console.log("\n[windows-demo] Check passed.");
}
