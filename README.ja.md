# claude-skill-validator

Claude Code のスキル・コマンドの健全性を一括チェック・自動修復するCLIツール。

[English README](README.md)

環境変更（CLIアップデート、ツール廃止、パス変更等）起因のスキル破損を早期検知する。

## チェック項目

| チェック | 内容 | 重要度 |
|---------|------|--------|
| frontmatter | SKILL.md の name/description 存在確認 | WARN |
| file-ref | INSTRUCTIONS.md, scripts/, references/ の参照先存在確認 | FAIL |
| tool-ref | 廃止された MCP ツール参照の検知 | FAIL |
| cmd-ref | Bash コマンドの PATH 存在確認 | WARN |
| path-ref | ハードコードされた絶対パスの存在確認 | WARN |
| syntax | scripts/ 内の .js/.py/.sh の構文チェック | FAIL |
| update | GitHub リポジトリからのアップデート検知 | WARN |

## 使い方

```bash
# npx で実行（インストール不要）
npx claude-skill-validator

# または基本実行（~/.claude をスキャン）
claude-skill-validator

# 詳細出力
claude-skill-validator --verbose

# アップデートチェック付き
claude-skill-validator --update-check

# JSON出力
claude-skill-validator --json

# skills/ のみ
claude-skill-validator --skills-only

# commands/ のみ
claude-skill-validator --commands-only

# 別ディレクトリを指定
claude-skill-validator --dir /path/to/.claude

# FAILのみ表示
claude-skill-validator --quiet

# WARNも含めて厳密チェック
claude-skill-validator --strict
```

## 出力例

```
📦 nano-banana
  ❌ [tool-ref] 廃止されたツール参照: tabs_context_mcp（廃止済み — browser-cli を使用）
  ❌ [tool-ref] 廃止されたツール参照: read_page（廃止済み — browser-cli snapshot を使用）

📦 api-design-reviewer
  ❌ [syntax] api_linter.py 構文エラー: SyntaxError: invalid syntax

============================================================
📊 スキャン結果サマリー
  対象ディレクトリ: /Users/you/.claude
  チェック総数: 450
  ✅ PASS: 380  ⚠️ WARN: 60  ❌ FAIL: 10
```

## 終了コード

| コード | 意味 |
|--------|------|
| 0 | 問題なし（FAILなし） |
| 1 | FAILあり（要修正） |
| 2 | ツール自体のエラー |

## 自動修復

```bash
# 修正可能な問題を自動修復（バックアップ付き）
claude-skill-validator --fix

# 修正内容をプレビュー（実際には変更しない）
claude-skill-validator --dry-run
```

廃止されたMCPツール参照（`tabs_context_mcp` → `browser-cli snapshot` 等）を自動で置換する。
修復前に `~/.claude/.skill-validator-backup/` にバックアップを作成する。

## アップデートチェック

`--update-check` フラグを付けると、スキルのソースリポジトリとの差分を検知する。

ソース情報は以下の優先順で探索：
1. `.source` ファイル（GitHubリポジトリURL）
2. `package.json` の `repository` フィールド
3. `.git/` ディレクトリの `origin` リモート

## オプション一覧

| オプション | 説明 |
|-----------|------|
| `--dir <path>` | Claude設定ディレクトリ（デフォルト: `~/.claude`） |
| `--skills-only` | `skills/` のみスキャン |
| `--commands-only` | `commands/` のみスキャン |
| `--json` | JSON形式で出力 |
| `--verbose` | PASS含む全結果を表示 |
| `--quiet` | FAILのみ表示（WARN件数はサマリーのみ） |
| `--strict` | frontmatter WARNも表示（デフォルト非表示） |
| `--update-check` | ソースリポジトリからのアップデートチェック |
| `--update` | アップデートを適用（`--update-check` を含む） |
| `--fix` | 修正可能な問題を自動修復（バックアップ付き） |
| `--dry-run` | 修正内容のプレビュー（実際には変更しない） |
| `--self-update` | `claude-skill-validator` 自体を最新版に更新 |
| `--no-version-check` | npm バージョンチェックをスキップ（CI環境向け） |
| `--help`, `-h` | ヘルプを表示 |

## プラグインコマンド（`commands/`）

このパッケージには Claude Code スラッシュコマンドが同梱されています：

| コマンド | ファイル | 機能 |
|---------|---------|------|
| `/skill-validate` | `commands/skill-validate.md` | 全オプション対応の一括スキャン |
| `/skill-validate-fix` | `commands/skill-validate-fix.md` | dry-run → fix → 確認の3ステップフロー |

グローバルインストール後、Claude Code でそのまま使えます：

```bash
npm install -g claude-skill-validator
```

## 動作環境

- Node.js 18+
- 外部依存なし（fs/path/child_process のみ使用）
- Windows / macOS / Linux 対応

## ライセンス

MIT
