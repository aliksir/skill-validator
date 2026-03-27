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
//   --quiet            FAILのみ表示（WARNは件数サマリーのみ）
//   --strict           frontmatter の WARN も表示する

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join, extname, basename, dirname, relative } from 'path';
import { execSync, execFileSync } from 'child_process';
import { homedir, tmpdir } from 'os';

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
const updateMode = hasFlag('--update');
const updateCheck = hasFlag('--update-check') || updateMode;
const verbose = hasFlag('--verbose');
const fixMode = hasFlag('--fix');
const dryRun = hasFlag('--dry-run');
const quiet = hasFlag('--quiet');
const strict = hasFlag('--strict');
const selfUpdateMode = hasFlag('--self-update');
const noVersionCheck = hasFlag('--no-version-check');

// --- --help ---
if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`claude-skill-validator — Validate and repair Claude Code skills

Usage: claude-skill-validator [options]

Options:
  --dir <path>         Claude config directory (default: ~/.claude)
  --skills-only        Scan skills/ only
  --commands-only      Scan commands/ only
  --json               JSON output
  --verbose            Show all checks (including PASS)
  --update-check       Check for updates from source repositories
  --update             Apply available updates (implies --update-check)
  --fix                Auto-fix fixable issues (with backup)
  --dry-run            Preview fixes without applying
  --quiet              Show FAIL only (WARN count in summary)
  --strict             Show frontmatter WARN entries
  --self-update        Update claude-skill-validator itself to the latest version
  --no-version-check   Skip npm version check at end of scan
  --help, -h           Show this help message
`);
  process.exit(0);
}

// --- バージョン管理 ---

import { fileURLToPath } from 'url';

/** このスクリプトと同ディレクトリの package.json から現在バージョンを取得 */
function getCurrentVersion() {
  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(scriptDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version || null;
    }
  } catch { /* package.json の読み込み・パース失敗は無視 */ }
  return null;
}

/** npmレジストリから最新バージョンを取得。失敗時は null を返す */
function getLatestVersion() {
  try {
    return execSync('npm view claude-skill-validator version', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null; // オフライン等
  }
}

/**
 * semver比較。current < latest なら true。
 * major.minor.patch の数値比較のみ（外部依存なし）
 */
function isNewer(current, latest) {
  const toNums = (v) => v.replace(/^v/, '').split('.').map(Number);
  const [cM, cm, cp] = toNums(current);
  const [lM, lm, lp] = toNums(latest);
  if (lM !== cM) return lM > cM;
  if (lm !== cm) return lm > cm;
  return lp > cp;
}

/** npx 経由で実行されているかどうかを判定 */
function isNpx() {
  const execPath = process.env.npm_execpath || '';
  const argv1 = process.argv[1] || '';
  if (execPath.includes('npx') || argv1.includes('npx')) return true;
  // npx はキャッシュ内 (_npx) に展開する
  if (argv1.includes('_npx')) return true;
  // グローバルインストール確認
  try {
    const out = execSync('npm list -g claude-skill-validator --depth=0', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return !out.includes('claude-skill-validator');
  } catch { /* npm list 失敗時はnpx経由ではないと仮定 */ }
  return false;
}

/** --self-update: npm install -g claude-skill-validator@latest を実行 */
async function selfUpdate() {
  if (isNpx()) {
    console.log(`\nℹ️  npxでは自動更新できません。`);
    console.log(`   npm install -g claude-skill-validator でインストール後に --self-update を使用してください。\n`);
    process.exit(0);
  }

  const current = getCurrentVersion() || '(不明)';
  console.log(`\n🔄 claude-skill-validator を更新中...`);
  console.log(`  現在: v${current}`);
  console.log(`  📥 npm install -g claude-skill-validator@latest`);

  try {
    execSync('npm install -g claude-skill-validator@latest', {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: 'inherit',
    });
    const after = getLatestVersion() || '(確認失敗)';
    console.log(`  ✅ 更新完了: v${after}\n`);
  } catch (e) {
    console.error(`  ❌ 更新失敗: ${e.message}`);
    process.exit(1);
  }
}

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
import { copyFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs';

function backupFile(filePath) {
  const backupDir = join(claudeDir, '.skill-validator-backup');
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `${basename(filePath)}.${timestamp}.bak`;
  const backupPath = join(backupDir, backupName);
  copyFileSync(filePath, backupPath);
  return backupPath;
}

/** スキルディレクトリ全体をバックアップ */
function backupSkillDir(skillDir, skillName) {
  const backupBaseDir = join(claudeDir, '.skill-validator-backup');
  mkdirSync(backupBaseDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.Z]/g, '').slice(0, 15);
  const backupName = `${skillName}-${timestamp}`;
  const backupPath = join(backupBaseDir, backupName);
  cpSync(skillDir, backupPath, { recursive: true });
  return backupName;
}

// --- アップデート適用 ---

/**
 * checkUpdates() と同じロジックでソース情報を取得して返す
 * @returns {{ sourceUrl, owner, repo, localSha, isGit }} または null
 */
function resolveSkillSource(baseDir) {
  const sourceFile = join(baseDir, '.source');
  let sourceUrl = null;

  if (existsSync(sourceFile)) {
    sourceUrl = readFileSync(sourceFile, 'utf-8').trim();
  }

  const pkgPath = join(baseDir, 'package.json');
  if (!sourceUrl && existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.repository?.url) sourceUrl = pkg.repository.url;
      else if (typeof pkg.repository === 'string') sourceUrl = pkg.repository;
    } catch { /* package.json のパース失敗は無視 */ }
  }

  const gitDir = join(baseDir, '.git');
  const isGit = existsSync(gitDir);

  if (!sourceUrl && isGit) {
    try {
      sourceUrl = execFileSync('git', ['-C', baseDir, 'remote', 'get-url', 'origin'], {
        encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch { /* リモートURL取得失敗（リモートなし等）は無視 */ }
  }

  if (!sourceUrl) return null;

  const ghMatch = sourceUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!ghMatch) return { sourceUrl, owner: null, repo: null, localSha: null, isGit };

  const [, owner, repo] = ghMatch;

  // ローカルSHAを取得
  let localSha = null;
  if (isGit) {
    try {
      localSha = execFileSync('git', ['-C', baseDir, 'rev-parse', 'HEAD'], {
        encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch { /* HEAD SHA取得失敗（空リポジトリ等）は無視 */ }
  }
  const shaFile = join(baseDir, '.source-sha');
  if (!localSha && existsSync(shaFile)) {
    localSha = readFileSync(shaFile, 'utf-8').trim();
  }

  return { sourceUrl, owner, repo, localSha, isGit };
}

async function applyUpdates() {
  const skillsDir = join(claudeDir, 'skills');
  if (!existsSync(skillsDir)) {
    console.error(`skills/ が見つかりません: ${skillsDir}`);
    return;
  }

  const entries = readdirSync(skillsDir).filter(e => {
    const full = join(skillsDir, e);
    return statSync(full).isDirectory() && !e.startsWith('_') && e !== 'security';
  });

  if (dryRun) {
    console.log('\n🔍 [dry-run] アップデート確認中（変更は行いません）...\n');
  } else {
    console.log('\n🔄 アップデート実行中...\n');
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const name of entries) {
    const baseDir = join(skillsDir, name);
    console.log(`📦 ${name}`);

    // ソース情報なしはスキップ
    const src = resolveSkillSource(baseDir);
    if (!src) {
      console.log(`  ⏭️  ソース情報なし — スキップ`);
      skippedCount++;
      continue;
    }

    if (!src.owner) {
      console.log(`  ⏭️  GitHub以外のソース (${src.sourceUrl}) — スキップ`);
      skippedCount++;
      continue;
    }

    const { owner, repo, localSha, isGit } = src;

    // リモートSHAを取得
    let remoteSha;
    try {
      remoteSha = execSync(
        `gh api repos/${owner}/${repo}/commits/HEAD --jq '.sha'`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
    } catch (e) {
      console.log(`  ❌ リモートSHA取得失敗: ${e.message?.slice(0, 80)}`);
      errorCount++;
      continue;
    }

    // SHAが一致していれば最新
    if (localSha && localSha === remoteSha) {
      console.log(`  ✅ 最新版 (${remoteSha.slice(0, 7)}) — スキップ`);
      skippedCount++;
      continue;
    }

    const localLabel = localSha ? localSha.slice(0, 7) : '不明';
    const remoteLabel = remoteSha.slice(0, 7);
    console.log(`  📥 ${owner}/${repo} (${localLabel} → ${remoteLabel})`);

    if (dryRun) {
      console.log(`  → [dry-run] 変更なし`);
      updatedCount++;
      continue;
    }

    // --- 実際のアップデート適用 ---
    let backupName;
    try {
      backupName = backupSkillDir(baseDir, name);
      console.log(`  💾 バックアップ完了: ${backupName}/`);
    } catch (e) {
      console.log(`  ❌ バックアップ失敗: ${e.message}`);
      errorCount++;
      continue;
    }

    try {
      if (isGit) {
        // git clone版: git pull で更新
        execFileSync('git', ['-C', baseDir, 'pull', '--ff-only'], {
          encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        // tarball版: gh api でtarballダウンロード → 展開 → 上書き
        const tmpBase = join(tmpdir(), `skill-update-${name}-${Date.now()}`);
        mkdirSync(tmpBase, { recursive: true });

        try {
          const tarPath = join(tmpBase, `${name}.tar.gz`);

          // gh api でtarballをダウンロード
          execSync(
            `gh api repos/${owner}/${repo}/tarball -H "Accept: application/vnd.github+json" --output "${tarPath}"`,
            { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }
          );

          const extractDir = join(tmpBase, 'extracted');
          mkdirSync(extractDir, { recursive: true });

          // tar で展開
          execSync(`tar -xzf "${tarPath}" -C "${extractDir}" --strip-components=1`, {
            encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
          });

          // 既存ディレクトリの内容を新版で上書き（.git は保護）
          // まず既存の管理外ファイルを削除（.gitは除く）
          const existingFiles = readdirSync(baseDir);
          for (const f of existingFiles) {
            if (f === '.git') continue;
            const fp = join(baseDir, f);
            try {
              rmSync(fp, { recursive: true, force: true });
            } catch { /* ファイル削除失敗は無視して続行 */ }
          }

          // 新版のファイルをコピー
          const newFiles = readdirSync(extractDir);
          for (const f of newFiles) {
            const src2 = join(extractDir, f);
            const dst = join(baseDir, f);
            cpSync(src2, dst, { recursive: true });
          }
        } finally {
          // 一時ディレクトリを削除
          try {
            rmSync(tmpBase, { recursive: true, force: true });
          } catch { /* 一時ディレクトリの削除失敗は無視 */ }
        }

        // .source-sha を新SHAで更新
        const shaFile = join(baseDir, '.source-sha');
        writeFileSync(shaFile, remoteSha, 'utf-8');
      }

      console.log(`  ✅ アップデート完了（バックアップ: ${backupName}/）`);
      updatedCount++;
    } catch (e) {
      console.log(`  ❌ アップデート失敗: ${e.message?.slice(0, 120)}`);
      console.log(`  ↩️  ロールバック: ${join(claudeDir, '.skill-validator-backup', backupName)}/ を ${baseDir}/ にコピーしてください`);
      errorCount++;
    }
  }

  // サマリー
  const label = dryRun ? '[dry-run] ' : '';
  console.log(`\n🔄 ${label}アップデート結果: ${updatedCount}件更新、${skippedCount}件スキップ${errorCount > 0 ? `、${errorCount}件エラー` : ''}`);
  if (!dryRun && updatedCount > 0) {
    console.log(`  バックアップ先: ${join(claudeDir, '.skill-validator-backup')}/`);
  }
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
      execFileSync('python', ['-c', `import py_compile; py_compile.compile(${JSON.stringify(filePath)}, doraise=True)`], { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
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
// strict=false の場合、WARNはカウントのみ（サマリーで件数を表示）
let frontmatterWarnCount = 0;

function addFrontmatterWarn(name, message) {
  frontmatterWarnCount++;
  if (strict) {
    addResult(name, 'frontmatter', 'WARN', message);
  }
  // strict でない場合は内部カウントのみ（サマリーで件数表示）
}

function checkFrontmatter(name, content, filePath) {
  const fm = parseYamlFrontmatter(content);
  if (!fm) {
    // SKILL.md にフロントマターがなくても、最低限 name 行があればOK（古い形式）
    if (content.match(/^name:/m)) {
      addFrontmatterWarn(name, 'YAML フロントマター未使用（name: は存在）');
    } else {
      addFrontmatterWarn(name, 'フロントマター（---...---）が見つかりません');
    }
    return;
  }
  if (!fm.name) {
    addResult(name, 'frontmatter', 'FAIL', 'フロントマターに name がありません');
  } else if (fm.name !== name && fm.name !== basename(filePath, '.md')) {
    addFrontmatterWarn(name, `name が「${fm.name}」ですがディレクトリ名は「${name}」です`);
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

  // パターン別ディレクトリ参照チェック
  const dirPatterns = [
    { pattern: /scripts\/[\w.-]+/g,    status: 'FAIL' },
    { pattern: /references\/[\w.-]+/g, status: 'FAIL' },
    { pattern: /resources\/[\w.-]+/g,  status: 'WARN' },
  ];

  for (const { pattern, status } of dirPatterns) {
    const matches = content.match(pattern);
    if (!matches) continue;
    const unique = [...new Set(matches)];
    for (const ref of unique) {
      const refPath = join(baseDir, ref);
      if (existsSync(refPath)) {
        addResult(name, 'file-ref', 'PASS', `${ref} 存在確認OK`);
      } else {
        addResult(name, 'file-ref', status, `${ref} を参照していますが存在しません`);
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
    pattern.lastIndex = 0;
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

// シェル組み込みコマンド・構文キーワードの除外リスト
// インラインバッククォートは対象外にしたため、英単語の大量除外は不要
const CMD_EXCLUDE = new Set([
  // シェル組み込みコマンド・構文キーワード
  'for', 'done', 'then', 'else', 'elif', 'fi', 'if', 'do', 'while',
  'case', 'esac', 'in', 'eval', 'exec', 'export', 'source', 'local',
  'declare', 'trap', 'wait', 'shift', 'unset', 'readonly', 'typeset',
  'getopts', 'alias', 'echo', 'printf', 'test', 'true', 'false',
  'cd', 'pwd', 'pushd', 'popd', 'dirs', 'bg', 'fg', 'jobs', 'kill',
  'umask', 'ulimit', 'read', 'builtin', 'command', 'type', 'hash',
  'enable', 'let', 'shopt', 'return', 'exit',
  // awk 組み込み
  'next', 'print', 'printf', 'getline', 'split', 'match', 'index', 'substr', 'gsub', 'gensub',
]);

function checkCommandReferences(name, content) {
  const knownCommands = new Set();

  // 一般的なシステムコマンドは検証対象外
  const systemCmds = new Set([
    'git', 'npm', 'npx', 'node', 'python', 'python3', 'pip', 'bash', 'sh',
    'cat', 'ls', 'cd', 'cp', 'mv', 'rm', 'mkdir', 'echo', 'grep', 'find',
    'curl', 'wget', 'chmod', 'touch', 'head', 'tail', 'sort', 'sed', 'awk',
    'cargo', 'go', 'java', 'ruby', 'php', 'docker', 'make', 'cmake',
    'pnpm', 'bun', 'yarn', 'deno', 'tsx', 'tsc', 'eslint', 'prettier',
    'pytest', 'jest', 'vitest', 'ruff', 'black', 'mypy',
  ]);

  /**
   * コマンド名を候補セットに追加するヘルパー
   * - 小文字英字またはハイフンで構成される4文字以上30文字未満の文字列
   * - CMD_EXCLUDE / systemCmds に含まれるものはスキップ
   * - アンダースコアを含む識別子（awk変数等）はスキップ
   * - 変数代入（var=value）はスキップ
   */
  function addCmd(raw) {
    // セミコロン・&&・||・バックグラウンド & で区切られた最初のトークンを取得
    const segment = raw.trim().replace(/^\$\s*/, '').split(/[\s|;&]/)[0];
    const cmd = segment.split('=')[0]; // 変数代入 (FOO=bar) を除去
    if (
      /^[a-z][a-z0-9-]*$/.test(cmd) && // アンダースコア含む識別子は除外
      cmd.length > 3 &&
      cmd.length < 30 &&
      !CMD_EXCLUDE.has(cmd) &&
      !systemCmds.has(cmd)
    ) {
      knownCommands.add(cmd);
    }
  }

  /**
   * パイプで区切られた各セグメントのコマンドを追加するヘルパー
   * - クォート（シングル・ダブル）内の | はシェルパイプではないためスキップ
   * - パイプ後のセグメントは先頭トークン（コマンド名）のみ処理
   */
  function addCmdWithPipes(line) {
    addCmd(line);
    // クォート内のパイプを除外するため、クォートを除去してからパイプ分割
    const stripped = line.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
    const pipeSegments = stripped.split('|');
    for (let i = 1; i < pipeSegments.length; i++) {
      // パイプ後の先頭コマンドのみ（オプション引数はスキップ）
      const pipeCmd = pipeSegments[i].trim().split(/\s/)[0];
      addCmd(pipeCmd);
    }
  }

  // --- 抽出元1: コードフェンスブロック（bash/sh/shell/zsh/console） ---
  // インラインバッククォートは意図的にスキップ（用語囲みとコマンドを区別不可のため）
  const fencePattern = /^```(?:bash|sh|shell|zsh|console)[^\n]*\n([\s\S]*?)^```/gm;
  let fenceMatch;
  while ((fenceMatch = fencePattern.exec(content)) !== null) {
    const blockLines = fenceMatch[1].split('\n');
    for (const line of blockLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // 変数代入行・awk/sed スクリプト内の識別子行はスキップ
      if (/^\w+=/.test(trimmed)) continue; // 変数代入行
      addCmdWithPipes(trimmed);
    }
  }

  // --- 抽出元2: コードブロック外の $ プレフィックス行（実行例）---
  // コードフェンス内は上記で処理済みなので、フェンス外の行に限定
  // 簡易的に「$ 」で始まる行をドキュメント内の実行例とみなす
  const dollarLinePattern = /^\s*\$\s+([^\n]+)/gm;
  let dollarMatch;
  while ((dollarMatch = dollarLinePattern.exec(content)) !== null) {
    addCmdWithPipes(dollarMatch[1]);
  }

  // --- 存在チェック ---
  for (const cmd of knownCommands) {
    if (commandExists(cmd)) {
      addResult(name, 'cmd-ref', 'PASS', `コマンド「${cmd}」がPATHに存在`);
    } else {
      addResult(name, 'cmd-ref', 'WARN', `コマンド「${cmd}」がPATHに見つかりません（インストール要確認）`);
    }
  }
}

// --- チェック5: パス参照検証 ---
function checkPathReferences(name, content) {
  const isWindows = process.platform === 'win32';

  // 絶対パス参照
  const absPaths = content.match(/(?:C:[\\/]|\/(?:home|Users|usr|opt|etc|var)[\\/])[\w/.\\-]+/g);
  if (absPaths) {
    const unique = [...new Set(absPaths)].map(p => p.replace(/\\/g, '/'));
    for (const p of unique) {
      // サンプル/例文っぽいパスは除外
      if (p.includes('example') || p.includes('your-') || p.includes('username')) continue;

      // OS固有パスのスキップ判定
      const isLinuxPath = p.startsWith('/etc/') || p.startsWith('/usr/') ||
                          p.startsWith('/home/') || p.startsWith('/opt/') ||
                          p.startsWith('/var/');
      const isWindowsPath = /^[A-Za-z]:[\\/]/.test(p);

      if (isWindows && isLinuxPath) {
        // Windows環境でLinuxパスは除外（セキュリティスキル教材パス等のノイズ解消）
        if (verbose) addResult(name, 'path-ref', 'PASS', `他OS固有パスのためスキップ: ${p}`);
        continue;
      }
      if (!isWindows && isWindowsPath) {
        // Linux/macOS環境でWindowsパスは除外
        if (verbose) addResult(name, 'path-ref', 'PASS', `他OS固有パスのためスキップ: ${p}`);
        continue;
      }

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
    } catch { /* package.json のパース失敗は無視 */ }
  }

  // .git ディレクトリがあれば remote を確認
  const gitDir = join(baseDir, '.git');
  if (!sourceUrl && existsSync(gitDir)) {
    try {
      sourceUrl = execFileSync('git', ['-C', baseDir, 'remote', 'get-url', 'origin'], {
        encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch { /* リモートURL取得失敗（リモートなし等）は無視 */ }
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
        localSha = execFileSync('git', ['-C', baseDir, 'rev-parse', 'HEAD'], {
          encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch { /* HEAD SHA取得失敗（空リポジトリ等）は無視 */ }
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

    if (fails.length > 0) failedTargets.push(target);

    // quiet モード: FAILがなければスキップ
    if (quiet && fails.length === 0) continue;
    // 通常モード: 問題がないスキルは非verboseでスキップ
    if (!quiet && !verbose && fails.length === 0 && warns.length === 0) continue;

    console.log(`\n📦 ${target}`);
    for (const c of checks) {
      if (!verbose && c.status === 'PASS') continue;
      // quiet モード: WARNは表示しない（サマリーのみ）
      if (quiet && c.status === 'WARN') continue;
      console.log(`  ${statusIcon[c.status]} [${c.check}] ${c.message}`);
    }
  }

  // サマリー
  console.log('\n' + '='.repeat(60));
  console.log(`📊 スキャン結果サマリー`);
  console.log(`  対象ディレクトリ: ${claudeDir}`);
  console.log(`  チェック総数: ${results.length}`);
  console.log(`  ✅ PASS: ${totalPass}  ⚠️ WARN: ${totalWarn}  ❌ FAIL: ${totalFail}`);

  // frontmatter WARN の件数サマリー（--strict なしの場合）
  if (!strict && frontmatterWarnCount > 0) {
    console.log(`  ℹ️  frontmatter警告: ${frontmatterWarnCount}件（--strictで詳細表示）`);
  }

  // quiet モード: WARN件数のみサマリーに出す
  if (quiet && totalWarn > 0) {
    console.log(`  ℹ️  WARN: ${totalWarn}件（--quietのため詳細非表示）`);
  }

  if (failedTargets.length > 0) {
    console.log(`\n  ❌ 要修正 (${failedTargets.length}件):`);
    for (const t of failedTargets) {
      console.log(`    - ${t}`);
    }
  }

  if (totalFail === 0 && totalWarn === 0 && frontmatterWarnCount === 0) {
    console.log('\n  🎉 全スキル健全！問題は見つかりませんでした。');
  }

  // npmバージョンチェック（--no-version-check / --json / --quiet では非表示）
  if (!noVersionCheck && !jsonOutput) {
    const current = getCurrentVersion();
    if (current) {
      const latest = getLatestVersion();
      if (latest && isNewer(current, latest)) {
        console.log(`\n  💡 新バージョン v${latest} が利用可能です（現在 v${current}）`);
        console.log(`     更新: npm install -g claude-skill-validator@latest`);
      }
    }
  }

  console.log('');
}

// --- メイン ---

async function main() {
  // --self-update: ツール自身を更新して終了
  if (selfUpdateMode) {
    await selfUpdate();
    return;
  }

  // --update のみの場合はスキャンをスキップしてアップデートのみ実行
  if (updateMode && skillsOnly) {
    await applyUpdates();
    return;
  }

  if (!commandsOnly) await scanSkills();
  if (!skillsOnly) scanCommands();
  printResults();

  // 修正モード
  if (fixMode || dryRun) {
    applyFixes();
  }

  // アップデート適用モード（--update）
  if (updateMode) {
    await applyUpdates();
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
