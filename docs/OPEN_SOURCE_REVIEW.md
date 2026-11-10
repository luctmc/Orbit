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

## Additional independent review — 10 November 2026

- Main branch has 133 commits. In the available metadata, **56 commits contain an Outlook-address author email**; a full-history rewrite may be needed to remove personal identity metadata, subject to maintainer review and GitHub's limits.
- A standalone privacy scanner was added at \`scripts/check-publication-safety.mjs\`. It reports only file paths and rule names, not the matched values. It does **not** inspect binary contents or history.
- A separate GitHub Actions workflow runs the scanner and Gitleaks on pull requests; scan results must be reviewed and resolved, not treated as a guarantee.
- Current public tree includes 259 tracked \`.log\` files, 131 images (including app assets), and compressed REA artifacts that cannot be fully inspected through the available interface.
- Do **not** claim that personal information, secrets, or third-party licensed materials have all been removed. Review all screenshots/archives and old commits locally before release.
- For Git history cleanup, follow GitHub's official \`git-filter-repo --sensitive-data-removal\` process; rotate exposed credentials first and coordinate with contributors. A history rewrite can invalidate signed commits and existing PRs.

To run the textual scan locally:
\`\`\`bash
node scripts/check-publication-safety.mjs
\`\`\`

For a separate history scan, install Gitleaks and run:
\`\`\`bash
gitleaks git --redact --log-opts="--all" .
\`\`\`


## 2026-11-10 public-tree minimization

The public branch removes historical experiment outputs from `docs/analysis/`, `docs/plans/` and `docs/reverse-engineering/` because they include local machine paths, runtime snapshots, screenshots and account-related artifacts. This removal deliberately does **not** erase their historical Git blobs, and does **not** prove absence of sensitive data in older commits, branches, releases or mirrors. Ensure the maintainer keeps any necessary private archival copies prior to changing the public branch. The remaining source and tests use synthetic account identities; the publication scanner intentionally ignores `example.com` and `example.invalid` examples. Existing production functionality and test suites must continue passing.

## Historical commit metadata

Repository authorship metadata in earlier commits includes a full personal name and a real Outlook email address. That information is still visible through the Git history after a normal merge. Use GitHub's noreply email for future commits. Correcting old commits would require a carefully coordinated history rewrite; do not perform one automatically because it rewrites SHAs and may disrupt signed releases, branches, PRs, forks and collaborator clones. Evaluate whether the user's publication/privacy requirement calls for a fresh sanitized public repository instead.
