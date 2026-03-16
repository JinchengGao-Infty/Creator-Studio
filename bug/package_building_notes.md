# 安装包构建说明

## 重要说明

### 关于 Windows MSI 安装包

由于您当前是在 macOS 系统上进行开发，无法直接构建 Windows MSI 安装包。要构建 Windows 平台的安装包，需要：

1. 在 Windows 系统上使用 Tauri 的构建工具
2. 或者使用交叉编译工具链（如果 Tauri 支持）
3. 或者使用 CI/CD 管道在不同平台上分别构建

### 关于 macOS DMG 安装包

构建过程仍在进行中，这很正常，因为：
1. 项目包含大型 AI 推理库（ONNX Runtime）
2. 需要编译所有 Rust 依赖
3. 首次构建通常非常耗时

## 平台构建规则

- **macOS**: 只能在 macOS 上构建 `.app` 和 `.dmg` 文件
- **Windows**: 只能在 Windows 上构建 `.exe` 和 `.msi` 文件  
- **Linux**: 可以构建 `.deb`、`.rpm`、`.AppImage` 等格式

## 解决方案

要获得所有平台的安装包，您有以下几种选择：

1. **使用 GitHub Actions 或其他 CI/CD 平台**
   - 配置多平台构建管道
   - 自动为每个平台生成安装包

2. **在原生平台上构建**
   - 在 Windows 上构建 Windows 安装包
   - 在 macOS 上构建 macOS 安装包
   - 在 Linux 上构建 Linux 安装包

3. **使用虚拟机或云服务**
   - 在虚拟机中安装不同操作系统进行构建

## 当前状态

- [x] 项目修复完成
- [x] 依赖问题已解决
- [x] 在 macOS 上启动构建过程
- [ ] 等待 macOS DMG 构建完成
- [ ] macOS DMG 文件将保存到 release 目录
- [ ] Windows MSI 需要在 Windows 系统上单独构建

## 构建完成后的文件位置

构建完成后，macOS 应用包和 DMG 文件将位于：
`/Users/yuhanwen/Desktop/work/01-story/Creator-Studio/src-tauri/target/release/bundle/`

从那里，我们可以复制到您创建的 release 目录中。