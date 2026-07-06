// ---- 簡易効果音 (WebAudio) ----
'use strict';

const SFX = {
  ctx: null,
  muted: false,

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { /* 音なしで続行 */ }
  },

  tone(freq, dur, type = 'sine', vol = 0.06, slide = 0, delay = 0) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* 無視 */ }
  },

  play(name) {
    switch (name) {
      case 'cast': this.tone(560, 0.12, 'square', 0.04, -200); break;
      case 'dash': this.tone(300, 0.18, 'sawtooth', 0.04, 260); break;
      case 'kill': this.tone(220, 0.35, 'sawtooth', 0.08, -130); break;
      case 'death': this.tone(160, 0.5, 'sawtooth', 0.08, -90); break;
      case 'tower': this.tone(110, 0.7, 'sawtooth', 0.1, -60); break;
      case 'buy': this.tone(880, 0.1, 'triangle', 0.05); this.tone(1320, 0.12, 'triangle', 0.05, 0, 0.08); break;
      case 'level': this.tone(440, 0.12, 'triangle', 0.06); this.tone(660, 0.18, 'triangle', 0.06, 0, 0.1); break;
      case 'recall': this.tone(520, 0.4, 'sine', 0.04, 240); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.07, 0, i * 0.16)); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.35, 'sawtooth', 0.06, 0, i * 0.18)); break;
    }
  },
};
