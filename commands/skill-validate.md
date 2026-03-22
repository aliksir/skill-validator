---
description: "Validate and repair installed Claude Code skills. Usage: /skill-validate [options]"
---

Claude Codeスキルの健全性チェックと自動修復ツール。

使い方:
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs` — 全スキルをチェック
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --fix` — 自動修正可能な項目を修正
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --dry-run` — 修正プレビュー
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --skills-only` — skills/のみチェック
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --commands-only` — commands/のみチェック
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --json` — JSON形式出力
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --verbose` — 詳細出力
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --quiet` — FAILのみ表示
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.mjs --strict` — WARN も表示

引数$ARGUMENTSがあればオプションとして渡す。
