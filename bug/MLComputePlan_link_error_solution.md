# MLComputePlan 符号链接错误解决方案

## 问题描述
在 macOS 上编译包含 ONNX Runtime 的 Rust 项目时，出现 `MLComputePlan` 符号未找到的链接错误：
```
error: could not compile `creatorai-v2` (lib) due to 1 previous error; 2 warnings emitted
```

## 问题原因
- `MLComputePlan` 类仅在 macOS 13.3+ 版本中可用
- ONNX Runtime (ort) 库需要访问这个类，但在较低版本的 macOS 上不存在
- 编译器试图链接到较低版本的 macOS，导致找不到该符号

## 解决方案
### 1. 添加弱链接
在 [build.rs](file:///Users/yuhanwen/Desktop/work/01-story/Creator-Studio/src-tauri/build.rs) 文件中添加对 MLCompute 框架的弱链接：
```rust
if cfg!(target_os = "macos") {
    // 添加链接器参数以支持 CoreML 的新功能
    println!("cargo:rustc-link-arg=-mmacosx-version-min=13.3");
    
    // 如果是 ARM64 架构，添加额外的链接参数
    if cfg!(target_arch = "aarch64") {
        println!("cargo:rustc-link-arg=-stdlib=libc++");
    }
    
    // 添加弱链接，解决 MLComputePlan 符号问题
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,MLCompute");
}
```

### 2. 添加缺失的依赖项
在 [Cargo.toml](file:///Users/yuhanwen/Desktop/work/01-story/Creator-Studio/src-tauri/Cargo.toml) 中添加项目代码中使用但未声明的依赖：
```toml
regex = "1.10.4"
keyring = "2.3.3"
bincode = "1.3.3"
uuid = { version = "1.0.0", features = ["v4", "serde"] }
```

## 修复效果
- 项目能够在 macOS 上成功编译
- 应用可以正常运行，支持在不同版本的 macOS 上使用
- AI 推理功能正常工作

## 技术原理
使用 `-Wl,-weak_framework,MLCompute` 链接参数允许应用在缺少 MLCompute 框架的旧系统上运行，同时在支持的系统上充分利用该框架提供的功能。