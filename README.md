# skill-validator

Claude Code のスキル・コマンドの健全性を一括チェックするCLIツール。

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
# 基本実行（~/.claude をスキャン）
node skill-validator.mjs

# 詳細出力
node skill-validator.mjs --verbose

# アップデートチェック付き
node skill-validator.mjs --update-check

# JSON出力
node skill-validator.mjs --json

# skills/ のみ
node skill-validator.mjs --skills-only

# commands/ のみ
node skill-validator.mjs --commands-only

# 別ディレクトリを指定
node skill-validator.mjs --dir /path/to/.claude
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

## アップデートチェック

`--update-check` フラグを付けると、スキルのソースリポジトリとの差分を検知する。

ソース情報は以下の優先順で探索：
1. `.source` ファイル（GitHubリポジトリURL）
2. `package.json` の `repository` フィールド
3. `.git/` ディレクトリの `origin` リモート

## 動作環境

- Node.js 18+
- 外部依存なし（fs/path/child_process のみ使用）
- Windows / macOS / Linux 対応

## ライセンス

MIT
