import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateQuestions, importQuestions, generateSql } from '../lib/importer.mjs';

export function main(args = process.argv.slice(2)) {
  const options = {
    input: 'data/questions-staging.json',
    db: '.local/app.sqlite',
    out: '.local/import',
    validateOnly: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--validate-only') options.validateOnly = true;
    else if (
      ['--input', '--db', '--out'].includes(arg) &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    )
      options[arg.slice(2)] = args[++i];
    else if (i === 0 && !arg.startsWith('--')) options.input = arg;
    else throw new Error(`Unknown or missing argument: ${arg}`);
  }
  const input = readFileSync(options.input);
  const rows = JSON.parse(input.toString('utf8').replace(/^\uFEFF/, ''));
  const result = validateQuestions(rows);
  const sha256 = createHash('sha256').update(input).digest('hex');
  // A rejected input never reuses a previous input's SQL.
  const folder = resolve(options.out, sha256);
  mkdirSync(folder, { recursive: true });
  const report = {
    input: resolve(options.input),
    sha256,
    ...result.summary,
    rejectedRecords: result.rejected,
    mode: options.validateOnly ? 'validate-only' : 'local-import',
    generatedAt: new Date().toISOString(),
  };
  const reportFile = resolve(folder, 'validation.json');
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...result.summary, sha256, report: reportFile }, null, 2));
  if (result.rejected.length || !result.accepted.length)
    throw new Error(
      'Import blocked: invalid or empty input. See validation.json. No database writes or SQL generated.',
    );
  if (options.validateOnly) return report;

  const schema = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
  const sql = generateSql(result.accepted);
  // Verify the exact generated SQL, including repeat execution, in an isolated database.
  const sandbox = new DatabaseSync(':memory:');
  try {
    sandbox.exec(schema);
    sandbox.exec(sql);
    sandbox.exec(sql);
    if (sandbox.prepare('SELECT COUNT(*) AS n FROM questions').get().n !== result.accepted.length)
      throw new Error('Generated SQL verification failed');
    if (sandbox.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Generated SQL foreign key check failed');
  } finally {
    sandbox.close();
  }

  mkdirSync(dirname(resolve(options.db)), { recursive: true });
  if (existsSync(options.db)) {
    const existing = new DatabaseSync(options.db);
    try {
      existing.prepare('VACUUM INTO ?').run(resolve(folder, `local-before-${Date.now()}.sqlite`));
    } finally {
      existing.close();
    }
  }
  const db = new DatabaseSync(options.db);
  try {
    db.exec(schema);
    report.local = importQuestions(db, result.accepted);
    const sqlPath = resolve(folder, 'questions.sql');
    writeFileSync(sqlPath, sql);
    report.sql = {
      path: sqlPath,
      sha256: createHash('sha256').update(sql).digest('hex'),
      verifiedTwice: true,
    };
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ local: report.local, sql: report.sql }, null, 2));
  } finally {
    db.close();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
