// vite build 산출물(dist/)을 아티팩트 배포용 단일 HTML 조각으로 합침
// (호스팅 측에서 <!doctype>·<head>·<body> 래핑을 하므로 본문 내용만 생성)
// 실행: npm run build && node scripts/build-artifact.mjs → dist/artifact.html

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

const jsFile = html.match(/src="\/?(assets\/[^"]+\.js)"/)?.[1];
const cssFile = html.match(/href="\/?(assets\/[^"]+\.css)"/)?.[1];
if (!jsFile) throw new Error('dist/index.html에서 JS 번들을 찾지 못했습니다');

const js = fs.readFileSync(path.join(DIST, jsFile), 'utf8');
const css = cssFile ? fs.readFileSync(path.join(DIST, cssFile), 'utf8') : '';

const out = `<title>포켓몬 챔피언스 위협 분석기</title>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

fs.writeFileSync(path.join(DIST, 'artifact.html'), out);
console.log(`dist/artifact.html: ${(out.length / 1024).toFixed(0)}KB`);
