---
description: "Validate and repair installed Claude Code skills. Usage: /skill-validate [options]"
---

Claude Codeスキルの健全性チェックと自動修復ツール。

使い方:
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js` — 全スキルをチェック
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js --fix` — 自動修正可能な項目を修正
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js --dry-run` — 修正プレビュー
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js --skills-only` — skills/のみチェック
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js --commands-only` — commands/のみチェック
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js --json` — JSON形式出力
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js --verbose` — 詳細出力
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js --quiet` — FAILのみ表示
- `node ${CLAUDE_PLUGIN_ROOT}/skill-validator.js --strict` — WARN も表示

引数$ARGUMENTSがあればオプションとして渡す。
