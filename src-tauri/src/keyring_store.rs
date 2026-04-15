use keyring::Entry;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const SERVICE_NAME: &str = "creatorai";
const BUILTIN_DEMO_PROVIDER_ID: &str = "builtin_dashscope_qwen_demo";
const LEAKED_BUILTIN_DEMO_API_KEY_SHA256: &str =
    "3a8e03e89c2bfa7d360dea9f57476bac4e922cbcf6a876ae68d662a388331a0e";
const LOCAL_API_KEYS_FILE: &str = "api_keys.local.json";

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn local_api_keys_path() -> Result<PathBuf, String> {
    Ok(crate::config::get_global_config_dir()?.join(LOCAL_API_KEYS_FILE))
}

fn read_local_api_keys() -> Result<HashMap<String, String>, String> {
    let path = local_api_keys_path()?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_local_api_keys(keys: &HashMap<String, String>) -> Result<(), String> {
    let path = local_api_keys_path()?;
    let content = serde_json::to_string_pretty(keys).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn store_local_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    let mut keys = read_local_api_keys()?;
    keys.insert(provider_id.to_string(), api_key.to_string());
    write_local_api_keys(&keys)
}

fn get_local_api_key(provider_id: &str) -> Result<Option<String>, String> {
    let keys = read_local_api_keys()?;
    Ok(keys.get(provider_id).cloned())
}

fn delete_local_api_key(provider_id: &str) -> Result<(), String> {
    let mut keys = read_local_api_keys()?;
    if keys.remove(provider_id).is_some() {
        write_local_api_keys(&keys)?;
    }
    Ok(())
}

pub fn store_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    let local_result = store_local_api_key(provider_id, api_key);
    let keychain_result = Entry::new(SERVICE_NAME, provider_id)
        .map_err(|e| e.to_string())
        .and_then(|entry| entry.set_password(api_key).map_err(|e| e.to_string()));

    match (local_result, keychain_result) {
        (Ok(()), _) => Ok(()),
        (Err(_), Ok(())) => Ok(()),
        (Err(local_err), Err(keychain_err)) => Err(format!(
            "Failed to store API key locally ({local_err}) and in keychain ({keychain_err})"
        )),
    }
}

pub fn get_api_key(provider_id: &str) -> Result<Option<String>, String> {
    if let Some(key) = get_local_api_key(provider_id)? {
        return Ok(Some(key));
    }

    let entry = Entry::new(SERVICE_NAME, provider_id).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key)
            if provider_id == BUILTIN_DEMO_PROVIDER_ID
                && sha256_hex(&key) == LEAKED_BUILTIN_DEMO_API_KEY_SHA256 =>
        {
            let _ = entry.delete_password();
            Ok(None)
        }
        Ok(key) => {
            let _ = store_local_api_key(provider_id, &key);
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
    let local_result = delete_local_api_key(provider_id);
    let keychain_result = Entry::new(SERVICE_NAME, provider_id)
        .map_err(|e| e.to_string())
        .and_then(|entry| match entry.delete_password() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        });

    match (local_result, keychain_result) {
        (Ok(()), _) => Ok(()),
        (Err(_), Ok(())) => Ok(()),
        (Err(local_err), Err(keychain_err)) => Err(format!(
            "Failed to delete API key locally ({local_err}) and from keychain ({keychain_err})"
        )),
    }
}

pub fn purge_leaked_builtin_demo_key() -> Result<bool, String> {
    let entry = Entry::new(SERVICE_NAME, BUILTIN_DEMO_PROVIDER_ID).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) if sha256_hex(&key) == LEAKED_BUILTIN_DEMO_API_KEY_SHA256 => {
            entry.delete_password().map_err(|e| e.to_string())?;
            Ok(true)
        }
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
