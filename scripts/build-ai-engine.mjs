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
const scriptOutPath = path.join("src-tauri", "bin", "ai-engine.js");
const localReleaseScriptOutPath = path.join("src-tauri", "target", "release", "ai-engine.js");
const aiEngineDir = path.join("packages", "ai-engine");
const builtCliPath = path.join(aiEngineDir, "dist", "cli.js");

mkdirSync(path.dirname(outPath), { recursive: true });
mkdirSync(path.join(aiEngineDir, "dist"), { recursive: true });

run("npm", ["install", "--no-package-lock"], { cwd: aiEngineDir });

const esbuildModulePath = pathToFileURL(
  path.resolve(aiEngineDir, "node_modules", "esbuild", "lib", "main.js"),
).href;
const { build } = await import(esbuildModulePath);

console.log("[ai-engine] bundle cli with esbuild");
await build({
  entryPoints: [path.resolve(aiEngineDir, "src", "cli.ts")],
  outfile: path.resolve(builtCliPath),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  packages: "bundle",
});

const normalizedCli = readFileSync(builtCliPath, "utf8").replace(/^#!.*\r?\n/, "");
writeFileSync(builtCliPath, normalizedCli);

console.log(`[ai-engine] copy ${builtCliPath} -> ${outPath}`);
copyFileSync(builtCliPath, outPath);
console.log(`[ai-engine] copy ${builtCliPath} -> ${scriptOutPath}`);
copyFileSync(builtCliPath, scriptOutPath);
if (existsSync(path.join("src-tauri", "target", "release"))) {
  console.log(`[ai-engine] copy ${builtCliPath} -> ${localReleaseScriptOutPath}`);
  copyFileSync(builtCliPath, localReleaseScriptOutPath);
}
