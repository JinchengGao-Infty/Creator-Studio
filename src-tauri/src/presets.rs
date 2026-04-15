use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::security::validate_path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritingPreset {
    pub id: String,
    pub name: String,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    pub style: WritingStyle,
    pub rules: Vec<String>,
    #[serde(rename = "customPrompt")]
    pub custom_prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritingStyle {
    pub tone: String,
    pub perspective: String,
    pub tense: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetsPayload {
    pub presets: Vec<WritingPreset>,
    pub active_preset_id: String,
}

static PRESETS_FS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn fs_lock() -> &'static Mutex<()> {
    PRESETS_FS_LOCK.get_or_init(|| Mutex::new(()))
}

fn now_unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| format!("Failed to read system time: {e}"))
}

fn ensure_project_exists(project_root: &Path) -> Result<(), String> {
    if project_root.as_os_str().is_empty() {
        return Err("Project path is empty".to_string());
    }
    if !project_root.exists() {
        return Err("Project path does not exist".to_string());
    }
    let meta = fs::symlink_metadata(project_root)
        .map_err(|e| format!("Failed to stat project path: {e}"))?;
    if !meta.file_type().is_dir() {
        return Err("Project path is not a directory".to_string());
    }
    let cfg = validate_path(project_root, ".creatorai/config.json")?;
    if !cfg.exists() {
        return Err("Not a valid project: missing .creatorai/config.json".to_string());
    }
    Ok(())
}

fn config_path(project_root: &Path) -> Result<PathBuf, String> {
    validate_path(project_root, ".creatorai/config.json")
}

fn builtin_presets() -> Vec<WritingPreset> {
    vec![
        WritingPreset {
            id: "default".to_string(),
            name: "默认风格".to_string(),
            is_default: true,
            style: WritingStyle {
                tone: "自然流畅".to_string(),
                perspective: "第三人称有限".to_string(),
                tense: "过去式".to_string(),
                description: "适中".to_string(),
            },
            rules: vec![
                "优先写清当前场景目标，再展开动作和情绪。".to_string(),
                "避免空泛抒情，细节要服务人物和剧情。".to_string(),
                "段落之间保持自然过渡，不要跳剪式断层。".to_string(),
            ],
            custom_prompt: "默认追求稳健、自然、可持续连载的正文写法。".to_string(),
        },
        WritingPreset {
            id: "tight-pacing".to_string(),
            name: "紧凑推进".to_string(),
            is_default: false,
            style: WritingStyle {
                tone: "利落克制".to_string(),
                perspective: "第三人称有限".to_string(),
                tense: "过去式".to_string(),
                description: "偏动作与决策".to_string(),
            },
            rules: vec![
                "每个场景都要有明确推进，不要原地打转。".to_string(),
                "减少空镜和重复心理描写，优先事件、冲突、选择。".to_string(),
                "结尾尽量留下下一步张力。".to_string(),
            ],
            custom_prompt: "适合剧情推进、追逐、谈判、危机处理这类需要节奏的章节。".to_string(),
        },
        WritingPreset {
            id: "lyrical-detail".to_string(),
            name: "细腻抒情".to_string(),
            is_default: false,
            style: WritingStyle {
                tone: "细腻温润".to_string(),
                perspective: "第三人称有限".to_string(),
                tense: "过去式".to_string(),
                description: "感官描写更丰富".to_string(),
            },
            rules: vec![
                "感官细节要具体，但不要堆砌形容词。".to_string(),
                "情绪变化通过动作、停顿和环境映射出来。".to_string(),
                "句子可以稍微舒展，但仍要保持清晰。".to_string(),
            ],
            custom_prompt: "适合情感递进、关系升温、氛围场景和偏文学化段落。".to_string(),
        },
        WritingPreset {
            id: "cold-suspense".to_string(),
            name: "冷峻悬疑".to_string(),
            is_default: false,
            style: WritingStyle {
                tone: "冷静压抑".to_string(),
                perspective: "第三人称有限".to_string(),
                tense: "过去式".to_string(),
                description: "信息控制更严格".to_string(),
            },
            rules: vec![
                "信息要分层释放，不要一次解释完。".to_string(),
                "可留白，但线索必须真实存在。".to_string(),
                "避免角色突然话多，保持克制和压迫感。".to_string(),
            ],
            custom_prompt: "适合悬疑、调查、危险接近、人物互相试探的章节。".to_string(),
        },
        WritingPreset {
            id: "light-comedy".to_string(),
            name: "轻快喜剧".to_string(),
            is_default: false,
            style: WritingStyle {
                tone: "轻松灵动".to_string(),
                perspective: "第三人称有限".to_string(),
                tense: "过去式".to_string(),
                description: "对话驱动更强".to_string(),
            },
            rules: vec![
                "笑点优先来自人物反应和关系，而不是硬插段子。".to_string(),
                "对话要短促，有来回。".to_string(),
                "轻快不等于轻飘，仍要保留剧情推进。".to_string(),
            ],
            custom_prompt: "适合轻喜、日常互动、反差萌和轻松群像场景。".to_string(),
        },
        WritingPreset {
            id: "webnovel-hook".to_string(),
            name: "网文爽感".to_string(),
            is_default: false,
            style: WritingStyle {
                tone: "直接有力".to_string(),
                perspective: "第三人称有限".to_string(),
                tense: "过去式".to_string(),
                description: "强调爽点和钩子".to_string(),
            },
            rules: vec![
                "尽早亮出本章核心看点，不要藏太久。".to_string(),
                "冲突和回报要清楚，让读者感到值回一章。".to_string(),
                "章末尽量留下钩子，吸引继续读。".to_string(),
            ],
            custom_prompt: "适合连载节奏、爽点兑现、反转和章末钩子设计。".to_string(),
        },
    ]
}

fn parse_presets(value: &Value) -> Result<Option<Vec<WritingPreset>>, String> {
    let Some(raw) = value.get("presets") else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    let presets = serde_json::from_value::<Vec<WritingPreset>>(raw.clone())
        .map_err(|e| format!("Invalid presets format: {e}"))?;
    Ok(Some(presets))
}

fn read_config_json(project_root: &Path) -> Result<Value, String> {
    let cfg_path = config_path(project_root)?;
    let bytes = fs::read(&cfg_path).map_err(|e| format!("Failed to read config.json: {e}"))?;
    serde_json::from_slice::<Value>(&bytes)
        .map_err(|e| format!("Failed to parse config.json: {e}"))
}

fn write_config_json(project_root: &Path, json: &Value) -> Result<(), String> {
    let cfg_path = config_path(project_root)?;
    let content =
        serde_json::to_string_pretty(json).map_err(|e| format!("Serialize JSON failed: {e}"))?;
    fs::write(&cfg_path, format!("{content}\n"))
        .map_err(|e| format!("Failed to write config.json: {e}"))?;
    Ok(())
}

fn normalize(presets: Vec<WritingPreset>, active: Option<String>) -> (Vec<WritingPreset>, String) {
    let mut presets = presets;
    if presets.is_empty() {
        presets = builtin_presets();
    }

    // Ensure there is at most one default preset (keep first).
    let mut seen_default = false;
    for preset in presets.iter_mut() {
        if preset.is_default {
            if seen_default {
                preset.is_default = false;
            } else {
                seen_default = true;
            }
        }
    }
    if !presets.iter().any(|p| p.is_default) {
        if let Some(first) = presets.first_mut() {
            first.is_default = true;
        }
    }

    let active = active.and_then(|id| {
        let trimmed = id.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    let resolved_active = match active {
        Some(id) if presets.iter().any(|p| p.id == id) => id,
        _ => presets
            .iter()
            .find(|p| p.is_default)
            .map(|p| p.id.clone())
            .unwrap_or_else(|| presets[0].id.clone()),
    };

    (presets, resolved_active)
}

fn get_presets_sync(project_path: String) -> Result<PresetsPayload, String> {
    let _guard = fs_lock()
        .lock()
        .map_err(|_| "Failed to lock presets storage".to_string())?;

    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let mut config = read_config_json(&project_root)?;

    let parsed = parse_presets(&config)?;
    let active = config
        .get("activePresetId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let (presets, active) = normalize(parsed.clone().unwrap_or_default(), active);

    // Persist defaults / normalization back to config.
    let mut should_write = match parsed.as_ref() {
        None => true,
        Some(existing) => existing != &presets,
    };
    should_write |= config.get("activePresetId").and_then(|v| v.as_str()) != Some(active.as_str());
    if should_write {
        config["presets"] = serde_json::to_value(&presets).unwrap_or(Value::Null);
        config["activePresetId"] = Value::String(active.clone());
        if let Ok(now) = now_unix_seconds() {
            config["updated"] = Value::Number(now.into());
        }
        write_config_json(&project_root, &config)?;
    }

    Ok(PresetsPayload {
        presets,
        active_preset_id: active,
    })
}

fn save_presets_sync(
    project_path: String,
    presets: Vec<WritingPreset>,
    active_preset_id: String,
) -> Result<(), String> {
    let _guard = fs_lock()
        .lock()
        .map_err(|_| "Failed to lock presets storage".to_string())?;

    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let mut config = read_config_json(&project_root)?;

    let (presets, active) = normalize(presets, Some(active_preset_id));

    config["presets"] = serde_json::to_value(&presets).unwrap_or(Value::Null);
    config["activePresetId"] = Value::String(active);
    config["updated"] = Value::Number(now_unix_seconds()?.into());

    write_config_json(&project_root, &config)?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_presets(project_path: String) -> Result<PresetsPayload, String> {
    tauri::async_runtime::spawn_blocking(move || get_presets_sync(project_path))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_presets(
    project_path: String,
    presets: Vec<WritingPreset>,
    active_preset_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_presets_sync(project_path, presets, active_preset_id))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}
