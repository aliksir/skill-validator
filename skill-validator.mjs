#!/usr/bin/env node
// skill-validator.mjs - Claude Code スキル健全性チェッカー
// ~/.claude/skills/ と ~/.claude/commands/ を一括スキャンし、
// 環境変更起因の破損を検知する。
//
// Usage:
//   node skill-validator.mjs [options]
//   --dir <path>       Claude config dir (default: ~/.claude)
//   --skills-only      skills/ のみチェック
//   --commands-only    commands/ のみチェック
//   --json             JSON形式で出力
//   --update-check     GitHubリポジトリからのアップデートチェック
//   --verbose          詳細出力
//   --fix              自動修正可能な項目を修正（バックアップ付き）
//   --dry-run          修正内容のプレビュー（実際には変更しない）

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join, extname, basename, dirname } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

// --- CLI引数パース ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};
const hasFlag = (name) => args.includes(name);

const claudeDir = (getArg('--dir') || join(homedir(), '.claude')).replace(/\\/g, '/');
const skillsOnly = hasFlag('--skills-only');
const commandsOnly = hasFlag('--commands-only');
const jsonOutput = hasFlag('--json');
const updateCheck = hasFlag('--update-check');
const verbose = hasFlag('--verbose');
const fixMode = hasFlag('--fix');
const dryRun = hasFlag('--dry-run');

// --- 結果収集 ---
const results = [];
const fixes = [];

function addResult(target, check, status, message) {
  results.push({ target, check, status, message });
}

function addFix(target, filePath, description, apply) {
  fixes.push({ target, filePath, description, apply });
}

// --- バックアップ & 修正 ---
import { copyFileSync, writeFileSync, mkdirSync } from 'fs';

function backupFile(filePath) {
  const backupDir = join(claudeDir, '.skill-validator-backup');
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `${basename(filePath)}.${timestamp}.bak`;
  const backupPath = join(backupDir, backupName);
  copyFileSync(filePath, backupPath);
  return backupPath;
}

function applyFixes() {
  if (fixes.length === 0) {
    console.log('\n🔧 修正対象はありません。');
    return;
  }

  console.log(`\n🔧 修正可能な項目: ${fixes.length}件`);
  for (const fix of fixes) {
    console.log(`  📦 ${fix.target}: ${fix.description}`);
    if (dryRun) {
      console.log(`    → [dry-run] 変更なし`);
      continue;
    }
    try {
      const backupPath = backupFile(fix.filePath);
      fix.apply();
      console.log(`    → ✅ 修正完了（バックアップ: ${basename(backupPath)}）`);
    } catch (e) {
      console.log(`    → ❌ 修正失敗: ${e.message}`);
    }
  }

  if (!dryRun) {
    console.log(`\n  バックアップ先: ${join(claudeDir, '.skill-validator-backup')}/`);
    console.log(`  ロールバック: バックアップファイルを元の場所にコピーしてください`);
  }
}

// --- ユーティリティ ---

function parseYamlFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>NUL`, {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function checkSyntax(filePath) {
  const ext = extname(filePath).toLowerCase();
  try {
    if (ext === '.js' || ext === '.mjs') {
      execSync(`node --check "${filePath}"`, { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true };
    }
    if (ext === '.py') {
      // Windows パス対策: バックスラッシュをフォワードスラッシュに変換
      const safePath = filePath.replace(/\\/g, '/');
      execSync(`python -c "import py_compile; py_compile.compile(r'${safePath}', doraise=True)"`, { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true };
    }
    if (ext === '.sh' || ext === '.bash') {
      execSync(`bash -n "${filePath}"`, { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true };
    }
    return { ok: true, skipped: true };
  } catch (e) {
    return { ok: false, error: e.stderr?.toString().trim() || e.message };
  }
}

// --- チェック1: フロントマター検証 ---
function checkFrontmatter(name, content, filePath) {
  const fm = parseYamlFrontmatter(content);
  if (!fm) {
    // SKILL.md にフロントマターがなくても、最低限 name 行があればOK（古い形式）
    if (content.match(/^name:/m)) {
      addResult(name, 'frontmatter', 'WARN', 'YAML フロントマター未使用（name: は存在）');
    } else {
      addResult(name, 'frontmatter', 'WARN', 'フロントマター（---...---）が見つかりません');
    }
    return;
  }
  if (!fm.name) {
    addResult(name, 'frontmatter', 'FAIL', 'フロントマターに name がありません');
  } else if (fm.name !== name && fm.name !== basename(filePath, '.md')) {
    addResult(name, 'frontmatter', 'WARN', `name が「${fm.name}」ですがディレクトリ名は「${name}」です`);
  } else {
    addResult(name, 'frontmatter', 'PASS', `name: ${fm.name}`);
  }
  if (!fm.description) {
    addResult(name, 'frontmatter', 'FAIL', 'フロントマターに description がありません');
  } else {
    addResult(name, 'frontmatter', 'PASS', `description: ${fm.description.slice(0, 60)}...`);
  }
}

// --- チェック2: ファイル参照検証 ---
function checkFileReferences(name, content, baseDir) {
  // INSTRUCTIONS.md 参照チェック
  if (content.includes('INSTRUCTIONS.md') || content.includes('instructions')) {
    const instrPath = join(baseDir, 'INSTRUCTIONS.md');
    if (existsSync(instrPath)) {
      addResult(name, 'file-ref', 'PASS', 'INSTRUCTIONS.md 存在確認OK');
    } else {
      addResult(name, 'file-ref', 'FAIL', 'INSTRUCTIONS.md を参照していますが存在しません');
    }
  }

  // scripts/ 参照チェック
  const scriptRefs = content.match(/scripts\/[\w.-]+/g);
  if (scriptRefs) {
    const unique = [...new Set(scriptRefs)];
    for (const ref of unique) {
      const scriptPath = join(baseDir, ref);
      if (existsSync(scriptPath)) {
        addResult(name, 'file-ref', 'PASS', `${ref} 存在確認OK`);
      } else {
        addResult(name, 'file-ref', 'FAIL', `${ref} を参照していますが存在しません`);
      }
    }
  }

  // references/ 参照チェック
  const refRefs = content.match(/references\/[\w.-]+/g);
  if (refRefs) {
    const unique = [...new Set(refRefs)];
    for (const ref of unique) {
      const refPath = join(baseDir, ref);
      if (existsSync(refPath)) {
        addResult(name, 'file-ref', 'PASS', `${ref} 存在確認OK`);
      } else {
        addResult(name, 'file-ref', 'FAIL', `${ref} を参照していますが存在しません`);
      }
    }
  }

  // resources/ 参照チェック
  const resRefs = content.match(/resources\/[\w.-]+/g);
  if (resRefs) {
    const unique = [...new Set(resRefs)];
    for (const ref of unique) {
      const resPath = join(baseDir, ref);
      if (existsSync(resPath)) {
        addResult(name, 'file-ref', 'PASS', `${ref} 存在確認OK`);
      } else {
        addResult(name, 'file-ref', 'WARN', `${ref} を参照していますが存在しません`);
      }
    }
  }
}

// --- チェック3: ツール参照検証（MCP等） ---
function checkToolReferences(name, content, filePath) {
  // MCPツール参照パターン（廃止されたMCPツール名 → 置換先）
  const mcpReplacements = [
    { pattern: /`?tabs_context_mcp`?/g, replacement: '`browser-cli snapshot`', desc: 'tabs_context_mcp → browser-cli snapshot' },
    { pattern: /`?tabs_create_mcp`?/g, replacement: '`browser-cli goto`', desc: 'tabs_create_mcp → browser-cli goto' },
    { pattern: /`?read_page`?\s*\(filter:\s*interactive\)/g, replacement: '`browser-cli snapshot`', desc: 'read_page (filter: interactive) → browser-cli snapshot' },
    { pattern: /`?read_page`?/g, replacement: '`browser-cli snapshot`', desc: 'read_page → browser-cli snapshot' },
    { pattern: /`?form_input`?/g, replacement: '`browser-cli fill <ref> "<text>"`', desc: 'form_input → browser-cli fill' },
    { pattern: /`?navigate_mcp`?/g, replacement: '`browser-cli goto`', desc: 'navigate_mcp → browser-cli goto' },
  ];

  for (const { pattern, desc } of mcpReplacements) {
    if (pattern.test(content)) {
      addResult(name, 'tool-ref', 'FAIL', `廃止されたツール参照: ${desc}`);

      if (fixMode && filePath) {
        const p = new RegExp(pattern.source, pattern.flags);
        const repl = mcpReplacements.find(r => r.desc === desc);
        addFix(name, filePath, `ツール参照を置換: ${desc}`, () => {
          let fileContent = readFileSync(filePath, 'utf-8');
          fileContent = fileContent.replace(p, repl.replacement);
          writeFileSync(filePath, fileContent, 'utf-8');
        });
      }
    }
  }

  // 汎用MCP参照（_mcp サフィックス）
  const mcpRefs = content.match(/\b\w+_mcp\b/g);
  if (mcpRefs) {
    const knownDeprecated = ['tabs_context_mcp', 'tabs_create_mcp', 'navigate_mcp'];
    const unknown = [...new Set(mcpRefs)].filter(r => !knownDeprecated.includes(r));
    if (unknown.length > 0) {
      addResult(name, 'tool-ref', 'WARN', `MCP ツール参照あり（利用可否要確認）: ${unknown.join(', ')}`);
    }
  }
}

// --- チェック4: コマンド参照検証 ---
function checkCommandReferences(name, content) {
  // バッククォート内のコマンドパターンを抽出
  const codeBlocks = content.match(/`([^`]+)`/g) || [];
  const knownCommands = new Set();

  for (const block of codeBlocks) {
    const cmd = block.replace(/`/g, '').trim().split(/\s/)[0];
    // コマンドっぽいもの（小文字英字+ハイフンで始まる）
    if (/^[a-z][\w-]*$/.test(cmd) && cmd.length > 2 && cmd.length < 30) {
      // 一般的なCLIコマンドやキーワードを除外
      const exclude = new Set([
        // 英語の一般単語
        'the', 'and', 'for', 'not', 'use', 'see', 'run', 'set', 'get', 'add',
        'all', 'any', 'are', 'but', 'can', 'did', 'has', 'had', 'have', 'its',
        'may', 'our', 'out', 'own', 'per', 'put', 'say', 'she', 'too', 'was',
        'way', 'who', 'why', 'yes', 'yet', 'you', 'also', 'each', 'here',
        'into', 'just', 'like', 'make', 'many', 'most', 'much', 'must', 'name',
        'need', 'only', 'over', 'such', 'take', 'than', 'that', 'them', 'then',
        'this', 'very', 'when', 'will', 'with', 'your', 'about', 'after',
        'being', 'could', 'every', 'first', 'found', 'great', 'never', 'other',
        'right', 'shall', 'since', 'still', 'their', 'there', 'these', 'thing',
        'those', 'under', 'using', 'where', 'which', 'while', 'would', 'should',
        'before', 'between', 'during', 'allows', 'rather', 'string', 'number',
        'object', 'header', 'module', 'result', 'output', 'input', 'value',
        'default', 'example', 'defaults', 'decision', 'description', 'markdown',
        'package', 'email', 'placeholder', 'flag', 'have', 'executes', 'based',
        'above', 'below', 'inside', 'returns', 'given', 'called', 'ensure',
        'create', 'check', 'update', 'delete', 'model', 'data', 'file', 'path',
        'note', 'rule', 'test', 'step', 'list', 'item', 'code', 'line', 'mode',
        'info', 'warn', 'error', 'pass', 'fail', 'skip', 'done', 'next', 'prev',
        'start', 'stop', 'open', 'close', 'read', 'write', 'send', 'load',
        'save', 'init', 'main', 'help', 'show', 'hide', 'move', 'copy', 'link',
        // プログラミング用語
        'let', 'var', 'new', 'true', 'false', 'null', 'auto', 'none', 'text',
        'ref', 'img', 'src', 'url', 'api', 'css', 'html', 'json', 'yaml',
        'env', 'config', 'import', 'export', 'const', 'function', 'return',
        'class', 'async', 'await', 'from', 'type', 'interface', 'enum',
        'void', 'self', 'super', 'static', 'public', 'private', 'protected',
        'abstract', 'final', 'override', 'throw', 'catch', 'finally', 'try',
        'break', 'continue', 'switch', 'case', 'while', 'yield', 'defer',
        'struct', 'trait', 'impl', 'match', 'where', 'select', 'insert',
        'define', 'include', 'require', 'template', 'component', 'service',
        // CSS/HTMLプロパティ
        'display', 'color', 'width', 'height', 'margin', 'padding', 'border',
        'content', 'position', 'overflow', 'opacity', 'transition',
        'prefers-reduced-motion', 'select_related', 'prefetch_related',
        // フレームワーク/ライブラリ名（コマンドではない）
        'typescript', 'javascript', 'dockerfile', 'graphql', 'xml', 'svg',
        'react', 'angular', 'django', 'flask', 'express', 'spring',
        // ペンテストスキルの参照（スキル名はコマンドではない）
        'api-fuzzing-bug-bounty', 'scanning-tools', 'dot',
        // その他の偽陽性パターン
        'agents', 'script', 'debug', 'format', 'build', 'deploy', 'lint',
        'watch', 'clean', 'serve', 'print', 'parse', 'fetch', 'handle',
        'render', 'mount', 'patch', 'merge', 'reset', 'clear', 'flush',
        'index', 'count', 'query', 'table', 'field', 'column', 'schema',
        'token', 'scope', 'state', 'event', 'route', 'proxy', 'cache',
        'queue', 'stack', 'graph', 'tree', 'node-', 'worker', 'socket',
        'stream', 'buffer', 'chunk', 'block', 'layer', 'stage', 'phase',
        'setup', 'apply', 'abort', 'retry', 'spawn', 'child', 'parent',
        'local', 'remote', 'source', 'target', 'origin', 'branch', 'commit',
        'version', 'release', 'stable', 'latest', 'canary', 'verify',
      ]);
      if (!exclude.has(cmd)) {
        knownCommands.add(cmd);
      }
    }
  }

  // 明示的なCLIコマンド参照パターン
  const cliPatterns = content.match(/(?:^|\n)\s*(?:\$\s+)?([a-z][\w-]+)\s/gm) || [];
  // bash/shell のコードブロック内のコマンド
  const shellBlocks = content.match(/```(?:bash|sh|shell)\n([\s\S]*?)```/g) || [];
  for (const block of shellBlocks) {
    const lines = block.split('\n').slice(1, -1);
    for (const line of lines) {
      const cmd = line.trim().replace(/^\$\s*/, '').split(/\s/)[0];
      if (/^[a-z][\w-]+$/.test(cmd) && cmd.length > 2) {
        knownCommands.add(cmd);
      }
    }
  }

  // 検証対象のコマンド（一般的なシステムコマンドは除外）
  const systemCmds = new Set([
    'git', 'npm', 'npx', 'node', 'python', 'python3', 'pip', 'bash', 'sh',
    'cat', 'ls', 'cd', 'cp', 'mv', 'rm', 'mkdir', 'echo', 'grep', 'find',
    'curl', 'wget', 'chmod', 'touch', 'head', 'tail', 'sort', 'sed', 'awk',
    'cargo', 'go', 'java', 'ruby', 'php', 'docker', 'make', 'cmake',
    'pnpm', 'bun', 'yarn', 'deno', 'tsx', 'tsc', 'eslint', 'prettier',
    'pytest', 'jest', 'vitest', 'ruff', 'black', 'mypy',
  ]);

  const customCmds = [...knownCommands].filter(c => !systemCmds.has(c));

  for (const cmd of customCmds) {
    if (commandExists(cmd)) {
      addResult(name, 'cmd-ref', 'PASS', `コマンド「${cmd}」がPATHに存在`);
    } else {
      addResult(name, 'cmd-ref', 'WARN', `コマンド「${cmd}」がPATHに見つかりません（インストール要確認）`);
    }
  }
}

// --- チェック5: パス参照検証 ---
function checkPathReferences(name, content) {
  // 絶対パス参照
  const absPaths = content.match(/(?:C:[\\/]|\/(?:home|Users|usr|opt|etc)[\\/])[\w/.\\-]+/g);
  if (absPaths) {
    const unique = [...new Set(absPaths)].map(p => p.replace(/\\/g, '/'));
    for (const p of unique) {
      // パスが実在するか確認（ただしサンプル/例文っぽいものは除外）
      if (p.includes('example') || p.includes('your-') || p.includes('username')) continue;
      if (existsSync(p)) {
        if (verbose) addResult(name, 'path-ref', 'PASS', `パス存在OK: ${p}`);
      } else {
        addResult(name, 'path-ref', 'WARN', `絶対パスが実在しません: ${p}`);
      }
    }
  }
}

// --- チェック6: スクリプト構文チェック ---
function checkScriptSyntax(name, baseDir) {
  const scriptsDir = join(baseDir, 'scripts');
  if (!existsSync(scriptsDir)) return;

  try {
    const files = readdirSync(scriptsDir);
    for (const file of files) {
      const filePath = join(scriptsDir, file);
      if (statSync(filePath).isDirectory()) continue;

      const result = checkSyntax(filePath);
      if (result.skipped) continue;
      if (result.ok) {
        addResult(name, 'syntax', 'PASS', `${file} 構文OK`);
      } else {
        addResult(name, 'syntax', 'FAIL', `${file} 構文エラー: ${result.error}`);
      }
    }
  } catch {
    // scriptsディレクトリ読み取りエラー
  }
}

// --- チェック7: アップデートチェック ---
async function checkUpdates(name, baseDir) {
  // .source ファイルや git remote でソースを特定
  const sourceFile = join(baseDir, '.source');
  let sourceUrl = null;

  if (existsSync(sourceFile)) {
    sourceUrl = readFileSync(sourceFile, 'utf-8').trim();
  }

  // package.json の repository フィールド
  const pkgPath = join(baseDir, 'package.json');
  if (!sourceUrl && existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.repository?.url) sourceUrl = pkg.repository.url;
      else if (typeof pkg.repository === 'string') sourceUrl = pkg.repository;
    } catch {}
  }

  // .git ディレクトリがあれば remote を確認
  const gitDir = join(baseDir, '.git');
  if (!sourceUrl && existsSync(gitDir)) {
    try {
      sourceUrl = execSync(`git -C "${baseDir}" remote get-url origin`, {
        encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {}
  }

  if (!sourceUrl) {
    if (verbose) addResult(name, 'update', 'PASS', 'ソースリポジトリ情報なし（ローカルスキル）');
    return;
  }

  // GitHub URLからオーナー/リポジトリを抽出
  const ghMatch = sourceUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!ghMatch) {
    addResult(name, 'update', 'WARN', `GitHub以外のソース: ${sourceUrl}`);
    return;
  }

  const [, owner, repo] = ghMatch;

  try {
    const latest = execSync(
      `gh api repos/${owner}/${repo}/commits/HEAD --jq '.sha'`,
      { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    // ローカルの最新コミットと比較
    let localSha = null;
    if (existsSync(gitDir)) {
      try {
        localSha = execSync(`git -C "${baseDir}" rev-parse HEAD`, {
          encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {}
    }

    // .source-sha ファイルで管理している場合
    const shaFile = join(baseDir, '.source-sha');
    if (!localSha && existsSync(shaFile)) {
      localSha = readFileSync(shaFile, 'utf-8').trim();
    }

    if (localSha && localSha === latest) {
      addResult(name, 'update', 'PASS', `最新版 (${latest.slice(0, 7)})`);
    } else if (localSha) {
      addResult(name, 'update', 'WARN', `アップデートあり: ローカル ${localSha.slice(0, 7)} → リモート ${latest.slice(0, 7)} (${owner}/${repo})`);
    } else {
      addResult(name, 'update', 'WARN', `ソース ${owner}/${repo} の最新: ${latest.slice(0, 7)}（ローカルバージョン不明）`);
    }
  } catch (e) {
    addResult(name, 'update', 'WARN', `アップデート確認失敗: ${e.message?.slice(0, 80)}`);
  }
}

// --- スキャン実行 ---

async function scanSkills() {
  const skillsDir = join(claudeDir, 'skills');
  if (!existsSync(skillsDir)) {
    console.error(`skills/ が見つかりません: ${skillsDir}`);
    return;
  }

  const entries = readdirSync(skillsDir).filter(e => {
    const full = join(skillsDir, e);
    return statSync(full).isDirectory() && !e.startsWith('_') && e !== 'security';
  });

  for (const name of entries) {
    const baseDir = join(skillsDir, name);
    const skillMd = join(baseDir, 'SKILL.md');

    if (!existsSync(skillMd)) {
      addResult(name, 'structure', 'FAIL', 'SKILL.md が存在しません');
      continue;
    }

    const content = readFileSync(skillMd, 'utf-8');

    // INSTRUCTIONS.md があれば結合して全文チェック
    const instrPath = join(baseDir, 'INSTRUCTIONS.md');
    const fullContent = existsSync(instrPath)
      ? content + '\n' + readFileSync(instrPath, 'utf-8')
      : content;

    checkFrontmatter(name, content, skillMd);
    checkFileReferences(name, fullContent, baseDir);
    // ツール参照修正はINSTRUCTIONS.md優先（あれば）、なければSKILL.md
    const toolRefTarget = existsSync(instrPath) ? instrPath : skillMd;
    checkToolReferences(name, fullContent, toolRefTarget);
    checkCommandReferences(name, fullContent);
    checkPathReferences(name, fullContent);
    checkScriptSyntax(name, baseDir);

    if (updateCheck) {
      await checkUpdates(name, baseDir);
    }
  }
}

function scanCommands() {
  const cmdsDir = join(claudeDir, 'commands');
  if (!existsSync(cmdsDir)) {
    console.error(`commands/ が見つかりません: ${cmdsDir}`);
    return;
  }

  const files = readdirSync(cmdsDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const name = `cmd:${basename(file, '.md')}`;
    const filePath = join(cmdsDir, file);
    const content = readFileSync(filePath, 'utf-8');

    // コマンドファイルにはフロントマターは不要（あれば検証）
    if (content.startsWith('---')) {
      checkFrontmatter(name, content, filePath);
    }

    checkToolReferences(name, content, filePath);
    checkCommandReferences(name, content);
    checkPathReferences(name, content);
  }
}

// --- 出力 ---

function printResults() {
  if (jsonOutput) {
    const summary = {
      total: results.length,
      pass: results.filter(r => r.status === 'PASS').length,
      warn: results.filter(r => r.status === 'WARN').length,
      fail: results.filter(r => r.status === 'FAIL').length,
      results: verbose ? results : results.filter(r => r.status !== 'PASS'),
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // テキスト出力
  const grouped = {};
  for (const r of results) {
    if (!grouped[r.target]) grouped[r.target] = [];
    grouped[r.target].push(r);
  }

  const statusIcon = { PASS: '✅', WARN: '⚠️', FAIL: '❌' };

  let totalPass = 0, totalWarn = 0, totalFail = 0;
  const failedTargets = [];

  for (const [target, checks] of Object.entries(grouped).sort()) {
    const fails = checks.filter(c => c.status === 'FAIL');
    const warns = checks.filter(c => c.status === 'WARN');
    const passes = checks.filter(c => c.status === 'PASS');

    totalPass += passes.length;
    totalWarn += warns.length;
    totalFail += fails.length;

    // 問題がないスキルは非verboseでスキップ
    if (!verbose && fails.length === 0 && warns.length === 0) continue;

    if (fails.length > 0) failedTargets.push(target);

    console.log(`\n📦 ${target}`);
    for (const c of checks) {
      if (!verbose && c.status === 'PASS') continue;
      console.log(`  ${statusIcon[c.status]} [${c.check}] ${c.message}`);
    }
  }

  // サマリー
  console.log('\n' + '='.repeat(60));
  console.log(`📊 スキャン結果サマリー`);
  console.log(`  対象ディレクトリ: ${claudeDir}`);
  console.log(`  チェック総数: ${results.length}`);
  console.log(`  ✅ PASS: ${totalPass}  ⚠️ WARN: ${totalWarn}  ❌ FAIL: ${totalFail}`);

  if (failedTargets.length > 0) {
    console.log(`\n  ❌ 要修正 (${failedTargets.length}件):`);
    for (const t of failedTargets) {
      console.log(`    - ${t}`);
    }
  }

  if (totalFail === 0 && totalWarn === 0) {
    console.log('\n  🎉 全スキル健全！問題は見つかりませんでした。');
  }
  console.log('');
}

// --- メイン ---

async function main() {
  if (!commandsOnly) await scanSkills();
  if (!skillsOnly) scanCommands();
  printResults();

  // 修正モード
  if (fixMode || dryRun) {
    applyFixes();
  }

  // 終了コード: FAILがあれば1
  if (results.some(r => r.status === 'FAIL')) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(2);
});
