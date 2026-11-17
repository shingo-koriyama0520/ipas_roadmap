import importlib.util
import pathlib
import unittest
import csv
import io

module_path = pathlib.Path(__file__).resolve().parent.parent / 'scripts/repair_2026.py'
spec = importlib.util.spec_from_file_location('repair', module_path)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class RepairTests(unittest.TestCase):
    def test_multiline_csv_preserves_choice_boundaries(self):
        text = 'id,text\n"sample","問題\nア選択A\nイ選択B\nウ選択C\nエ選択D"\n'
        rows = list(csv.DictReader(io.StringIO(text)))
        self.assertIn('\n', rows[0]['text'])
        prompt, choices, sequence = repair.split_ocr(rows[0]['text'])
        self.assertEqual(prompt, '問題')
        self.assertEqual(choices, ['選択A','選択B','選択C','選択D'])

    def test_missing_choice_is_not_invented(self):
        prompt, choices, sequence = repair.split_ocr('問題\nイ選択B\nウ選択C\nエ選択D')
        self.assertIsNone(prompt)
        self.assertEqual(choices, [])

    def test_wrong_reading_order_is_not_reordered(self):
        prompt, choices, sequence = repair.split_ocr('問題\nイ選択B\nア選択A\nウ選択C\nエ選択D')
        self.assertEqual(choices, [])

    def test_ocr_glyph_variants_are_candidates_only(self):
        prompt, choices, sequence = repair.split_ocr('問題\nア選択A\nイ選択B\nウ選択C\n工選択D')
        self.assertEqual(sequence, 'アイウエ')
        self.assertEqual(choices[-1], '選択D')

    def test_checkpoint_keeps_exact_verified_content_and_invalidates_changes(self):
        q = dict(id='2025-001', explanation={'reasons': ['A','B','C','D']})
        saved = repair.checkpoint(q, {'source': 'original'}, {})
        saved['verification'] = 'independent_verified'
        self.assertEqual(repair.checkpoint(q, {'source': 'original'}, {}, saved)['verification'], 'independent_verified')
        changed = {**q, 'explanation': {'reasons': ['changed','B','C','D']}}
        self.assertEqual(repair.checkpoint(changed, {'source': 'original'}, {}, saved)['verification'], 'pending')


if __name__ == '__main__':
    unittest.main()
