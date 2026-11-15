// Take FROSTLINE's screenshots in headless Chromium (WebGL 2 via SwiftShader).
// Reads shots.json, opens each URL, waits for the scene to settle, saves a JPEG.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const shots = JSON.parse(readFileSync(new URL('./shots.json', import.meta.url), 'utf8'));
mkdirSync(new URL('./screenshots', import.meta.url), { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

for (const shot of shots) {
  const url = 'http://127.0.0.1:8123/' + shot.query;
  console.log('shot', shot.name, url);
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3500);
  const stats = await page.evaluate(() => {
    const c = document.querySelector('#game canvas');
    if (!c) return { ok: false, why: 'no canvas' };
    const t = document.createElement('canvas');
    t.width = 160; t.height = 90;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += v; sum2 += v * v; n++;
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    return { ok: true, mean: Math.round(mean), sd: Math.round(sd) };
  });
  console.log('  frame stats:', JSON.stringify(stats));
  const file = new URL('./screenshots/' + shot.name, import.meta.url);
  await page.screenshot({ path: file.pathname, type: 'jpeg', quality: 85 });
  console.log('  saved', shot.name);
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
