# skill-validator

Claude Codeのスキル（`~/.claude/skills/`）とコマンド（`~/.claude/commands/`）を一括スキャンし、壊れた参照・廃止ツール・構文エラーを検出・自動修正するCLIツール。

## 技術スタック
- Node.js 18+（ESモジュール）
- 依存パッケージなし（Node.js built-insのみ）
- 単一ファイル構成（`skill-validator.js`）

## セットアップ
```bash
npm install -g claude-skill-validator
```

## ビルド
該当なし（ビルドステップなし）

## テスト
```bash
node --test test/skill-validator.test.mjs
```

## 開発規約
- 外部依存ゼロを維持する（Node.js built-insのみ使用）
- `--json` 出力のスキーマを安定させる（破壊的変更はメジャーバージョンアップ）
- `--fix` モードは必ずバックアップを作成してから修正処理を実行する
- NPMパッケージ名: `claude-skill-validator`
