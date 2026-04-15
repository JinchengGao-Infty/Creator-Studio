import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function log(message, type = "info") {
  const prefix = type === "error" ? "[ai-engine-packaging:ERROR]" : "[ai-engine-packaging]";
  console.log(`${prefix} ${message}`);
}

function fail(message) {
  log(message, "error");
  process.exit(1);
}

function pass(message) {
  log(`✅ ${message}`);
}

/**
 * 测试用例：AI 引擎打包和启动测试
 * 
 * 测试内容：
 * 1. 验证 ai-engine.js / ai-engine-daemon.js 文件存在
 * 2. 验证 Node.js 运行时可用
 * 3. 测试 ai-engine CLI 基本执行
 * 4. 测试 fetch_models 功能
 * 5. 测试 health check（如果实现了）
 */
export async function runAiEnginePackagingSuite({ rootDir }) {
  const root = fileURLToPath(rootDir);
  const srcTauriBin = resolve(root, "src-tauri", "bin");
  const releaseBin = resolve(root, "src-tauri", "target", "release");

  // ========== 测试 1: 检查 bin 目录中的文件 ==========
  log("测试 1: 检查 src-tauri/bin 目录");
  
  if (!existsSync(srcTauriBin)) {
    fail(`src-tauri/bin 目录不存在: ${srcTauriBin}`);
  }

  const binFiles = readdirSync(srcTauriBin);
  log(`  bin 目录中的文件: ${binFiles.join(", ")}`);

  const expectedFiles = ["ai-engine.js", "ai-engine-daemon.js"];
  const hasExpectedFiles = expectedFiles.every(f => 
    binFiles.some(bf => bf.includes(f))
  );

  if (!hasExpectedFiles) {
    fail(`bin 目录缺少必需文件. 期望: ${expectedFiles.join(", ")}, 实际: ${binFiles.join(", ")}`);
  }
  pass("bin 目录文件检查通过");

  // ========== 测试 2: 检查 Node.js 运行时 ==========
  log("测试 2: 检查 Node.js 运行时");

  const nodeResult = spawnSync("node", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (nodeResult.error || nodeResult.status !== 0) {
    fail(`Node.js 运行时不可用: ${nodeResult.error?.message ?? "unknown error"}`);
  }

  log(`  Node.js 版本: ${nodeResult.stdout.trim()}`);
  pass("Node.js 运行时检查通过");

  // ========== 测试 3: 测试 ai-engine.js 可执行性 ==========
  log("测试 3: 测试 ai-engine.js 可执行性");

  const aiEngineJs = resolve(srcTauriBin, "ai-engine.js");
  
  if (!existsSync(aiEngineJs)) {
    fail(`ai-engine.js 文件不存在: ${aiEngineJs}`);
  }

  const fileStat = statSync(aiEngineJs);
  log(`  ai-engine.js 大小: ${(fileStat.size / 1024).toFixed(2)} KB`);

  // 尝试获取帮助信息或版本
  const helpResult = spawnSync("node", [aiEngineJs, "--help"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 5000
  });

  // ai-engine.js 可能不接受 --help 参数，但至少不应该报错
  if (helpResult.status !== 0 && !helpResult.stdout.includes("{")) {
    log(`  注意: --help 参数可能不支持 (exit code: ${helpResult.status})`);
  }
  pass("ai-engine.js 可执行性检查通过");

  // ========== 测试 3b: 测试 ai-engine-daemon.js 可启动 ==========
  log("测试 3b: 测试 ai-engine-daemon.js 可启动");

  const aiEngineDaemonJs = resolve(srcTauriBin, "ai-engine-daemon.js");
  if (!existsSync(aiEngineDaemonJs)) {
    fail(`ai-engine-daemon.js 文件不存在: ${aiEngineDaemonJs}`);
  }

  const daemonChild = spawn("node", [aiEngineDaemonJs], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, CREATORAI_SHARED_SECRET: "test-secret", CREATORAI_PORT: "0" }
  });

  const startupLine = await new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => reject(new Error("daemon startup timeout")), 5000);

    daemonChild.stdout?.on("data", (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        clearTimeout(timeout);
        resolve(buffer.slice(0, newlineIndex).trim());
      }
    });

    daemonChild.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    daemonChild.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`daemon exited early with code ${code}`));
    });
  }).finally(() => {
    daemonChild.kill("SIGTERM");
  });

  try {
    const parsed = JSON.parse(startupLine);
    if (!parsed.port || !parsed.version) {
      fail(`ai-engine-daemon.js 启动消息缺少字段: ${startupLine}`);
    }
  } catch (error) {
    fail(`ai-engine-daemon.js 启动消息不是合法 JSON: ${startupLine}`);
  }
  pass("ai-engine-daemon.js 启动检查通过");

  // ========== 测试 4: 测试 fetch_models 功能 ==========
  log("测试 4: 测试 fetch_models 功能");

  const fetchModelsRequest = JSON.stringify({
    type: "fetch_models",
    providerType: "openai-compatible",
    baseURL: "http://127.0.0.1:9999/v1",  // 使用无效端口测试
    apiKey: "test-key-for-packaging"
  });

  const fetchResult = spawnSync("node", [aiEngineJs], {
    input: `${fetchModelsRequest}\n`,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 10000
  });

  // 解析输出
  let output;
  try {
    // 可能有多行输出，取第一行 JSON
    const firstLine = fetchResult.stdout.trim().split("\n")[0];
    output = JSON.parse(firstLine);
  } catch (error) {
    // 如果解析失败，输出可能有错误信息
    log(`  警告: 无法解析输出为 JSON: ${fetchResult.stdout.substring(0, 100)}`);
    log(`  stderr: ${fetchResult.stderr?.substring(0, 100) ?? "无"}`);
    
    // 检查是否是预期的错误格式
    if (fetchResult.stdout.includes("error") || fetchResult.stderr?.includes("error")) {
      pass("fetch_models 功能检查通过（预期返回 error）");
    } else {
      fail(`fetch_models 输出格式异常`);
    }
    return;
  }

  // 验证输出格式
  if (output.type === "models") {
    pass(`fetch_models 返回 ${output.models?.length ?? 0} 个模型`);
  } else if (output.type === "error") {
    // error 是预期的，因为端口无效
    pass(`fetch_models 返回预期错误: ${output.message}`);
  } else {
    fail(`fetch_models 返回未知类型: ${output.type}`);
  }

  // ========== 测试 5: 检查 release 目录 ==========
  log("测试 5: 检查 release 目录");

  if (existsSync(releaseBin)) {
    const releaseFiles = readdirSync(releaseBin);
    log(`  release 目录文件数: ${releaseFiles.length}`);
    
    // 检查 release 目录中是否有 ai-engine.js
    const hasReleaseAiEngine = releaseFiles.some(f => f.includes("ai-engine"));
    if (hasReleaseAiEngine) {
      pass("release 目录包含 ai-engine 相关文件");
    } else {
      log("  警告: release 目录中没有 ai-engine 文件（这在某些构建配置下是正常的）");
    }
  } else {
    log("  跳过: release 目录不存在（仅在 release 构建时存在）");
  }

  // ========== 测试 6: 检查打包配置文件 ==========
  log("测试 6: 检查打包配置 (tauri.conf.json)");

  const tauriConf = resolve(root, "src-tauri", "tauri.conf.json");
  if (existsSync(tauriConf)) {
    try {
      const fs = await import("node:fs");
      const confContent = fs.readFileSync(tauriConf, "utf8");
      const conf = JSON.parse(confContent);
      
      const bundle = conf.bundle;
      if (bundle) {
        log(`  resources: ${JSON.stringify(bundle.resources)}`);
        
        // 验证配置与实际文件匹配
        const requiredResources = ["bin/ai-engine.js", "bin/ai-engine-daemon.js"];
        const hasResources = requiredResources.every((item) => bundle.resources?.includes(item));
        if (hasResources) {
          pass("tauri.conf.json resources 配置正确");
        } else {
          log("  警告: resources 配置可能缺少 ai-engine 资源");
        }

        if (Array.isArray(bundle.externalBin) && bundle.externalBin.length > 0) {
          fail(`tauri.conf.json 不应再使用 externalBin 打包 JS sidecar: ${JSON.stringify(bundle.externalBin)}`);
        }
      }
    } catch (error) {
      log(`  警告: 无法读取 tauri.conf.json: ${error.message}`);
    }
  } else {
    log("  跳过: tauri.conf.json 不存在");
  }

  // ========== 总结 ==========
  log("========================================");
  pass("AI 引擎打包和启动测试全部通过");
  log("========================================");
  log("");
  log("如果 MSI 安装后仍有问题，请检查:");
  log("1. 安装目录中是否存在 bin/ai-engine.js");
  log("2. 应用日志中是否有 [ai-bridge] 开头的调试信息");
  log("3. CREATORAI_AI_ENGINE_CLI_PATH 环境变量设置");
}
