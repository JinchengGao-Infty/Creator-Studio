use keyring::Entry;
use sha2::{Digest, Sha256};

const SERVICE_NAME: &str = "creatorai";
const BUILTIN_DEMO_PROVIDER_ID: &str = "builtin_dashscope_qwen_demo";
const LEAKED_BUILTIN_DEMO_API_KEY_SHA256: &str =
    "3a8e03e89c2bfa7d360dea9f57476bac4e922cbcf6a876ae68d662a388331a0e";

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn store_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, provider_id).map_err(|e| e.to_string())?;
    entry.set_password(api_key).map_err(|e| e.to_string())
}

pub fn get_api_key(provider_id: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, provider_id).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key)
            if provider_id == BUILTIN_DEMO_PROVIDER_ID
                && sha256_hex(&key) == LEAKED_BUILTIN_DEMO_API_KEY_SHA256 =>
        {
            let _ = entry.delete_password();
            Ok(None)
        }
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, provider_id).map_err(|e| e.to_string())?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // 不存在也算成功
        Err(e) => Err(e.to_string()),
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
