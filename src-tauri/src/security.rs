use std::path::{Component, Path, PathBuf};

fn canonical_project_dir(project_dir: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(project_dir)
        .map_err(|e| format!("Failed to canonicalize project dir: {e}"))
}

fn canonicalize_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut current = path.to_path_buf();
    loop {
        if current.exists() {
            return std::fs::canonicalize(&current)
                .map_err(|e| format!("Failed to canonicalize path: {e}"));
        }
        if !current.pop() {
            return Err("Invalid path".to_string());
        }
    }
}

// 核心函数：路径安全校验
//
// 要求：
// - 禁止 ".." 越界
// - 禁止绝对路径
// - 返回规范化的完整路径
// - 确保最终路径在 project_dir 下
pub fn validate_path(project_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let project_dir = canonical_project_dir(project_dir)?;
    let input = Path::new(relative_path);

    if input.is_absolute() {
        return Err("Absolute paths are not allowed".to_string());
    }

    let mut full_path = project_dir.clone();
    for component in input.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(part) => full_path.push(part),
            Component::ParentDir => {
                return Err("Parent directory (..) is not allowed".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Absolute paths are not allowed".to_string());
            }
        }
    }

    // 防止通过 symlink 越界：验证已存在的最近祖先仍在 project_dir 内
    let existing_ancestor = canonicalize_existing_ancestor(&full_path)?;
    if !existing_ancestor.starts_with(&project_dir) {
        return Err("Path escapes project directory".to_string());
    }

    Ok(full_path)
}

