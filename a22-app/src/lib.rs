mod commands;

use std::sync::Mutex;

use a22_core::state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Keep the application database in the platform app-data directory
            // and serialize access through one managed AppState mutex.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let state = AppState::open(dir.join("a22.db")).map_err(|error| error.to_string())?;
            app.manage(Mutex::new(state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_load_all,
            commands::items_create,
            commands::items_update,
            commands::items_delete,
            commands::timers_create,
            commands::timers_update,
            commands::timers_delete,
            commands::item_timer_links_create,
            commands::item_timer_links_update,
            commands::item_timer_links_delete,
            commands::item_timer_link_cycle,
            commands::items_filter,
            commands::timers_statuses,
            commands::export_snapshot,
            commands::import_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
