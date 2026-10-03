// Renders the static rooftop plates + Sol sprites for the native RooftopView from the approved mockup code.
// Usage: node plates.mjs <outDir>   (needs puppeteer-core + Chrome; see README.md)
import puppeteer from 'puppeteer-core';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../../app/src/main');
const repo = path.resolve(here, '../../../../..');
const map = (u) => {
  if (u.startsWith('/assets/web/')) return path.join(repo, 'public/sprites', u.slice(12));
  if (u.startsWith('/assets/font/')) return path.join(app, 'res/font', u.slice(13));
  if (u.startsWith('/assets/')) return path.join(app, 'assets/art', u.slice(8));
  return path.join(here, u);
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const f = map(decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const port = srv.address().port;
const out = path.resolve(process.argv[2] || 'out'); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--force-color-profile=srgb'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', e.message)); page.on('console', m => console.log('console:', m.text()));
const jobs = [];
for (const scene of ['day', 'sunset', 'night']) {
  jobs.push([`land-${scene}.png`, `scene=${scene}&plate=1&w=2667&t=0`]);
  jobs.push([`port-${scene}.png`, `scene=${scene}&plate=1&w=1920&et=2000&eb=700&t=0`]);
  jobs.push([`sol-${scene}.png`, `scene=${scene}&solonly=1&w=1920&t=0`]);
}
for (const [name, qs] of jobs) {
  await page.goto(`http://localhost:${port}/index.html?${qs}`);
  await page.waitForFunction('window.READY', { timeout: 120000 });
  const ready = await page.evaluate('window.READY'); if (ready !== true) { console.log('ERR', ready); process.exit(1); }
  const url = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
  fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', name, await page.evaluate('JSON.stringify(window.SOLRECT)'));
}
await browser.close(); srv.close();
