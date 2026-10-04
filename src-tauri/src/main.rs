// StoryLoom Lite：Tauri 2 壳。文件对话框与读写全部走
// tauri-plugin-dialog / tauri-plugin-fs，由渲染层的统一 HostApi 适配层调用。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod recovery;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![recovery::list_recovery, recovery::write_recovery, recovery::clear_recovery, recovery::write_project_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
