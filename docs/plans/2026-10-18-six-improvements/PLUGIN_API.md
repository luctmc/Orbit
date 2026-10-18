# Orbit application plugin API 1 — EXPERIMENTAL

This is an isolated Orbit API, not binary/source compatibility with Orca or the CLI plugin systems. No third-party plugin is bundled, installed or run by this change. Test fixtures are first-party synthetic programs in isolated test data directories.

Local packages live at `<ORBIT_HOME>/app-plugins/<publisher>.<id>/orbit-plugin.json`. Copying a package is an explicit user operation; the host has no downloader/installer. Every package starts disabled. Ambiente → Plugins do aplicativo shows its identity, permissions and SHA-256 of manifest + entry. Review source before granting the exact hash. Changed code/manifest requires a new grant. Revocation removes the running frame and worker; closing its panel ends its execution. Grants survive restart; source never executes merely because it appears in a list.

Manifest example (a schema example, not installed content):

```json
{"manifestVersion":1,"pluginApi":1,"experimental":true,"publisher":"example","id":"status","name":"Status","version":"1.0.0","entry":"main.js","permissions":["panels","commands","events:pane.status.changed"],"contributes":{"panels":[{"id":"status","title":"Status"}],"commands":[{"id":"refresh","title":"Refresh"}],"events":["pane.status.changed"]}}
```

The single JavaScript entry runs in a Web Worker inside a sandboxed opaque-origin iframe (`allow-scripts`, never `allow-same-origin`). It may call:

```js
orbit.render('status', { title: 'Status', body: 'Waiting', actions: [{command:'refresh',title:'Refresh'}] })
orbit.registerCommand('refresh', () => ({ refreshed: true }))
orbit.onEvent(event => orbit.render('status', { body: JSON.stringify(event) }))
```

Views are text and declared command buttons, not arbitrary HTML. Commands execute only inside the plugin worker. They cannot call Orbit's native commands or mutate missions/files. Events are a closed allowlist of mission/pane status with IDs/status only. No prompts, session contents, paths, accounts, credentials, usage, prices or tokens are sent. CSP denies network, external frames, forms and arbitrary resources. The worker has no Node/DOM/Tauri API. The host grants no filesystem, shell, service, payment or provider capability.

Bounds: 32 local packages, 128 KiB entry, 32 KiB manifest, 8 panels/32 commands/2 event subscriptions; 16 queued runtime messages, 2 s startup/dispatch/heartbeat deadline, 100 worker messages/s; 16,000 characters of panel body and 8,192 characters of result. Timeouts terminate the worker without retrying a command. The browser owns memory/process isolation: this API does not claim a hard per-plugin heap quota, OS sandbox certification, or compatibility with arbitrary third-party code. Browser support failures are displayed and never fall back to Node or the parent UI thread.

Source reference: Orca bbdbe72 `src/shared/plugins/plugin-manifest.ts`, explicitly experimental upstream. Manifest concepts are adapted with MIT attribution; runtime and least-authority protocol are implemented specifically for Orbit.
