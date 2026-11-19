import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('Node.js 22.13 or later is required. Install Node.js and try again.');
  process.exit(1);
}
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
process.argv.push('--workshop');
try {
  await import('./dev.mjs');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
