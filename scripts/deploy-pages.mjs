// GitHub Pages 배포: 리포 이름 기준 base 경로로 빌드 후 gh-pages 브랜치에 강제 푸시
// 실행: node scripts/deploy-pages.mjs <github-user>/<repo>
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const slug = process.argv[2];
if (!slug || !slug.includes('/')) {
  console.error('사용법: node scripts/deploy-pages.mjs <github-user>/<repo>');
  process.exit(1);
}
const repo = slug.split('/')[1];
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const run = (cmd, cwd = ROOT) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, {cwd, stdio: 'inherit'});
};

// 1) Pages 하위 경로 기준으로 빌드
run(`npx vite build --base=/${repo}/`);
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

// 2) dist를 gh-pages 브랜치로 푸시
const distGit = path.join(DIST, '.git');
if (fs.existsSync(distGit)) fs.rmSync(distGit, {recursive: true, force: true});
run('git init -b gh-pages', DIST);
run('git add -A', DIST);
run('git -c user.name="deploy" -c user.email="deploy@local" commit -m "deploy"', DIST);
run(`git push --force https://github.com/${slug}.git gh-pages`, DIST);
fs.rmSync(distGit, {recursive: true, force: true});

console.log(`\n배포 완료 → https://${slug.split('/')[0]}.github.io/${repo}/ (첫 배포는 반영까지 1~2분)`);
