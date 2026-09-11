#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Scrierea acordului semnat pe disc și deschiderea lui. Merg pe toate
      // sistemele, deci nu sunt legate de calculator ca actualizarea.
      app.handle().plugin(tauri_plugin_fs::init())?;
      app.handle().plugin(tauri_plugin_opener::init())?;

      // Verificarea versiunii și repornirea după instalare. Doar pe
      // calculator: pe telefon nu există așa ceva, iar modulele nici nu se
      // compilează acolo.
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
