# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-17

### Added
- `--quiet` flag: Show FAIL only; WARN count appears in summary only
- `--strict` flag: Enable frontmatter WARN output (previously always shown, now hidden by default)
- OS-aware path filtering in `checkPathReferences`: Linux paths (`/etc/`, `/usr/`, `/home/`, `/opt/`, `/var/`) are skipped on Windows; Windows paths (`C:\`) are skipped on Linux/macOS

### Changed
- `checkCommandReferences`: Minimum command length raised from 3 to 4 characters (3-char CLIs like `aws`, `pip` are covered by `systemCmds`)
- `checkCommandReferences`: Shell built-ins added to exclude list (`done`, `then`, `else`, `elif`, `esac`, `eval`, `exec`, `trap`, `wait`, `shift`, `alias`, `unset`, `declare`, `readonly`, `typeset`, `getopts`, `source`, `local`)
- `checkCommandReferences`: Expanded false-positive exclude list with commonly misdetected English words and language names (`markers`, `section`, `contains`, `agent`, `csharp`, `rust`, `kotlin`, `scala`, `lua`, `elixir`, `dart`, `sql`, `implement`, `search`, `exploit`, `act`, `set`, etc.)
- `checkCommandReferences`: `CMD_EXCLUDE` constant extracted outside the loop for performance
- Frontmatter WARN entries are now suppressed unless `--strict` is passed; count is shown in summary as `frontmatter警告: N件（--strictで表示）`

## [1.0.0] - 2026-03-10

### Initial release
- Frontmatter validation (`name`, `description` fields)
- File reference checks (`INSTRUCTIONS.md`, `scripts/`, `references/`, `resources/`)
- Deprecated MCP tool detection with auto-fix support
- Command existence checks via `which`/`where`
- Absolute path existence checks
- Script syntax validation (`.js`, `.mjs`, `.py`, `.sh`)
- Update check via GitHub API (`--update-check`)
- Auto-fix mode (`--fix`, `--dry-run`)
- JSON output (`--json`)
- Verbose mode (`--verbose`)
