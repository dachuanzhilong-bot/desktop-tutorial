// index.html と css/js を1枚のHTMLにまとめる（claude.ai のアーティファクト公開用）。
// 使い方: node scripts/build-single.mjs <出力パス>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dist', 'sixtysix.html');
const read = p => readFileSync(join(root, p), 'utf8');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];

const page = `<title>66日間</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>
${read('css/app.css')}
</style>
${body.trim()}
`;
writeFileSync(out, page);
console.log('wrote', out, (page.length / 1024).toFixed(1) + ' KB');
