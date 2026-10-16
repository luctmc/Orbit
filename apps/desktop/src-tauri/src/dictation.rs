use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct Dictation(pub Mutex<Option<(String, Child)>>);

impl Dictation {
    pub fn stop(&self, kill: bool) {
        if let Ok(mut current) = self.0.lock() {
            if let Some((_, child)) = current.as_mut() {
                if kill {
                    let _ = child.kill();
                } else if let Some(stdin) = child.stdin.as_mut() {
                    let _ = stdin.write_all(b"stop\n");
                    let _ = stdin.flush();
                }
            }
        }
    }
}

#[tauri::command]
pub fn orbit_dictation_stop(state: tauri::State<'_, Dictation>, session: String) {
    if let Ok(mut current) = state.0.lock() {
        if let Some((id, child)) = current.as_mut() {
            if id == &session {
                if let Some(stdin) = child.stdin.as_mut() { let _ = stdin.write_all(b"stop\n"); let _ = stdin.flush(); }
            }
        }
    }
}

#[tauri::command]
pub fn orbit_dictation_start(app: tauri::AppHandle, state: tauri::State<'_, Dictation>, session: String, locale: String) -> Result<(), String> {
    if session.len() > 80 || session.is_empty() || locale.len() > 40 {
        return Err("Sessão de ditado inválida".into());
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = (app, state, session, locale); Err("Ditado nativo disponível apenas no macOS".into()) }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut current = state.0.lock().map_err(|e| e.to_string())?;
        if current.is_some() { return Err("Outro ditado ainda está encerrando. Tente novamente.".into()); }
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("native");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join("orbit-dictation");
        let bytes = include_bytes!(concat!(env!("OUT_DIR"), "/orbit-dictation"));
        // Replace atomically so a prior build cannot leave an old voice helper in the cache.
        let temp = dir.join("orbit-dictation.tmp");
        std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, &path).map_err(|e| e.to_string())?;
        let mut child = Command::new(path).arg(locale).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
        let output = child.stdout.take().ok_or("Ditado sem saída")?;
        *current = Some((session.clone(), child));
        drop(current);
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if let Ok(mut value) = serde_json::from_str::<Value>(&line) {
                    if let Some(obj) = value.as_object_mut() {
                        obj.insert("session".into(), json!(session));
                        let _ = app.emit("orbit-dictation", value);
                    }
                }
            }
            let state = app.state::<Dictation>();
            if let Ok(mut current) = state.0.lock() {
                if current.as_ref().is_some_and(|(id, _)| id == &session) {
                    if let Some((_, mut child)) = current.take() { let _ = child.wait(); }
                }
            };
            let _ = app.emit("orbit-dictation", json!({ "session": session, "ended": true }));
        });
        Ok(())
    }
}
