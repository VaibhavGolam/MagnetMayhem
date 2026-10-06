'use strict';
// All sound is synthesized with WebAudio, so the app ships no audio files.
const Sfx = (() => {
  let ac = null, master = null, humO = null, humG = null;
  let on = true, music = true, musT = null, step = 0, lastBoom = 0;

  function init() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.6;
      master.connect(ac.destination);
      humO = ac.createOscillator();
      humO.type = 'sawtooth';
      humO.frequency.value = 70;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      humG = ac.createGain();
      humG.gain.value = 0;
      humO.connect(lp); lp.connect(humG); humG.connect(master);
      humO.start();
    } catch (e) { ac = null; }
  }

  function resume() {
    init();
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function tone(f, d, type, vol, slide, delay) {
    if (!ac || !on) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + d);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + d + 0.03);
  }

  function noise(d, vol, fc) {
    if (!ac || !on) return;
    const n = Math.floor(ac.sampleRate * d);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ac.createBufferSource();
    s.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = fc || 800;
    const g = ac.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master);
    s.start();
  }

  const BASS = [55, 55, 82.4, 55, 65.4, 65.4, 98, 65.4];
  function musicTick() {
    if (!ac || !music || !on) return;
    const n = BASS[step % 8];
    tone(n, 0.18, 'triangle', 0.07);
    if (step % 4 === 2) tone(n * 8, 0.12, 'square', 0.015);
    if (step % 16 === 15) tone(n * 6, 0.25, 'sine', 0.02, 60);
    step++;
  }

  return {
    resume,
    configure(o) {
      on = !!o.snd; music = !!o.mus;
      if (!on) this.hum(0, 0);
      if (!music || !on) this.stopMusic();
    },
    hum(level, speed) {
      if (!ac) return;
      const t = ac.currentTime;
      humG.gain.setTargetAtTime(on ? level * 0.11 : 0, t, 0.05);
      humO.frequency.setTargetAtTime(58 + level * 40 + speed * 0.06, t, 0.08);
    },
    coin(i) { tone(1000 + Math.min(i, 12) * 70, 0.12, 'sine', 0.16, 500); },
    combo(level) {
      const b = 440 * Math.pow(1.06, Math.min(level, 20));
      tone(b, 0.1, 'square', 0.07, 80);
      tone(b * 1.5, 0.14, 'triangle', 0.08, 120, 0.05);
    },
    boom(power) {
      if (!ac) return;
      const now = ac.currentTime;
      if (now - lastBoom < 0.15) return;
      lastBoom = now;
      const v = 0.15 + 0.25 * (power || 1);
      tone(130, 0.22, 'sine', v, -90);
      noise(0.18, v * 0.6, 500);
    },
    slingshot() { tone(300, 0.25, 'sawtooth', 0.09, 900); },
    power() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'square', 0.07, 0, i * 0.06));
    },
    event() { tone(200, 0.5, 'sawtooth', 0.1, 400); tone(300, 0.5, 'square', 0.05, 500, 0.1); },
    death() { tone(160, 0.35, 'sawtooth', 0.22, -120); noise(0.3, 0.3, 700); },
    click() { tone(660, 0.06, 'square', 0.06); },
    startMusic() {
      if (musT || !ac) return;
      step = 0;
      musT = setInterval(musicTick, 60000 / 132 / 2);
    },
    stopMusic() { if (musT) { clearInterval(musT); musT = null; } }
  };
})();
