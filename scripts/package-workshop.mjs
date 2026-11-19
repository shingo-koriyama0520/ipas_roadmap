import {
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateQuestions } from '../lib/importer.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const rows = [2024, 2025, 2026].flatMap((year) =>
  JSON.parse(readFileSync(`data/repair/${year}/questions-repaired.json`, 'utf8')),
);
const checked = validateQuestions(rows);
if (
  checked.rejected.length ||
  rows.length !== 300 ||
  rows.some(
    (q) =>
      q.status !== 'needs_review' ||
      q.explanation_status !== 'needs_review' ||
      q.reviewer ||
      q.reviewed_at,
  )
)
  throw new Error('Expected 300 valid questions with pending human review');

// A new folder for every build: never include an existing learner database or history.
mkdirSync('.local/distribution', { recursive: true });
const build = mkdtempSync(resolve('.local/distribution/build-'));
const target = join(build, 'it-passport-workshop');
for (const folder of ['public', 'lib', 'scripts', 'migrations', 'workshop', 'docs', '教材'])
  mkdirSync(join(target, folder), { recursive: true });
for (const folder of ['public', 'lib']) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error(`Unexpected directory in ${folder}: ${entry.name}`);
    copyFileSync(join(folder, entry.name), join(target, folder, entry.name));
  }
}
for (const name of [
  'dev.mjs',
  'workshop-start.mjs',
  'workshop-tools.mjs',
  'import.mjs',
  'mvp-data.mjs',
])
  copyFileSync(`scripts/${name}`, join(target, 'scripts', name));
copyFileSync('migrations/0001_init.sql', join(target, 'migrations/0001_init.sql'));
writeFileSync(
  join(target, 'docs/architecture.md'),
  readFileSync('docs/architecture.md', 'utf8').replace(
    '詳しい既存の説明： [公開MVP](public-mvp.md) ／ [データ投入](d1-import.md)',
    '配布版の操作手順： [受講生用手順](workshop-student.md)',
  ),
);
copyFileSync('docs/workshop-student.md', join(target, 'docs/workshop-student.md'));
copyFileSync('docs/workshop-student.md', join(target, 'はじめに.md'));
copyFileSync(
  'docs/workshop-troubleshooting.md',
  join(target, '教材/ローカル環境_起動トラブル対処手順.md'),
);

const data = JSON.stringify(rows, null, 2) + '\n';
writeFileSync(join(target, 'workshop/questions.json'), data);
writeFileSync(
  join(target, 'workshop/manifest.json'),
  JSON.stringify(
    {
      count: rows.length,
      years: checked.summary.years,
      humanReview: 'pending',
      sha256: createHash('sha256').update(data).digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
const index = readFileSync(join(target, 'public/index.html'), 'utf8').replace(
  '2025・2026年度の合計200問を提供しています。',
  '勉強会ローカル版：2024～2026年度の300問を収録しています。問題・AI生成解説は人による確認待ちです。',
);
writeFileSync(join(target, 'public/index.html'), index);
writeFileSync(
  join(target, 'package.json'),
  JSON.stringify(
    {
      name: 'it-passport-workshop',
      private: true,
      type: 'module',
      engines: { node: '>=22.13' },
      scripts: {
        start: 'node scripts/workshop-start.mjs',
        'db:validate': 'node scripts/import.mjs --validate-only --input workshop/questions.json',
      },
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(target, '起動.cmd'),
  [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo Node.js is required. Please install Node.js 22.13 or later.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo Open http://127.0.0.1:8790 after Local preview appears.',
    'echo Press Ctrl+C to stop the server.',
    'node scripts/workshop-start.mjs',
    'pause',
    '',
  ].join('\r\n'),
);
for (const [filename, mode] of [
  ['環境チェック.cmd', 'check'],
  ['起動ログ.cmd', 'log'],
]) {
  writeFileSync(
    join(target, filename),
    [
      '@echo off',
      'setlocal',
      'chcp 65001 >nul',
      'cd /d "%~dp0"',
      'if not exist ".local\\logs" mkdir ".local\\logs"',
      'if not exist ".local\\logs" goto write_error',
      `set "bootstrap=.local\\logs\\${mode}-bootstrap.log"`,
      '> "%bootstrap%" echo Workshop bootstrap %date% %time%',
      'where node >> "%bootstrap%" 2>&1',
      'if errorlevel 1 goto no_node',
      'node --version >> "%bootstrap%" 2>&1',
      'if not exist "scripts\\workshop-tools.mjs" goto missing_files',
      `node scripts/workshop-tools.mjs ${mode}`,
      'set "result=%errorlevel%"',
      'echo If the check failed, share files in .local\\logs with your instructor.',
      'pause',
      'exit /b %result%',
      ':no_node',
      'echo [FAIL E_NODE_MISSING] Node.js was not found.',
      '>> "%bootstrap%" echo [FAIL E_NODE_MISSING] Node.js was not found.',
      'echo Install Node.js 22.13 or later, then open this file again.',
      'echo Log: %bootstrap%',
      'pause',
      'exit /b 1',
      ':missing_files',
      'echo [FAIL E_FILES] Extract the entire ZIP before running.',
      '>> "%bootstrap%" echo [FAIL E_FILES] Missing scripts/workshop-tools.mjs.',
      'echo Log: %bootstrap%',
      'pause',
      'exit /b 1',
      ':write_error',
      'echo [FAIL E_WRITE] Cannot create .local/logs.',
      'echo Extract the ZIP into a writable folder. Take a screenshot of this message.',
      'pause',
      'exit /b 1',
      '',
    ].join('\r\n'),
  );
}
console.log(target);
