// Learning availability is explicitly authorized independently of human content approval.
// This handler has no database write path and never returns source/OCR/reviewer data.
export async function handlePublic(request, env) {
  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  if (request.method !== 'GET') return reply({ error: '読み取り専用APIです' }, 405);
  const path = new URL(request.url).pathname.replace(/^\/api/, '');
  // Enabled only by the separate local workshop server, never by request parameters.
  const workshop = env.LOCAL_WORKSHOP === true;
  const years = workshop ? 'year BETWEEN 2021 AND 2026' : 'year IN (2025,2026)';
  const eligible = `${years} AND number BETWEEN 1 AND 100 AND id=printf('%d-%03d',year,number) AND status='needs_review' AND explanation_status='needs_review' AND reviewer IS NULL AND reviewed_at IS NULL`;
  try {
    if (path === '/catalog') {
      const { results } = await env.DB.prepare(
        `SELECT id,year,number,domain FROM questions WHERE ${eligible} ORDER BY year DESC,number`,
      ).all();
      return reply({
        questions: results,
        count: results.length,
        contentApproval: 'pending',
        learningAvailable: true,
      });
    }
    const match = path.match(
      workshop
        ? /^\/questions\/(202[1-6]-\d{3})(\/solution)?$/
        : /^\/questions\/(202[56]-\d{3})(\/solution)?$/,
    );
    if (!match) return reply({ error: '公開されていないAPIです' }, 404);
    const columns = match[2] ? 'answer,explanation' : 'id,year,number,domain,prompt,choices';
    const q = await env.DB.prepare(`SELECT ${columns} FROM questions WHERE ${eligible} AND id=?`)
      .bind(match[1])
      .first();
    if (!q) return reply({ error: '問題が見つかりません' }, 404);
    if (match[2]) return reply({ answer: q.answer, explanation: JSON.parse(q.explanation) });
    return reply({ ...q, choices: JSON.parse(q.choices) });
  } catch {
    return reply({ error: '問題を取得できませんでした。再度お試しください' }, 500);
  }
}
