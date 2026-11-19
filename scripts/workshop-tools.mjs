import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const mode = process.argv[2];
if (!['check', 'log'].includes(mode)) throw new Error('Expected check or log');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let log;
try {
  mkdirSync('.local/logs', { recursive: true });
  log = resolve(
    '.local/logs',
    `${mode === 'check' ? 'environment' : 'startup'}-${stamp}-${process.pid}.log`,
  );
  writeFileSync(log, '', 'utf8');
} catch (error) {
  console.error(`[FAIL E_WRITE] Cannot create .local/logs: ${error.message}`);
  console.error('Extract the ZIP into a writable folder. See the troubleshooting guide.');
  process.exit(1);
}
function report(line) {
  console.log(line);
  appendFileSync(log, line + '\n', 'utf8');
}
let failures = 0;
const fail = (code, detail) => {
  failures++;
  report(`[FAIL ${code}] ${detail}`);
};
report(`Workshop ${mode} / ${new Date().toISOString()}`);
report(`OS: ${process.platform} ${process.arch}; Node: ${process.version}`);
report(`Node path: ${process.execPath}`);
report(`Folder: ${root}`);
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 13);
if (supported) report('[PASS] Node.js version');
else fail('E_NODE_VERSION', 'Node.js 22.13 or later is required.');

const required = [
  'public/index.html',
  'public/app.js',
  'public/learning.mjs',
  'public/style.css',
  'scripts/workshop-start.mjs',
  'scripts/dev.mjs',
  'scripts/mvp-data.mjs',
  'lib/public-api.mjs',
  'lib/domain.mjs',
  'lib/importer.mjs',
  'lib/question-quality.mjs',
  'migrations/0001_init.sql',
  'workshop/questions.json',
];
const missing = required.filter((file) => !existsSync(file));
if (missing.length) fail('E_FILES', `Missing files: ${missing.join(', ')}`);
else report('[PASS] Required files');
const probe = join(root, '.local', `write-check-${process.pid}-${stamp}.tmp`);
try {
  writeFileSync(probe, 'write check', { flag: 'wx' });
  unlinkSync(probe);
  mkdirSync('.local/workshop', { recursive: true });
  const dbProbe = join(root, '.local/workshop', `write-check-${process.pid}-${stamp}.tmp`);
  writeFileSync(dbProbe, 'write check', { flag: 'wx' });
  unlinkSync(dbProbe);
  report('[PASS] Database folder is writable');
} catch (error) {
  fail('E_WRITE', error.message);
}

let sqlite;
if (supported) {
  try {
    sqlite = await import('node:sqlite');
    report('[PASS] SQLite is available');
  } catch (error) {
    fail('E_SQLITE', error.message);
  }
  if (!missing.length) {
    try {
      const { validateQuestions } = await import('../lib/importer.mjs');
      const rows = JSON.parse(readFileSync('workshop/questions.json', 'utf8'));
      const result = validateQuestions(rows);
      if (
        !rows.length ||
        result.rejected.length ||
        rows.some(
          (q) =>
            q.status !== 'needs_review' ||
            q.explanation_status !== 'needs_review' ||
            q.reviewer ||
            q.reviewed_at,
        )
      )
        throw new Error(`Invalid or non-review input; rejected=${result.rejected.length}`);
      report(`[PASS] Question JSON: ${rows.length} records`);
    } catch (error) {
      fail('E_DATA', error.message);
    }
  }
}
if (sqlite && existsSync('.local/workshop/app.sqlite')) {
  let db;
  try {
    db = new sqlite.DatabaseSync('.local/workshop/app.sqlite', { readOnly: true });
    const rows = db.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok')
      throw new Error('Database integrity check failed');
    db.prepare('SELECT count(*) FROM questions').get();
    report('[PASS] Existing database can be read');
  } catch (error) {
    fail('E_DB', error.message);
  } finally {
    if (db) db.close();
  }
} else if (!existsSync('.local/workshop/app.sqlite'))
  report('[INFO] Database will be created on first start.');

const port = Number(process.env.PORT || 8790);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  fail('E_PORT', 'PORT must be an integer between 1 and 65535.');
else
  await new Promise((done) => {
    const server = net.createServer();
    server.once('error', (error) => {
      fail('E_PORT', `127.0.0.1:${port}: ${error.message}`);
      done();
    });
    server.listen(port, '127.0.0.1', () =>
      server.close(() => {
        report(`[PASS] Port ${port} is available`);
        done();
      }),
    );
  });
report(`Result: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failed checks)`);
report(`Log file: ${log}`);
if (failures) {
  report('See the troubleshooting guide in the teaching-materials folder.');
  process.exitCode = 1;
} else if (mode === 'log') {
  report(`Starting server. Open http://127.0.0.1:${port} after Local preview appears.`);
  report('Press Ctrl+C to stop. Output is also saved in this log.');
  // Run in the same process so logging does not require permission to spawn another process.
  for (const stream of [process.stdout, process.stderr]) {
    const originalWrite = stream.write.bind(stream);
    stream.write = (chunk, encoding, callback) => {
      appendFileSync(log, chunk, typeof encoding === 'string' ? encoding : 'utf8');
      return originalWrite(chunk, encoding, callback);
    };
  }
  try {
    await import('./workshop-start.mjs');
  } catch (error) {
    console.error(`[FAIL E_START] ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
