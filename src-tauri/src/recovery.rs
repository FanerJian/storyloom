use serde_json::{json, Value};
use std::{fs, io::Write, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}};
use tauri::Manager;

static TEMP_ID: AtomicU64 = AtomicU64::new(0);

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|p| p.join("recovery")).map_err(|e| e.to_string())
}

fn snapshot_id(snapshot: &Value) -> Result<&str, String> {
    let id = snapshot.get("id").and_then(Value::as_str).unwrap_or("");
    if !valid_id(id) || snapshot.get("version").and_then(Value::as_u64) != Some(1)
        || snapshot.get("savedAt").and_then(Value::as_f64).filter(|n| n.is_finite() && *n > 0.0).is_none()
        || !matches!(snapshot.pointer("/project/version").and_then(Value::as_u64), Some(3) | Some(4))
        || snapshot.pointer("/project/meta/title").and_then(Value::as_str).is_none()
        || !snapshot.pointer("/project/nodes").map(Value::is_array).unwrap_or(false)
        || !snapshot.pointer("/project/edges").map(Value::is_array).unwrap_or(false) {
        return Err("恢复快照格式无效；原文件已保留".into());
    }
    Ok(id)
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("保存路径无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let filename = path.file_name().ok_or("保存路径无效")?.to_string_lossy();
    let temp = parent.join(format!("{}.{}.{}.tmp", filename, std::process::id(), TEMP_ID.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })().map_err(|e: std::io::Error| e.to_string());
    if temp.exists() { let _ = fs::remove_file(&temp); }
    result
}

#[tauri::command]
pub fn write_project_file(path: String, content: String) -> Result<(), String> {
    atomic_write(Path::new(&path), &content)
}

#[tauri::command]
pub fn list_recovery(app: tauri::AppHandle) -> Result<Value, String> {
    let dir = directory(&app)?;
    if !dir.exists() { return Ok(json!({ "snapshots": [] })); }
    let mut snapshots = Vec::new();
    let mut errors = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".json") { continue; }
        let result = fs::read_to_string(entry.path()).map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str::<Value>(&s).map_err(|e| e.to_string()))
            .and_then(|s| {
                if format!("{}.json", snapshot_id(&s)?) != name { return Err("快照名称与内容不匹配".into()); }
                Ok(s)
            });
        match result { Ok(s) => snapshots.push(s), Err(_) => errors.push(name) }
    }
    snapshots.sort_by(|a, b| b["savedAt"].as_f64().unwrap_or(0.0).total_cmp(&a["savedAt"].as_f64().unwrap_or(0.0)));
    let mut result = json!({ "snapshots": snapshots });
    if !errors.is_empty() { result["error"] = json!(format!("{} 个恢复文件无法读取，原文件已保留：{}", errors.len(), errors.join("、"))); }
    Ok(result)
}

#[tauri::command]
pub fn write_recovery(app: tauri::AppHandle, snapshot: Value) -> Result<(), String> {
    let id = snapshot_id(&snapshot)?;
    atomic_write(&directory(&app)?.join(format!("{}.json", id)), &snapshot.to_string())
}

#[tauri::command]
pub fn clear_recovery(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) { return Err("恢复快照 ID 无效".into()); }
    let path = directory(&app)?.join(format!("{}.json", id));
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_preserves_complete_content_and_cleans_temporary_files() {
        let dir = std::env::temp_dir().join(format!("fableloom-atomic-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("project.json");
        atomic_write(&path, "旧工程").unwrap();
        atomic_write(&path, "新工程含素材").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "新工程含素材");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ids_cannot_escape_recovery_directory() {
        for id in ["", "../project", "..\\project", "C:\\data", "x/y"] { assert!(!valid_id(id)); }
        assert!(valid_id("recovery_abc-123"));
    }
}
