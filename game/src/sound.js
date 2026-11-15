// FROSTLINE synthesized sound: every effect is built from oscillators and
// filtered noise in a WebAudio graph, so the game ships no audio files. One
// AudioContext, one master gain, short envelopes; nothing allocates per frame.
export class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.noiseBuf = null; this.lastStep = 0;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  _noise(dur, type, freq, q, gain, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  _tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  shot(kind) {
    const p = { pistol: [0.09, 1900, 0.5], smg: [0.07, 2500, 0.4], rifle: [0.12, 1500, 0.65], dmr: [0.16, 1100, 0.8], shotgun: [0.18, 750, 0.9], enemy: [0.1, 1200, 0.35] }[kind] || [0.1, 1500, 0.5];
    this._noise(p[0], 'bandpass', p[1], 0.8, p[2]);
    this._tone(170, 0.07, 'square', 0.25, 60);
  }
  dry() { this._tone(1400, 0.03, 'square', 0.12); }
  reload() { this._tone(900, 0.04, 'square', 0.14); this._tone(600, 0.05, 'square', 0.16, 0, 0.18); }
  hit() { this._tone(2200, 0.05, 'sine', 0.22); }
  kill() { this._tone(880, 0.07, 'sine', 0.25); this._tone(1320, 0.1, 'sine', 0.25, 0, 0.08); }
  headshot() { this._tone(1760, 0.06, 'sine', 0.28); this._tone(2640, 0.09, 'sine', 0.22, 0, 0.05); }
  hurt() { this._tone(120, 0.15, 'sawtooth', 0.3, 60); this._noise(0.12, 'lowpass', 500, 1, 0.25); }
  step() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStep < 0.28) return;
    this.lastStep = now;
    this._noise(0.05, 'lowpass', 300, 1, 0.07);
  }
  bounce() { this._tone(300, 0.05, 'sine', 0.12, 180); }
  beep(n = 1) { for (let i = 0; i < n; i++) this._tone(1050, 0.07, 'square', 0.18, 0, i * 0.16); }
  boom() {
    this._noise(0.9, 'lowpass', 400, 0.7, 0.9);
    this._tone(70, 0.7, 'sine', 0.6, 30);
    this._noise(0.3, 'highpass', 2000, 1, 0.3);
  }
  buy() { this._tone(660, 0.06, 'sine', 0.2); this._tone(990, 0.08, 'sine', 0.2, 0, 0.06); }
  deny() { this._tone(220, 0.12, 'square', 0.18, 180); }
  roundWin() { [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.16, 'triangle', 0.25, 0, i * 0.11)); }
  roundLose() { [392, 330, 262, 196].forEach((f, i) => this._tone(f, 0.18, 'triangle', 0.22, 0, i * 0.12)); }
  plantDone() { this._tone(700, 0.1, 'square', 0.22); this._tone(1050, 0.14, 'square', 0.22, 0, 0.1); }
}
