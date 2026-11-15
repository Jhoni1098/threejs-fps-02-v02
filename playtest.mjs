// FROSTLINE playability test in headless Chromium (WebGL 2 via SwiftShader).
// Serves game/ on 8123, plays through the debug hook, asserts the sim works.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL'), name, detail); };

await page.goto('http://127.0.0.1:8123/', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2500);
check('page loads, canvas present', await page.evaluate(() => !!document.querySelector('#game canvas')));
check('WebGL2 context', await page.evaluate(() => {
  const c = document.querySelector('#game canvas');
  return !!c.getContext('webgl2');
}));

// start the match via the Play button
await page.click('#playbtn');
await page.waitForTimeout(800);
check('match starts in buy phase', await page.evaluate(() => window.__frostline.game.phase === 'buy'));
check('buy phase timer running', await page.evaluate(() => window.__frostline.game.timer > 0 && window.__frostline.game.timer <= 12));

// buy a rifle (give the player funds first — a fresh match only has $800)
const buy = await page.evaluate(() => {
  const g = window.__frostline.game;
  g.player.money = 5000;
  const before = g.player.money;
  const ok = g.buy('rifle');
  return { ok, before, after: g.player.money, owned: [...g.player.owned] };
});
check('buy rifle deducts $2700 and grants it', buy.ok && buy.after === buy.before - 2700 && buy.owned.includes('rifle'), JSON.stringify(buy));

// go live and move the player with real key events (headless renders slowly, so
// the sim advances slower than wall time — a small move proves the input path)
await page.evaluate(() => { const g = window.__frostline.game; g.phase = 'live'; g.timer = 100; });
const p0 = await page.evaluate(() => ({ x: window.__frostline.game.player.x, z: window.__frostline.game.player.z }));
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
const p1 = await page.evaluate(() => ({ x: window.__frostline.game.player.x, z: window.__frostline.game.player.z }));
check('player moves forward with W (real key)', Math.abs(p1.x - p0.x) + Math.abs(p1.z - p0.z) > 0.1, JSON.stringify({ p0, p1 }));

// and the same movement driven straight through the sim (1 s of sim time)
const move = await page.evaluate(() => {
  const g = window.__frostline.game;
  const p = g.player;
  const x0 = p.x, z0 = p.z;
  const fwd = { moveX: 0, moveZ: 1, jump: false, crouch: false, walk: false, fire: false, firePressed: false, reload: false, grenade: false, use: false, yawDelta: 0, pitchDelta: 0 };
  for (let i = 0; i < 60; i++) g.step(1 / 60, fwd);
  return { dx: p.x - x0, dz: p.z - z0 };
});
check('player covers ~5 m in 1 s of forward sim', Math.hypot(move.dx, move.dz) > 4, JSON.stringify(move));

// shoot via the debug hook: ammo must drop
const shoot = await page.evaluate(() => {
  const g = window.__frostline.game;
  const p = g.player;
  p.cur = 'rifle';
  const mag0 = p.weapons.rifle.mag;
  const blank = { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, fire: true, firePressed: true, reload: false, grenade: false, use: false, yawDelta: 0, pitchDelta: 0 };
  for (let i = 0; i < 30; i++) g.step(1 / 60, blank);
  return { mag0, mag1: p.weapons.rifle.mag, shots: g.stats.shots };
});
check('shooting consumes ammo', shoot.mag1 < shoot.mag0 && shoot.shots > 0, JSON.stringify(shoot));

// reload refills the mag
const reload = await page.evaluate(() => {
  const g = window.__frostline.game;
  const p = g.player;
  p.weapons.rifle.mag = 2;
  const blank = { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, fire: false, firePressed: false, reload: true, grenade: false, use: false, yawDelta: 0, pitchDelta: 0 };
  for (let i = 0; i < 200; i++) g.step(1 / 60, blank);
  return { mag: p.weapons.rifle.mag, reserve: p.weapons.rifle.reserve };
});
check('reload refills the mag', reload.mag === 30, JSON.stringify(reload));

// bots move and fight over 45 s of sim time
const bots = await page.evaluate(() => {
  const g = window.__frostline.game;
  const before = g.bots.map((b) => [Math.round(b.x), Math.round(b.z)]);
  const blank = { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, fire: false, firePressed: false, reload: false, grenade: false, use: false, yawDelta: 0, pitchDelta: 0 };
  for (let i = 0; i < 45 * 60; i++) { g.step(1 / 60, blank); if (g.phase !== 'live') break; }
  const after = g.bots.map((b) => [Math.round(b.x), Math.round(b.z), b.alive]);
  const moved = before.some((p, i) => Math.abs(p[0] - after[i][0]) + Math.abs(p[1] - after[i][1]) > 2);
  const fullMag = { pistol: 12, smg: 30, rifle: 30, dmr: 8, shotgun: 6 };
  const fullRes = { pistol: 36, smg: 90, rifle: 90, dmr: 24, shotgun: 18 };
  const anyFired = g.bots.some((b) => b.mag < fullMag[b.weapon] || b.reserve < fullRes[b.weapon]);
  const anyDead = g.bots.some((b) => !b.alive);
  const mags = g.bots.map((b) => b.mag);
  return { moved, anyFired, anyDead, mags, phase: g.phase, scoreA: g.scoreA, scoreB: g.scoreB, kills: g.stats.kills };
});
check('bots move along waypoints', bots.moved, JSON.stringify(bots));
check('bots fire their weapons', bots.anyFired || bots.anyDead, JSON.stringify(bots.mags));

// hostage rescue: walk the player to the hostage, then to the dock
const rescue = await page.evaluate(() => {
  const g = window.__frostline.game;
  if (g.phase !== 'live') { g.startRound(); g.phase = 'live'; g.timer = 100; }
  const p = g.player;
  p.x = 23; p.z = 0; p.alive = true; p.hp = 100;
  const blank = { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, fire: false, firePressed: false, reload: false, grenade: false, use: false, yawDelta: 0, pitchDelta: 0 };
  for (let i = 0; i < 60; i++) g.step(1 / 60, blank);
  const following = g.hostage.state;
  // now carry the hostage to the dock
  p.x = -26; p.z = 0;
  g.hostage.x = -26; g.hostage.z = 0;
  for (let i = 0; i < 30; i++) g.step(1 / 60, blank);
  return { following, after: g.hostage.state, phase: g.phase, scoreA: g.scoreA };
});
check('hostage follows when reached', rescue.following === 'follow', JSON.stringify(rescue));
check('extraction ends the round for Aurora', rescue.after === 'extracted' && rescue.phase === 'end' && rescue.scoreA >= 1, JSON.stringify(rescue));

// grenade throws and explodes
const nade = await page.evaluate(() => {
  const g = window.__frostline.game;
  g.startRound(); g.phase = 'live'; g.timer = 100;
  const p = g.player;
  p.grenades = 1; p.x = 0; p.z = 0;
  const blank = { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, fire: false, firePressed: false, reload: false, grenade: true, use: false, yawDelta: 0, pitchDelta: 0 };
  g.step(1 / 60, blank);
  const thrown = g.grenades.length === 1;
  const idle = { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, fire: false, firePressed: false, reload: false, grenade: false, use: false, yawDelta: 0, pitchDelta: 0 };
  for (let i = 0; i < 200; i++) g.step(1 / 60, idle);
  return { thrown, gone: g.grenades.length === 0 };
});
check('grenade throws and explodes', nade.thrown && nade.gone, JSON.stringify(nade));

console.log('errors:', errors.length ? errors : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 && errors.length === 0 ? 'PLAYTEST ALL PASS' : 'PLAYTEST HAS FAILURES: ' + failed + ' checks, ' + errors.length + ' errors');
await browser.close();
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
