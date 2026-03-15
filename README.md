# claude-skill-validator

Validate and repair [Claude Code](https://claude.ai/code) skills — detect broken references, deprecated tools, syntax errors, and auto-fix issues.

Scans `~/.claude/skills/` and `~/.claude/commands/` in bulk to catch skill corruption caused by CLI updates, tool deprecations, or path changes.

[日本語 README](README.ja.md)

## Install

```bash
npm install -g claude-skill-validator
```

Or run without installing:

```bash
npx claude-skill-validator
```

## Usage

```bash
# Basic scan (scans ~/.claude by default)
claude-skill-validator

# Verbose output
claude-skill-validator --verbose

# Check for updates from source repositories
claude-skill-validator --update-check

# JSON output
claude-skill-validator --json

# Scan skills/ only
claude-skill-validator --skills-only

# Scan commands/ only
claude-skill-validator --commands-only

# Specify a custom Claude config directory
claude-skill-validator --dir /path/to/.claude

# Auto-fix fixable issues (with backup)
claude-skill-validator --fix

# Preview fixes without applying
claude-skill-validator --dry-run
```

## Check Types

| Check | What it verifies | Severity |
|-------|-----------------|----------|
| `frontmatter` | `name` and `description` fields exist in `SKILL.md` | WARN |
| `file-ref` | Referenced files in `INSTRUCTIONS.md`, `scripts/`, `references/` exist | FAIL |
| `tool-ref` | Deprecated MCP tool references are detected | FAIL |
| `cmd-ref` | Bash commands referenced in skills exist in PATH | WARN |
| `path-ref` | Hardcoded absolute paths exist on disk | WARN |
| `syntax` | `.js`, `.py`, `.sh` files in `scripts/` have valid syntax | FAIL |
| `update` | Skill source repositories have newer versions available | WARN |

## Output Example

```
📦 nano-banana
  ❌ [tool-ref] Deprecated tool reference: tabs_context_mcp (deprecated — use browser-cli)
  ❌ [tool-ref] Deprecated tool reference: read_page (deprecated — use browser-cli snapshot)

📦 api-design-reviewer
  ❌ [syntax] api_linter.py syntax error: SyntaxError: invalid syntax

============================================================
📊 Scan Summary
  Target directory: /Users/you/.claude
  Total checks: 450
  ✅ PASS: 380  ⚠️ WARN: 60  ❌ FAIL: 10
```

## Options

| Option | Description |
|--------|-------------|
| `--dir <path>` | Claude config directory (default: `~/.claude`) |
| `--skills-only` | Scan `skills/` directory only |
| `--commands-only` | Scan `commands/` directory only |
| `--json` | Output results as JSON |
| `--update-check` | Check for updates from source repositories |
| `--verbose` | Verbose output |
| `--fix` | Auto-fix fixable issues (creates backups) |
| `--dry-run` | Preview fixes without applying changes |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | No issues (no FAILs) |
| `1` | FAILs found (action required) |
| `2` | Tool error |

## Requirements

- Node.js 18+
- No external dependencies (uses `fs`, `path`, `child_process`, `os` only)
- Works on Windows, macOS, and Linux

## License

MIT
