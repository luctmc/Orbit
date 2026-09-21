# Tool Runtime

Orbit owns its own tool runtime. External agents never touch the operating system
directly — they propose tool calls, which Orbit validates, classifies, adjudicates, and
executes on their behalf (see [permissions.md](./permissions.md)).

## Tool definition

```ts
interface ToolDefinition<I, O> {
  name: string;                       // 'filesystem.move'
  summary: string;                    // one line — also what Jev and MCP clients see
  inputSchema: JSONSchema;            // validated before ANY execution
  outputSchema: JSONSchema;
  riskClass: (input: I) => RiskClass; // deterministic, argument-aware — never a constant
  reversible: (input: I) => UndoPlan | null;
  platforms: ('macos' | 'windows')[];
  requires?: Permission[];            // e.g. 'macos.accessibility', 'macos.screen-recording'
  exposeToAgents: boolean;            // not every Orbit tool is offered over MCP
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}

interface ToolContext {
  signal: AbortSignal;                // cancellation
  progress(p: Progress): void;
  timeoutMs: number;
  taskId: string; traceId: string;
}
```

Namespaces: `applications.* · filesystem.* · processes.* · system.* · clipboard.* ·
window.* · display.* · audio.* · network.* · search.* · git.* · browser.* · shell.* ·
notifications.*`

## Rules

- **Input is validated against the JSON Schema before the Permission Engine ever sees the
  call.** A malformed call is rejected, never adjudicated.
- **`riskClass` is a function of the arguments, not a constant.**
  `filesystem.delete{path:'~/tmp/x'}` and `filesystem.delete{path:'~'}` must resolve to
  different classes.
- **Errors are typed**, never bare strings: `PermissionDenied`, `NotSupportedOnPlatform`,
  `CapabilityUnavailable`, `Timeout`, `Cancelled`, `PreconditionFailed`. An agent reads these
  and should be able to change approach based on which one it got.
- **`shell.execute` is not a general escape hatch.** Allowlist-driven, argv-array only
  (never a shell string), no shell interpolation, and DESTRUCTIVE-or-higher risk unless the
  binary is on a vetted read-only list.
- **Capability probing over assumption.** macOS brightness, window move/resize, and window
  titles all resolve to *available / unavailable* at runtime. Unavailable tools are removed
  from the registry entirely — so neither Jev nor an agent is ever told a tool exists that
  cannot actually run on this machine.

## Platform capability tiers (macOS)

Some macOS capabilities are not binary available/unavailable — they degrade in tiers, and
the Tool Runtime models this explicitly rather than failing at call time:

| Tier | Permission | What's available |
| --- | --- | --- |
| 0 | none | list apps and windows with geometry, activate/hide apps |
| 1 | + Screen Recording | window **titles** (`kCGWindowName` is empty without it) |
| 2 | + Accessibility | move / resize / raise **individual windows** — the only path; there is no other |

Accessibility cannot be granted programmatically (the prompt only offers to open System
Settings); Screen Recording re-prompts monthly on macOS 15+, and on Tahoe 26.1+ non-bundled
executables don't even appear in its permission UI — reinforcing why Orbit ships as a
signed `.app`.

## The hard cases, and why they're modeled as best-effort

| Capability | Reality | Orbit's posture |
| --- | --- | --- |
| macOS brightness | No supported public API exists. `IODisplaySetFloatParameter` returns success and does nothing on Apple Silicon. Only the **private** `DisplayServices.framework` actually works. | Tier-2, feature-flagged, probed at runtime. Declared unavailable rather than silently failing. Mac App Store distribution is incompatible with this; see [ADR-0012](../adr/0012-developer-id-distribution.md). |
| macOS window move/resize | AX API is the only path — there is no public alternative. | Gated behind the Accessibility permission tier above. |
| Windows `SetForegroundWindow` | Fails silently under the foreground lock. | Try `AllowSetForegroundWindow`, then `SwitchToThisWindow`/`AttachThreadInput`; ALT-key synthesis is the explicit, logged last resort — the one place raw input synthesis is justified. |
| Windows elevated windows | UIPI blocks all manipulation of elevated windows from a medium-integrity process. | Report "that window is running as administrator" as a first-class typed error rather than running Orbit elevated. |

## Platform adapter pattern

```
OrbitTool → PlatformAdapter → { macOS impl | Windows impl }
```

The agent-facing tool surface never differs by platform; `applications.open("Spotify")`
means the same thing everywhere. Preference order, from the brief and upheld throughout
research: **native API > official CLI/API > accessibility API > UI automation > raw
mouse/keyboard automation.** The only two documented exceptions to "avoid input
synthesis" are macOS window focus edge cases and the Windows foreground-lock workaround
above — both logged explicitly when used.

## Privileged operations

Orbit never runs elevated as a whole process. A narrow, enumerated verb set is exposed to a
separately-privileged helper, requested lazily on first use:

- **macOS**: `SMAppService` daemon, shipped inside the app bundle (so deleting the app
  removes the root helper), communicating over XPC with the client's code signature
  validated against a pinned Team ID. `SMAppService` cannot show a password prompt — it
  returns `.requiresApproval` and the user must enable it in System Settings → Login Items.
- **Windows**: the COM elevation moniker (`Elevation:Administrator!new:{CLSID}`) — one UAC
  prompt per object activation, the object persists for many operations, nothing stays
  permanently privileged.
- **Both converge on the same shape**: a narrow, signature-validated IPC surface with an
  enumerated verb list. **There is no "run arbitrary command as root" verb** — that is the
  one thing that would sink a security review.

See [security.md](./security.md) for the full threat model this supports.
