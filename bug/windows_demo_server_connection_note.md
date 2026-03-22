# Windows 演示启动时出现“无法连接服务器”

## 问题现象

- 在 Windows 上直接打开应用后，界面提示无法连接服务器。

## 实际根因

- 启动的是开发态调试产物 [`src-tauri/target/debug/creatorai-v2.exe`](c:\Users\16053\proj\07-story\Creator-Studio\src-tauri\target\debug\creatorai-v2.exe)。
- 该产物会依赖 [`src-tauri/tauri.conf.json`](c:\Users\16053\proj\07-story\Creator-Studio\src-tauri\tauri.conf.json) 中的 `devUrl`，当前值是 `http://localhost:1420`。
- 在没有运行前端开发服务器的情况下，应用会表现为“无法连接服务器”。

## 正确做法

- Windows 演示时应启动安装版或发布版程序，而不是调试产物。
- 本机已安装的正确路径是：
  - `C:\Program Files\CreatorAI\creatorai-v2.exe`

## 测试固化

- 已在 [`test-suite/cases/windows-demo.mjs`](c:\Users\16053\proj\07-story\Creator-Studio\test-suite\cases\windows-demo.mjs) 增加 Windows 演示启动检查项。
- 运行命令：
  - `npm run test:windows-demo`

## 技术注释

- 这个问题属于“启动方式错误”而不是“业务逻辑缺陷”。
- 以后如果再出现类似问题，先判断当前运行的是开发态、调试态还是发布态产物，再判断是否是真正的功能 bug。
