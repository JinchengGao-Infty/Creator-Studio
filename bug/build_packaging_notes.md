# 构建和打包说明文档

## 构建过程记录

### 构建环境
- 操作系统: macOS
- 项目类型: Tauri 桌面应用程序
- 应用名称: CreatorAI
- 版本号: 0.1.12

### 构建命令
使用 `tauri build` 命令进行构建和打包。

### 构建时间
- 总构建时间: 3分49秒
- 这是一个包含AI推理库的大型Rust项目，因此构建时间相对较长

### 打包产物
成功生成以下文件:
1. macOS 应用程序包: `/Users/yuhanwen/Desktop/work/01-story/Creator-Studio/src-tauri/target/release/bundle/macos/CreatorAI.app`
2. macOS DMG 安装包: `/Users/yuhanwen/Desktop/work/01-story/Creator-Studio/src-tauri/target/release/bundle/dmg/CreatorAI_0.1.12_aarch64.dmg`

该DMG安装包已复制到release目录中。

## 关于Windows MSI包的说明

**重要提示**: 在当前的macOS环境中无法创建Windows MSI安装包。这是因为:

1. 平台限制: Tauri的打包功能是平台特定的，只能为当前操作系统创建安装包
2. Windows MSI包需要在Windows环境下构建
3. macOS无法原生编译或创建Windows特定的安装包格式

如果您需要Windows MSI安装包，您需要:
- 在Windows系统上运行 `tauri build`
- 或者使用交叉编译工具链
- 或者设置CI/CD流水线，在Windows构建代理上生成MSI包

## 项目特点

此项目包含大量AI推理相关的依赖库，包括:
- ONNX Runtime
- Tokenizers (v0.22.2 和 v0.15.2)
- FastEmbed (v5.12.1)
- 各种图像处理和机器学习库

这些库导致了较长的构建时间，但提供了强大的AI功能支持。