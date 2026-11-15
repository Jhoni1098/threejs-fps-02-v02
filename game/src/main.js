// FROSTLINE entry point: renderer, input, pointer lock, viewmodel, FX pools and
// the fixed-step loop that drives the sim. Also the `?shot=` hooks the screenshots
// use: start / buy / play / win, each with a seeded RNG so the frame is reproducible.
import * as THREE from 'three';
import { buildScene } from './world.js';
import { Game } from './sim.js';
import { Sfx } from './sound.js';
import { Hud } from './ui.js';
import { GUNS } from './guns.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';
const SEED = Number(params.get('seed') || '7');
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
if (SHOT) Math.random = mulberry32(SEED);

const sfx = new Sfx();
const hud = new Hud();
const game = new Game(sfx, hud);

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
buildScene(scene);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

// ---- bot meshes (one group per bot, rebuilt per round) ----
const botMeshes = new Map();
const MAT_AUR = new THREE.MeshStandardMaterial({ color: 0x7fb8d8, roughness: 0.7 });
const MAT_BRK = new THREE.MeshStandardMaterial({ color: 0xc25a2e, roughness: 0.7 });
const MAT_DARK = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.85 });
const MAT_GUN = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.45, metalness: 0.6 });
function makeBotMesh(bot) {
  const g = new THREE.Group();
  const mat = bot.team === 'aur' ? MAT_AUR : MAT_BRK;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.36), mat);
  torso.position.y = 1.05; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8b48f, roughness: 0.8 }));
  head.position.y = 1.62; head.castShadow = true; g.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), MAT_DARK);
  helm.position.y = 1.64; g.add(helm);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.26), MAT_DARK);
  legL.position.set(-0.16, 0.31, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.16; g.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85), MAT_GUN);
  gun.position.set(0.22, 1.28, -0.42); gun.castShadow = true; g.add(gun);
  const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.13),
    new THREE.MeshBasicMaterial({ color: bot.team === 'aur' ? 0x8fd8ff : 0xff7a4e }));
  mark.position.y = 2.05; g.add(mark);
  g.userData.mark = mark;
  scene.add(g);
  botMeshes.set(bot, g);
  return g;
}
function syncBotMeshes() {
  for (const [bot, g] of botMeshes) {
    if (!bot.alive) { g.visible = false; continue; }
    g.visible = true;
    g.position.set(bot.x, 0, bot.z);
    g.rotation.y = bot.yaw;
    g.userData.mark.rotation.y += 0.06;
    g.scale.y = bot.crouch ? 0.72 : 1;
  }
}
// ---- hostage mesh: an orange-suited figure with a floating marker ----
const hostageMesh = new THREE.Group();
{
  const suit = new THREE.MeshStandardMaterial({ color: 0xe87a1e, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.34), suit);
  torso.position.y = 1.02; torso.castShadow = true; hostageMesh.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8b48f, roughness: 0.8 }));
  head.position.y = 1.6; hostageMesh.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.6, 0.25), MAT_DARK);
  legL.position.set(-0.15, 0.3, 0); hostageMesh.add(legL);
  const legR = legL.clone(); legR.position.x = 0.15; hostageMesh.add(legR);
  const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.16),
    new THREE.MeshBasicMaterial({ color: 0xffb347 }));
  mark.position.y = 2.1; hostageMesh.add(mark);
  hostageMesh.userData.mark = mark;
  hostageMesh.visible = false;
  scene.add(hostageMesh);
}

// ---- viewmodel: a boxy rifle attached to the camera ----
const MAT_VM = new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.45, metalness: 0.5, emissive: 0x141c24 });
const MAT_VM_DARK = new THREE.MeshStandardMaterial({ color: 0x2a323c, roughness: 0.6, metalness: 0.4, emissive: 0x0c1014 });
const vm = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), MAT_VM);
  body.position.set(0, 0, -0.1); vm.add(body);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.12), MAT_VM_DARK);
  mag.position.set(0, -0.13, 0.02); mag.rotation.x = 0.25; vm.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), MAT_VM);
  sight.position.set(0, 0.1, -0.05); vm.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), MAT_VM_DARK);
  grip.position.set(0, -0.1, 0.22); grip.rotation.x = 0.4; vm.add(grip);
  vm.position.set(0.28, -0.27, -0.55);
  vm.scale.setScalar(0.7);
  camera.add(vm);
}
const flashLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
flashLight.position.set(0.28, -0.22, -1.05);
camera.add(flashLight);
const flashQuad = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34),
  new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
flashQuad.position.set(0.28, -0.22, -1.0);
camera.add(flashQuad);
let flashT = 0;

// ---- FX pools: tracers, explosions ----
const tracers = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
  line.visible = false; scene.add(line);
  tracers.push({ line, life: 0 });
}
function spawnTracer(from, to, color) {
  const t = tracers.find((x) => x.life <= 0) || tracers[0];
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from[0], from[1], from[2]);
  pos.setXYZ(1, to[0], to[1], to[2]);
  pos.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.visible = true;
  t.life = 0.09;
}
const booms = [];
for (let i = 0; i < 2; i++) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0 }));
  const light = new THREE.PointLight(0xff7a2e, 0, 26, 1.6);
  mesh.add(light); mesh.visible = false; scene.add(mesh);
  booms.push({ mesh, light, life: 0 });
}
function spawnBoom(at) {
  const b = booms.find((x) => x.life <= 0) || booms[0];
  b.mesh.position.set(at[0], at[1], at[2]);
  b.mesh.visible = true; b.life = 0.55;
}
const grenadeMeshes = [];
function syncGrenades() {
  while (grenadeMeshes.length < game.grenades.length) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.5, metalness: 0.4 }));
    scene.add(m); grenadeMeshes.push(m);
  }
  for (let i = 0; i < grenadeMeshes.length; i++) {
    const m = grenadeMeshes[i];
    if (i < game.grenades.length) {
      const g = game.grenades[i];
      m.visible = true; m.position.set(g.x, g.y, g.z);
    } else m.visible = false;
  }
}

// ---- input ----
const input = {
  moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false,
  fire: false, firePressed: false, reload: false, grenade: false, use: false,
  yawDelta: 0, pitchDelta: 0,
};
const keys = {};
let locked = false, paused = false, frozen = false;
const isBuyOpen = () => !hud.el.buy.hidden;

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyB' && game.phase === 'buy' && hud.el.matchend.hidden) {
    if (isBuyOpen()) { hud.hide('buy'); lockPointer(); }
    else { hud.show('buy'); hud.refreshBuy(buyState()); document.exitPointerLock?.(); }
  }
  if (e.code === 'KeyR') input.reload = true;
  if (e.code === 'KeyG') input.grenade = true;
  if (e.code === 'KeyE') input.use = true;
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= 5) game.selectWeapon(n - 1);
    if (isBuyOpen()) buyByIndex(n);
  }
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyR') input.reload = false;
  if (e.code === 'KeyG') input.grenade = false;
  if (e.code === 'KeyE') input.use = false;
  if (e.code === 'Space') input.jump = false;
});
addEventListener('mousemove', (e) => {
  if (!locked) return;
  input.yawDelta += e.movementX;
  input.pitchDelta += e.movementY;
});
addEventListener('mousedown', (e) => {
  if (!locked || e.button !== 0) return;
  input.fire = true; input.firePressed = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) { input.fire = false; } });
addEventListener('wheel', (e) => {
  if (!game.player || !game.player.alive) return;
  const order = ['pistol', 'smg', 'shotgun', 'rifle', 'dmr'].filter((k) => game.player.owned.has(k));
  const i = order.indexOf(game.player.cur);
  const n = order[(i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length];
  if (n) game.selectWeapon(['pistol', 'smg', 'shotgun', 'rifle', 'dmr'].indexOf(n));
});
function lockPointer() {
  if (SHOT) return;
  renderer.domElement.requestPointerLock?.();
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && (game.phase === 'live' || game.phase === 'buy') && !SHOT && hud.el.matchend.hidden) {
    paused = true; hud.show('pause');
  } else if (locked) { paused = false; hud.hide('pause'); }
});
function buyState() {
  const p = game.player;
  return { money: p.money, owned: p.owned, grenades: p.grenades, armor: p.armor };
}
function buyByIndex(n) {
  const map = { 1: 'smg', 2: 'shotgun', 3: 'rifle', 4: 'dmr', 5: 'armor', 6: 'grenade' };
  const key = map[n];
  if (key && game.buy(key)) hud.refreshBuy(buyState());
}
document.getElementById('buygrid').addEventListener('click', (e) => {
  const item = e.target.closest('.buyitem');
  if (!item) return;
  if (game.buy(item.dataset.key)) hud.refreshBuy(buyState());
});
document.getElementById('buyclose').addEventListener('click', () => { hud.hide('buy'); lockPointer(); });
document.getElementById('playbtn').addEventListener('click', () => {
  sfx.ensure();
  hud.hide('menu');
  if (game.phase === 'menu') game.startMatch();
  lockPointer();
});
document.getElementById('resumebtn').addEventListener('click', () => { paused = false; hud.hide('pause'); lockPointer(); });
document.getElementById('restartbtn').addEventListener('click', () => {
  paused = false; hud.hide('pause'); game.startMatch(); lockPointer();
});
document.getElementById('againbtn').addEventListener('click', () => {
  hud.hide('matchend'); game.startMatch(); lockPointer();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- shot-mode setup ----
function setupShot() {
  if (!SHOT) return;
  hud.hide('menu');
  if (SHOT === 'start') {
    hud.show('menu');
    camera.position.set(-24, 4.5, 12);
    camera.rotation.set(-0.12, 0.9, 0);
    frozen = true;
    return;
  }
  game.startMatch();
  if (SHOT === 'buy') {
    hud.show('buy'); hud.refreshBuy(buyState());
    camera.position.set(-28, 1.6, 0); camera.rotation.set(0, Math.PI / 2, 0);
    frozen = true;
    return;
  }
  if (SHOT === 'play') {
    game.phase = 'live'; game.timer = 96;
    // player at the warehouse door, looking east at the hostage + two defenders
    const brk = game.bots.filter((b) => b.team === 'brk');
    brk[0].x = 24; brk[0].z = -3; brk[0].yaw = -Math.PI / 2;
    brk[1].x = 24; brk[1].z = 3; brk[1].yaw = -Math.PI / 2;
    brk[2].x = 18; brk[2].z = -5; brk[2].yaw = -Math.PI / 2;
    const aur = game.bots.filter((b) => b.team === 'aur');
    aur[0].x = 14; aur[0].z = -4; aur[0].yaw = -Math.PI / 2;
    game.player.x = 12; game.player.z = 0; game.player.yaw = -Math.PI / 2 + 0.02; game.player.pitch = 0.0;
    game.player.cur = 'rifle';
    game.player.weapons.rifle = { mag: 30, reserve: 90 };
    game.player.owned.add('rifle');
    game.fx.push({ type: 'tracer', from: [12, 1.5, 0], to: [24, 1.3, -3], color: 0xffc46b });
    for (let i = 0; i < 20; i++) game.step(1 / 60, blankInput());
    frozen = true;
    return;
  }
  if (SHOT === 'win') {
    game.phase = 'end'; game.timer = 3;
    game.scoreA = 1;
    game.hostage.state = 'extracted';
    hud.banner('win', 'ROUND WON', 'Hostage extracted at the dock');
    camera.position.set(-22, 3.2, -6);
    camera.rotation.set(-0.15, 1.9, 0);
    frozen = true;
    return;
  }
}
function blankInput() {
  return { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, fire: false, firePressed: false, reload: false, grenade: false, use: false, yawDelta: 0, pitchDelta: 0 };
}

// ---- main loop ----
let last = performance.now(), acc = 0, shake = 0;
function readKeys() {
  input.moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  input.moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  input.crouch = !!keys.ControlLeft || !!keys.KeyC;
  input.walk = !!keys.ShiftLeft || !!keys.ShiftRight;
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  readKeys();
  if (!paused && !frozen && game.phase !== 'menu' && game.phase !== 'matchend') {
    acc += dt;
    while (acc >= 1 / 60) {
      game.step(1 / 60, input);
      acc -= 1 / 60;
      input.yawDelta = 0; input.pitchDelta = 0;
      input.firePressed = false; input.reload = false; input.grenade = false; input.jump = false;
    }
  } else {
    input.yawDelta = 0; input.pitchDelta = 0;
    input.firePressed = false; input.reload = false; input.grenade = false; input.jump = false;
  }
  for (const f of game.fx) {
    if (f.type === 'tracer') spawnTracer(f.from, f.to, f.color);
    else if (f.type === 'explosion') { spawnBoom(f.at); shake = Math.min(1, shake + 0.7); }
    else if (f.type === 'muzzle') flashT = 0.05;
  }
  game.fx.length = 0;
  const p = game.player;
  if (p && game.phase !== 'menu' && SHOT !== 'start' && SHOT !== 'win') {
    camera.position.set(p.x, p.eyeY, p.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch + p.recoil;
    camera.rotation.z = 0;
    if (shake > 0) {
      camera.rotation.x += (Math.random() - 0.5) * shake * 0.03;
      camera.rotation.y += (Math.random() - 0.5) * shake * 0.03;
      shake = Math.max(0, shake - dt * 2.2);
    }
    vm.position.z = -0.55 + (p.recoil * 2.2);
    vm.position.y = -0.27 - (p.reloading > 0 ? 0.12 : 0);
    vm.rotation.x = p.recoil * 1.5;
    vm.visible = p.alive;
  }
  flashT = Math.max(0, flashT - dt);
  flashLight.intensity = flashT > 0 ? 26 : 0;
  flashQuad.material.opacity = flashT > 0 ? 0.9 : 0;
  flashQuad.rotation.z = Math.random() * Math.PI;
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
      if (t.life <= 0) t.line.visible = false;
    }
  }
  for (const b of booms) {
    if (b.life > 0) {
      b.life -= dt;
      const f = 1 - b.life / 0.55;
      const s = 0.6 + f * 7.5;
      b.mesh.scale.set(s, s, s);
      b.mesh.material.opacity = Math.max(0, 0.85 * (1 - f));
      b.light.intensity = 60 * (1 - f);
      if (b.life <= 0) { b.mesh.visible = false; b.light.intensity = 0; }
    }
  }
  if (game.phase !== 'menu') {
    for (const b of game.bots) if (!botMeshes.has(b)) makeBotMesh(b);
    syncBotMeshes();
    syncGrenades();
    const h = game.hostage;
    if (h.state === 'held' || h.state === 'follow') {
      hostageMesh.visible = true;
      hostageMesh.position.set(h.x, 0, h.z);
      hostageMesh.rotation.y = h.yaw;
      hostageMesh.userData.mark.rotation.y += 0.08;
    } else hostageMesh.visible = false;
    for (const s of scene.userData.siteSigns || []) {
      s.quaternion.copy(camera.quaternion);
    }
  }
  if (game.phase !== 'menu' && p) {
    hud.update(game.hudState());
    const w = GUNS[p.cur];
    const spread = (w.spread + p.spread + (p.moving ? w.moveSpread : 0)) * (p.crouch ? w.crouchMul : 1);
    hud.crosshair(spread, input.fire);
    if (game.phase === 'live' && p.alive && game.hostage.state === 'follow' && game.hostage.leader === p) {
      hud.prompt('Hostage is with <b>YOU</b> — reach the green dock ring to extract');
    } else if (game.phase === 'live' && p.alive && game.hostage.state === 'follow') {
      hud.prompt('Hostage is moving — escort them to the dock');
    } else if (game.phase === 'buy') {
      hud.prompt('Buy phase — press <span class="key">B</span> to open the shop');
    } else hud.prompt('');
    if (isBuyOpen()) hud.refreshBuy(buyState());
  }
  renderer.render(scene, camera);
}

setupShot();
if (!SHOT) {
  camera.position.set(-26, 6, 14);
  camera.rotation.set(-0.25, 0.8, 0);
  game.startMatch();
  game.phase = 'menu';
}
// debug hook (read-only state for play-testing; harmless in the shipped game)
window.__frostline = { game, hud };
requestAnimationFrame(frame);
