// FROSTLINE HUD: every DOM read is cached once, every update writes only what
// changed. The buy menu is built from the gun table so prices always match the sim.
import { GUNS, ARMOR_PRICE, GRENADE_PRICE } from './guns.js';

const $ = (id) => document.getElementById(id);
export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['timer', 'obj', 'score-v', 'score-c', 'alive-v', 'alive-c', 'feed',
      'hpnum', 'hpfill', 'armor', 'ammo', 'wname', 'money', 'reload', 'prompt', 'banner',
      'cross', 'hitm', 'dmg', 'lowhp', 'menu', 'buy', 'buygrid', 'buy-money', 'pause',
      'matchend', 'me-title', 'me-sub', 'matchstats']) this.el[id] = $(id);
    this.last = {};
    this.hitAt = 0;
    this.buildBuy();
  }
  set(id, v) { if (this.last[id] !== v) { this.last[id] = v; this.el[id].textContent = v; } }
  html(id, v) { if (this.last[id] !== v) { this.last[id] = v; this.el[id].innerHTML = v; } }

  // spread in radians -> crosshair gap in px
  crosshair(spread, firing) {
    const gap = Math.min(26, 3 + spread * 900);
    const c = this.el.cross.children;
    c[0].style.top = (-9 - gap) + 'px'; c[1].style.top = (gap) + 'px';
    c[2].style.left = (-9 - gap) + 'px'; c[3].style.left = (gap) + 'px';
    this.el.cross.style.opacity = firing ? 0.65 : 1;
  }
  hitmarker(kind) { // 'hit' | 'kill' | 'head'
    const h = this.el.hitm;
    h.className = kind === 'kill' ? 'k' : (kind === 'head' ? 'h' : '');
    h.style.opacity = 1;
    this.hitAt = performance.now();
    setTimeout(() => { if (performance.now() - this.hitAt > 110) h.style.opacity = 0; }, 120);
  }
  damageFlash() {
    const d = this.el.dmg;
    d.style.opacity = 0.9;
    setTimeout(() => { d.style.opacity = 0; }, 140);
  }
  update(s) {
    this.set('hpnum', String(Math.max(0, Math.ceil(s.hp))));
    this.el.hpfill.style.width = Math.max(0, s.hp) + '%';
    this.el.hpfill.classList.toggle('low', s.hp < 35);
    this.set('armor', s.armor > 0 ? 'ARMOR ' + Math.ceil(s.armor) : '');
    this.el.ammo.classList.toggle('empty', s.mag === 0);
    this.html('ammo', s.mag + ' <small>/ ' + s.reserve + '</small>');
    this.set('wname', s.wname);
    this.set('money', '$' + s.money);
    this.set('reload', s.reloading ? 'RELOADING…' : '');
    this.set('timer', s.timer);
    this.el.timer.classList.toggle('low', s.timerLow);
    this.html('obj', s.objHtml);
    this.set('score-v', String(s.scoreV));
    this.set('score-c', String(s.scoreC));
    this.html('alive-v', s.aliveV.map((a, i) => '<i class="' + (a ? '' : 'dead') + (i === 0 ? ' me' : '') + '"></i>').join(''));
    this.html('alive-c', s.aliveC.map((a) => '<i class="' + (a ? '' : 'dead') + '"></i>').join(''));
    this.el.lowhp.style.opacity = s.lowHp ? 0.85 : 0;
  }
  prompt(html) { this.html('prompt', html || ''); }
  feed(html) {
    const f = this.el.feed;
    const div = document.createElement('div');
    div.innerHTML = html;
    f.prepend(div);
    while (f.children.length > 5) f.removeChild(f.lastChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 6000);
  }
  banner(kind, title, sub) {
    const b = this.el.banner;
    b.className = kind;
    b.querySelector('h2').textContent = title;
    b.querySelector('p').textContent = sub || '';
    b.classList.remove('hidden');
  }
  hideBanner() { this.el.banner.classList.add('hidden'); }
  show(id) { this.el[id].hidden = false; }
  hide(id) { this.el[id].hidden = true; }
  buildBuy() {
    const g = this.el.buygrid;
    const items = [];
    for (const k of ['smg', 'shotgun', 'rifle', 'dmr']) {
      const w = GUNS[k];
      items.push({ key: k, label: w.name, tag: w.kind + ' · ' + w.mag + ' rnd mag', price: w.price, kind: 'weapon' });
    }
    items.push({ key: 'armor', label: 'Combat Armor', tag: 'Absorbs 50% damage', price: ARMOR_PRICE, kind: 'armor' });
    items.push({ key: 'grenade', label: 'Snowball Frag Grenade', tag: 'Throw with G · blast radius 7.5 m', price: GRENADE_PRICE, kind: 'grenade' });
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'buyitem'; d.dataset.key = it.key; d.dataset.kind = it.kind;
      d.innerHTML = '<span>' + it.label + '<span class="tag">' + it.tag + '</span></span><b>$' + it.price + '</b>';
      g.appendChild(d);
    }
  }
  refreshBuy(state) {
    this.set('buy-money', 'Money: $' + state.money);
    for (const d of this.el.buygrid.children) {
      const key = d.dataset.key, kind = d.dataset.kind;
      const owned = kind === 'weapon' ? state.owned.has(key) : (kind === 'armor' ? state.armor > 0 : state.grenades > 0);
      const price = kind === 'weapon' ? GUNS[key].price : (kind === 'armor' ? ARMOR_PRICE : GRENADE_PRICE);
      d.classList.toggle('owned', owned);
      d.classList.toggle('cant', !owned && state.money < price);
    }
  }
  matchEnd(win, title, sub, statsHtml) {
    this.el['me-title'].textContent = title;
    this.el['me-sub'].textContent = sub;
    this.el.matchstats.innerHTML = statsHtml;
    this.hide('menu'); this.hide('buy'); this.hide('pause');
    this.show('matchend');
  }
}
