# Codex Project Instructions

This repository uses Cursor project rules and Codex CLI together.

Before making code changes, Codex must read and follow:

- `.cursor/rules/agent-development-standard.mdc`

That Cursor rule file is the authoritative Agent development standard for this project. It defines:

- Agent architecture and routing rules
- file header comment requirements
- prompt extraction rules
- state design rules
- final artifact output rules
- tool and safety rules
- logging rules
- validation checklist

Do not duplicate or override those rules in implementation. If the standard changes, update `.cursor/rules/agent-development-standard.mdc` first.
