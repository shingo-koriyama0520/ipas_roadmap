import { createLearningClient } from './learning.mjs';
const api = createLearningClient(localStorage);
const $ = (s) => document.querySelector(s),
  app = $('#app');
const titles = [
  '初回診断・IT基礎',
  'コンピュータ・OS',
  'ネットワーク・データベース',
  '情報セキュリティ',
  '企業活動・法務',
  '経営戦略・システム戦略',
  'システム開発・プロジェクト管理',
  '3分野の総合演習',
  '苦手分野①',
  '苦手分野②',
  '過去問演習',
  '総合演習',
  '模擬試験',
  '最終復習・受験判定',
];
const esc = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
let examSize = 100,
  catalog = [],
  history = { answers: [], days: [], exams: [] },
  page = 'home',
  queue = [],
  index = 0,
  selected = null,
  feedback = null,
  exam = null,
  examIndex = 0,
  timer,
  renderId = 0;
const rate = (a) =>
  a.length ? Math.round((a.filter((x) => x.correct).length / a.length) * 100) : 0;
function toast(s) {
  $('#notice').textContent = s;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($('#notice').textContent = ''), 6000);
}
function metric(label, value, unit = '') {
  return /* HTML */ `
    <div class="metric">
      <p>${label}</p>
      <strong>${esc(value)}</strong>
      <small>${unit}</small>
    </div>
  `;
}
const day = () =>
  Math.min(
    14,
    Array.from({ length: 14 }, (_, i) => i + 1).find(
      (n) => !history.days.some((d) => d.day === n),
    ) || 14,
  );
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const todayAnswers = () =>
  history.answers.filter(
    (a) =>
      new Date(a.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) === today(),
  );
async function refresh() {
  [catalog, history] = await Promise.all([
    api('/catalog').then((v) => v.questions),
    api('/history'),
  ]);
}
function empty(title, text) {
  return /* HTML */ `
    <div class="card empty">
      <span class="symbol">▤</span>
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(text)}</p>
      <a class="secondary" href="#home">ホームに戻る</a>
    </div>
  `;
}
function weak() {
  const grouped = {};
  for (const a of history.answers) {
    const q = catalog.find((q) => q.id === a.question_id);
    if (q) (grouped[q.domain] ??= []).push(a);
  }
  return Object.entries(grouped).sort((a, b) => rate(a[1]) - rate(b[1]));
}
function home() {
  const d = day(),
    n = history.answers.length,
    t = todayAnswers().length;
  app.innerHTML = /* HTML */ `
    <div class="welcome">
      <div>
        <div class="eyebrow">YOUR LEARNING JOURNEY</div>
        <h1>今日も、ひとつずつ。</h1>
        <p class="muted">ITパスポートへの14日間。あなたのペースで進めましょう。</p>
      </div>
      <div class="date">
        ${new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'long' })}
      </div>
    </div>
    <div class="grid">
      <section>
        <div class="card hero">
          <div class="hero-top">
            <span class="tag">今日の学習プラン</span>
            <span class="muted">残り ${14 - history.days.length} 日分</span>
          </div>
          <div class="day">
            Day ${d}
            <small>/ 14</small>
          </div>
          <h2>${titles[d - 1]}</h2>
          <p class="muted">
            ${d === 1 ? 'まずは今の理解を知るところから。知らない言葉も、少しずつ身につけていきましょう。' : '未完了の学習から再開できます。復習を重ねて、理解を確かめましょう。'}
          </p>
          <div class="actions">
            <a class="primary" href="#study">
              ${n ? '学習を続ける' : '今日の学習をはじめる'}
              <span>→</span>
            </a>
          </div>
          <div class="progress"><span id="today-progress"></span></div>
          <div class="progress-row">
            <span>今日の回答 ${t} 問</span>
            <span>学習完了 ${history.days.length} / 14 日分</span>
          </div>
        </div>
        <div class="metrics">
          ${metric('累計回答数', n, '問')}${metric('累計正答率', n ? rate(history.answers) : '—', '%')}${metric('復習待ち', reviewCount(), '問')}
        </div>
        <div class="card">
          <div class="section-title">
            <h2>60分の、ちょうどいい一歩。</h2>
            <span class="pill">基本の時間配分</span>
          </div>
          <div class="allocation">
            <span>新規学習 35分</span>
            <span>復習 20分</span>
            <span>確認 5分</span>
          </div>
          <p class="muted">
            初回診断・模擬試験日は専用プラン。終わらなかった学習は、翌日以降に続けられます。
          </p>
          <button class="secondary" id="complete-day">今日の学習を完了する</button>
        </div>
      </section>
      <aside>
        <div class="card">
          <div class="section-title">
            <h2>14日間の道しるべ</h2>
            <span class="mini">CURRICULUM</span>
          </div>
          <ol class="plan">
            ${titles.map((x, i) => `<li class="${history.days.some((d) => d.day === i + 1) ? 'done' : i + 1 === d ? 'current' : ''}"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="label">${x}</span><span>${history.days.some((d) => d.day === i + 1) ? '✓' : i + 1 === d ? '●' : ''}</span></li>`).join('')}
          </ol>
        </div>
        <div class="card">
          <h3>苦手を、次の得意に。</h3>
          <p class="muted">
            ${weak().length ? esc(weak()[0][0]) + 'を中心に復習しましょう。' : '回答を重ねると、復習したい分野が見えてきます。'}
          </p>
          <a href="#review" class="text-button">復習に取り組む →</a>
        </div>
      </aside>
    </div>
    ${!catalog.length ? '<div class="callout">問題データを整備中です。確認が完了した問題・解説から提供します。合格を保証するものではありません。</div>' : ''}
  `;
  $('#today-progress').style.width = Math.min(100, (history.days.length / 14) * 100) + '%';
  if ($('#complete-day'))
    $('#complete-day').onclick = async () => {
      try {
        await api('/days/complete', { day: d });
        await refresh();
        home();
        toast('学習の完了を保存しました');
      } catch (e) {
        toast(e.message);
      }
    };
}
function reviewCount() {
  return new Set(history.answers.filter((a) => !a.correct).map((a) => a.question_id)).size;
}
async function study(review = false) {
  queue = review ? (await api('/review')).questions : [...catalog];
  index = 0;
  selected = null;
  feedback = null;
  if (!queue.length) {
    app.innerHTML = empty(
      review ? '復習待ちの問題はありません' : '問題データを準備しています',
      review
        ? '回答履歴や苦手分野に応じて復習問題を表示します。'
        : '確認済みの問題と解説が登録されると学習できます。',
    );
    return;
  }
  if (!review) {
    const unseen = queue.filter((q) => !history.answers.some((a) => a.question_id === q.id));
    queue = [...unseen, ...queue.filter((q) => !unseen.includes(q))];
  }
  question();
}
async function question() {
  const requestedRender = renderId;
  const requestedIndex = index;
  const requestedPage = page;
  const current = () =>
    renderId === requestedRender && index === requestedIndex && page === requestedPage;
  let q;
  try {
    q = await api('/questions/' + queue[index].id);
  } catch (error) {
    if (current()) app.innerHTML = empty('問題を取得できません', error.message);
    return;
  }
  if (!current()) return;
  app.innerHTML = /* HTML */ `
    <section class="question">
      <div class="eyebrow">
        ${page === 'review' ? 'REVIEW / 繰り返して、理解を深める' : 'DAILY PRACTICE / 今日の学習'}
      </div>
      <div class="progress-row">
        <span>${index + 1} / ${queue.length} 問</span>
        <span>${esc(q.domain)}</span>
      </div>
      <div class="card">
        <span class="tag">${q.year}年度 問${q.number}</span>
        <div class="question-text">${esc(q.prompt)}</div>
        <div class="choices">
          ${q.choices.map((c, i) => `<button class="choice ${selected === i ? 'selected' : ''} ${feedback?.answer === i ? 'correct' : ''}" data-choice="${i}" ${feedback ? 'disabled' : ''} aria-pressed="${selected === i}"><span class="letter">${'アイウエ'[i]}</span><span>${esc(c)}</span></button>`).join('')}
        </div>
        ${
          feedback
            ? /* HTML */ `
                <div class="result ${feedback.correct ? '' : 'wrong'}">
                  <h3>
                    ${feedback.correct ? '正解です' : 'もう一度、ポイントを確認しましょう'} · 正解
                    ${'アイウエ'[feedback.answer]}
                  </h3>
                  <ul>
                    ${feedback.explanation.reasons.map((r, i) => `<li><b>${'アイウエ'[i]}</b> ${esc(r)}</li>`).join('')}
                  </ul>
                  <p>
                    <b>重要用語</b>
                    ${feedback.explanation.terms.map(esc).join('・')}
                  </p>
                  <p>
                    <b>覚えるポイント</b>
                    ${esc(feedback.explanation.point)}
                  </p>
                </div>
              `
            : ''
        }
        <div class="actions">
          ${feedback ? '<button class="primary" id="next">次の問題へ →</button>' : `<button class="primary" id="confirm" ${selected === null ? 'disabled' : ''}>回答を確定する</button>`}
        </div>
        <p class="muted" id="save-status">
          ${feedback ? '回答を保存しました' : '確定するまで正解は表示されません。回答は自動保存されます。'}
        </p>
      </div>
    </section>
  `;
  document.querySelectorAll('[data-choice]').forEach(
    (b) =>
      (b.onclick = () => {
        selected = Number(b.dataset.choice);
        question();
      }),
  );
  if ($('#confirm')) $('#confirm').onclick = saveAnswer;
  if ($('#next'))
    $('#next').onclick = () => {
      if (index + 1 >= queue.length) {
        toast('今回の学習が終わりました');
        location.hash = 'stats';
      } else {
        index++;
        selected = null;
        feedback = null;
        question();
      }
    };
}
async function saveAnswer() {
  const btn = $('#confirm');
  btn.disabled = true;
  try {
    feedback = await api('/answers', {
      id: crypto.randomUUID(),
      question_id: queue[index].id,
      selected,
      mode: page === 'review' ? 'review' : 'study',
    });
    await refresh();
    await question();
  } catch (error) {
    toast(error.message);
    btn.disabled = false;
  }
}
function stats() {
  const h = history.answers;
  app.innerHTML = /* HTML */ `
    <div class="eyebrow">LEARNING INSIGHTS</div>
    <h1>積み重ねが、見えてくる。</h1>
    <p class="muted">正答率は回答数に基づく集計です。公式試験のIRT評価点ではありません。</p>
    <div class="metrics">
      ${metric('総回答数', h.length, '問')}${metric('総正答率', h.length ? rate(h) : '—', '%')}${metric('学習した日数', new Set(h.map((a) => new Date(a.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }))).size, '日')}
    </div>
    <div class="grid">
      <section>
        <div class="card">
          <h2>分野別の正答率</h2>
          <div class="bars">
            ${['ストラテジ', 'マネジメント', 'テクノロジ']
              .map((d) =>
                bar(
                  d,
                  h.filter((a) => catalog.find((q) => q.id === a.question_id)?.domain === d),
                ),
              )
              .join('')}
          </div>
        </div>
        <div class="card">
          <h2>正答率の推移</h2>
          <div id="trend" class="trend"></div>
          <p class="muted">
            初回10回答：${h.length ? rate(h.slice(0, 10)) + '%' : '—'} ／
            直近10回答：${h.length ? rate(h.slice(-10)) + '%' : '—'}
          </p>
        </div>
      </section>
      <aside>
        <div class="card">
          <h2>年度別の正答率</h2>
          <div class="bars">
            ${[2021, 2022, 2023, 2024, 2025, 2026]
              .map((y) =>
                bar(
                  y + '年度',
                  h.filter((a) => catalog.find((q) => q.id === a.question_id)?.year === y),
                ),
              )
              .join('')}
          </div>
        </div>
        <div class="card">
          <h2>復習の記録</h2>
          <p class="muted">
            復習で正解した回数：${h.filter((a) => a.mode === 'review' && a.correct).length}回
            <br />
            過去に間違えた問題も、引き続き復習できます。
          </p>
        </div>
      </aside>
    </div>
  `;
  for (const b of document.querySelectorAll('[data-rate]')) b.style.width = b.dataset.rate + '%';
  const groups = {};
  for (const a of h) {
    const d = new Date(a.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    (groups[d] ??= []).push(a);
  }
  for (const [date, a] of Object.entries(groups).slice(-14)) {
    const el = document.createElement('div');
    const i = document.createElement('i');
    i.style.height = rate(a) + 'px';
    i.title = date + ' ' + rate(a) + '%';
    const s = document.createElement('span');
    s.textContent = date.slice(5);
    el.append(i, s);
    $('#trend').append(el);
  }
  if (!h.length) $('#trend').textContent = '回答後に日別の推移を表示します。';
}
function bar(label, a) {
  return /* HTML */ `
    <div>
      <div class="bar-label">
        <span>${esc(label)}</span>
        <span>
          ${a.length ? rate(a) + '%' : '—'}
          <small>(${a.length}問)</small>
        </span>
      </div>
      <div class="bar-track"><div class="bar-fill" data-rate="${rate(a)}"></div></div>
    </div>
  `;
}
async function examStart() {
  const active = history.exams.find((e) => e.status !== 'submitted');
  app.innerHTML = /* HTML */ `
    <div class="eyebrow">MOCK EXAM</div>
    <h1>今の力を、確かめよう。</h1>
    <p class="muted">${examSize}問・120分。提出するまで正解は表示されません。</p>
    <div class="grid">
      <div class="card">
        <h2>自分に合った受け方で。</h2>
        <p>
          4択形式で、提出前は回答を変更できます。
          <br />
          分割形式は60分で自動中断し、残り60分を後日再開できます。
        </p>
        <label class="field">
          試験形式
          <select id="exam-format">
            <option value="full">120分でまとめて受験</option>
            <option value="split">60分ずつ2回に分ける</option>
          </select>
        </label>
        <button
          class="primary"
          id="exam-start"
          ${!active && catalog.length < examSize ? 'disabled' : ''}
        >
          ${active ? '中断中の試験を開く' : '模擬試験をはじめる'} →
        </button>
        ${
          catalog.length < examSize
            ? /* HTML */ `
                <div class="callout">
                  開始には学習用問題が${examSize}問必要です。現在 ${catalog.length} 問です。
                </div>
              `
            : ''
        }
      </div>
      <div class="card">
        <h2>受験前に</h2>
        <p class="muted">
          通信できる環境で取り組んでください。回答は選択時にこのブラウザへ保存されます。通常形式では画面を閉じても時間が進みます。
        </p>
        <p class="muted">
          結果は正答数と正答率で表示します。合否や公式IRT評価点を示すものではありません。
        </p>
      </div>
    </div>
    <h2>これまでの模擬試験</h2>
    ${
      history.exams
        .filter((e) => e.status === 'submitted')
        .map((e) => {
          const r = JSON.parse(e.result);
          return /* HTML */ `
            <div class="card">
              <span>${esc(new Date(e.created_at).toLocaleDateString('ja-JP'))}</span>
              　
              <strong>${r.correct} / ${r.total} 問（${r.rate}%）</strong>
              <button class="text-button" data-exam="${esc(e.id)}">結果を確認 →</button>
            </div>
          `;
        })
        .join('') || '<p class="muted">まだ受験記録はありません。</p>'
    }
  `;
  $('#exam-start').onclick = async () => {
    try {
      const { id } =
        active || (await api('/exams', { split: $('#exam-format').value === 'split' }));
      await openExam(id);
    } catch (e) {
      toast(e.message);
    }
  };
  document
    .querySelectorAll('[data-exam]')
    .forEach((b) => (b.onclick = () => openExam(b.dataset.exam)));
}
async function openExam(id) {
  exam = await api('/exams/' + id);
  exam.receivedAt = Date.now();
  examIndex = 0;
  drawExam();
}
function drawExam() {
  clearInterval(timer);
  if (exam.status === 'submitted') {
    examResult();
    return;
  }
  if (exam.status === 'paused') {
    app.innerHTML = empty(
      '前半60分が終了しました',
      '回答を保存しました。準備ができたら後半60分を開始してください。',
    );
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = '後半60分を開始する';
    b.onclick = async () => {
      try {
        await api('/exams/' + exam.id + '/resume', {});
        await openExam(exam.id);
      } catch (e) {
        toast(e.message);
      }
    };
    app.querySelector('.card').append(b);
    return;
  }
  const q = exam.questions[examIndex];
  app.innerHTML = /* HTML */ `
    <section class="question">
      <div class="hero-top">
        <span class="tag">模擬試験 ${examIndex + 1} / ${exam.questions.length}</span>
        <span class="timer" id="clock"></span>
      </div>
      <div class="card">
        <span class="muted">${q.year}年度 問${q.number} · ${esc(q.domain)}</span>
        <div class="question-text">${esc(q.prompt)}</div>
        <div class="choices">
          ${q.choices.map((c, i) => `<button class="choice ${exam.selections[q.id] === i ? 'selected' : ''}" data-exam-choice="${i}"><span class="letter">${'アイウエ'[i]}</span><span>${esc(c)}</span></button>`).join('')}
        </div>
        <div class="actions">
          <button class="secondary" id="prev" ${examIndex === 0 ? 'disabled' : ''}>← 前へ</button>
          <button
            class="primary"
            id="exam-next"
            ${examIndex === exam.questions.length - 1 ? 'disabled' : ''}
          >
            次へ →
          </button>
        </div>
        <div class="exam-map">
          ${exam.questions.map((q, i) => `<button data-jump="${i}" class="${Number.isInteger(exam.selections[q.id]) ? 'answered' : ''} ${examIndex === i ? 'current' : ''}" aria-label="問${i + 1}">${i + 1}</button>`).join('')}
        </div>
        <div class="actions">
          <button class="secondary" id="submit-exam">
            提出して採点（${Object.keys(exam.selections).length}/${exam.questions.length}回答済み）
          </button>
        </div>
        <p class="muted" id="exam-save">回答は選択時に自動保存されます。</p>
      </div>
    </section>
  `;
  document.querySelectorAll('[data-exam-choice]').forEach(
    (b) =>
      (b.onclick = async () => {
        document.querySelectorAll('[data-exam-choice]').forEach((x) => (x.disabled = true));
        try {
          const selected = Number(b.dataset.examChoice);
          await api('/exams/' + exam.id + '/answer', { question_id: q.id, selected });
          exam.selections[q.id] = selected;
          drawExam();
        } catch (e) {
          toast('保存失敗：' + e.message);
          document.querySelectorAll('[data-exam-choice]').forEach((x) => (x.disabled = false));
        }
      }),
  );
  $('#prev').onclick = () => {
    examIndex--;
    drawExam();
  };
  $('#exam-next').onclick = () => {
    examIndex++;
    drawExam();
  };
  document.querySelectorAll('[data-jump]').forEach(
    (b) =>
      (b.onclick = () => {
        examIndex = Number(b.dataset.jump);
        drawExam();
      }),
  );
  $('#submit-exam').onclick = async () => {
    if (!confirm('未回答の問題は不正解として採点します。提出しますか？')) return;
    try {
      exam = await api('/exams/' + exam.id + '/submit', {});
      await refresh();
      drawExam();
    } catch (e) {
      toast(e.message);
    }
  };
  const start = exam.receivedAt || Date.now(),
    left = exam.remaining;
  function tick() {
    const r = Math.max(0, left - (Date.now() - start));
    $('#clock').textContent =
      Math.floor(r / 60000) + ':' + String(Math.floor(r / 1000) % 60).padStart(2, '0');
    if (!r) {
      clearInterval(timer);
      openExam(exam.id).catch((e) => toast(e.message));
    } else setTimeoutCheck();
  }
  tick();
  timer = setInterval(tick, 1000);
}
let lastCheck = 0;
function setTimeoutCheck() {
  if (Date.now() - lastCheck > 10000) {
    lastCheck = Date.now();
    api('/exams/' + exam.id)
      .then((e) => {
        if (page === 'exam' && exam?.id === e.id) {
          exam = { ...e, receivedAt: Date.now() };
          if (e.status !== 'running') drawExam();
        }
      })
      .catch((e) => toast(e.message));
  }
}
function examResult() {
  app.innerHTML = /* HTML */ `
    <div class="eyebrow">EXAM RESULT</div>
    <h1>おつかれさまでした。</h1>
    <div class="metrics">
      ${metric('正答数', exam.result.correct, `/ ${exam.result.total}問`)}${metric('正答率', exam.result.rate, '%')}${metric('未回答', exam.result.total - Object.keys(exam.selections).length, '問')}
    </div>
    <div class="card">
      <h2>分野別の結果</h2>
      ${Object.entries(exam.result.domains)
        .map(([d, v]) => `<p>${esc(d)}：${v.correct}/${v.total} 問</p>`)
        .join('')}
      <p class="muted">公式試験のIRT評価点・合否判定ではありません。</p>
      <button class="primary" id="exam-review">間違えた問題を復習する →</button>
    </div>
  `;
  $('#exam-review').onclick = () => {
    queue = exam.questions.filter(
      (q) => exam.selections[q.id] !== exam.solutions.find((s) => s.id === q.id).answer,
    );
    if (!queue.length) {
      toast('全問正解です');
      return;
    }
    page = 'review';
    index = 0;
    feedback = null;
    selected = null;
    question();
  };
}
async function render() {
  const rid = ++renderId;
  clearInterval(timer);
  page = location.hash.slice(1) || 'home';
  document
    .querySelectorAll('[data-page]')
    .forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  try {
    if (rid !== renderId) return;
    if (page === 'home') home();
    else if (page === 'study' || page === 'review') await study(page === 'review');
    else if (page === 'stats') stats();
    else if (page === 'exam') await examStart();
    else home();
  } catch (e) {
    app.innerHTML = empty('画面を表示できません', e.message);
  }
}
window.addEventListener('hashchange', render);
window.addEventListener('online', async () => {
  await refresh();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && page === 'exam' && exam?.status === 'running')
    openExam(exam.id).catch((e) => toast(e.message));
});
try {
  await refresh();
  await render();
} catch (e) {
  app.innerHTML = empty('接続を確認してください', e.message);
}
