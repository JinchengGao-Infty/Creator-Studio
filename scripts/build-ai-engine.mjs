import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readHostTargetTriple() {
  const raw = execSync("rustc -vV", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const match = raw.match(/^host:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function resolveTargetTriple() {
  const fromEnv = (process.env.TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? "").trim();
  if (fromEnv) return fromEnv;
  return readHostTargetTriple();
}

function run(command, args, options = {}) {
  const cmd = [command, ...args].join(" ");
  console.log(`[ai-engine] ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...options });
}

const target = resolveTargetTriple();
if (!target) {
  throw new Error("Failed to resolve Rust target triple (TARGET / rustc -vV).");
}

const exeSuffix = target.includes("windows") ? ".exe" : "";
const outPath = path.join("src-tauri", "bin", `ai-engine-${target}${exeSuffix}`);
const cliScriptOutPath = path.join("src-tauri", "bin", "ai-engine.js");
const daemonScriptOutPath = path.join("src-tauri", "bin", "ai-engine-daemon.js");
const localReleaseCliOutPath = path.join("src-tauri", "target", "release", "ai-engine.js");
const localReleaseDaemonOutPath = path.join("src-tauri", "target", "release", "ai-engine-daemon.js");
const aiEngineDir = path.join("packages", "ai-engine");
const builtCliPath = path.join(aiEngineDir, "dist", "cli.js");
const builtDaemonPath = path.join(aiEngineDir, "dist", "server.js");

mkdirSync(path.dirname(outPath), { recursive: true });
mkdirSync(path.join(aiEngineDir, "dist"), { recursive: true });

run("npm", ["install", "--no-package-lock"], { cwd: aiEngineDir });

const esbuildModulePath = pathToFileURL(
  path.resolve(aiEngineDir, "node_modules", "esbuild", "lib", "main.js"),
).href;
const { build } = await import(esbuildModulePath);

async function bundleNodeEntry(entryFile, outFile) {
  console.log(`[ai-engine] bundle ${path.basename(entryFile)} with esbuild`);
  await build({
    entryPoints: [path.resolve(aiEngineDir, "src", entryFile)],
    outfile: path.resolve(outFile),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    packages: "bundle",
  });

  const normalized = readFileSync(outFile, "utf8").replace(/^#!.*\r?\n/, "");
  writeFileSync(outFile, normalized);
}

await bundleNodeEntry("cli.ts", builtCliPath);
await bundleNodeEntry("server.ts", builtDaemonPath);

console.log(`[ai-engine] copy ${builtCliPath} -> ${outPath}`);
copyFileSync(builtCliPath, outPath);
console.log(`[ai-engine] copy ${builtCliPath} -> ${cliScriptOutPath}`);
copyFileSync(builtCliPath, cliScriptOutPath);
console.log(`[ai-engine] copy ${builtDaemonPath} -> ${daemonScriptOutPath}`);
copyFileSync(builtDaemonPath, daemonScriptOutPath);
if (existsSync(path.join("src-tauri", "target", "release"))) {
  console.log(`[ai-engine] copy ${builtCliPath} -> ${localReleaseCliOutPath}`);
  copyFileSync(builtCliPath, localReleaseCliOutPath);
  console.log(`[ai-engine] copy ${builtDaemonPath} -> ${localReleaseDaemonOutPath}`);
  copyFileSync(builtDaemonPath, localReleaseDaemonOutPath);
}
