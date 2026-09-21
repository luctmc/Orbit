# Context Architecture

```
Context Sources → Context Broker → Privacy Filter → Scoped Task Context
```

Sources: active app, focused window title, selected files, clipboard *classification* (not
contents), recent files/projects, running processes, cwd, connected displays, network
state.

## Rules

1. **Default deny.** A source is included in a snapshot only when the current task class
   actually needs it — nothing is gathered speculatively "just in case."
2. **Clipboard is classified, not read.** On macOS 26+, `changeCount` polling plus
   `detectPatterns(for:)` tell Orbit *that* something changed and *what kind* of content it
   is, without triggering the platform's new per-app pasteboard-read consent alert. Contents
   are read only when the user's current instruction plainly implies it ("summarize what I
   copied"). An always-on clipboard history is the wrong design on macOS as of 26+.
3. **Private folders are filtered before the broker, not after.** A path under a
   user-designated private root never enters a snapshot in the first place — filtering
   after collection is a data-handling bug waiting to happen.
4. **Window titles are treated as untrusted input.** They routinely contain document names,
   URLs, and occasionally credentials; see [security.md](./security.md) for how untrusted
   content is kept out of privilege-bearing decisions.
5. **What leaves the machine is inspectable, not just promised.** The Dev Mode panel shows
   the exact `state` payload sent to Jev and the exact prompt sent to an agent provider for
   every request, so Orbit's privacy story can be checked rather than trusted on faith.
6. **Snapshots are time-boxed.** Each carries a `capturedAt` and is rejected as stale past a
   short TTL — Jev has no sense of time on its own and would happily reason over a
   minute-old window list as if it were current.
