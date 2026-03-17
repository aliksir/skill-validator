# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-03-17

### Added
- `--self-update` flag: Update `claude-skill-validator` itself via `npm install -g claude-skill-validator@latest`
  - Detects npx execution and guides user to global install instead of attempting auto-update
  - Shows current version before update and new version after
- Automatic npm version check at the end of every scan
  - Compares local `package.json` version against npm registry (`npm view claude-skill-validator version`)
  - Displays `💡 新バージョン vX.Y.Z が利用可能です` only when a newer version exists (no output when already up to date)
  - Silently skips on network failure (offline-safe)
  - Suppressed by `--no-version-check` flag, or when `--json` output is active
- `--no-version-check` flag: Disable the npm version check (useful for CI environments)
- `getCurrentVersion()`: Reads version from `package.json` in the script's own directory via `import.meta.url`
- `getLatestVersion()`: Fetches latest version from npm registry via `npm view`
- `isNewer(current, latest)`: Semver comparison (major.minor.patch numeric) with no external dependencies
- `isNpx()`: Detects npx execution via `npm_execpath`, `argv[1]`, and `npm list -g` fallback
- `selfUpdate()`: Orchestrates the self-update flow with pre/post version display

## [1.2.0] - 2026-03-17

### Changed
- `checkCommandReferences`: チェック対象をコードフェンスブロック（` ```bash/sh/shell/zsh/console ``` `）内のコマンドと `$ ` プレフィックス行のみに限定
  - インラインバッククォート（`` `word` ``）は完全スキップ — 用語囲みをコマンドと誤検知する最大の原因を排除
  - パイプ `|` の後のコマンドもコードブロック内から抽出
  - コードブロック外の `$ command` パターン（ドキュメント内の実行例）は引き続き検出
- `checkCommandReferences`: `CMD_EXCLUDE` を大幅縮小 — インラインバッククォートを対象外にしたため、数百語の英単語除外リストが不要になり削除
  - シェル組み込み・構文キーワードのみを除外リストに残す（`for`, `done`, `if`, `fi`, `while`, `case`, `esac` 等）
- セキュリティスキル（`active-directory-attacks` 等）の bashブロック内 `nmap`/`sqlmap`/`hydra` 等は引き続き検出される

## [1.1.0] - 2026-03-17

### Added
- `--update` flag: Apply available updates from source repositories (implies `--update-check`)
  - Skills with `.source` file or `.git` directory are updated from their GitHub source
  - Git-cloned skills: updated via `git pull --ff-only`
  - Tarball-installed skills: downloaded via `gh api repos/{owner}/{repo}/tarball`, extracted, and overwritten
  - Full skill directory backup created in `.skill-validator-backup/{skill-name}-{timestamp}/` before each update
  - Rollback instructions displayed on error
  - Combinable with `--dry-run` to preview what would be updated without making changes
  - Skills without `.source` information are skipped with `⏭️ ソース情報なし` message
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
