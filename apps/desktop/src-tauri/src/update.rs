//! App updates. Orbit's releases live in a private GitHub repository, so the sidecar fetches them
//! with the person's own `gh` login and serves them on loopback; the updater plugin checks the
//! signature against the public key in tauri.conf.json before installing anything.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::sidecar::Sidecar;

/// The update found by the last check, kept until it is installed.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn updater(app: &AppHandle, sidecar: &Sidecar) -> Result<tauri_plugin_updater::Updater, String> {
    let connection = sidecar.wait_ready()?;
    let endpoint = Url::parse(&format!("http://127.0.0.1:{}/update/latest.json", connection.port)).map_err(|e| e.to_string())?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .header("x-orbit-token", connection.token)
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())
}

/// Asks for a newer release; None when this is the latest (or there is no release yet).
#[tauri::command]
pub async fn orbit_update_check(app: AppHandle, sidecar: State<'_, Sidecar>, pending: State<'_, Pending>) -> Result<Option<UpdateInfo>, String> {
    let sidecar = sidecar.inner().clone();
    let handle = app.clone();
    let updater = tauri::async_runtime::spawn_blocking(move || updater(&handle, &sidecar)).await.map_err(|e| e.to_string())??;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        current: u.current_version.clone(),
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *pending.0.lock().map_err(|e| e.to_string())? = update;
    Ok(info)
}

/// Downloads, verifies and installs the update found by the last check, then restarts Orbit.
/// Progress goes to the window as `orbit-update-progress`.
#[tauri::command]
pub async fn orbit_update_install(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let update = pending.0.lock().map_err(|e| e.to_string())?.take().ok_or("Verifique as atualizações de novo")?;
    let mut downloaded: u64 = 0;
    let events = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = events.emit("orbit-update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
