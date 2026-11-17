// Read-only PDF rendering for local source verification; no public assets are produced.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(resolve('.tools/pdf/package.json'));
const canvas = require('@napi-rs/canvas');
globalThis.DOMMatrix = canvas.DOMMatrix;
globalThis.ImageData = canvas.ImageData;
globalThis.Path2D = canvas.Path2D;
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
const [input, output = '.local/repair/2026/pages'] = process.argv.slice(2);
if (!input)
  throw new Error('Usage: node scripts/render-source-pdf.mjs <source.pdf> <output-directory>');
mkdirSync(output, { recursive: true });
const loading = pdfjs.getDocument({
  data: new Uint8Array(readFileSync(input)),
  useSystemFonts: true,
  isEvalSupported: false,
});
const doc = await loading.promise;
const pageArgument = process.argv.indexOf('--pages');
const selected =
  pageArgument < 0
    ? null
    : new Set(
        process.argv[pageArgument + 1].split(',').flatMap((value) => {
          const [first, last = first] = value.split('-').map(Number);
          if (
            !Number.isInteger(first) ||
            !Number.isInteger(last) ||
            first < 1 ||
            last < first ||
            last > doc.numPages
          )
            throw Error('Invalid PDF page range');
          return Array.from({ length: last - first + 1 }, (_, i) => first + i);
        }),
      );
const textFile = resolve(output, 'extracted-text.json');
const resume = process.argv.includes('--resume');
const texts = resume && existsSync(textFile) ? JSON.parse(readFileSync(textFile, 'utf8')) : [];
for (let number = 1; number <= doc.numPages; number++) {
  if (selected && !selected.has(number)) continue;
  const imageFile = resolve(output, `page-${String(number).padStart(2, '0')}.png`);
  if (resume && existsSync(imageFile) && texts.some((p) => p.page === number)) continue;
  const page = await doc.getPage(number);
  const viewport = page.getViewport({ scale: 2200 / page.getViewport({ scale: 1 }).height });
  const surface = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: surface.getContext('2d'), viewport }).promise;
  writeFileSync(imageFile, surface.toBuffer('image/png'));
  const content = await page.getTextContent();
  const previous = texts.findIndex((p) => p.page === number);
  if (previous >= 0) texts.splice(previous, 1);
  texts.push({
    page: number,
    text: content.items.map((item) => item.str).join('\n'),
    items: content.items.map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
    })),
  });
  page.cleanup();
}
texts.sort((a, b) => a.page - b.page);
writeFileSync(textFile, JSON.stringify(texts, null, 2));
console.log(
  JSON.stringify({
    pages: doc.numPages,
    output,
    textCharacters: texts.reduce((n, p) => n + p.text.length, 0),
  }),
);
await loading.destroy();
