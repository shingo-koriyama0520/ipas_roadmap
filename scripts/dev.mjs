import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { handlePublic as handle } from '../lib/public-api.mjs';
import { importQuestions } from '../lib/importer.mjs';
import { selectMvpQuestions } from './mvp-data.mjs';
const mvp = process.argv.includes('--mvp');
mkdirSync('.local', { recursive: true });
if (mvp) mkdirSync('.local/mvp-2026', { recursive: true });
const sqlite = new DatabaseSync(mvp ? '.local/mvp-2026/app.sqlite' : '.local/app.sqlite');
sqlite.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
let previewQuestions;
if (mvp) {
  previewQuestions = selectMvpQuestions(
    JSON.parse(readFileSync('data/repair/2026/questions-repaired.json', 'utf8')),
    JSON.parse(readFileSync('data/repair/2026/quality-decisions.json', 'utf8')),
  );
  const counts = importQuestions(sqlite, previewQuestions);
  if (counts.total !== 98) throw new Error('Unexpected rows in isolated MVP database');
  console.log(`Private MVP database: ${counts.total} review-only questions; no human approvals`);
}
function prepared(sql) {
  let args = [];
  return {
    bind(...v) {
      args = v;
      return this;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args) };
    },
    async first() {
      return sqlite.prepare(sql).get(...args) || null;
    },
    async run() {
      return sqlite.prepare(sql).run(...args);
    },
  };
}
const DB = {
  prepare: prepared,
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const r = [];
      for (const s of statements) r.push(await s.run());
      sqlite.exec('COMMIT');
      return r;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  },
};
const port = Number(process.env.PORT || (mvp ? 8789 : 8788)),
  origin = `http://127.0.0.1:${port}`;
const env = {
  DB,
  LOCAL_DEVELOPMENT: true,
  mailbox: new Map(),
  APP_ORIGIN: origin,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS || '',
  ...(mvp ? { PREVIEW_QUESTION_IDS: new Set(previewQuestions.map((q) => q.id)) } : {}),
};
http
  .createServer(async (req, res) => {
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        res.writeHead(403);
        res.end('Local origin required');
        return;
      }
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        let size = 0;
        for await (const b of req) {
          size += b.length;
          if (size > 50000) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(b);
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers))
          if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
        const response = await handle(
          new Request(url, {
            method: req.method,
            headers,
            ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
          }),
          env,
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      const file = path.resolve(
        'public',
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
      );
      if (!file.startsWith(path.resolve('public') + path.sep) || !existsSync(file)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(file);
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.mjs': 'text/javascript; charset=utf-8',
          '.svg': 'image/svg+xml',
        }[ext] || 'application/octet-stream',
      );
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      res.end(readFileSync(file));
    } catch (e) {
      console.error(e.message);
      res.writeHead(500);
      res.end('Server error');
    }
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`Local preview: ${origin} (development email inbox enabled; loopback only)`),
  );
