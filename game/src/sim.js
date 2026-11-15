// FROSTLINE match simulation. Fixed-step (1/60 s), rendering kept apart: this
// module owns all state — combatants, the hostage, rounds, money — and emits
// transient FX records the renderer consumes. No DOM, no three.js in here.
import { WALLS, SPAWNS, collide, hasLOS, inExtract, HOSTAGE } from './world.js';
import { GUNS, ARMOR_PRICE, GRENADE_PRICE, Grenade, hitscan, damageAt } from './guns.js';
import { makeBot, updateBot, separate, makeHostage, updateHostage, BOT_NAMES } from './ai.js';

const BUY_T = 12, LIVE_T = 110, END_T = 4, WIN_ROUNDS = 5;
const EYE_STAND = 1.55, EYE_CROUCH = 1.05, RADIUS = 0.45;

export class Game {
  constructor(sfx, hud) {
    this.sfx = sfx; this.hud = hud;
    this.phase = 'menu'; this.round = 0; this.scoreA = 0; this.scoreB = 0;
    this.timer = 0; this.now = 0;
    this.combatants = []; this.bots = []; this.player = null;
    this.grenades = []; this.fx = [];
    this.hostage = makeHostage();
    this.useHeld = false;
    this.stats = { kills: 0, deaths: 0, rescues: 0, damage: 0, shots: 0, hits: 0, headshots: 0 };
    this.heard = { x: 0, z: 0, t: -99 };
    this.matchWinner = null;
  }

  newPlayer() {
    return {
      kind: 'player', team: 'aur', name: 'You', x: -28, z: 0, yaw: -Math.PI / 2, pitch: 0,
      eyeY: EYE_STAND, hp: 100, armor: 0, alive: true, isPlayer: true,
      weapons: { pistol: { mag: 12, reserve: 36 } }, owned: new Set(['pistol']),
      cur: 'pistol', grenades: 0, money: 800, kills: 0, deaths: 0,
      reloading: 0, fireAt: 0, spread: 0, recoil: 0, vx: 0, vz: 0, moving: false,
      crouch: false, onGround: true, vy: 0, lastHurt: -99,
    };
  }
  startMatch() {
    this.player = this.newPlayer();
    this.scoreA = 0; this.scoreB = 0; this.round = 0;
    this.stats = { kills: 0, deaths: 0, rescues: 0, damage: 0, shots: 0, hits: 0, headshots: 0 };
    this.startRound();
  }
  startRound() {
    this.round++;
    this.phase = 'buy'; this.timer = BUY_T;
    this.grenades = []; this.fx = [];
    this.hostage = makeHostage();
    this.bots = [];
    const aSpawn = SPAWNS.aur, bSpawn = SPAWNS.brk;
    const aW = ['rifle', 'smg', 'rifle'];
    const bW = ['rifle', 'smg', 'dmr', 'rifle'];
    for (let i = 0; i < 3; i++) {
      const s = aSpawn[i + 1] || aSpawn[0];
      const b = makeBot('aur', BOT_NAMES.aur[i], s[0], s[1], -Math.PI / 2, this.round === 1 ? 'pistol' : aW[i]);
      if (i === 0) b.escort = true;
      this.bots.push(b);
    }
    for (let i = 0; i < 4; i++) {
      const s = bSpawn[i];
      const b = makeBot('brk', BOT_NAMES.brk[i], s[0], s[1], Math.PI / 2, this.round === 1 ? 'pistol' : bW[i]);
      b.post = i < 2 ? 'cell' : 'dock';
      this.bots.push(b);
    }
    const all = [this.player, ...this.bots];
    for (const c of all) {
      c.alive = true; c.hp = 100;
      if (c === this.player) {
        const sp = aSpawn[0]; c.x = sp[0]; c.z = sp[1]; c.yaw = -Math.PI / 2; c.pitch = 0;
        c.armor = c.boughtArmor ? 100 : 0; c.boughtArmor = false;
        for (const k of c.owned) { const w = GUNS[k]; c.weapons[k] = { mag: w.mag, reserve: w.reserve }; }
        c.cur = c.owned.has('rifle') ? 'rifle' : (c.owned.has('smg') ? 'smg' : 'pistol');
        c.reloading = 0; c.spread = 0; c.recoil = 0;
      } else {
        c.armor = this.round > 2 ? 50 : 0;
        const w = GUNS[c.weapon];
        c.mag = w.mag; c.reserve = w.reserve; c.reloading = 0;
      }
      c.eyeY = EYE_STAND; c.crouch = false;
    }
    this.combatants = all;
    this.hud.hideBanner();
    this.hud.hide('matchend');
  }
  endRound(winner, reason) {
    if (this.phase === 'end' || this.phase === 'matchend') return;
    this.phase = 'end'; this.timer = END_T;
    if (winner === 'aur') this.scoreA++; else this.scoreB++;
    const win = winner === 'aur';
    for (const c of this.combatants) {
      if (c.isPlayer) c.money += win ? 325 : 150;
    }
    this.hud.banner(win ? 'win' : 'lose', win ? 'ROUND WON' : 'ROUND LOST', reason);
    if (win) this.sfx.roundWin(); else this.sfx.roundLose();
    if (this.scoreA >= WIN_ROUNDS || this.scoreB >= WIN_ROUNDS || this.round >= 2 * WIN_ROUNDS - 1) {
      this.matchWinner = this.scoreA > this.scoreB ? 'aur' : (this.scoreB > this.scoreA ? 'brk' : 'draw');
    }
  }
  endMatch() {
    this.phase = 'matchend';
    const w = this.matchWinner;
    const acc = this.stats.shots ? Math.round(this.stats.hits / this.stats.shots * 100) : 0;
    const title = w === 'aur' ? 'AURORA WINS THE MATCH' : w === 'brk' ? 'BREAKWATER WINS THE MATCH' : 'MATCH DRAW';
    const sub = w === 'aur' ? 'The hostage is safe. The harbour is yours.' : w === 'brk' ? 'Breakwater held the warehouse. Regroup and go again.' : 'Dead even after nine rounds. One more?';
    const stats = 'Rounds <b>' + this.scoreA + ' – ' + this.scoreB + '</b> · Kills <b>' + this.stats.kills +
      '</b> · Deaths <b>' + this.stats.deaths + '</b> · Accuracy <b>' + acc + '%</b> · Headshots <b>' + this.stats.headshots +
      '</b> · Rescues <b>' + this.stats.rescues + '</b> · Damage <b>' + Math.round(this.stats.damage) + '</b>';
    this.hud.matchEnd(w === 'aur', title, sub, stats);
  }

  // ---- economy ----
  buy(key) {
    if (this.phase !== 'buy') return false;
    const p = this.player;
    if (key === 'armor') {
      if (p.armor > 0 || p.money < ARMOR_PRICE) { this.sfx.deny(); return false; }
      p.money -= ARMOR_PRICE; p.boughtArmor = true; p.armor = 100; this.sfx.buy(); return true;
    }
    if (key === 'grenade') {
      if (p.grenades >= 2 || p.money < GRENADE_PRICE) { this.sfx.deny(); return false; }
      p.money -= GRENADE_PRICE; p.grenades++; this.sfx.buy(); return true;
    }
    const w = GUNS[key];
    if (!w || p.owned.has(key) || p.money < w.price) { this.sfx.deny(); return false; }
    p.money -= w.price; p.owned.add(key);
    p.weapons[key] = { mag: w.mag, reserve: w.reserve };
    p.cur = key; this.sfx.buy(); return true;
  }
  selectWeapon(slot) {
    const order = ['pistol', 'smg', 'shotgun', 'rifle', 'dmr'];
    const p = this.player;
    const id = order[slot];
    if (id && p.owned.has(id) && p.cur !== id && p.alive) { p.cur = id; p.reloading = 0; }
  }

  // ---- combat ----
  eyePos(c) { return [c.x, c.eyeY, c.z]; }
  fireHitscan(shooter, dx, dy, dz, maxD = 120) {
    const w = GUNS[shooter.weapon || shooter.cur];
    const [ox, oy, oz] = this.eyePos(shooter);
    const r = hitscan(ox, oy, oz, dx, dy, dz, maxD, WALLS, this.combatants, shooter);
    const endD = r.hit ? r.dist : r.wallDist;
    this.fx.push({ type: 'tracer', from: [ox, oy - 0.12, oz], to: [ox + dx * endD, oy + dy * endD, oz + dz * endD], color: w.tracer });
    if (r.hit) {
      const c = r.hit;
      const dmg = damageAt(w, r.dist, r.head, c.armor);
      this.applyDamage(c, dmg.hpDmg, dmg.armorDmg, shooter, r.head);
      if (shooter.isPlayer) {
        this.stats.hits++; this.stats.damage += dmg.hpDmg;
        if (r.head) this.stats.headshots++;
        this.hud.hitmarker(c.hp <= 0 ? 'kill' : (r.head ? 'head' : 'hit'));
        if (r.head) this.sfx.headshot(); else this.sfx.hit();
      }
      return { hit: c, head: r.head, dist: r.dist };
    }
    return { hit: null, head: false, dist: r.wallDist };
  }
  applyDamage(c, hpDmg, armorDmg, shooter, head) {
    c.hp -= hpDmg; c.armor = Math.max(0, c.armor - armorDmg);
    c.hurtAt = this.now;
    if (c.isPlayer) this.hud.damageFlash();
    if (c.hp <= 0 && c.alive) this.kill(c, shooter, head);
  }
  kill(victim, killer, head) {
    victim.alive = false; victim.hp = 0; victim.deaths++;
    if (killer) killer.kills++;
    const vName = victim.isPlayer ? 'You' : victim.name;
    const kName = !killer ? '—' : (killer.isPlayer ? 'You' : killer.name);
    const vCol = victim.team === 'aur' ? '#8fd8ff' : '#ff9a7a';
    const kCol = killer && killer.team === 'aur' ? '#8fd8ff' : '#ff9a7a';
    this.hud.feed('<span style="color:' + kCol + '">' + kName + '</span> <span class="w">✕</span> <span style="color:' + vCol + '">' + vName + '</span>' + (head ? ' <span class="hs">HEADSHOT</span>' : ''));
    if (killer && killer.isPlayer) { killer.money += 300; this.stats.kills++; this.sfx.kill(); }
    if (victim.isPlayer) { this.stats.deaths++; this.sfx.hurt(); }
    const aurAlive = this.combatants.some(c => c.team === 'aur' && c.alive);
    const brkAlive = this.combatants.some(c => c.team === 'brk' && c.alive);
    if (!aurAlive) this.endRound('brk', 'Aurora eliminated');
    else if (!brkAlive) this.endRound('aur', 'Breakwater eliminated');
  }

  // ---- per-step ----
  step(dt, input) {
    this.now += dt;
    if (this.phase === 'menu' || this.phase === 'matchend') return;
    if (this.phase === 'buy' || this.phase === 'live' || this.phase === 'end') {
      this.timer -= dt;
      if (this.phase === 'buy' && this.timer <= 0) { this.phase = 'live'; this.timer = LIVE_T; this.hud.hide('buy'); }
      else if (this.phase === 'live' && this.timer <= 0) {
        this.endRound('brk', 'Time expired — the hostage stays put');
      } else if (this.phase === 'end' && this.timer <= 0) {
        if (this.matchWinner) this.endMatch(); else this.startRound();
      }
    }
    this.useHeld = !!input.use;
    this.updatePlayer(dt, input);
    const ctx = {
      now: this.now, combatants: this.combatants, round: this.round,
      hostageState: this.hostage.state, hostageX: this.hostage.x, hostageZ: this.hostage.z,
      heardAt: this.heard.t, heardX: this.heard.x, heardZ: this.heard.z,
      shoot: (bot, enemy, spread, d) => this.botShoot(bot, enemy, spread, d),
    };
    for (const b of this.bots) updateBot(b, ctx, dt);
    separate(this.bots, dt);
    // hostage follows the nearest alive Aurora; extraction ends the round
    const prevState = this.hostage.state;
    updateHostage(this.hostage, this.combatants, dt, this.now);
    if (prevState === 'held' && this.hostage.state === 'follow') {
      this.stats.rescues++;
      const leader = this.hostage.leader;
      this.hud.feed('<span style="color:#8fd8ff">' + (leader && leader.isPlayer ? 'You' : (leader ? leader.name : 'Aurora')) + '</span> reached the hostage — escort them to the dock');
      this.sfx.plantDone();
    }
    if (this.hostage.state === 'follow' && inExtract(this.hostage.x, this.hostage.z)) {
      this.hostage.state = 'extracted';
      this.player.money += 400;
      this.endRound('aur', 'Hostage extracted at the dock');
      return;
    }
    // grenades
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      const done = g.step(dt, WALLS, 0);
      if (done) {
        this.fx.push({ type: 'explosion', at: [g.x, g.y, g.z] });
        this.sfx.boom();
        for (const { c, dmg } of g.blast(this.combatants)) {
          this.applyDamage(c, dmg, 0, g.owner, false);
        }
        this.grenades.splice(i, 1);
      }
    }
  }

  updatePlayer(dt, input) {
    const p = this.player;
    if (!p.alive) return;
    const w = GUNS[p.cur];
    p.yaw -= (input.yawDelta || 0) * 0.0022;
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - (input.pitchDelta || 0) * 0.0022));
    p.recoil = Math.max(0, p.recoil - dt * 0.09);
    p.spread = Math.max(0, p.spread - dt * 0.05);
    const walk = input.walk ? 0.5 : 1;
    const crouch = !!input.crouch;
    p.crouch = crouch;
    const speed = (crouch ? 2.2 : w.speed) * walk;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    let mx = (-sin * input.moveZ + cos * input.moveX) * speed;
    let mz = (-cos * input.moveZ - sin * input.moveX) * speed;
    const ml = Math.hypot(mx, mz);
    if (ml > speed) { mx = mx / ml * speed; mz = mz / ml * speed; }
    p.vx += (mx - p.vx) * Math.min(1, dt * 12);
    p.vz += (mz - p.vz) * Math.min(1, dt * 12);
    const [nx, nz] = collide(p.x + p.vx * dt, p.z + p.vz * dt, RADIUS);
    p.x = nx; p.z = nz;
    p.moving = Math.hypot(p.vx, p.vz) > 0.6;
    if (p.moving && p.onGround) this.sfx.step();
    if (input.jump && p.onGround) { p.vy = 5.2; p.onGround = false; }
    if (!p.onGround) {
      p.vy -= 16 * dt;
      p.eyeY += p.vy * dt;
      if (p.eyeY <= (crouch ? EYE_CROUCH : EYE_STAND)) { p.eyeY = crouch ? EYE_CROUCH : EYE_STAND; p.vy = 0; p.onGround = true; }
    } else {
      const want = crouch ? EYE_CROUCH : EYE_STAND;
      p.eyeY += (want - p.eyeY) * Math.min(1, dt * 14);
    }
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) {
        const cur = p.weapons[p.cur];
        const need = w.mag - cur.mag, take = Math.min(need, cur.reserve);
        cur.mag += take; cur.reserve -= take;
      }
    } else if (input.reload) {
      const cur = p.weapons[p.cur];
      if (cur.mag < w.mag && cur.reserve > 0) { p.reloading = w.reload; this.sfx.reload(); }
    }
    const cur = p.weapons[p.cur];
    const wantFire = input.fire && this.phase === 'live';
    if (wantFire && p.reloading <= 0 && this.now >= p.fireAt) {
      if (cur.mag > 0) {
        const interval = 60 / w.rpm;
        if (!w.auto && !input.firePressed) { /* semi-auto needs a fresh press */ }
        else {
          p.fireAt = this.now + interval;
          cur.mag--;
          this.stats.shots++;
          this.playerShoot();
          if (cur.mag === 0) this.sfx.dry();
        }
      } else {
        p.fireAt = this.now + 0.25;
        this.sfx.dry();
      }
    }
    if (input.grenade && p.grenades > 0 && this.phase === 'live') {
      p.grenades--;
      const dx = -Math.sin(p.yaw) * Math.cos(p.pitch), dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * Math.cos(p.pitch);
      const g = new Grenade(p.x + dx * 0.6, p.eyeY - 0.1, p.z + dz * 0.6, dx * 11 + p.vx, dy * 11 + 3.5, dz * 11 + p.vz);
      g.owner = p;
      this.grenades.push(g);
      this.sfx.bounce();
    }
  }

  playerShoot() {
    const p = this.player;
    const w = GUNS[p.cur];
    const moveSpread = p.moving ? w.moveSpread : 0;
    const spread = (w.spread + p.spread + moveSpread) * (p.crouch ? w.crouchMul : 1);
    p.recoil = Math.min(0.09, p.recoil + w.kick);
    p.spread = Math.min(0.06, p.spread + w.bloom);
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const yaw = p.yaw + Math.cos(a) * r;
      const pitch = p.pitch + p.recoil + Math.sin(a) * r;
      const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
      this.fireHitscan(p, dx, dy, dz);
    }
    this.sfx.shot(w.id);
    this.heard = { x: p.x, z: p.z, t: this.now };
    this.fx.push({ type: 'muzzle', at: [p.x, p.eyeY, p.z], yaw: p.yaw, pitch: p.pitch });
  }

  botShoot(bot, enemy, spread, dist) {
    const w = GUNS[bot.weapon];
    if (bot.mag <= 0) return;
    bot.mag--;
    const tx = enemy.x, ty = enemy.eyeY - 0.62, tz = enemy.z;
    const dx = tx - bot.x, dy = ty - bot.eyeY, dz = tz - bot.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    let ux = dx / d, uy = dy / d, uz = dz / d;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const px = -uz, pz = ux, py = 0;
    const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
    ux += (Math.cos(a) * px + Math.sin(a) * qx) * r;
    uy += (Math.cos(a) * py + Math.sin(a) * qy) * r;
    uz += (Math.cos(a) * pz + Math.sin(a) * qz) * r;
    const len = Math.sqrt(ux * ux + uy * uy + uz * uz);
    this.fireHitscan(bot, ux / len, uy / len, uz / len);
    this.sfx.shot('enemy');
    this.heard = { x: bot.x, z: bot.z, t: this.now };
    this.fx.push({ type: 'muzzle', at: [bot.x, bot.eyeY, bot.z], yaw: bot.yaw, pitch: 0 });
    if (bot.mag === 0) bot.reloading = w.reload;
  }

  hudState() {
    const p = this.player;
    const w = GUNS[p.cur];
    const cur = p.weapons[p.cur];
    const mm = Math.max(0, Math.floor(this.timer));
    const timer = Math.floor(mm / 60) + ':' + String(mm % 60).padStart(2, '0');
    let obj = '';
    if (this.phase === 'buy') obj = 'BUY PHASE — press <b>B</b> to shop · round starts soon';
    else if (this.hostage.state === 'extracted') obj = 'HOSTAGE EXTRACTED — round over';
    else if (this.hostage.state === 'follow') {
      const leader = this.hostage.leader;
      obj = leader && leader.isPlayer
        ? 'Hostage is following <b>YOU</b> — get them to the dock (E)'
        : 'Hostage is following <b>' + (leader ? leader.name : 'a teammate') + '</b> — escort them to the dock (E)';
    } else obj = 'Hostage held in the east warehouse — reach them and bring them to the dock (E)';
    return {
      hp: p.hp, armor: p.armor, mag: cur.mag, reserve: cur.reserve,
      wname: w.name + ' · ' + w.kind, money: p.money, reloading: p.reloading > 0,
      timer, timerLow: this.phase === 'live' && this.timer < 15,
      objHtml: obj, scoreV: this.scoreA, scoreC: this.scoreB,
      aliveV: this.combatants.filter(c => c.team === 'aur').map(c => c.alive),
      aliveC: this.combatants.filter(c => c.team === 'brk').map(c => c.alive),
      lowHp: p.hp < 30 && p.alive,
    };
  }
}
