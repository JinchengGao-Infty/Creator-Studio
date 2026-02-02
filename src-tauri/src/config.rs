use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalConfig {
    pub schema_version: u32,
    pub providers: Vec<Provider>,
    pub active_provider_id: Option<String>,
    pub default_parameters: ModelParameters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    // API Key 不存在这里，存在 Keychain
    pub models: Vec<String>,
    pub models_updated_at: Option<u64>,
    pub provider_type: ProviderType,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderType {
    OpenaiCompatible,
    Google,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelParameters {
    pub model: String,
    pub temperature: f32,
    pub top_p: f32,
    pub top_k: Option<u32>,
    pub max_tokens: u32,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            providers: vec![],
            active_provider_id: None,
            default_parameters: ModelParameters::default(),
        }
    }
}

impl Default for ModelParameters {
    fn default() -> Self {
        Self {
            model: String::new(),
            temperature: 0.7,
            top_p: 1.0,
            top_k: None,
            max_tokens: 2000,
        }
    }
}

fn get_config_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("CREATORAI_CONFIG_DIR") {
        let config_dir = PathBuf::from(dir);
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        }
        return Ok(config_dir);
    }

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let config_dir = home.join(".creatorai");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir)
}

fn get_config_path() -> Result<PathBuf, String> {
    Ok(get_config_dir()?.join("config.json"))
}

pub fn load_config() -> Result<GlobalConfig, String> {
    let path = get_config_path()?;
    if !path.exists() {
        return Ok(GlobalConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn save_config(config: &GlobalConfig) -> Result<(), String> {
    let path = get_config_path()?;
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn config_save_load_roundtrip() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp_dir = std::env::temp_dir().join(format!("creatorai-config-test-{unique}"));
        std::env::set_var("CREATORAI_CONFIG_DIR", &tmp_dir);

        let mut config = GlobalConfig::default();
        config.providers.push(Provider {
            id: "test".to_string(),
            name: "Test Provider".to_string(),
            base_url: "http://localhost:3000".to_string(),
            models: vec!["model-1".to_string()],
            models_updated_at: None,
            provider_type: ProviderType::OpenaiCompatible,
            headers: None,
        });

        save_config(&config).expect("save_config should succeed");
        let loaded = load_config().expect("load_config should succeed");
        assert_eq!(loaded.providers.len(), 1);
        assert_eq!(loaded.providers[0].id, "test");

        let _ = fs::remove_dir_all(&tmp_dir);
        std::env::remove_var("CREATORAI_CONFIG_DIR");
    }
}

