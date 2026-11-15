// FROSTLINE ballistics: the weapon table, analytic hitscan and grenades.
// Accuracy is the skill. Every gun has a base spread, a per-shot bloom, a movement
// penalty and a recoil kick; standing still and firing in short bursts beats
// spraying on the move. Hit detection is analytic — segment vs sphere for heads
// and bodies, segment vs AABB for walls — so nothing allocates in the hot loop.
export const GUNS = {
  pistol: { id: 'pistol', name: 'P9 Frost', kind: 'Pistol', price: 0, auto: false, rpm: 330, mag: 12, reserve: 36, reload: 1.1, dmg: 27, headMul: 2.0, range: 26, falloff: 0.55, spread: 0.011, bloom: 0.006, kick: 0.011, moveSpread: 0.02, crouchMul: 0.6, speed: 5.4, tracer: 0xcfe8ff },
  smg: { id: 'smg', name: 'Sleet-9', kind: 'SMG', price: 900, auto: true, rpm: 780, mag: 30, reserve: 90, reload: 1.6, dmg: 19, headMul: 2.0, range: 22, falloff: 0.5, spread: 0.016, bloom: 0.008, kick: 0.008, moveSpread: 0.024, crouchMul: 0.6, speed: 5.2, tracer: 0xffe08a },
  rifle: { id: 'rifle', name: 'Glacier-47', kind: 'Rifle', price: 2700, auto: true, rpm: 600, mag: 30, reserve: 90, reload: 2.0, dmg: 31, headMul: 2.2, range: 46, falloff: 0.7, spread: 0.009, bloom: 0.007, kick: 0.014, moveSpread: 0.026, crouchMul: 0.55, speed: 4.9, tracer: 0xffc46b },
  dmr: { id: 'dmr', name: 'Northstar', kind: 'Marksman', price: 3500, auto: false, rpm: 135, mag: 8, reserve: 24, reload: 2.4, dmg: 80, headMul: 2.5, range: 95, falloff: 0.85, spread: 0.002, bloom: 0.02, kick: 0.045, moveSpread: 0.05, crouchMul: 0.5, speed: 4.6, tracer: 0x9fd8ff },
  shotgun: { id: 'shotgun', name: 'Breaker-12', kind: 'Shotgun', price: 1400, auto: false, rpm: 78, mag: 6, reserve: 18, reload: 2.6, dmg: 11, headMul: 1.8, range: 14, falloff: 0.3, spread: 0.05, bloom: 0.01, kick: 0.05, moveSpread: 0.03, crouchMul: 0.6, speed: 5.0, pellets: 8, tracer: 0xffb36b },
};
export const ARMOR_PRICE = 650;
export const GRENADE_PRICE = 300;
export const GRENADE = { name: 'Snowball frag', fuse: 2.1, radius: 7.5, dmg: 110 };

// Segment vs sphere. Returns the nearest t in [0,maxD] or -1.
export function segSphere(ox, oy, oz, dx, dy, dz, maxD, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  return t >= 0 && t <= maxD ? t : -1;
}

// Segment vs AABB (slab test). Returns nearest t in [0,maxD] or -1.
export function segBox(ox, oy, oz, dx, dy, dz, maxD, b) {
  let tmin = 0, tmax = maxD;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [b.x1, 0, b.z1], mx = [b.x2, b.h, b.z2];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return -1; }
    else {
      let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Fire one hitscan shot. `walls` are AABBs, `targets` are combatants.
// Returns { hit, head, dist, wallDist }. No allocation.
export function hitscan(ox, oy, oz, dx, dy, dz, maxD, walls, targets, shooter) {
  let wallD = maxD, hit = null, head = false, hitD = maxD;
  for (let i = 0; i < walls.length; i++) {
    const t = segBox(ox, oy, oz, dx, dy, dz, maxD, walls[i]);
    if (t >= 0 && t < wallD) wallD = t;
  }
  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    if (c === shooter || !c.alive) continue;
    const ht = segSphere(ox, oy, oz, dx, dy, dz, wallD, c.x, c.eyeY - 0.14, c.z, 0.24);
    if (ht >= 0 && ht < hitD) { hit = c; head = true; hitD = ht; continue; }
    const bt = segSphere(ox, oy, oz, dx, dy, dz, wallD, c.x, c.eyeY - 0.62, c.z, 0.46);
    if (bt >= 0 && bt < hitD) { hit = c; head = false; hitD = bt; }
  }
  return { hit, head, dist: hit ? hitD : wallD, wallDist: wallD };
}

// Damage at range with falloff and armor. Returns { hpDmg, armorDmg }.
export function damageAt(w, dist, head, armor) {
  let d = w.dmg * (head ? w.headMul : 1);
  if (dist > w.range) d *= Math.max(w.falloff, 1 - (dist - w.range) / (w.range * 2));
  if (armor > 0) {
    const absorbed = Math.min(armor, d * 0.5);
    return { hpDmg: d - absorbed, armorDmg: absorbed };
  }
  return { hpDmg: d, armorDmg: 0 };
}

// Grenade: point physics with wall bounces, fuse, AoE falloff.
export class Grenade {
  constructor(x, y, z, vx, vy, vz) {
    this.x = x; this.y = y; this.z = z; this.vx = vx; this.vy = vy; this.vz = vz;
    this.fuse = GRENADE.fuse; this.bounces = 0; this.dead = false;
  }
  step(dt, walls, floorY) {
    this.fuse -= dt;
    this.vy -= 14 * dt;
    let nx = this.x + this.vx * dt, ny = this.y + this.vy * dt, nz = this.z + this.vz * dt;
    if (ny < floorY + 0.09) { ny = floorY + 0.09; this.vy = Math.abs(this.vy) * 0.42; this.vx *= 0.7; this.vz *= 0.7; this.bounces++; }
    for (let i = 0; i < walls.length; i++) {
      const b = walls[i];
      if (ny < b.h && nx > b.x1 - 0.09 && nx < b.x2 + 0.09 && nz > b.z1 - 0.09 && nz < b.z2 + 0.09) {
        const dxl = Math.abs(nx - b.x1), dxr = Math.abs(nx - b.x2);
        const dzl = Math.abs(nz - b.z1), dzr = Math.abs(nz - b.z2);
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl || m === dxr) this.vx = -this.vx * 0.55; else this.vz = -this.vz * 0.55;
        nx = this.x; nz = this.z; this.bounces++;
      }
    }
    this.x = nx; this.y = ny; this.z = nz;
    if (this.fuse <= 0 || this.bounces > 3) this.dead = true;
    return this.dead;
  }
  blast(targets) {
    const out = [];
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      if (!c.alive) continue;
      const dx = c.x - this.x, dy = (c.eyeY - 0.6) - this.y, dz = c.z - this.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < GRENADE.radius) out.push({ c, dmg: GRENADE.dmg * (1 - d / GRENADE.radius * 0.75) });
    }
    return out;
  }
}
