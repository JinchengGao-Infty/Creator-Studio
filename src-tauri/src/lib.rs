mod ai_bridge;
mod config;
mod file_ops;
mod keyring_store;
mod security;

use config::{GlobalConfig, ModelParameters, Provider};
use std::time::{SystemTime, UNIX_EPOCH};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ===== Config Commands =====

#[tauri::command]
fn get_config() -> Result<GlobalConfig, String> {
    config::load_config()
}

#[tauri::command]
fn save_config(config: GlobalConfig) -> Result<(), String> {
    config::save_config(&config)
}

// ===== Provider Commands =====

#[tauri::command]
fn list_providers() -> Result<Vec<Provider>, String> {
    let config = config::load_config()?;
    Ok(config.providers)
}

#[tauri::command(rename_all = "camelCase")]
fn get_provider(provider_id: String) -> Result<Provider, String> {
    let config = config::load_config()?;
    let provider = config
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or(format!("Provider {} not found", provider_id))?;

    Ok(provider.clone())
}

#[tauri::command(rename_all = "camelCase")]
fn add_provider(provider: Provider, api_key: String) -> Result<(), String> {
    keyring_store::store_api_key(&provider.id, &api_key)?;

    let mut config = config::load_config()?;
    if config.providers.iter().any(|p| p.id == provider.id) {
        return Err(format!("Provider {} already exists", provider.id));
    }

    config.providers.push(provider);
    config::save_config(&config)
}

#[tauri::command(rename_all = "camelCase")]
fn update_provider(provider: Provider, api_key: Option<String>) -> Result<(), String> {
    if let Some(key) = api_key {
        keyring_store::store_api_key(&provider.id, &key)?;
    }

    let mut config = config::load_config()?;
    if let Some(p) = config.providers.iter_mut().find(|p| p.id == provider.id) {
        *p = provider;
    } else {
        return Err(format!("Provider {} not found", provider.id));
    }

    config::save_config(&config)
}

#[tauri::command(rename_all = "camelCase")]
fn delete_provider(provider_id: String) -> Result<(), String> {
    keyring_store::delete_api_key(&provider_id)?;

    let mut config = config::load_config()?;
    config.providers.retain(|p| p.id != provider_id);

    if config.active_provider_id.as_ref() == Some(&provider_id) {
        config.active_provider_id = None;
    }

    config::save_config(&config)
}

#[tauri::command(rename_all = "camelCase")]
fn set_active_provider(provider_id: String) -> Result<(), String> {
    let mut config = config::load_config()?;

    if !config.providers.iter().any(|p| p.id == provider_id) {
        return Err(format!("Provider {} not found", provider_id));
    }

    config.active_provider_id = Some(provider_id);
    config::save_config(&config)
}

#[tauri::command(rename_all = "camelCase")]
fn get_api_key(provider_id: String) -> Result<Option<String>, String> {
    keyring_store::get_api_key(&provider_id)
}

// ===== Parameters Commands =====

#[tauri::command]
fn get_default_parameters() -> Result<ModelParameters, String> {
    let config = config::load_config()?;
    Ok(config.default_parameters)
}

#[tauri::command]
fn set_default_parameters(parameters: ModelParameters) -> Result<(), String> {
    let mut config = config::load_config()?;
    config.default_parameters = parameters;
    config::save_config(&config)
}

// ===== Models Commands =====

#[tauri::command(rename_all = "camelCase")]
async fn refresh_provider_models(provider_id: String) -> Result<Vec<String>, String> {
    let provider = {
        let config = config::load_config()?;
        config
            .providers
            .iter()
            .find(|p| p.id == provider_id)
            .ok_or(format!("Provider {} not found", provider_id))?
            .clone()
    };

    let api_key = keyring_store::get_api_key(&provider_id)?
        .ok_or(format!("API Key not found for provider {}", provider_id))?;

    let base_url = provider.base_url.clone();
    let api_key_for_task = api_key.clone();
    let models = tauri::async_runtime::spawn_blocking(move || {
        ai_bridge::fetch_models(&base_url, &api_key_for_task)
    })
    .await
    .map_err(|e| format!("refresh_provider_models join error: {e}"))??;

    let mut config = config::load_config()?;
    if let Some(p) = config.providers.iter_mut().find(|p| p.id == provider_id) {
        p.models = models.clone();
        p.models_updated_at = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        );
    }
    config::save_config(&config)?;

    Ok(models)
}

#[tauri::command(rename_all = "camelCase")]
fn get_provider_models(provider_id: String) -> Result<Vec<String>, String> {
    let config = config::load_config()?;
    let provider = config
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or(format!("Provider {} not found", provider_id))?;

    Ok(provider.models.clone())
}

#[tauri::command]
fn file_read(project_dir: String, params: file_ops::ReadParams) -> Result<file_ops::ReadResult, String> {
    file_ops::read::file_read(project_dir, params)
}

#[tauri::command]
fn file_write(project_dir: String, params: file_ops::WriteParams) -> Result<(), String> {
    file_ops::write::file_write(project_dir, params)
}

#[tauri::command]
fn file_append(project_dir: String, params: file_ops::AppendParams) -> Result<(), String> {
    file_ops::append::file_append(project_dir, params)
}

#[tauri::command]
fn file_list(project_dir: String, params: file_ops::ListParams) -> Result<file_ops::ListResult, String> {
    file_ops::list::file_list(project_dir, params)
}

#[tauri::command]
fn file_search(project_dir: String, params: file_ops::SearchParams) -> Result<file_ops::SearchResult, String> {
    file_ops::search::file_search(project_dir, params)
}

#[tauri::command(rename_all = "camelCase")]
async fn ai_chat(
    provider: serde_json::Value,
    parameters: serde_json::Value,
    system_prompt: String,
    messages: Vec<serde_json::Value>,
    project_dir: String,
) -> Result<String, String> {
    let request = ai_bridge::ChatRequest {
        provider,
        parameters,
        system_prompt,
        messages,
        project_dir,
    };

    let response = tauri::async_runtime::spawn_blocking(move || ai_bridge::run_chat(request))
        .await
        .map_err(|e| format!("ai_chat join error: {e}"))??;

    Ok(response.content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_config,
            save_config,
            list_providers,
            get_provider,
            add_provider,
            update_provider,
            delete_provider,
            set_active_provider,
            get_api_key,
            get_default_parameters,
            set_default_parameters,
            refresh_provider_models,
            get_provider_models,
            file_read,
            file_write,
            file_append,
            file_list,
            file_search,
            ai_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod t2_6_integration_tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    const BASE_URL: &str = "http://127.0.0.1:3002/geminicli/v1";
    const API_KEY: &str = "sk-XnbHbzBOmPYGHgL_4Mg8zRcoBIb2gVpJiuO0eSifyyCUV2Twz2c4SljcNCo";
    const MODEL: &str = "gemini-3-flash-preview";

    fn unique_suffix() -> String {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string()
    }

    #[test]
    fn t2_6_provider_switch_and_parameters() {
        let tmp_dir = std::env::temp_dir().join(format!("creatorai-t2_6-{}", unique_suffix()));
        fs::create_dir_all(&tmp_dir).expect("create temp config dir");
        std::env::set_var("CREATORAI_CONFIG_DIR", &tmp_dir);

        let provider_id = format!("gemini-local-{}", unique_suffix());
        let provider = Provider {
            id: provider_id.clone(),
            name: "Gemini Local".to_string(),
            base_url: BASE_URL.to_string(),
            models: vec![],
            models_updated_at: None,
            provider_type: config::ProviderType::OpenaiCompatible,
            headers: None,
        };

        // Step 3: Add provider
        add_provider(provider.clone(), API_KEY.to_string()).expect("add_provider should succeed");

        // Step 3b: Set active provider
        set_active_provider(provider_id.clone()).expect("set_active_provider should succeed");

        // Step 4: Refresh models
        let models = tauri::async_runtime::block_on(refresh_provider_models(provider_id.clone()))
            .expect("refresh_provider_models should succeed");
        println!("\n[models] count={}\n", models.len());
        assert!(models.iter().any(|m| m == MODEL));

        // Step 5: Save default parameters
        let params = ModelParameters {
            model: MODEL.to_string(),
            temperature: 0.7,
            top_p: 1.0,
            top_k: None,
            max_tokens: 2000,
        };
        set_default_parameters(params.clone()).expect("set_default_parameters should succeed");

        let saved = get_config().expect("get_config should succeed");
        assert_eq!(saved.active_provider_id.as_deref(), Some(provider_id.as_str()));
        assert_eq!(saved.default_parameters.model, MODEL);
        assert!((saved.default_parameters.temperature - 0.7).abs() < f32::EPSILON);
        assert_eq!(saved.default_parameters.max_tokens, 2000);

        // Step 7: Verify parameter update takes effect (temperature)
        let params_low_temp = ModelParameters {
            temperature: 0.1,
            ..params
        };
        set_default_parameters(params_low_temp.clone())
            .expect("set_default_parameters (temp=0.1) should succeed");

        let saved_low = get_config().expect("get_config should succeed");
        assert!((saved_low.default_parameters.temperature - 0.1).abs() < f32::EPSILON);

        // Cleanup provider + keyring entry
        delete_provider(provider_id).expect("delete_provider should succeed");

        let _ = fs::remove_dir_all(&tmp_dir);
        std::env::remove_var("CREATORAI_CONFIG_DIR");
    }
}
