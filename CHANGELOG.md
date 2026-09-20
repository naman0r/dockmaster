# Changelog

## Unreleased

- Agent Watch token counts: Codex usage from before a resumed session is no longer dropped, Codex cached tokens are no longer counted twice, and Claude Code subagent transcripts are folded into their session.
- Weekly receipt page: agent sessions, cost, and cleanup totals for the last seven days, exportable as a PNG. Successful stops, worktree removals, and disk cleans are now logged to `~/.dockmaster/actions.json`.
- Agent Watch lists the servers each session's folder is running and worktree state, and has a Left behind banner that opens a cleanup page with the reason for each flag and a Clean up action for servers and merged worktrees that finished agents left.
- Containers module: Docker containers with compose project, ports, and a guarded stop. Remote via companion 2.2.0.
- Ports rows link to their repository on the Repos page.
- Secrets reports keys declared in `.env.example` that `.env` does not set.
- Repos shows a pinned Node version when it differs from the running major.
- Health can send a browser notification when a check changes state, while the page is open.
- Harbor summarizes dirty and unpushed repos on the Repos card.
- AGENTS.md, CONTRIBUTING.md, issue templates.

## 0.2.0

- Disk module, remote machines over SSH, command palette, worktree and repo sorting, marketing site.
