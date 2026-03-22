/**
 * skill-validator.test.mjs — integration tests for skill-validator.js
 *
 * Uses node:test + node:assert/strict + spawnSync (no external dependencies).
 * Each test spawns a fresh process to avoid shared state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALIDATOR = join(__dirname, '..', 'skill-validator.js');

/** spawnSync wrapper — always returns { status, stdout, stderr } as strings */
function run(args = [], opts = {}) {
  const result = spawnSync(process.execPath, [VALIDATOR, ...args], {
    encoding: 'utf-8',
    timeout: 15000,
    ...opts,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Create a minimal temporary ~/.claude-like directory for scan tests */
function makeTempClaudeDir(opts = {}) {
  const base = mkdtempSync(join(tmpdir(), 'sv-test-'));
  const skillsDir = join(base, 'skills');
  const cmdsDir = join(base, 'commands');
  mkdirSync(skillsDir);
  mkdirSync(cmdsDir);

  if (opts.withSkill) {
    const skillDir = join(skillsDir, 'test-skill');
    mkdirSync(skillDir);
    // Valid SKILL.md with proper frontmatter
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: A test skill for unit testing\n---\n\nDoes nothing.\n'
    );
  }

  if (opts.withInvalidSkill) {
    const skillDir = join(skillsDir, 'bad-skill');
    mkdirSync(skillDir);
    // SKILL.md with no frontmatter — triggers WARN
    writeFileSync(join(skillDir, 'SKILL.md'), '# bad-skill\n\nNo frontmatter here.\n');
  }

  if (opts.withSyntaxError) {
    const skillDir = join(skillsDir, 'syntax-bad');
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: syntax-bad\ndescription: Has broken script\n---\n'
    );
    const scriptsDir = join(skillDir, 'scripts');
    mkdirSync(scriptsDir);
    writeFileSync(join(scriptsDir, 'broken.js'), 'this is not valid javascript ===== !!!');
  }

  if (opts.withFileRef) {
    const skillDir = join(skillsDir, 'fileref-skill');
    mkdirSync(skillDir);
    // References a file that does not exist → FAIL
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: fileref-skill\ndescription: Has broken file ref\n---\n\nSee INSTRUCTIONS.md for details.\n'
    );
    writeFileSync(
      join(skillDir, 'INSTRUCTIONS.md'),
      'This skill uses scripts/nonexistent.sh\n'
    );
  }

  return base;
}

// ---------------------------------------------------------------------------
// --help / -h
// ---------------------------------------------------------------------------

describe('help flags', () => {
  it('--help exits 0 and shows Usage', () => {
    const r = run(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage/i);
  });

  it('-h is equivalent to --help', () => {
    const r = run(['-h']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage/i);
  });
});

// ---------------------------------------------------------------------------
// --json output contract
// ---------------------------------------------------------------------------

describe('--json output', () => {
  it('outputs parseable JSON with required fields', () => {
    const dir = makeTempClaudeDir({ withSkill: true });
    try {
      const r = run(['--dir', dir, '--json', '--no-version-check']);
      // exit 0 (no FAILs in valid skill)
      assert.equal(r.status, 0);
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); }, 'stdout must be valid JSON');
      assert.ok('total' in parsed, 'must have "total"');
      assert.ok('pass' in parsed, 'must have "pass"');
      assert.ok('warn' in parsed, 'must have "warn"');
      assert.ok('fail' in parsed, 'must have "fail"');
      assert.ok('results' in parsed, 'must have "results"');
      assert.ok(Array.isArray(parsed.results), '"results" must be an array');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Default scan (requires ~/.claude to exist — assumed on dev machines)
// ---------------------------------------------------------------------------

describe('default scan', () => {
  it('exits 0 or 1 (not 2) when scanning ~/.claude', () => {
    const r = run(['--no-version-check']);
    // exit 2 means a tool error — that must never happen when ~/.claude exists
    assert.notEqual(r.status, 2, `Tool error: ${r.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// --skills-only / --commands-only
// ---------------------------------------------------------------------------

describe('scope flags', () => {
  it('--skills-only exits 0 or 1', () => {
    const dir = makeTempClaudeDir({ withSkill: true });
    try {
      const r = run(['--dir', dir, '--skills-only', '--no-version-check']);
      assert.notEqual(r.status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--commands-only exits 0 or 1', () => {
    const dir = makeTempClaudeDir({ withSkill: true });
    try {
      const r = run(['--dir', dir, '--commands-only', '--no-version-check']);
      assert.notEqual(r.status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// --dir with non-existent path
// ---------------------------------------------------------------------------

describe('--dir with missing path', () => {
  it('prints error to stderr when skills/ is absent', () => {
    const r = run(['--dir', '/nonexistent-path-99999999', '--no-version-check']);
    // stderr should mention the missing directory
    const combined = r.stdout + r.stderr;
    assert.match(combined, /skills.*見つかりません|skills.*not found/i);
  });
});

// ---------------------------------------------------------------------------
// --verbose
// ---------------------------------------------------------------------------

describe('--verbose', () => {
  it('includes PASS results in output', () => {
    const dir = makeTempClaudeDir({ withSkill: true });
    try {
      const r = run(['--dir', dir, '--verbose', '--no-version-check']);
      assert.match(r.stdout, /PASS|✅/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// --quiet
// ---------------------------------------------------------------------------

describe('--quiet', () => {
  it('does not show WARN lines (only summary)', () => {
    const dir = makeTempClaudeDir({ withInvalidSkill: true });
    try {
      // Without --quiet, WARN should appear somewhere; with --quiet it should not
      const withQuiet = run(['--dir', dir, '--quiet', '--no-version-check', '--strict']);
      // WARN icon should not appear in main output (may appear in summary count)
      // We check that individual ⚠️ lines are not in per-skill section
      // The easiest proxy: no "⚠️ [" pattern (which is the per-result format)
      assert.doesNotMatch(withQuiet.stdout, /⚠️ \[/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// --dry-run
// ---------------------------------------------------------------------------

describe('--dry-run', () => {
  it('exits 0 when combined with scan (no crash)', () => {
    const dir = makeTempClaudeDir({ withSkill: true });
    try {
      const r = run(['--dir', dir, '--dry-run', '--no-version-check']);
      // --dry-run should not crash (exit 2 is a tool error)
      assert.notEqual(r.status, 2, `Tool error: ${r.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includes [dry-run] marker when there are fixable issues', () => {
    // Create a skill with a deprecated tool reference that can be fixed
    const base = mkdtempSync(join(tmpdir(), 'sv-test-'));
    const skillsDir = join(base, 'skills');
    const cmdsDir = join(base, 'commands');
    mkdirSync(skillsDir);
    mkdirSync(cmdsDir);
    const skillDir = join(skillsDir, 'fixable-skill');
    mkdirSync(skillDir);
    // Use a deprecated tool reference that the fixer will pick up
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: fixable-skill\ndescription: Has deprecated tool ref\n---\n\nUse mcp__claude-in-chrome__tabs_context_mcp for tabs.\n'
    );
    try {
      const r = run(['--dir', base, '--fix', '--dry-run', '--no-version-check']);
      // [dry-run] marker must appear when there are fixable items
      assert.match(r.stdout, /\[dry-run\]/i);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// --no-version-check
// ---------------------------------------------------------------------------

describe('--no-version-check', () => {
  it('suppresses version notification line', () => {
    const dir = makeTempClaudeDir({ withSkill: true });
    try {
      const r = run(['--dir', dir, '--no-version-check']);
      // The version check outputs "💡 新バージョン" when a newer version exists
      // With --no-version-check it must be absent
      assert.doesNotMatch(r.stdout, /新バージョン/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Frontmatter validation (temp skill dir)
// ---------------------------------------------------------------------------

describe('frontmatter check', () => {
  it('valid skill with proper frontmatter → exit 0', () => {
    const dir = makeTempClaudeDir({ withSkill: true });
    try {
      const r = run(['--dir', dir, '--skills-only', '--no-version-check']);
      assert.equal(r.status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skill without frontmatter → WARN appears in JSON (with --strict)', () => {
    const dir = makeTempClaudeDir({ withInvalidSkill: true });
    try {
      const r = run(['--dir', dir, '--skills-only', '--json', '--strict', '--no-version-check']);
      const parsed = JSON.parse(r.stdout);
      const warns = parsed.results.filter(x => x.status === 'WARN');
      assert.ok(warns.length > 0, 'expected at least one WARN for missing frontmatter');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Syntax error detection (temp skill with broken script)
// ---------------------------------------------------------------------------

describe('syntax check', () => {
  it('broken JS script → FAIL and exit 1', () => {
    const dir = makeTempClaudeDir({ withSyntaxError: true });
    try {
      const r = run(['--dir', dir, '--skills-only', '--no-version-check']);
      assert.equal(r.status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
