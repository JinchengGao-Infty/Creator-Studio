mod config;
mod keyring_store;

use config::{GlobalConfig, ModelParameters, Provider};

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

#[tauri::command]
fn add_provider(provider: Provider, api_key: String) -> Result<(), String> {
    // 保存 API Key 到 Keychain
    keyring_store::store_api_key(&provider.id, &api_key)?;

    // 保存 Provider 到配置
    let mut config = config::load_config()?;

    // 检查是否已存在
    if config.providers.iter().any(|p| p.id == provider.id) {
        return Err(format!("Provider {} already exists", provider.id));
    }

    config.providers.push(provider);
    config::save_config(&config)
}

#[tauri::command]
fn update_provider(provider: Provider, api_key: Option<String>) -> Result<(), String> {
    // 如果提供了新的 API Key，更新 Keychain
    if let Some(key) = api_key {
        keyring_store::store_api_key(&provider.id, &key)?;
    }

    // 更新配置
    let mut config = config::load_config()?;
    if let Some(p) = config.providers.iter_mut().find(|p| p.id == provider.id) {
        *p = provider;
    } else {
        return Err(format!("Provider {} not found", provider.id));
    }
    config::save_config(&config)
}

#[tauri::command]
fn delete_provider(provider_id: String) -> Result<(), String> {
    // 删除 Keychain 中的 API Key
    keyring_store::delete_api_key(&provider_id)?;

    // 从配置中删除
    let mut config = config::load_config()?;
    config.providers.retain(|p| p.id != provider_id);

    // 如果删除的是当前激活的 Provider，清空激活状态
    if config.active_provider_id.as_ref() == Some(&provider_id) {
        config.active_provider_id = None;
    }

    config::save_config(&config)
}

#[tauri::command]
fn set_active_provider(provider_id: String) -> Result<(), String> {
    let mut config = config::load_config()?;

    // 检查 Provider 是否存在
    if !config.providers.iter().any(|p| p.id == provider_id) {
        return Err(format!("Provider {} not found", provider_id));
    }

    config.active_provider_id = Some(provider_id);
    config::save_config(&config)
}

#[tauri::command]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_config,
            save_config,
            list_providers,
            add_provider,
            update_provider,
            delete_provider,
            set_active_provider,
            get_api_key,
            get_default_parameters,
            set_default_parameters,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
