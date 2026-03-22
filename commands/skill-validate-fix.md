---
description: Auto-fix repairable issues in installed Claude Code skills
---

インストール済みClaude Codeスキルの自動修復ツール。

## 推奨フロー

まず --dry-run でプレビューしてから --fix で修正する。

### ステップ1: 修正プレビュー（ドライラン）
```
node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --dry-run
```
修正内容を確認し、意図しない変更がないかチェックする。

### ステップ2: 自動修復を実行
```
node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --fix
```
自動修正可能な項目（壊れた参照・非推奨ツール・構文エラー等）を修復する。

### ステップ3: 修復結果の確認
```
node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs
```
修復後に再チェックして全件PASSであることを確認する。

引数$ARGUMENTSがあれば追加オプションとして渡す。
