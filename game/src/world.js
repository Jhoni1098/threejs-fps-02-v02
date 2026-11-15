// FROSTLINE map: a frozen harbour, 60 x 40 m. Aurora spawns at the west dock,
// Breakwater holds the east warehouse where the hostage is kept. Three lanes
// (north, mid, south) connect the halves, with containers, crates and ice walls
// for cover. All collision is AABB in the XZ plane.
import * as THREE from 'three';
import { segBox } from './guns.js';

export const BOUNDS = { x1: -30, x2: 30, z1: -20, z2: 20 };
export const HOSTAGE = { x: 24, z: 0 };
export const EXTRACT = { x: -26, z: 0, r: 4.5 };
export const SPAWNS = {
  aur: [[-28, -5], [-28, 0], [-28, 5], [-26, -3]],
  brk: [[27, -5], [27, 5], [22, -8], [22, 8]],
};
// Walls: {x1,z1,x2,z2,h} — perimeter, containers, crates, warehouse.
export const WALLS = [
  // perimeter
  { x1: -30, z1: -20, x2: -29, z2: 20, h: 5 }, { x1: 29, z1: -20, x2: 30, z2: 20, h: 5 },
  { x1: -30, z1: -20, x2: 30, z2: -19, h: 5 }, { x1: -30, z1: 19, x2: 30, z2: 20, h: 5 },
  // mid: two stacked containers with a gap north and south
  { x1: -4, z1: -5, x2: 2, z2: -2, h: 2.6 }, { x1: -4, z1: 2, x2: 2, z2: 5, h: 2.6 },
  { x1: -4, z1: -2, x2: -2.5, z2: 2, h: 5.2 },
  // north lane ice wall + crates
  { x1: 6, z1: -19, x2: 8, z2: -12, h: 3.2 }, { x1: 11, z1: -17, x2: 13.5, z2: -14.5, h: 1.3 },
  { x1: 15, z1: -11, x2: 17, z2: -9, h: 1.3 }, { x1: -14, z1: -16, x2: -12, z2: -14, h: 1.3 },
  // south lane ice wall + crates
  { x1: 6, z1: 12, x2: 8, z2: 19, h: 3.2 }, { x1: 11, z1: 14.5, x2: 13.5, z2: 17, h: 1.3 },
  { x1: 15, z1: 9, x2: 17, z2: 11, h: 1.3 }, { x1: -14, z1: 14, x2: -12, z2: 16, h: 1.3 },
  // warehouse (hostage cell) at the east end: north + south walls, west wall with a
  // door gap in the middle (z -2..2 open)
  { x1: 20, z1: -7, x2: 28, z2: -6, h: 4.2 }, { x1: 20, z1: 6, x2: 28, z2: 7, h: 4.2 },
  { x1: 20, z1: -6, x2: 21, z2: -2, h: 4.2 }, { x1: 20, z1: 2, x2: 21, z2: 6, h: 4.2 },
  // west cover
  { x1: -20, z1: -9, x2: -18, z2: -7, h: 1.3 }, { x1: -20, z1: 7, x2: -18, z2: 9, h: 1.3 },
  { x1: -12, z1: -13, x2: -10, z2: -11, h: 1.3 }, { x1: -12, z1: 11, x2: -10, z2: 13, h: 1.3 },
  { x1: -7, z1: -9, x2: -5, z2: -7, h: 1.3 }, { x1: -7, z1: 7, x2: -5, z2: 9, h: 1.3 },
  // east cover
  { x1: 4, z1: -10, x2: 6, z2: -8, h: 1.3 }, { x1: 4, z1: 8, x2: 6, z2: 10, h: 1.3 },
  { x1: 10, z1: -5, x2: 12, z2: -3, h: 1.3 }, { x1: 10, z1: 3, x2: 12, z2: 5, h: 1.3 },
  { x1: 16, z1: -12, x2: 18, z2: -10, h: 1.3 }, { x1: 16, z1: 10, x2: 18, z2: 12, h: 1.3 },
];
// Waypoints: [x, z] nodes; EDGES by index.
export const WAYPOINTS = [
  [-27, 0], [-27, -7], [-27, 7], [-18, 0], [-18, -13], [-18, 13], // 0-5 aurora
  [-8, 0], [-8, -11], [-8, 11], [0, -7], [0, 7], [0, 0], // 6-11 mid
  [7, -11], [7, 11], [13, -11], [13, 11], [13, 0], // 12-16 east mid
  [20, 0], [24, 0], [26, -4], [26, 4], // 17-20 warehouse + hostage
  [27, 0], [27, -7], [27, 7], [21, 0], // 21-24 breakwater
  [-3, -16], [-3, 16], [3, -16], [3, 16], // 25-28 north/south lanes
];
export const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 6], [3, 4], [3, 5],
  [4, 25], [5, 26], [25, 7], [26, 8], [6, 7], [6, 8], [6, 11], [7, 9], [8, 10],
  [9, 12], [10, 13], [11, 9], [11, 10], [9, 27], [10, 28], [27, 12], [28, 13],
  [12, 14], [13, 15], [12, 16], [13, 16], [14, 17], [15, 17], [16, 24],
  [17, 18], [17, 19], [17, 20], [17, 24], [18, 19], [18, 20], [19, 21], [20, 22],
  [21, 22], [21, 23], [22, 24], [23, 24], [24, 16], [25, 27], [26, 28],
];
const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }

// BFS path on the waypoint graph. Returns array of node indices (excluding start).
export function findPath(from, to) {
  if (from === to) return [];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const q = [from]; prev[from] = from;
  while (q.length) {
    const n = q.shift();
    if (n === to) break;
    for (const m of ADJ[n]) if (prev[m] === -1) { prev[m] = n; q.push(m); }
  }
  if (prev[to] === -1) return [];
  const path = []; let n = to;
  while (n !== from) { path.unshift(n); n = prev[n]; }
  return path;
}
export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x, dz = WAYPOINTS[i][1] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Circle (r) vs AABB in XZ: push the point out of every overlapping box.
export function collide(x, z, r) {
  for (let i = 0; i < WALLS.length; i++) {
    const b = WALLS[i];
    const cx = Math.max(b.x1, Math.min(x, b.x2)), cz = Math.max(b.z1, Math.min(z, b.z2));
    const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + dx / d * r; z = cz + dz / d * r;
      } else {
        const pl = x - b.x1, pr = b.x2 - x, pt = z - b.z1, pb = b.z2 - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = b.x1 - r; else if (m === pr) x = b.x2 + r;
        else if (m === pt) z = b.z1 - r; else z = b.z2 + r;
      }
    }
  }
  x = Math.max(BOUNDS.x1 + 0.6, Math.min(BOUNDS.x2 - 0.6, x));
  z = Math.max(BOUNDS.z1 + 0.6, Math.min(BOUNDS.z2 - 0.6, z));
  return [x, z];
}

export function hasLOS(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) return true;
  const ix = dx / d, iy = dy / d, iz = dz / d;
  for (let i = 0; i < WALLS.length; i++) {
    const t = segBox(x1, y1, z1, ix, iy, iz, d, WALLS[i]);
    if (t >= 0 && t < d - 0.05) return false;
  }
  return true;
}
export function inExtract(x, z) {
  const dx = x - EXTRACT.x, dz = z - EXTRACT.z;
  return dx * dx + dz * dz < EXTRACT.r * EXTRACT.r;
}

// ---- scene building ----
function snowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#dfe9f2'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5200; i++) {
    const s = Math.random();
    g.fillStyle = s < 0.5 ? 'rgba(150,180,210,0.28)' : 'rgba(255,255,255,0.5)';
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // packed-snow tracks along the lanes
  g.fillStyle = 'rgba(140,170,200,0.22)';
  for (const [x, y, w, h] of [[60, 236, 392, 40], [60, 40, 392, 26], [60, 446, 392, 26]]) g.fillRect(x, y, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function letterTexture(letter, color) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.font = 'bold 190px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.strokeText(letter, 128, 136);
  g.fillStyle = color; g.fillText(letter, 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function skyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2c4a72'); gr.addColorStop(0.45, '#6f9cc8');
  gr.addColorStop(0.62, '#cfe0ee'); gr.addColorStop(0.75, '#e8eef4'); gr.addColorStop(1, '#cfd9e4');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildScene(scene) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(62, 42),
    new THREE.MeshStandardMaterial({ map: snowTexture(), roughness: 0.9, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 16, 12),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
  scene.add(sky);
  scene.fog = new THREE.Fog(0xcfe0ee, 55, 150);
  const sun = new THREE.DirectionalLight(0xdfeaf5, 2.6);
  sun.position.set(-25, 42, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 120; sun.shadow.bias = -0.002;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbcd4ea, 0x8fa8c0, 1.1));

  const box = (x1, z1, x2, z2, h, mat, y0 = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, h, z2 - z1), mat);
    m.position.set((x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); return m;
  };
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a6a8a, roughness: 0.55, metalness: 0.35 });
  const slate = new THREE.MeshStandardMaterial({ color: 0x5a6a72, roughness: 0.7, metalness: 0.25 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x8a4a30, roughness: 0.75, metalness: 0.2 });
  const ice = new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85, metalness: 0.05 });
  const snowWall = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.9, metalness: 0 });
  const mats = [steel, slate, rust, ice];
  for (let i = 0; i < WALLS.length; i++) {
    const b = WALLS[i];
    const mat = i < 4 ? snowWall : (b.h > 3 ? wood : mats[i % 4]);
    box(b.x1, b.z1, b.x2, b.z2, b.h, mat);
    if (b.h <= 2.6 && b.h > 1.2) {
      const lid = new THREE.Mesh(new THREE.BoxGeometry(b.x2 - b.x1 + 0.06, 0.08, b.z2 - b.z1 + 0.06),
        new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 }));
      lid.position.set((b.x1 + b.x2) / 2, b.h + 0.04, (b.z1 + b.z2) / 2);
      scene.add(lid);
    }
  }
  // the extraction boat at the west dock: a simple hull + cabin
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.1, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x2a4a5a, roughness: 0.6, metalness: 0.3 }));
  hull.position.set(-28.5, 0.55, 4.5); hull.castShadow = true; scene.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.8),
    new THREE.MeshStandardMaterial({ color: 0xd8dee4, roughness: 0.6, metalness: 0.2 }));
  cabin.position.set(-28.5, 1.7, 4.5); cabin.castShadow = true; scene.add(cabin);
  // dock planks leading to the boat
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 2.4), wood);
    p.position.set(-27 + i * 0.2, 0.06, 4.5); p.receiveShadow = true; scene.add(p);
  }
  // frozen crates / barrels scattered (visual only, clear of lanes)
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3a5a7a, roughness: 0.6, metalness: 0.3 });
  for (const [x, z] of [[-24, -14], [-24, 14], [12, -18], [12, 18], [-2, -17], [-2, 17]]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12), barrelMat);
    bar.position.set(x, 0.65, z); bar.castShadow = true; scene.add(bar);
  }
  // extraction ring + floating E sign at the dock
  const ring = new THREE.Mesh(new THREE.RingGeometry(EXTRACT.r - 0.35, EXTRACT.r, 40),
    new THREE.MeshBasicMaterial({ color: 0x51d88a, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(EXTRACT.x, 0.03, EXTRACT.z); scene.add(ring);
  const signE = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: letterTexture('E', '#51d88a'), transparent: true, side: THREE.DoubleSide, fog: false }));
  signE.position.set(EXTRACT.x, 4.6, EXTRACT.z); scene.add(signE);
  // hostage cell marker: floating H sign over the warehouse
  const signH = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: letterTexture('H', '#ffb347'), transparent: true, side: THREE.DoubleSide, fog: false }));
  signH.position.set(HOSTAGE.x, 5.4, HOSTAGE.z); scene.add(signH);
  scene.userData.siteSigns = [signE, signH];
  return { sun };
}
