/**
 * 构建脚本（供 Cloudflare Pages 使用，无第三方依赖）
 *
 * 目标：把 data.json 打包进 dist/data.js（window.__APP_DATA__），
 * 部署产物只包含 index.html / app.js / data.js，不包含原始 data.json，
 * 避免站点暴露可下载的原始 JSON 数据文件。
 *
 * Cloudflare Pages 配置：
 *   构建命令：npm run build
 *   输出目录：dist
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
// 先清空旧的构建产物，避免部署时混入过期文件
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1) 读取可编辑的数据源
const data = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));

// 2) 生成内嵌数据的 data.js（数据不再以独立 JSON 文件暴露）
const dataJs = `/* 由 build.mjs 从 data.json 自动生成，请勿手改 */\nwindow.__APP_DATA__ = ${JSON.stringify(data)};\n`;
writeFileSync(join(dist, 'data.js'), dataJs, 'utf8');

// 3) 复制页面与逻辑文件（data.json 不进入部署产物）
copyFileSync(join(root, 'index.html'), join(dist, 'index.html'));
copyFileSync(join(root, 'app.js'), join(dist, 'app.js'));
// 4) 把 .assetsignore 也复制进 dist/，确保 Cloudflare 无论把 assets 目录
//    指向仓库根还是 dist，都会忽略 node_modules/ 等大文件
copyFileSync(join(root, '.assetsignore'), join(dist, '.assetsignore'));

console.log('build done -> dist/');
console.log('dist files:', ['index.html', 'app.js', 'data.js', '.assetsignore'].join(', '));
console.log('data.json is NOT included in the deploy output.');
