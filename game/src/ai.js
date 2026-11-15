// FROSTLINE bot AI. Each bot is a combatant with a small state machine: push along
// the waypoint graph toward its objective, hold a position, engage a visible enemy
// with burst fire, retreat to cover when hurt, and work the objective. Aurora
// pushes to the hostage and then escorts them to the extraction dock; Breakwater
// holds the warehouse and rotates to noise. Perception is line-of-sight + range +
// a reaction delay, so a player who peeks first wins the duel.
import { WAYPOINTS, findPath, nearestWaypoint, collide, hasLOS, HOSTAGE, EXTRACT } from './world.js';
import { GUNS } from './guns.js';

export const BOT_NAMES = { aur: ['Wren', 'Sable', 'Pip'], brk: ['Frost', 'Gale', 'Rime', 'Sleet'] };
const EYE = 1.55;

export function makeBot(team, name, x, z, yaw, weaponId) {
  const w = GUNS[weaponId];
  return {
    kind: 'bot', team, name, x, z, yaw, pitch: 0, eyeY: EYE,
    hp: 100, armor: 0, alive: true, isPlayer: false,
    weapon: weaponId, mag: w.mag, reserve: w.reserve, reloading: 0,
    speed: 0, crouch: false, moving: false,
    state: 'push', path: [], pathIdx: 0, holdUntil: 0,
    target: null, lastSeen: null, lastSeenT: -99, reactAt: 0,
    burstLeft: 0, fireAt: 0, pauseUntil: 0, strafe: 1, strafeAt: 0,
    repathAt: 0, thinkAt: Math.random() * 0.2, aimErr: 0,
    hurtAt: -99, heardAt: -99, heardX: 0, heardZ: 0,
    kills: 0, deaths: 0, escort: false,
  };
}

function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// Where this bot wants to go right now.
function goalWp(bot, ctx) {
  if (bot.team === 'aur') {
    if (ctx.hostageState === 'follow') return nearestWaypoint(EXTRACT.x + (Math.random() * 4 - 2), EXTRACT.z + (Math.random() * 4 - 2));
    return nearestWaypoint(HOSTAGE.x + (Math.random() * 3 - 1.5), HOSTAGE.z + (Math.random() * 3 - 1.5));
  }
  // breakwater: defend the warehouse, rotate to the dock once the hostage moves
  if (ctx.hostageState === 'follow') {
    if (Math.random() < 0.5) return nearestWaypoint(EXTRACT.x + (Math.random() * 6 - 3), EXTRACT.z + (Math.random() * 6 - 3));
    return nearestWaypoint(ctx.hostageX + (Math.random() * 4 - 2), ctx.hostageZ + (Math.random() * 4 - 2));
  }
  if (ctx.heardAt > ctx.now - 6 && ctx.heardX !== undefined) {
    const w = nearestWaypoint(ctx.heardX, ctx.heardZ);
    if (dist2(WAYPOINTS[w][0], WAYPOINTS[w][1], bot.x, bot.z) < 900) return w;
  }
  const near = bot.post || 'cell';
  if (near === 'dock') return nearestWaypoint(EXTRACT.x + (Math.random() * 6 - 3), EXTRACT.z + (Math.random() * 6 - 3));
  return nearestWaypoint(HOSTAGE.x + (Math.random() * 6 - 3), HOSTAGE.z + (Math.random() * 6 - 3));
}

function setPath(bot, toWp) {
  const from = nearestWaypoint(bot.x, bot.z);
  bot.path = findPath(from, toWp);
  bot.pathIdx = 0;
}

function walkPath(bot, dt, speed) {
  if (bot.pathIdx >= bot.path.length) return false;
  const wp = WAYPOINTS[bot.path[bot.pathIdx]];
  const dx = wp[0] - bot.x, dz = wp[1] - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) { bot.pathIdx++; return bot.pathIdx < bot.path.length; }
  const vx = dx / d * speed, vz = dz / d * speed;
  const [nx, nz] = collide(bot.x + vx * dt, bot.z + vz * dt, 0.45);
  bot.x = nx; bot.z = nz;
  bot.yaw = Math.atan2(-vx, -vz);
  bot.moving = true;
  return true;
}

function facePoint(bot, x, z, dt, rate = 7) {
  const want = Math.atan2(-(x - bot.x), -(z - bot.z));
  const d = angDiff(want, bot.yaw);
  bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
  return Math.abs(d) < 0.06;
}

export function updateBot(bot, ctx, dt) {
  if (!bot.alive) return;
  const now = ctx.now;
  bot.moving = false;
  bot.thinkAt -= dt;
  const w = GUNS[bot.weapon];

  // ---- perception (throttled) ----
  if (bot.thinkAt <= 0) {
    bot.thinkAt = 0.15;
    let best = null, bd = Infinity;
    for (const c of ctx.combatants) {
      if (c.team === bot.team || !c.alive) continue;
      const d2 = dist2(bot.x, bot.z, c.x, c.z);
      if (d2 > 48 * 48) continue;
      if (d2 < bd && hasLOS(bot.x, EYE, bot.z, c.x, c.eyeY, c.z)) {
        const ang = Math.abs(angDiff(Math.atan2(-(c.x - bot.x), -(c.z - bot.z)), bot.yaw));
        if (ang < 1.9 || d2 < 36 || now - bot.hurtAt < 1) { best = c; bd = d2; }
      }
    }
    if (best) {
      if (bot.target !== best) bot.reactAt = now + 0.28 + Math.random() * 0.25;
      bot.target = best;
      bot.lastSeen = { x: best.x, z: best.z };
      bot.lastSeenT = now;
    } else if (bot.target && now - bot.lastSeenT > 1.2) {
      bot.target = null;
    }
  }
  const enemy = bot.target && now >= bot.reactAt ? bot.target : null;
  const enemyVisible = enemy && enemy.alive && hasLOS(bot.x, EYE, bot.z, enemy.x, enemy.eyeY, enemy.z);

  // ---- reload ----
  if (bot.reloading > 0) {
    bot.reloading -= dt;
    if (bot.reloading <= 0) {
      const need = w.mag - bot.mag, take = Math.min(need, bot.reserve);
      bot.mag += take; bot.reserve -= take;
    }
  } else if (bot.mag === 0) {
    if (bot.reserve > 0) bot.reloading = w.reload; else bot.mag = 0;
  }

  // ---- combat: face, strafe, burst fire ----
  if (enemyVisible) {
    bot.state = 'engage';
    facePoint(bot, enemy.x, enemy.z, dt, 9);
    if (now > bot.strafeAt) { bot.strafe = Math.random() < 0.5 ? -1 : 1; bot.strafeAt = now + 0.5 + Math.random() * 0.9; }
    const d = Math.sqrt(dist2(bot.x, bot.z, enemy.x, enemy.z));
    const wantD = d > 22 ? 1 : (d < 6 ? -1 : 0);
    const fx = Math.sin(bot.yaw), fz = Math.cos(bot.yaw);
    const px = -fz * bot.strafe, pz = fx * bot.strafe;
    const sp = 2.6;
    const mx = px * sp + (-fx) * wantD * sp * 0.6;
    const mz = pz * sp + (-fz) * wantD * sp * 0.6;
    const [nx, nz] = collide(bot.x + mx * dt, bot.z + mz * dt, 0.45);
    bot.x = nx; bot.z = nz; bot.moving = true;
    if (bot.reloading <= 0 && bot.mag > 0 && now >= bot.pauseUntil) {
      if (bot.burstLeft <= 0) { bot.burstLeft = 3 + Math.floor(Math.random() * 3); }
      if (now >= bot.fireAt) {
        bot.fireAt = now + 60 / w.rpm;
        bot.burstLeft--;
        const tgtMoving = enemy.moving ? 1 : 0;
        const spread = 0.02 + d * 0.0011 + tgtMoving * 0.012 + (bot.moving ? 0.012 : 0);
        ctx.shoot(bot, enemy, spread, d);
        if (bot.burstLeft <= 0) bot.pauseUntil = now + 0.45 + Math.random() * 0.5;
      }
    }
    return;
  }

  // ---- retreat when badly hurt ----
  if (bot.hp < 30 && now - bot.hurtAt < 3 && bot.state !== 'retreat') {
    bot.state = 'retreat';
    setPath(bot, nearestWaypoint(bot.x + (bot.team === 'aur' ? -8 : 8), bot.z));
  }
  if (bot.state === 'retreat') {
    if (!walkPath(bot, dt, 3.4) || bot.hp >= 30) bot.state = 'push';
    return;
  }

  // ---- hold / push ----
  if (bot.state === 'hold') {
    if (now > bot.holdUntil) bot.state = 'push';
    return;
  }
  // escorting bots stick close to the hostage instead of rushing the dock
  if (bot.team === 'aur' && ctx.hostageState === 'follow' && bot.escort) {
    const d2 = dist2(bot.x, bot.z, ctx.hostageX, ctx.hostageZ);
    if (d2 > 5 * 5) {
      const goal = nearestWaypoint(ctx.hostageX, ctx.hostageZ);
      if (bot.pathIdx >= bot.path.length) setPath(bot, goal);
      walkPath(bot, dt, 3.8);
      return;
    }
    bot.state = 'hold'; bot.holdUntil = now + 0.8;
    return;
  }
  if (bot.pathIdx >= bot.path.length) {
    if (bot.repathAt <= now) {
      bot.repathAt = now + 1.5 + Math.random() * 2;
      const goal = goalWp(bot, ctx);
      setPath(bot, goal);
      if (bot.path.length === 0) { bot.state = 'hold'; bot.holdUntil = now + 1 + Math.random() * 2; }
    }
    return;
  }
  walkPath(bot, dt, 3.6 + Math.random() * 0.4);
}

// Separation: keep bots from stacking on each other.
export function separate(bots, dt) {
  for (let i = 0; i < bots.length; i++) {
    for (let j = i + 1; j < bots.length; j++) {
      const a = bots[i], b = bots[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.1 * 1.1 && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (1.1 - d) * 0.5;
        const ux = dx / d, uz = dz / d;
        const [ax, az] = collide(a.x - ux * push, a.z - uz * push, 0.45);
        const [bx, bz] = collide(b.x + ux * push, b.z + uz * push, 0.45);
        a.x = ax; a.z = az; b.x = bx; b.z = bz;
      }
    }
  }
}

// The hostage: stands in the cell until an Aurora combatant comes close, then
// follows the nearest alive Aurora at walking pace. Invulnerable; if their leader
// dies they wait where they are for the next rescuer.
export function makeHostage() {
  return { x: HOSTAGE.x, z: HOSTAGE.z, yaw: Math.PI / 2, state: 'held', leader: null, path: [], pathIdx: 0, repathAt: 0 };
}
export function updateHostage(h, combatants, dt, now) {
  if (h.state === 'extracted') return;
  let leader = null, bd = Infinity;
  for (const c of combatants) {
    if (c.team !== 'aur' || !c.alive) continue;
    const d2 = (c.x - h.x) ** 2 + (c.z - h.z) ** 2;
    if (d2 < bd) { bd = d2; leader = c; }
  }
  if (h.state === 'held') {
    if (leader && bd < 2.2 * 2.2) { h.state = 'follow'; h.leader = leader; }
    return;
  }
  // follow
  if (!leader || !leader.alive) { h.leader = null; return; }
  h.leader = leader;
  const d2 = (leader.x - h.x) ** 2 + (leader.z - h.z) ** 2;
  if (d2 < 1.2 * 1.2) return; // close enough, wait
  if (h.repathAt <= now || h.pathIdx >= h.path.length) {
    h.repathAt = now + 0.8;
    h.path = findPath(nearestWaypoint(h.x, h.z), nearestWaypoint(leader.x, leader.z));
    h.pathIdx = 0;
  }
  if (h.pathIdx < h.path.length) {
    const wp = WAYPOINTS[h.path[h.pathIdx]];
    const dx = wp[0] - h.x, dz = wp[1] - h.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8) { h.pathIdx++; return; }
    const sp = 3.1;
    const [nx, nz] = collide(h.x + dx / d * sp * dt, h.z + dz / d * sp * dt, 0.4);
    h.x = nx; h.z = nz;
    h.yaw = Math.atan2(-dx, -dz);
  } else {
    // no path (leader adjacent but not on a waypoint): walk straight at them
    const dx = leader.x - h.x, dz = leader.z - h.z;
    const d = Math.hypot(dx, dz) || 1;
    const [nx, nz] = collide(h.x + dx / d * 3.1 * dt, h.z + dz / d * 3.1 * dt, 0.4);
    h.x = nx; h.z = nz;
    h.yaw = Math.atan2(-dx, -dz);
  }
}
