# Security policy

Orbit launches and coordinates local coding agents, processes, workspaces and files. Its security boundary matters.

## Reporting a vulnerability

**Do not publish exploit steps, tokens, personal data or sensitive logs in a public issue or pull request.** Use GitHub's private vulnerability reporting in the repository's Security tab when available. If that option is disabled, contact the maintainer privately through their GitHub profile and request a secure channel before sending any sensitive details.

Provide a minimal synthetic reproduction, affected commit or version, expected vs. observed behavior, and impact. Do not include real credentials or other users' information.

## Supported releases

The project is experimental. Security fixes will be assessed for the current maintained branch and the newest available release; no long-term support commitment is currently made for older builds.

## Safety principles

- Credentials for Claude Code, Codex and other providers must remain outside Git.
- Do not publish session content, private project files, account identifiers, personal filesystem paths or unredacted screenshots/logs.
- Revoke or rotate credentials if exposed. Removing a file from the latest commit does **not** erase it from Git history, forks, caches or existing downloads.
- Contributions should use synthetic fixtures and least-privilege local permissions.

This policy does not certify that all historical repository content has been audited.
