mod sidecar;

use sidecar::{Connection, Sidecar};
use tauri::{Manager, RunEvent};

/// Where the UI finds the sidecar. Waits until it is listening (or failed to start).
#[tauri::command]
async fn orbit_connection(sidecar: tauri::State<'_, Sidecar>) -> Result<Connection, String> {
    let sidecar = sidecar.inner().clone();
    tauri::async_runtime::spawn_blocking(move || sidecar.wait_ready())
        .await
        .map_err(|e| e.to_string())?
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let sidecar = Sidecar::start(app.handle())?;
            app.manage(sidecar);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![orbit_connection])
        .build(tauri::generate_context!())
        .expect("falha ao montar o Orbit");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(sidecar) = handle.try_state::<Sidecar>() {
                sidecar.stop();
            }
        }
    });
}
