# Open-source publication and privacy review

This project has functional developer-tooling code, but publication requires more than making the repository visible.

## Must verify before promoting the project

- [ ] Confirm rights to license all original code under MIT; preserve upstream licenses and any restrictions on third-party assets, names and logos.
- [ ] Review **all current tracked files, screenshots and embedded documentation**, especially historical execution evidence, account screens, captured terminal output and copied upstream sources.
- [ ] Inspect **all reachable Git history** (not just `main`) with a local secret-scanning tool such as Gitleaks and manually inspect flagged paths. Review tags and releases too.
- [ ] Remove personal identifiers, real home paths, account details, session content, environment files, API tokens, signing materials and proprietary data.
- [ ] If a secret was exposed, rotate or revoke it; rewriting Git history alone cannot make an exposed secret safe.
- [ ] If a history rewrite is required, coordinate it with all collaborators. Public forks, caches, existing clones and releases may retain copies.
- [ ] Manually review every screenshot and binary that cannot be scanned as text.
- [ ] Verify `npm ci`, unit tests, typecheck, desktop build, Rust checks and clean-machine installation.
- [ ] Verify updater behavior with **public** GitHub releases and avoid publishing an untested update for existing installations.
- [ ] Enable GitHub secret scanning, dependency alerts, private vulnerability reporting and branch protection where available.
- [ ] Provide an honest demonstration, install instructions and external adoption evidence; do not imply that internal pull requests count as external contributions.

**Status:** This document is a checklist, not a statement that the security review is complete. An independent local history and binary scan is still required.
