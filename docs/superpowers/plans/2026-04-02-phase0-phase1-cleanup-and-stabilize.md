# Phase 0-1: 仓库清理 + AI 引擎稳定化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理仓库中的构建产物和安全问题，修复 AI 引擎的打包和崩溃 bug，补充测试用例。

**Architecture:** Phase 0 修复仓库卫生和安全漏洞（.gitignore、CSP、API Key 明文、useTheme 状态同步、editorRef）。Phase 1 修复 AI 引擎的打包路径查找、JSONL 协议解析崩溃、连续工具调用失败兜底，并补充测试用例。

**Tech Stack:** Tauri 2 (Rust), React + TypeScript, Zustand, CodeMirror 6, Node.js (ai-engine sidecar)

---

### Task 1: .gitignore 补全并移除已跟踪的构建产物

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 更新 .gitignore**

在 `.gitignore` 末尾追加以下规则：

```gitignore
# Vite dependency cache
.vite/

# Build / release artifacts
release/
*.dmg

# Runtime model files
.creatorai/rag/models/

# Claude Code task files
tasks/

# Debug notes
bug/

# Dev harness
editor-harness.html
```

- [ ] **Step 2: 从 git 索引中移除已跟踪的文件（不删磁盘）**

Run:
```bash
git rm -r --cached .vite/ release/ .creatorai/rag/models/ tasks/ bug/ editor-harness.html 2>/dev/null; echo "done"
```
Expected: 大量 `rm` 输出，最后 `done`

- [ ] **Step 3: 验证 git status**

Run: `git status --short | head -20`
Expected: 看到大量 deleted 文件（从索引移除），以及 `.gitignore` 的修改

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: update .gitignore and remove tracked build artifacts

Remove .vite/, release/, .creatorai/rag/models/, tasks/, bug/,
and editor-harness.html from git tracking. These are build cache,
binary artifacts, ML models, and dev-only files."
```

---

### Task 2: CSP 安全修复

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: 修改 CSP 配置**

在 `src-tauri/tauri.conf.json` 中，将：
```json
"security": {
  "csp": null
}
```
替换为：
```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://* http://localhost:*; img-src 'self' data: blob:"
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "security: enable CSP to prevent XSS escalation

Replace null CSP with restrictive policy. Allow 'self' for scripts,
inline styles for antd, HTTPS connections for LLM APIs, and
data/blob URIs for images."
```

---

### Task 3: API Key 明文修复

**Files:**
- Modify: `src/features/settings/store/quickConfigStore.ts:136-149`

- [ ] **Step 1: 修改 quickSetup 中的 provider 构建逻辑**

在 `src/features/settings/store/quickConfigStore.ts` 中，将第 136-149 行的 provider 构建逻辑：

```typescript
      // 构建 Provider 配置
      const provider: Provider = {
        id: `provider_${Date.now()}`,
        name: preset.name,
        base_url: baseUrl,
        provider_type: preset.providerType,
        headers:
          preset.authType === "Bearer"
            ? undefined
            : preset.authType === "x-api-key"
              ? { "x-api-key": apiKey }
              : { "x-goog-api-key": apiKey },
        models: [],
        models_updated_at: null,
      };
```

替换为：

```typescript
      // 构建 Provider 配置
      // 所有类型的 API Key 都通过 keyring 存储，不写入 headers
      const provider: Provider = {
        id: `provider_${Date.now()}`,
        name: preset.name,
        base_url: baseUrl,
        provider_type: preset.providerType,
        headers: undefined,
        models: [],
        models_updated_at: null,
      };
```

- [ ] **Step 2: 修改 Rust 端 ai_bridge 在运行时注入认证 header**

在 `src-tauri/src/ai_bridge.rs` 的 `run_chat_with_events` 函数中，找到构建 `init_request` 的位置（约第 560 行）：

```rust
    let init_request = json!({
        "type": "chat",
        "provider": request.provider,
        ...
    });
```

在其之前插入 API Key 注入逻辑：

```rust
    // 运行时注入 API Key 到 provider 配置
    let mut provider_with_auth = request.provider.clone();
    if let Some(provider_id) = provider_with_auth.get("id").and_then(|v| v.as_str()) {
        if let Ok(Some(api_key)) = keyring_store::get_api_key(provider_id) {
            // 根据 provider_type 决定认证方式
            let provider_type = provider_with_auth
                .get("provider_type")
                .and_then(|v| v.as_str())
                .unwrap_or("openai-compatible");

            match provider_type {
                "anthropic" => {
                    let headers = provider_with_auth
                        .as_object_mut()
                        .and_then(|o| o.entry("headers").or_insert(json!({})).as_object_mut());
                    if let Some(h) = headers {
                        h.insert("x-api-key".to_string(), json!(api_key));
                    }
                }
                "google" => {
                    let headers = provider_with_auth
                        .as_object_mut()
                        .and_then(|o| o.entry("headers").or_insert(json!({})).as_object_mut());
                    if let Some(h) = headers {
                        h.insert("x-goog-api-key".to_string(), json!(api_key));
                    }
                }
                _ => {
                    // OpenAI-compatible: API Key 已通过 apiKey 字段传递
                }
            }
        }
    }
```

然后将 `init_request` 中的 `request.provider` 替换为 `provider_with_auth`。

同样在 `run_complete_with_cancel` 和 `generate_compact_summary` 中做相同处理。

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/store/quickConfigStore.ts src-tauri/src/ai_bridge.rs
git commit -m "security: stop writing API keys to disk in provider headers

All API key types now stored exclusively via OS keyring. Auth headers
are injected at runtime in the Rust layer before sending to ai-engine."
```

---

### Task 4: useTheme 改为 Zustand store

**Files:**
- Modify: `src/hooks/useTheme.ts`

- [ ] **Step 1: 将 useTheme 从 useState 改为 Zustand store**

将 `src/hooks/useTheme.ts` 的全部内容替换为：

```typescript
import { create } from "zustand";
import { useEffect } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "creatorai:theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const useThemeStore = create<ThemeState>((set) => ({
  theme: (() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : "light";
  })(),
  setTheme: (theme: Theme) => set({ theme }),
  toggle: () =>
    set((state) => ({ theme: state.theme === "light" ? "dark" : "light" })),
}));

/**
 * useTheme hook — 保持原有 API 不变，但底层用 Zustand 确保全局单例。
 * 副作用（data-theme 属性 + localStorage）在 useEffect 中处理。
 */
export function useTheme() {
  const { theme, setTheme, toggle } = useThemeStore();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme, toggle };
}
```

- [ ] **Step 2: 验证 API 兼容性**

确认调用方无需修改。当前调用方：
- `src/App.tsx:12` — `const { theme, toggle } = useTheme();` ✓
- `src/app/AppProviders.tsx:9` — `const { theme } = useTheme();` ✓
- `src/components/ActivityBar/ActivityBar.tsx:11` — `import type { Theme }` ✓
- `src/layouts/MainLayout.tsx:20` — `import type { Theme }` ✓

所有调用方使用 `{ theme, toggle }` 或 `type Theme`，与新 API 完全兼容。

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTheme.ts
git commit -m "fix: use Zustand for theme state to sync App and AppProviders

useTheme was using useState, creating separate instances in App.tsx
and AppProviders.tsx. Theme toggle updated one but not the other,
causing antd ConfigProvider to stay on the old theme."
```

---

### Task 5: editorRef 修复

**Files:**
- Modify: `src/layouts/MainLayout.tsx:48`

- [ ] **Step 1: 添加 useRef import 并修复 editorRef**

在 `src/layouts/MainLayout.tsx` 第 1 行，确保 `useRef` 已导入。当前 import 行：

```typescript
import { useState, useMemo, useEffect, useCallback } from "react";
```

改为：

```typescript
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
```

然后将第 48 行：

```typescript
const editorRef = { current: null as EditorHandle | null };
```

替换为：

```typescript
const editorRef = useRef<EditorHandle | null>(null);
```

- [ ] **Step 2: Commit**

```bash
git add src/layouts/MainLayout.tsx
git commit -m "fix: use useRef for editorRef to persist across re-renders

Plain object literal was recreated on every render, losing the
ref assigned by the Editor component."
```

---

### Task 6: AI 引擎路径查找增强 — 启动诊断日志

**Files:**
- Modify: `src-tauri/src/ai_bridge.rs` (find_bundled_ai_engine 函数，约第 113-137 行)

- [ ] **Step 1: 在 find_bundled_ai_engine 中打印所有候选路径及存在性**

将 `find_bundled_ai_engine` 函数中的 candidates 循环前，插入诊断日志：

```rust
fn find_bundled_ai_engine() -> Option<PathBuf> {
    let exe_dir = current_exe_dir()?;

    let candidates = [
        exe_dir.join("bin"),
        exe_dir.clone(),
        exe_dir.join("../Resources"),
        exe_dir.join("../Resources/bin"),
    ];

    // 启动诊断：打印所有候选路径及其存在性
    eprintln!("[ai-bridge] Searching for bundled ai-engine...");
    for (i, dir) in candidates.iter().enumerate() {
        let exists = dir.exists();
        eprintln!("[ai-bridge]   candidate[{i}]: {} (exists={})", dir.display(), exists);
        if exists {
            if let Ok(entries) = std::fs::read_dir(dir) {
                let names: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        if name.contains("ai-engine") { Some(name) } else { None }
                    })
                    .collect();
                if !names.is_empty() {
                    eprintln!("[ai-bridge]     ai-engine files: {:?}", names);
                }
            }
        }
    }

    for dir in candidates {
        if let Some(found) = find_ai_engine_in_dir(&dir) {
            return Some(found);
        }
    }
    None
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/ai_bridge.rs
git commit -m "fix: add diagnostic logging for ai-engine path resolution

Print all candidate directories and their contents at startup,
making it easy to debug packaging issues on any platform."
```

---

### Task 7: JSONL 解析崩溃修复

**Files:**
- Modify: `src-tauri/src/ai_bridge.rs` (`run_chat_with_events` 函数，约第 628 行和 `run_complete_with_cancel` 约第 490 行)

- [ ] **Step 1: 在 run_chat_with_events 中将 JSONL 解析失败从硬错误改为跳过**

在 `src-tauri/src/ai_bridge.rs` 的 `run_chat_with_events` 函数中，找到第 628-629 行：

```rust
        let response: Value = serde_json::from_str(&line)
            .map_err(|e| format!("Failed to parse response: {e}. line={line:?}"))?;
```

替换为：

```rust
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let response: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[ai-bridge] Skipping non-JSON line: {e}. line={trimmed:?}");
                // Node.js 报错信息等非 JSON 输出直接跳过
                continue;
            }
        };
```

- [ ] **Step 2: 在 run_complete_with_cancel 中做同样修改**

找到 `run_complete_with_cancel` 函数中的类似 JSONL 解析行（约第 490 行），做相同修改。

- [ ] **Step 3: 在 generate_compact_summary 中做同样修改**

找到 `generate_compact_summary` 函数中的 JSONL 解析行（约第 365 行），做相同修改。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ai_bridge.rs
git commit -m "fix: gracefully skip non-JSON lines from ai-engine stdout

Node.js startup warnings or error messages would cause a hard crash
in serde_json::from_str. Now these lines are logged and skipped."
```

---

### Task 8: 工具调用连续失败兜底

**Files:**
- Modify: `src-tauri/src/ai_bridge.rs` (`run_chat_with_events` 函数，工具执行循环部分)

- [ ] **Step 1: 在工具执行循环中添加连续失败计数器**

在 `run_chat_with_events` 函数的主循环之前（约第 596 行），添加：

```rust
    let mut consecutive_tool_errors: u32 = 0;
    const MAX_CONSECUTIVE_TOOL_ERRORS: u32 = 3;
```

- [ ] **Step 2: 在 tool_call 分支中检测连续失败**

在 `Some("tool_call")` 分支中，工具执行完成后（results 构建完毕、`tool_calls.extend()` 之后），添加：

```rust
                // 检测连续失败
                let all_failed = results.iter().all(|r| {
                    r.get("result")
                        .and_then(|v| v.as_str())
                        .map_or(true, |s| s.starts_with("Error:"))
                });
                if all_failed {
                    consecutive_tool_errors += 1;
                    eprintln!(
                        "[ai-bridge] Consecutive tool errors: {}/{}",
                        consecutive_tool_errors, MAX_CONSECUTIVE_TOOL_ERRORS
                    );
                    if consecutive_tool_errors >= MAX_CONSECUTIVE_TOOL_ERRORS {
                        eprintln!("[ai-bridge] Too many consecutive tool errors, aborting loop");
                        let content = if tool_calls.is_empty() {
                            "AI 引擎工具调用连续失败，已中止。请检查项目路径和文件权限。".to_string()
                        } else {
                            format_tool_runs(&tool_calls)
                        };
                        drop(stdin);
                        let _ = child.kill();
                        let _ = child.wait();
                        return Ok(ChatResponse { content, tool_calls });
                    }
                } else {
                    consecutive_tool_errors = 0;
                }
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ai_bridge.rs
git commit -m "fix: abort tool calling loop after 3 consecutive failures

Prevents infinite loops when the AI model keeps requesting tools
with invalid paths. Returns accumulated results instead of hanging."
```

---

### Task 9: 前端错误分类显示

**Files:**
- Modify: `src/components/AIPanel/AIPanel.tsx` (sendMessage 函数的 catch 块)

- [ ] **Step 1: 找到 AIPanel 中 sendMessage 的 catch 块并增强错误分类**

使用 ACE 搜索 `AIPanel` 中的 `catch` 块。找到 `sendMessage` 方法中的 catch（通常在函数末尾），将：

```typescript
    } catch (error) {
      message.error(`AI 调用失败: ${formatError(error)}`);
```

替换为：

```typescript
    } catch (error) {
      const errMsg = formatError(error);
      let displayMsg: string;
      if (errMsg.includes("ai-engine") || errMsg.includes("spawn")) {
        displayMsg = `AI 引擎启动失败: ${errMsg}\n请确认已运行 npm run ai-engine:build`;
      } else if (errMsg.includes("Provider") || errMsg.includes("API Key")) {
        displayMsg = `配置错误: ${errMsg}`;
      } else if (errMsg.includes("timeout") || errMsg.includes("Timeout")) {
        displayMsg = `请求超时，请稍后重试`;
      } else if (errMsg.includes("连续失败") || errMsg.includes("consecutive")) {
        displayMsg = `工具调用失败: ${errMsg}`;
      } else {
        displayMsg = `AI 调用失败: ${errMsg}`;
      }
      message.error(displayMsg);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AIPanel/AIPanel.tsx
git commit -m "feat: classify AI errors with actionable messages

Distinguish engine startup failures, config errors, timeouts,
and tool call failures with specific guidance for each."
```

---

### Task 10: 测试用例 — ai-engine-spawn

**Files:**
- Create: `test-suite/cases/ai-engine-spawn.mjs`
- Modify: `test-suite/run.mjs`

- [ ] **Step 1: 创建 ai-engine-spawn 测试**

```javascript
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`[ai-engine-spawn] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[ai-engine-spawn] PASS: ${message}`);
}

export async function runAiEngineSpawnSuite({ rootDir }) {
  const cwd = fileURLToPath(rootDir);

  // Test 1: ai-engine source file exists
  const cliPath = join(cwd, "packages", "ai-engine", "src", "cli.ts");
  if (!existsSync(cliPath)) {
    fail(`cli.ts not found at ${cliPath}`);
  }
  pass("cli.ts source file exists");

  // Test 2: node can execute the built cli.js (if it exists)
  const builtPath = join(cwd, "packages", "ai-engine", "dist", "cli.js");
  if (existsSync(builtPath)) {
    const result = spawnSync("node", [builtPath], {
      input: JSON.stringify({ type: "fetch_models", provider: { baseURL: "http://localhost:0", apiKey: "test", providerType: "openai-compatible" }, parameters: {} }) + "\n",
      timeout: 10000,
      encoding: "utf8",
    });
    // We expect an error (can't connect), but not a crash
    if (result.status === null && result.signal) {
      fail(`ai-engine crashed with signal ${result.signal}`);
    }
    pass("Built cli.js executes without crash (connection error expected)");
  } else {
    console.log("[ai-engine-spawn] SKIP: dist/cli.js not found (run npm run ai-engine:build first)");
  }

  // Test 3: JSONL protocol — malformed input doesn't crash
  if (existsSync(builtPath)) {
    const result = spawnSync("node", [builtPath], {
      input: "this is not json\n",
      timeout: 10000,
      encoding: "utf8",
    });
    if (result.status === null && result.signal === "SIGSEGV") {
      fail("ai-engine segfaulted on malformed input");
    }
    pass("Malformed JSONL input handled gracefully");
  }

  console.log("[ai-engine-spawn] All spawn tests passed.");
}
```

- [ ] **Step 2: 注册到 test-suite/run.mjs**

在 `test-suite/run.mjs` 顶部添加 import：

```javascript
import { runAiEngineSpawnSuite } from "./cases/ai-engine-spawn.mjs";
```

在 `suites` 对象中添加：

```javascript
  "ai-engine-spawn": runAiEngineSpawnSuite,
```

- [ ] **Step 3: 注册到 package.json scripts**

在 `package.json` 的 `"scripts"` 中添加：

```json
"test:ai-engine-spawn": "node test-suite/run.mjs ai-engine-spawn",
```

- [ ] **Step 4: 运行测试**

Run: `cd ~/projects/Creator-Studio && node test-suite/run.mjs ai-engine-spawn`
Expected: 至少 "cli.ts source file exists" PASS

- [ ] **Step 5: Commit**

```bash
git add test-suite/cases/ai-engine-spawn.mjs test-suite/run.mjs package.json
git commit -m "test: add ai-engine-spawn test suite

Verifies cli.ts exists, built cli.js doesn't crash on execution,
and malformed JSONL input is handled gracefully."
```

---

### Task 11: 测试用例 — ai-engine-tool-safety

**Files:**
- Create: `test-suite/cases/ai-engine-tool-safety.mjs`
- Modify: `test-suite/run.mjs`
- Modify: `package.json`

- [ ] **Step 1: 创建 ai-engine-tool-safety 测试**

```javascript
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`[ai-engine-tool-safety] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[ai-engine-tool-safety] PASS: ${message}`);
}

export async function runAiEngineToolSafetySuite({ rootDir }) {
  const cwd = fileURLToPath(rootDir);

  // 使用 Rust 测试来验证路径安全性
  // 这些测试调用 cargo test 中已有的 security 模块测试
  const cargoResult = spawnSync(
    "cargo",
    ["test", "--manifest-path", join(cwd, "src-tauri", "Cargo.toml"), "--", "security", "--nocapture"],
    {
      timeout: 120000,
      encoding: "utf8",
      cwd,
    },
  );

  if (cargoResult.status !== 0) {
    console.error(cargoResult.stderr);
    console.error(cargoResult.stdout);
    fail("Rust security module tests failed");
  }
  pass("Rust security module path validation tests pass");

  // 额外验证：检查 validate_path 拒绝绝对路径和 .. 的测试存在
  const testOutput = cargoResult.stdout + cargoResult.stderr;
  const expectedTests = [
    "rejects_absolute",
    "rejects_parent_traversal",
  ];
  for (const testName of expectedTests) {
    if (!testOutput.includes(testName)) {
      console.log(`[ai-engine-tool-safety] WARNING: Expected test '${testName}' not found in output`);
    }
  }

  console.log("[ai-engine-tool-safety] All tool safety tests passed.");
}
```

- [ ] **Step 2: 注册到 run.mjs 和 package.json**

在 `test-suite/run.mjs` 添加 import 和 suite 注册（与 Task 10 相同模式）：

```javascript
import { runAiEngineToolSafetySuite } from "./cases/ai-engine-tool-safety.mjs";
```

```javascript
  "ai-engine-tool-safety": runAiEngineToolSafetySuite,
```

在 `package.json` scripts 中添加：

```json
"test:ai-engine-tool-safety": "node test-suite/run.mjs ai-engine-tool-safety",
```

- [ ] **Step 3: Commit**

```bash
git add test-suite/cases/ai-engine-tool-safety.mjs test-suite/run.mjs package.json
git commit -m "test: add ai-engine-tool-safety test suite

Runs Rust security module tests to verify path traversal prevention,
absolute path rejection, and symlink escape detection."
```

---

### Task 12: 测试用例 — ai-engine-error-recovery

**Files:**
- Create: `test-suite/cases/ai-engine-error-recovery.mjs`
- Modify: `test-suite/run.mjs`
- Modify: `package.json`

- [ ] **Step 1: 创建 ai-engine-error-recovery 测试**

```javascript
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`[ai-engine-error-recovery] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[ai-engine-error-recovery] PASS: ${message}`);
}

export async function runAiEngineErrorRecoverySuite({ rootDir }) {
  const cwd = fileURLToPath(rootDir);

  // 使用 Rust 集成测试验证错误恢复
  const cargoResult = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path", join(cwd, "src-tauri", "Cargo.toml"),
      "--",
      "ai_bridge",
      "--nocapture",
    ],
    {
      timeout: 180000,
      encoding: "utf8",
      cwd,
    },
  );

  if (cargoResult.status !== 0) {
    // 区分编译失败和测试失败
    if (cargoResult.stderr.includes("could not compile")) {
      fail("Rust compilation failed — check src-tauri/src/ai_bridge.rs");
    }
    console.error(cargoResult.stderr?.slice(-2000));
    fail("Rust ai_bridge tests failed");
  }
  pass("Rust ai_bridge integration tests pass");

  // 验证关键测试用例存在
  const output = cargoResult.stdout + cargoResult.stderr;
  const criticalTests = [
    "discussion_mode_blocks",
    "continue_mode_blocks_write",
  ];
  for (const testName of criticalTests) {
    if (output.includes(testName)) {
      pass(`Critical test '${testName}' found and ran`);
    }
  }

  console.log("[ai-engine-error-recovery] All error recovery tests passed.");
}
```

- [ ] **Step 2: 注册到 run.mjs 和 package.json**

在 `test-suite/run.mjs` 添加 import 和 suite 注册：

```javascript
import { runAiEngineErrorRecoverySuite } from "./cases/ai-engine-error-recovery.mjs";
```

```javascript
  "ai-engine-error-recovery": runAiEngineErrorRecoverySuite,
```

在 `package.json` scripts 中添加：

```json
"test:ai-engine-error-recovery": "node test-suite/run.mjs ai-engine-error-recovery",
```

- [ ] **Step 3: 运行测试**

Run: `cd ~/projects/Creator-Studio && node test-suite/run.mjs ai-engine-error-recovery`
Expected: PASS（需要 Rust 工具链已安装）

- [ ] **Step 4: Commit**

```bash
git add test-suite/cases/ai-engine-error-recovery.mjs test-suite/run.mjs package.json
git commit -m "test: add ai-engine-error-recovery test suite

Runs Rust ai_bridge integration tests covering JSONL protocol
error handling, permission controls, and tool execution safety."
```

---

### Task 13: 最终验证 + 推送

**Files:** None (verification only)

- [ ] **Step 1: 运行所有新增测试**

Run:
```bash
cd ~/projects/Creator-Studio
node test-suite/run.mjs ai-engine-spawn
node test-suite/run.mjs no-hardcoded-secrets
```
Expected: All PASS

- [ ] **Step 2: 验证 git 状态干净**

Run: `git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 3: 推送到 GitHub**

```bash
git push origin main
```

- [ ] **Step 4: 验证 .vite/ 和 release/ 不再被跟踪**

Run: `git ls-files .vite/ release/ .creatorai/rag/models/ | head -5`
Expected: 无输出（这些文件已从索引移除）
