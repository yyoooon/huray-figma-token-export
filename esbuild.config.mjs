import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

// 1) main thread 번들
await build({
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2019',
  format: 'iife',
});

// 2) ui.ts 번들 → 문자열로 받아 ui.html <script>에 inline 주입
const ui = await build({
  entryPoints: ['src/ui.ts'],
  bundle: true,
  write: false,
  target: 'es2019',
  format: 'iife',
});
const uiJs = ui.outputFiles[0].text;
const html = readFileSync('src/ui.html', 'utf8').replace(
  '<!--UI_SCRIPT-->',
  `<script>${uiJs}</script>`,
);
writeFileSync('dist/ui.html', html);
console.log('built dist/code.js + dist/ui.html');
