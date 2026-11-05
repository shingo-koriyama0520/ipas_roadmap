"""Fail-closed import. No OCR correction or invented answers."""
import csv, json, re, collections, pathlib, hashlib, io
ROOT = pathlib.Path(__file__).resolve().parent.parent
raw = (ROOT / 'it_passport_2021_2026.csv').read_bytes()
text = raw.decode('utf-8-sig', errors='strict')
rows = list(csv.DictReader(io.StringIO(text)))
ids = collections.Counter(r['id'] for r in rows)
texts = collections.Counter(r['question_and_choices_ocr'] for r in rows)
items = []
for r in rows:
    body = r['question_and_choices_ocr'].replace('\\n', '\n')
    matches = list(re.finditer(r'(?m)^[ \t]*([アイウエ])[ \t]*', body))
    choices = []
    if [m[1] for m in matches] == list('アイウエ'):
        choices = [body[m.end():matches[i+1].start() if i<3 else len(body)].strip() for i,m in enumerate(matches)]
    reasons = ['OCR原文未検証', '公式正答PDFとの独立照合未実施', '出題分野未検証']
    if len(choices) != 4 or not all(choices): reasons.append('4選択肢を安全に分離できない')
    if not body.strip(): reasons.append('問題文欠損')
    if ids[r['id']] != 1: reasons.append('ID重複')
    if texts[r['question_and_choices_ocr']] != 1: reasons.append('原文重複')
    if r['official_answer'] not in 'アイウエ' or len(r['official_answer']) != 1: reasons.append('正答値不正')
    diagram = bool(re.search(r'図|表|グラフ|模式|次の回路', body))
    if diagram: reasons.append('図表依存の可能性・原本確認が必要')
    if re.search(r'(?m)^工|�|[\ue000-\uf8ff]', body): reasons.append('OCR誤認識の疑い')
    year, n = int(r['year']), int(r['question_number'])
    source = ROOT / '過去問' / pathlib.PurePosixPath(r['question_pdf']).name
    answer_source = ROOT / '解答' / pathlib.PurePosixPath(r['answer_pdf']).name
    if not source.exists() or not answer_source.exists(): reasons.append('原本PDF不足')
    items.append(dict(id=r['id'], year=year, number=n, prompt=body[:matches[0].start()].strip() if choices else None,
        choices=choices, answer=list('アイウエ').index(r['official_answer']) if r['official_answer'] in 'アイウエ' else None,
        domain=None, raw=body, question_pdf=str(source.relative_to(ROOT)), page=int(r['question_pdf_page']),
        answer_pdf=str(answer_source.relative_to(ROOT)), answer_page=int(r['answer_pdf_page']),
        diagram_suspected=diagram, status='needs_review', explanation_status='not_generated', issues=reasons))
report = dict(encoding='UTF-8 (strict)', sha256=hashlib.sha256(raw).hexdigest(), columns=list(rows[0]), total=len(rows),
    years=dict(collections.Counter(r['year'] for r in rows)), duplicate_ids=sum(v-1 for v in ids.values()),
    duplicate_texts=sum(v-1 for v in texts.values()), missing_text=sum(not r['question_and_choices_ocr'].strip() for r in rows),
    safely_split_choices=sum(len(q['choices'])==4 for q in items),
    valid_answer_values=sum(r['official_answer'] in list('アイウエ') for r in rows), independently_matched_answers=0,
    diagram_suspected=sum(q['diagram_suspected'] for q in items), confirmed_missing_diagrams=None,
    repair_required=len(items), publishable=0, note='図表件数はキーワードによる候補数。PDF目視・公式正答照合・人による解説検証は未実施。')
(ROOT/'data/questions-staging.json').write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'reports/data-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
with (ROOT/'reports/repair-queue.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f); w.writerow(['id','year','number','issues','question_pdf','page','answer_pdf','answer_page'])
    for q in items: w.writerow([q['id'],q['year'],q['number'],' / '.join(q['issues']),q['question_pdf'],q['page'],q['answer_pdf'],q['answer_page']])
print(json.dumps(report,ensure_ascii=False,indent=2))
