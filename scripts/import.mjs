import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { publishable } from '../lib/domain.mjs';
mkdirSync('.local', { recursive: true });
const db = new DatabaseSync('.local/app.sqlite');
db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
const rows = JSON.parse(readFileSync(process.argv[2] || 'data/questions-staging.json', 'utf8'));
const insert = db.prepare(
  'INSERT INTO questions(id,year,number,prompt,choices,answer,domain,status,explanation_status,explanation,reviewer,reviewed_at,source,issues) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET prompt=excluded.prompt,choices=excluded.choices,answer=excluded.answer,domain=excluded.domain,status=excluded.status,explanation_status=excluded.explanation_status,explanation=excluded.explanation,reviewer=excluded.reviewer,reviewed_at=excluded.reviewed_at,source=excluded.source,issues=excluded.issues',
);
const sql = [];
const quote = (x) =>
  x === null ? 'NULL' : typeof x === 'number' ? String(x) : "'" + x.replaceAll("'", "''") + "'";
db.exec('BEGIN');
try {
  for (const q of rows) {
    if (q.status === 'published' && !publishable(q)) throw Error(`公開要件不足: ${q.id}`);
    const v = [
      q.id,
      q.year,
      q.number,
      q.prompt,
      JSON.stringify(q.choices),
      q.answer,
      q.domain,
      q.status,
      q.explanation_status,
      q.explanation ? JSON.stringify(q.explanation) : null,
      q.reviewer || null,
      q.reviewed_at || null,
      JSON.stringify({
        question_pdf: q.question_pdf,
        page: q.page,
        answer_pdf: q.answer_pdf,
        answer_page: q.answer_page,
      }),
      JSON.stringify(q.issues || []),
    ];
    insert.run(...v);
    sql.push('INSERT OR REPLACE INTO questions VALUES(' + v.map(quote).join(',') + ');');
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
const { writeFileSync } = await import('node:fs');
writeFileSync('data/import.sql', sql.join('\n'));
console.log(`Imported ${rows.length}; publishable ${rows.filter(publishable).length}`);
db.close();
