use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const LEGACY_GLM_DEMO_PROVIDER_ID: &str = "builtin_glm_4_7_demo";
const BUILTIN_DEMO_PROVIDER_ID: &str = "builtin_dashscope_qwen_demo";
const BUILTIN_DEMO_PROVIDER_NAME: &str = "DashScope Qwen Demo";
const BUILTIN_DEMO_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const BUILTIN_DEMO_MODEL: &str = "qwen-plus";

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
        let mut config = Self {
            schema_version: 1,
            providers: vec![],
            active_provider_id: None,
            default_parameters: ModelParameters::default(),
        };
        ensure_builtin_demo_provider(&mut config, false);
        config
    }
}

impl Default for ModelParameters {
    fn default() -> Self {
        Self {
            model: BUILTIN_DEMO_MODEL.to_string(),
            temperature: 0.7,
            top_p: 1.0,
            top_k: None,
            max_tokens: 2000,
        }
    }
}

fn builtin_demo_provider() -> Provider {
    Provider {
        id: BUILTIN_DEMO_PROVIDER_ID.to_string(),
        name: BUILTIN_DEMO_PROVIDER_NAME.to_string(),
        base_url: BUILTIN_DEMO_BASE_URL.to_string(),
        models: vec![BUILTIN_DEMO_MODEL.to_string()],
        models_updated_at: None,
        provider_type: ProviderType::OpenaiCompatible,
        headers: None,
    }
}

fn normalize_builtin_demo_provider(provider: &mut Provider) -> bool {
    let canonical = builtin_demo_provider();
    let mut changed = false;

    if provider.name != canonical.name {
        provider.name = canonical.name;
        changed = true;
    }
    if provider.base_url != canonical.base_url {
        provider.base_url = canonical.base_url;
        changed = true;
    }
    if provider.models != canonical.models {
        provider.models = canonical.models;
        changed = true;
    }
    if provider.models_updated_at.is_some() {
        provider.models_updated_at = None;
        changed = true;
    }
    if !matches!(provider.provider_type, ProviderType::OpenaiCompatible) {
        provider.provider_type = ProviderType::OpenaiCompatible;
        changed = true;
    }
    if provider.headers.is_some() {
        provider.headers = None;
        changed = true;
    }

    changed
}

fn is_legacy_glm_provider(provider: &Provider) -> bool {
    provider.id == LEGACY_GLM_DEMO_PROVIDER_ID
        || provider
            .base_url
            .contains("open.bigmodel.cn/api/paas/v4")
        || provider.name.trim().eq_ignore_ascii_case("glm-4.7")
}

fn ensure_builtin_demo_provider(config: &mut GlobalConfig, cleanup_keyring: bool) -> bool {
    let mut changed = false;

    let legacy_active_provider_id = config.active_provider_id.clone().filter(|id| {
        config
            .providers
            .iter()
            .any(|provider| provider.id == *id && is_legacy_glm_provider(provider))
    });

    let before_len = config.providers.len();
    config
        .providers
        .retain(|provider| !is_legacy_glm_provider(provider));
    if config.providers.len() != before_len {
        changed = true;
    }

    if let Some(provider) = config
        .providers
        .iter_mut()
        .find(|provider| provider.id == BUILTIN_DEMO_PROVIDER_ID)
    {
        if normalize_builtin_demo_provider(provider) {
            changed = true;
        }
    } else {
        config.providers.insert(0, builtin_demo_provider());
        changed = true;
    }

    if config.active_provider_id.is_none()
        || config.active_provider_id.as_deref() == Some(LEGACY_GLM_DEMO_PROVIDER_ID)
        || legacy_active_provider_id.is_some()
    {
        config.active_provider_id = Some(BUILTIN_DEMO_PROVIDER_ID.to_string());
        changed = true;
    }

    if config.default_parameters.model.trim().is_empty()
        || config.default_parameters.model.trim() == "glm-4.7"
    {
        config.default_parameters.model = BUILTIN_DEMO_MODEL.to_string();
        changed = true;
    }

    if cleanup_keyring {
        let _ = crate::keyring_store::delete_api_key(LEGACY_GLM_DEMO_PROVIDER_ID);
        let _ = crate::keyring_store::purge_leaked_builtin_demo_key();
    }

    changed
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

pub fn get_global_config_dir() -> Result<PathBuf, String> {
    get_config_dir()
}

pub fn load_config() -> Result<GlobalConfig, String> {
    let path = get_config_path()?;
    let (mut config, loaded_from_disk) = if !path.exists() {
        (GlobalConfig::default(), false)
    } else {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let content = content.trim_start_matches('\u{feff}').to_string();
        (
            serde_json::from_str(&content).map_err(|e| e.to_string())?,
            true,
        )
    };
    let changed = ensure_builtin_demo_provider(&mut config, true);
    if loaded_from_disk && changed {
        save_config(&config)?;
    }
    Ok(config)
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
        assert!(loaded.providers.iter().any(|provider| provider.id == "test"));
        assert!(loaded
            .providers
            .iter()
            .any(|provider| provider.id == BUILTIN_DEMO_PROVIDER_ID));

        let _ = fs::remove_dir_all(&tmp_dir);
        std::env::remove_var("CREATORAI_CONFIG_DIR");
    }

    #[test]
    fn default_config_contains_builtin_dashscope_demo_provider() {
        let config = GlobalConfig::default();
        assert_eq!(
            config.active_provider_id.as_deref(),
            Some(BUILTIN_DEMO_PROVIDER_ID)
        );
        assert_eq!(config.default_parameters.model, BUILTIN_DEMO_MODEL);
        assert!(config
            .providers
            .iter()
            .any(|provider| provider.id == BUILTIN_DEMO_PROVIDER_ID
                && provider.base_url == BUILTIN_DEMO_BASE_URL
                && provider.models == vec![BUILTIN_DEMO_MODEL.to_string()]));
    }

    #[test]
    fn legacy_glm_provider_is_replaced_by_builtin_dashscope_demo() {
        let mut config = GlobalConfig {
            schema_version: 1,
            providers: vec![Provider {
                id: "provider_legacy".to_string(),
                name: "glm-4.7".to_string(),
                base_url: "https://open.bigmodel.cn/api/paas/v4/chat/completions".to_string(),
                models: vec![],
                models_updated_at: None,
                provider_type: ProviderType::Anthropic,
                headers: None,
            }],
            active_provider_id: Some("provider_legacy".to_string()),
            default_parameters: ModelParameters {
                model: "glm-4.7".to_string(),
                temperature: 0.7,
                top_p: 1.0,
                top_k: None,
                max_tokens: 2000,
            },
        };

        let changed = ensure_builtin_demo_provider(&mut config, false);
        assert!(changed);
        assert_eq!(config.providers.len(), 1);
        assert_eq!(config.providers[0].id, BUILTIN_DEMO_PROVIDER_ID);
        assert_eq!(
            config.active_provider_id.as_deref(),
            Some(BUILTIN_DEMO_PROVIDER_ID)
        );
        assert_eq!(config.default_parameters.model, BUILTIN_DEMO_MODEL);
    }

    #[test]
    fn malformed_builtin_provider_is_normalized() {
        let mut config = GlobalConfig {
            schema_version: 1,
            providers: vec![Provider {
                id: BUILTIN_DEMO_PROVIDER_ID.to_string(),
                name: "Old Demo".to_string(),
                base_url: "https://example.com/wrong".to_string(),
                models: vec![],
                models_updated_at: Some(123),
                provider_type: ProviderType::Google,
                headers: Some(HashMap::from([(
                    "x-test".to_string(),
                    "1".to_string(),
                )])),
            }],
            active_provider_id: Some(BUILTIN_DEMO_PROVIDER_ID.to_string()),
            default_parameters: ModelParameters::default(),
        };

        let changed = ensure_builtin_demo_provider(&mut config, false);
        assert!(changed);
        assert_eq!(config.providers.len(), 1);
        assert_eq!(config.providers[0].name, BUILTIN_DEMO_PROVIDER_NAME);
        assert_eq!(config.providers[0].base_url, BUILTIN_DEMO_BASE_URL);
        assert_eq!(config.providers[0].models, vec![BUILTIN_DEMO_MODEL.to_string()]);
        assert!(config.providers[0].models_updated_at.is_none());
        assert!(matches!(
            config.providers[0].provider_type,
            ProviderType::OpenaiCompatible
        ));
        assert!(config.providers[0].headers.is_none());
    }
}

