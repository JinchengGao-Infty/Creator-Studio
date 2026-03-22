# 安装包与发布说明

## 当前结论

- Windows 安装包必须在 Windows 环境下构建和验证。
- Tauri 原始打包输出目录是：
  - `src-tauri/target/release/bundle/msi/`
  - `src-tauri/target/release/bundle/nsis/`
- 项目根目录的 `release/` 只是二次同步目录，方便直接取包，不是 Tauri 原始输出目录。

## 当前固定规则

- 每次执行 `npm run tauri:build` 后，安装包要自动同步到 `release/`。
- 对外发包时，统一从 `release/` 目录取包。
- Windows 版本号必须递增，不能反复用同一版本覆盖调试安装问题。
- 修复安装版问题时，不能只验证源码目录或 `src-tauri/target/release/creatorai-v2.exe`，必须实际验证安装版。

## 当前构建入口

- `npm run tauri:build`

它会执行：

1. 构建 `ai-engine` sidecar
2. 构建 Tauri 发布版
3. 生成 MSI / NSIS 安装包
4. 将安装包复制到 `release/`

## 当前关键实现

- `scripts/build-ai-engine.mjs`
  - 使用 `esbuild` 将 `ai-engine` 打成单文件 bundle
  - 避免安装版运行时缺少 `node_modules`
- `scripts/copy-release-artifacts.mjs`
  - 将 `src-tauri/target/release/bundle/` 下的安装包同步到 `release/`

## Windows 安装版已知注意事项

- 安装目录不一定是 `C:\Program Files\CreatorAI`
- 当前机器上的 MSI 实际安装路径可能是：
  - `C:\Users\<用户名>\AppData\Local\CreatorAI`
- 安装后要优先检查：
  - `creatorai-v2.exe`
  - `bin/ai-engine.js`
- AI 引擎查找顺序必须优先 `安装目录/bin`

## 本轮修复要点

### 1. AI 引擎安装版路径修复

- 安装版中 `ai-engine.js` 位于 `安装目录/bin/ai-engine.js`
- Tauri 侧查找逻辑已调整为优先搜索 `exe_dir/bin`
- 避免先误命中根目录里的旧 `ai-engine.exe`

### 2. AI 引擎黑窗修复

- Windows 上启动 `node ai-engine.js` 时使用无控制台窗口方式
- 避免每次调用大模型时弹出黑色 shell 窗口

### 3. 重装清理规则

- 正常重启软件不清理聊天界面状态
- 新安装/新版本首次启动时，清理旧版本遗留的本地 UI 状态
- 后端不再直接删除当前版本自己的 WebView 目录，避免安装后闪退

## 安装版验证步骤

每次修复安装包相关问题后，必须至少完成以下验证：

1. `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture`
2. `npm run test:regression`
3. `npm run tauri:build`
4. 用新 MSI 实际安装
5. 启动安装后的 `creatorai-v2.exe`
6. 验证：
   - 应用能正常启动
   - 调用 AI 不报 `AI 引擎启动失败`
   - 不弹黑色 shell 窗口
   - 重装后旧聊天界面状态已清理

## 当前推荐取包路径

- MSI:
  - `release/CreatorAI_<version>_x64_en-US.msi`
- NSIS:
  - `release/CreatorAI_<version>_x64-setup.exe`
