//! Starts and supervises the Node sidecar (Orbit's core). The shell owns the auth token, learns the
//! port from the sidecar's `ORBIT_READY` line, restarts it if it crashes and stops it on exit.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const READY_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RESTARTS: u32 = 5;

#[derive(Clone, Serialize)]
pub struct Connection {
    pub port: u16,
    pub token: String,
}

#[derive(Default)]
struct State {
    child: Option<Child>,
    port: Option<u16>,
    error: Option<String>,
    stopping: bool,
    restarts: u32,
}

struct Launch {
    node: PathBuf,
    entry: PathBuf,
    hook_script: PathBuf,
    data_dir: Option<PathBuf>,
}

#[derive(Clone)]
pub struct Sidecar {
    token: String,
    launch: Arc<Launch>,
    state: Arc<(Mutex<State>, Condvar)>,
}

impl Sidecar {
    pub fn start(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let launch = Launch {
            node: resolve_node().ok_or("Node.js não encontrado (instale o Node 24.11+ ou defina ORBIT_NODE)")?,
            entry: sidecar_entry(app)?,
            hook_script: hook_script(app)?,
            data_dir: std::env::var_os("ORBIT_HOME").map(PathBuf::from),
        };
        let sidecar = Sidecar {
            token: random_token()?,
            launch: Arc::new(launch),
            state: Arc::new((Mutex::new(State::default()), Condvar::new())),
        };
        sidecar.spawn();
        Ok(sidecar)
    }

    /// Blocks until the sidecar listens, it failed, or the timeout passes.
    pub fn wait_ready(&self) -> Result<Connection, String> {
        let (lock, ready) = &*self.state;
        let deadline = Instant::now() + READY_TIMEOUT;
        let mut state = lock.lock().map_err(|e| e.to_string())?;
        loop {
            if let Some(port) = state.port {
                return Ok(Connection { port, token: self.token.clone() });
            }
            if let Some(error) = &state.error {
                return Err(error.clone());
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("O motor do Orbit não respondeu a tempo".into());
            }
            state = ready.wait_timeout(state, left).map_err(|e| e.to_string())?.0;
        }
    }

    /// SIGTERM so the sidecar can stop its agents cleanly; SIGKILL if it does not exit.
    pub fn stop(&self) {
        let child = {
            let Ok(mut state) = self.state.0.lock() else { return };
            state.stopping = true;
            state.child.take()
        };
        let Some(mut child) = child else { return };
        unsafe {
            libc::kill(child.id() as i32, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    fn spawn(&self) {
        let launch = &self.launch;
        let mut command = Command::new(&launch.node);
        command
            .arg(&launch.entry)
            .env("ORBIT_TOKEN", &self.token)
            .env("ORBIT_PORT", "0")
            .env("ORBIT_ALLOWED_ORIGINS", allowed_origins())
            .env("ORBIT_EXIT_ON_STDIN_CLOSE", "1")
            .env("ORBIT_HOOK_SCRIPT", &launch.hook_script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        if std::env::var_os("SHELL").is_none() {
            command.env("SHELL", "/bin/zsh");
        }
        if let Some(dir) = &launch.data_dir {
            command.env("ORBIT_HOME", dir);
        }

        let (lock, ready) = &*self.state;
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                if let Ok(mut state) = lock.lock() {
                    state.error = Some(format!("Falha ao iniciar o motor: {error}"));
                }
                ready.notify_all();
                return;
            }
        };
        let stdout = child.stdout.take();
        if let Ok(mut state) = lock.lock() {
            state.port = None;
            state.error = None;
            state.child = Some(child);
        }

        let this = self.clone();
        thread::spawn(move || {
            if let Some(stdout) = stdout {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    match line.strip_prefix("ORBIT_READY ").and_then(parse_port) {
                        Some(port) => {
                            let (lock, ready) = &*this.state;
                            if let Ok(mut state) = lock.lock() {
                                state.port = Some(port);
                            }
                            ready.notify_all();
                        }
                        None => eprintln!("[sidecar] {line}"),
                    }
                }
            }
            this.on_exit();
        });
    }

    /// stdout closed: the sidecar is gone. Restart it unless we are quitting or it keeps dying.
    fn on_exit(&self) {
        let (lock, ready) = &*self.state;
        let restart = {
            let Ok(mut state) = lock.lock() else { return };
            if let Some(mut child) = state.child.take() {
                let _ = child.wait();
            }
            state.port = None;
            if state.stopping {
                return;
            }
            state.restarts += 1;
            if state.restarts > MAX_RESTARTS {
                state.error = Some("O motor do Orbit caiu várias vezes; reabra o app".into());
                false
            } else {
                true
            }
        };
        ready.notify_all();
        if restart {
            eprintln!("[orbit] motor caiu; reiniciando");
            thread::sleep(Duration::from_millis(500));
            self.spawn();
        }
    }
}

fn parse_port(json: &str) -> Option<u16> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    u16::try_from(value.get("port")?.as_u64()?).ok()
}

fn allowed_origins() -> String {
    let mut origins = vec!["tauri://localhost", "http://tauri.localhost"];
    if cfg!(debug_assertions) {
        origins.push("http://localhost:5273");
    }
    origins.join(",")
}

/// Dev runs the TypeScript sources from the repo; a release runs the bundled sidecar.
fn sidecar_entry(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/sidecar/src/index.ts"));
    }
    Ok(app.path().resource_dir()?.join("sidecar/dist/index.mjs"))
}

fn hook_script(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/sidecar/hooks/report.mjs"));
    }
    Ok(app.path().resource_dir()?.join("sidecar/hooks/report.mjs"))
}

/// GUI apps on macOS do not inherit the shell's PATH, so ask a login shell where `node` is.
fn resolve_node() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("ORBIT_NODE") {
        return Some(PathBuf::from(path));
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    if let Ok(output) = Command::new(&shell).args(["-lc", "command -v node"]).stdin(Stdio::null()).output() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !path.is_empty() {
            return Some(PathBuf::from(path));
        }
    }
    ["/opt/homebrew/bin/node", "/usr/local/bin/node"].iter().map(PathBuf::from).find(|p| p.exists())
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| format!("sem fonte de aleatoriedade: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
