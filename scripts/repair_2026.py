"""Rebuild a separate, non-public review dataset from source OCR and explicit image corrections.

No database connection or source-file update is performed. Correction files must stay private.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent


def split_ocr(text):
    # These glyph variants are extraction candidates, never evidence of source correctness.
    markers = list(re.finditer(r'(?m)^[ \t]*([アイウエ工ェ])[ \t]*', text))
    sequence = ''.join(m[1].translate(str.maketrans('工ェ', 'エエ')) for m in markers)
    if sequence != 'アイウエ':
        return None, [], sequence
    choices = [text[m.end():markers[i + 1].start() if i < 3 else len(text)].replace('\n', '').strip()
               for i, m in enumerate(markers)]
    return text[:markers[0].start()].replace('\n', '').strip(), choices, sequence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--year', type=int, default=2026)
    parser.add_argument('--input', default='data/received/it_passport_2021_2026.json')
    parser.add_argument('--staging', default='data/questions-staging.json')
    parser.add_argument('--strategy-end', type=int)
    parser.add_argument('--management-end', type=int)
    parser.add_argument('--edits')
    parser.add_argument('--output')
    parser.add_argument('--start', type=int, default=1)
    parser.add_argument('--end', type=int, default=100)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    if args.year != 2026 and (args.strategy_end is None or args.management_end is None):
        parser.error('Other years require boundaries confirmed from their booklet')
    strategy_end = args.strategy_end if args.strategy_end is not None else 34
    management_end = args.management_end if args.management_end is not None else 54
    if not (2021 <= args.year <= 2026 and 1 <= args.start <= args.end <= 100
            and 1 <= strategy_end < management_end < 100):
        parser.error('Invalid year, range or domain boundaries')
    args.edits = args.edits or f'data/repair/{args.year}/edits.json'
    args.output = args.output or f'data/repair/{args.year}/questions-repaired.json'
    output = (ROOT / args.output).resolve()
    if not any(output.is_relative_to((ROOT / folder / str(args.year)).resolve())
               for folder in ('data/repair', '.local/repair')):
        raise ValueError('Output must stay inside this year\'s private repair directory')
    source_path = ROOT / args.input
    source_bytes = source_path.read_bytes()
    source = json.loads(source_bytes)['records']
    originals = [q for q in source if q['year'] == args.year]
    if len(originals) != 100 or sorted(q['question_number'] for q in originals) != list(range(1, 101)) or len({q['id'] for q in originals}) != 100:
        raise ValueError('Source year must have 100 unique, consecutive questions')
    staging = json.loads((ROOT / args.staging).read_text(encoding='utf-8'))
    stage_lookup = {q['id']: q for q in staging}
    edit_path = ROOT / args.edits
    edits = json.loads(edit_path.read_text(encoding='utf-8')) if edit_path.exists() else {}
    previous = {q['id']: q for q in json.loads(output.read_text(encoding='utf-8'))} if args.resume and output.exists() else {}
    records, changes, diagnostics, states = [], [], [], {}
    for original in originals:
        n = original['question_number']
        if not args.start <= n <= args.end:
            if original['id'] in previous:
                records.append(previous[original['id']])
            continue
        text = original['question_and_choices_ocr']
        prompt, choices, sequence = split_ocr(text)
        edit = edits.get(str(n), {})
        if 'prompt_lines' in edit:
            # Keep item starts readable while joining OCR line wraps inside sentences.
            parts = text.splitlines()[:edit['prompt_lines']]
            prompt = ''.join(('\n' if i and re.match(r'^[abcd](?:[^A-Za-z]|$)', line) else '') + line
                             for i, line in enumerate(parts))
        prompt = edit.get('prompt', prompt)
        choices = edit.get('choices', choices)
        if prompt:
            prompt = re.sub(r'^問\s*\d+\s*', '', prompt)
        for before, after in edit.get('replace', []):
            if before not in (prompt or '') and not any(before in c for c in choices):
                raise ValueError(f'Unused correction {n}: {before}')
            prompt = prompt.replace(before, after) if prompt else prompt
            choices = [c.replace(before, after) for c in choices]
        if 'append' in edit:
            prompt = (prompt or '') + '\n\n' + edit['append']
        structurally_complete = bool(prompt and len(choices) == 4 and all(c.strip() for c in choices))
        answer = 'アイウエ'.index(original['official_answer'])
        domain = 'ストラテジ' if n <= strategy_end else 'マネジメント' if n <= management_end else 'テクノロジ'
        reasons = edit.get('reasons')
        explanation = dict(answer=answer, reasons=reasons, terms=edit.get('terms', []), point=edit.get('point', reasons[answer])) if reasons else None
        issues = ['human_content_and_explanation_review_required']
        if not structurally_complete:
            issues.append('structure_incomplete')
        if not edit.get('image_checked'):
            issues.append('source_image_comparison_pending')
        if not explanation:
            issues.append('explanation_not_generated')
        q = dict(id=original['id'], year=args.year, number=n, prompt=prompt, choices=choices, answer=answer,
                 official_answer=original['official_answer'], domain=domain, status='needs_review',
                 explanation_status='needs_review' if explanation else 'not_generated', explanation=explanation,
                 reviewer=None, reviewed_at=None, issues=issues,
                 source=dict(question_pdf=original['question_pdf'], page=original['question_pdf_page'],
                             answer_pdf=original['answer_pdf'], answer_page=1,
                             regions=original['source_regions'], raw_ocr=text,
                             source_json_sha256=hashlib.sha256(source_bytes).hexdigest()),
                 repair=dict(structure_complete=structurally_complete, image_comparison='ai_visual' if edit.get('image_checked') else 'pending',
                             human_review='pending', classification='要確認' if structurally_complete else '公開不可',
                             ai_reasoning_check=edit.get('reasoning_check'), errors_resolved=edit.get('errors_resolved', []),
                             references=edit.get('references', []),
                             table_or_code_transcribed=edit.get('table_or_code_transcribed', args.year == 2026 and n in [3,7,26,44,50,55,57,67,68,69,72,74,76,80,85,88,89,99])))
        batch_file = output.parent / 'batches' / f'{((n-1)//20)*20+1:03}-{min(((n-1)//20+1)*20,100):03}.json'
        cached = json.loads(batch_file.read_text(encoding='utf-8')).get(q['id']) if args.resume and batch_file.exists() else None
        state = checkpoint(q, original, edit, cached)
        states[q['id']] = state
        records.append(q)
        diagnostics.append(dict(number=n, sequence=sequence, complete=structurally_complete, choices=choices))
        changes.append(dict(id=q['id'], original_has_newlines='\n' in text,
            original_json_roundtrip_matches=json.loads(json.dumps(original, ensure_ascii=False))['question_and_choices_ocr'] == text,
            staging_matches_after_newline_removal=stage_lookup[q['id']]['raw'] == text.replace('\n', ''),
            before_prompt=stage_lookup[q['id']]['prompt'], after_prompt=prompt,
            before_choices=stage_lookup[q['id']]['choices'], after_choices=choices,
            correction=edit))
    output.parent.mkdir(parents=True, exist_ok=True)
    for first in range(1, 101, 20):
        path = output.parent / 'batches' / f'{first:03}-{first+19:03}.json'
        updates = {q['id']: states[q['id']] for q in records if first <= q['number'] < first+20 and q['id'] in states}
        if updates:
            path.parent.mkdir(parents=True, exist_ok=True)
            prior = json.loads(path.read_text(encoding='utf-8')) if args.resume and path.exists() else {}
            prior.update(updates)
            path.write_text(json.dumps(prior, ensure_ascii=False, indent=2), encoding='utf-8')
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    (output.parent / 'changes.json').write_text(json.dumps(changes, ensure_ascii=False, indent=2), encoding='utf-8')
    (output.parent / 'diagnostics.json').write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2), encoding='utf-8')
    summary = dict(year=args.year, total=len(records), processed_range=[args.start,args.end], structure_complete=sum(q['repair']['structure_complete'] for q in records),
                   original_json_matches=sum(c['original_json_roundtrip_matches'] for c in changes),
                   staging_newline_loss_matches=sum(c['staging_matches_after_newline_removal'] for c in changes),
                   original_newlines=sum(c['original_has_newlines'] for c in changes),
                   classifications=dict(collections.Counter(q['repair']['classification'] for q in records)),
                   error_types=dict(collections.Counter(e for q in records for e in q['issues'])),
                   explanations=sum(q['explanation'] is not None for q in records), publishable=0)
    (output.parent / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def checkpoint(question, original, edit, previous=None):
    digest = lambda value: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    content_hash = digest(question)
    input_hash = digest([original, edit])
    # Verification is carried forward only for the exact same inputs AND output.
    same = previous and previous.get('input_hash') == input_hash and previous.get('content_hash') == content_hash
    return dict(id=question['id'], input_hash=input_hash, content_hash=content_hash,
                generated=question['explanation'] is not None,
                verification=previous.get('verification', 'pending') if same else 'pending',
                record=question)


if __name__ == '__main__':
    main()
