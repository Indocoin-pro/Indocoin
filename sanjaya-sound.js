/**
 * SANJAYA Sound System — Gamelan Web Audio Engine
 * Menggunakan Web Audio API murni, tidak butuh file audio eksternal.
 * Semua suara dihasilkan secara prosedural (synthesized).
 */

(function(){
  'use strict';

  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let bgmNode = null;
  let bgmInterval = null;
  let _muted = false;
  let _musicVol = 0.35;
  let _sfxVol = 0.6;
  let _initialized = false;
  let _currentBgm = null;

  // ═══════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════
  function init() {
    if (_initialized) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain(); masterGain.gain.value = 1.0;
      musicGain  = ctx.createGain(); musicGain.gain.value  = _musicVol;
      sfxGain    = ctx.createGain(); sfxGain.gain.value    = _sfxVol;
      musicGain.connect(masterGain);
      sfxGain.connect(masterGain);
      masterGain.connect(ctx.destination);
      _initialized = true;
    } catch(e) {
      console.warn("SANJAYA Sound: Web Audio API tidak tersedia.", e);
    }
  }

  function ensureInit() {
    if (!_initialized) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ═══════════════════════════════════════
  // PRIMITIVE OSCILLATOR HELPERS
  // ═══════════════════════════════════════
  function playTone(freq, type, duration, gainVal, startTime, dest, detune=0) {
    if (!ctx) return null;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type    = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (detune) osc.detune.value = detune;
    gain.gain.setValueAtTime(gainVal, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(dest || sfxGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
    return { osc, gain };
  }

  function playNoise(duration, gainVal, startTime, freq=800, q=5) {
    if (!ctx) return;
    const buf  = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src    = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain   = ctx.createGain();
    src.buffer = buf;
    filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = q;
    gain.gain.setValueAtTime(gainVal, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    src.connect(filter); filter.connect(gain); gain.connect(sfxGain);
    src.start(startTime); src.stop(startTime + duration + 0.05);
  }

  // ═══════════════════════════════════════
  // GAMELAN INSTRUMENTS (synthesized)
  // ═══════════════════════════════════════

  // Slenthem (low metallophone)
  function slenthem(freq, t, vol=0.4) {
    playTone(freq,      'sine',     1.2, vol*0.7, t, musicGain);
    playTone(freq*2.76, 'sine',     0.6, vol*0.25, t, musicGain);
    playTone(freq*5.4,  'sine',     0.3, vol*0.12, t, musicGain);
    playNoise(0.04,     vol*0.15,   t,   freq*4, 3);
  }

  // Bonang (mid metallophone)
  function bonang(freq, t, vol=0.35) {
    playTone(freq,      'sine',     0.8, vol*0.8, t, musicGain);
    playTone(freq*2.1,  'triangle', 0.5, vol*0.3, t, musicGain);
    playTone(freq*3.9,  'sine',     0.25, vol*0.1, t, musicGain);
    playNoise(0.03,     vol*0.2,    t,   freq*3, 4);
  }

  // Kenong (large pot gong)
  function kenong(freq, t, vol=0.5) {
    playTone(freq,      'sine',     2.0, vol*0.9, t, musicGain);
    playTone(freq*1.05, 'sine',     1.5, vol*0.4, t, musicGain);
    playTone(freq*2.8,  'sine',     0.8, vol*0.2, t, musicGain);
    playNoise(0.06,     vol*0.3,    t,   freq*2, 5);
  }

  // Gong Ageng (large ceremonial gong)
  function gongAgeng(freq, t, vol=0.6) {
    playTone(freq,      'sine',     4.0, vol,     t, musicGain, -10);
    playTone(freq*1.02, 'sine',     3.5, vol*0.5, t, musicGain,  10);
    playTone(freq*2.15, 'sine',     2.0, vol*0.3, t, musicGain);
    playTone(freq*4.1,  'sine',     1.0, vol*0.15, t, musicGain);
    playNoise(0.1,      vol*0.4,    t,   freq*2, 6);
  }

  // Kendang (drum)
  function kendang(t, isDownbeat=false, vol=0.45) {
    const f = isDownbeat ? 80 : 140;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f*0.5, t+0.1);
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + (isDownbeat ? 0.35 : 0.18));
    osc.connect(env); env.connect(sfxGain);
    osc.start(t); osc.stop(t + 0.4);
    playNoise(isDownbeat?0.06:0.04, vol*0.3, t, isDownbeat?200:400, 3);
  }

  // Saron (metallophone melody)
  function saron(freq, t, vol=0.4) {
    playTone(freq,     'square',   0.35, vol*0.5, t, musicGain);
    playTone(freq,     'sine',     0.5,  vol*0.7, t, musicGain);
    playTone(freq*2,   'sine',     0.2,  vol*0.2, t, musicGain);
    playNoise(0.025,   vol*0.25,   t,    freq*5, 5);
  }

  // ═══════════════════════════════════════
  // PENTATONIC SCALES (Pelog & Slendro)
  // ═══════════════════════════════════════
  // Pelog scale (frequensi relatif dari C3 = 130.81)
  const BASE = 130.81;
  const PELOG   = [1, 1.067, 1.185, 1.333, 1.5, 1.6, 1.78].map(r => BASE * r);
  const SLENDRO = [1, 1.125, 1.266, 1.5, 1.688].map(r => BASE * r);

  // ═══════════════════════════════════════
  // BGM PATTERNS
  // ═══════════════════════════════════════

  let _beatStep = 0;
  let _bgmType  = 'lobby';

  const PATTERNS = {
    lobby: {
      tempo: 420, // ms per beat
      melody: [0,2,4,3,2,0,4,2, 0,3,4,2,0,4,3,2],
      bass:   [0,0,2,0,4,0,2,0, 0,0,4,0,2,0,0,4],
      gong:   [0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1],
      kenongAt:[3,7,11,15],
      drumPat: [1,0,0,1,0,1,0,0, 1,0,0,1,0,0,1,0],
      scale: PELOG
    },
    race: {
      tempo: 240,
      melody: [0,2,3,4,2,0,3,4, 2,4,3,2,0,4,2,3],
      bass:   [0,0,4,0,2,4,0,2, 0,4,0,2,4,0,2,0],
      gong:   [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,1],
      kenongAt:[7,15],
      drumPat: [1,1,0,1,1,0,1,0, 1,1,0,1,0,1,1,0],
      scale: SLENDRO
    },
    victory: {
      tempo: 350,
      melody: [4,3,4,2,4,3,4,0, 4,2,0,2,4,3,2,4],
      bass:   [0,0,2,4,0,2,4,0, 2,0,4,0,2,4,0,2],
      gong:   [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,1],
      kenongAt:[3,7,11,15],
      drumPat: [1,0,1,0,1,0,1,1, 0,1,0,1,0,1,1,0],
      scale: PELOG
    },
    tense: {
      tempo: 200,
      melody: [0,4,1,3,0,4,2,3, 1,4,0,3,2,4,1,0],
      bass:   [0,0,0,2,0,0,2,0, 0,4,0,0,2,0,0,4],
      gong:   [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,1],
      kenongAt:[7,15],
      drumPat: [1,0,1,1,0,1,1,0, 1,1,0,1,0,1,1,1],
      scale: SLENDRO
    }
  };

  function tickBgm() {
    if (!ctx || _muted) return;
    ensureInit();
    const pat = PATTERNS[_bgmType] || PATTERNS.lobby;
    const step = _beatStep % 16;
    const t = ctx.currentTime + 0.01;
    const sc = pat.scale;

    // Melody (saron)
    const mIdx = pat.melody[step] % sc.length;
    saron(sc[mIdx] * (step % 4 === 0 ? 2 : 1), t, 0.25);

    // Bass (slenthem, octave bawah)
    if (step % 2 === 0) {
      const bIdx = pat.bass[step] % sc.length;
      slenthem(sc[bIdx] * 0.5, t, 0.3);
    }

    // Bonang (counter-melody)
    if (step % 3 === 0) {
      const cIdx = (pat.melody[step]+2) % sc.length;
      bonang(sc[cIdx] * 1.5, t, 0.2);
    }

    // Kenong
    if (pat.kenongAt.includes(step)) {
      kenong(sc[0] * 0.75, t, 0.35);
    }

    // Gong
    if (pat.gong[step]) {
      gongAgeng(sc[0] * 0.25, t, 0.5);
    }

    // Kendang
    if (pat.drumPat[step]) {
      kendang(t, step === 0, 0.3);
    }

    _beatStep++;
  }

  // ═══════════════════════════════════════
  // PUBLIC BGM API
  // ═══════════════════════════════════════
  function playBgm(type) {
    ensureInit();
    if (!ctx) return;
    if (bgmInterval) { clearInterval(bgmInterval); bgmInterval = null; }
    _bgmType  = type || 'lobby';
    _beatStep = 0;
    _currentBgm = type;
    const tempo = (PATTERNS[_bgmType]||PATTERNS.lobby).tempo;
    tickBgm(); // first beat immediately
    bgmInterval = setInterval(tickBgm, tempo);
  }

  function stopBgm() {
    if (bgmInterval) { clearInterval(bgmInterval); bgmInterval = null; }
    _currentBgm = null;
  }

  // ═══════════════════════════════════════
  // SOUND EFFECTS
  // ═══════════════════════════════════════
  const SFX = {

    // Klik / tap
    click() {
      ensureInit(); if (!ctx||_muted) return;
      playTone(880, 'sine', 0.06, 0.3, ctx.currentTime);
      playTone(1320,'sine', 0.04, 0.15, ctx.currentTime+0.02);
    },

    // Bergerak maju
    move() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      const f=SLENDRO[Math.floor(Math.random()*SLENDRO.length)]*2;
      bonang(f, t, 0.5);
    },

    // Serangan
    attack() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      playTone(150,'sawtooth',0.15,0.6,t);
      playTone(200,'sawtooth',0.1,0.4,t+0.03);
      playNoise(0.12, 0.5, t, 600, 2);
      playNoise(0.08, 0.3, t+0.05, 300, 3);
    },

    // Kena serangan / damage
    damage() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      playTone(300,'sawtooth',0.08,0.5,t);
      playTone(200,'sawtooth',0.06,0.4,t+0.04);
      playNoise(0.1, 0.4, t, 400, 3);
    },

    // Skill dipakai
    skill() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      [PELOG[4],PELOG[3],PELOG[2],PELOG[1],PELOG[0]].forEach((f,i)=>{
        bonang(f*2, t+i*0.06, 0.4);
      });
      playNoise(0.3, 0.2, t, 2000, 2);
    },

    // Pasang jebakan
    trap() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      playTone(200,'square',0.1,0.4,t);
      playTone(180,'square',0.08,0.3,t+0.08);
      playNoise(0.06, 0.3, t, 300, 4);
    },

    // Sembunyi
    hide() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      [1000,800,600].forEach((f,i)=>playTone(f,'sine',0.15,0.2,t+i*0.07));
    },

    // Level up / stage baru
    stageUp() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      [PELOG[0],PELOG[2],PELOG[4],PELOG[4]*2].forEach((f,i)=>{
        saron(f*2, t+i*0.1, 0.5);
        bonang(f*1.5, t+i*0.1+0.04, 0.3);
      });
      kenong(PELOG[0]*0.75, t+0.45, 0.5);
    },

    // Menang!
    win() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      // Fanfare gamelan
      [0,2,4,3,4,2,4].forEach((idx,i)=>{
        const f=PELOG[idx]*2;
        saron(f, t+i*0.12, 0.55);
        if(i%2===0) bonang(f*1.5, t+i*0.12+0.05, 0.3);
      });
      gongAgeng(PELOG[0]*0.25, t+0.9, 0.7);
      kenong(PELOG[0]*0.5, t+0.5, 0.5);
      setTimeout(()=>playBgm('victory'), 1000);
    },

    // Kalah
    lose() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      [PELOG[4],PELOG[2],PELOG[0],PELOG[0]*0.5].forEach((f,i)=>{
        slenthem(f, t+i*0.2, 0.4);
      });
      playNoise(0.4, 0.15, t+0.6, 200, 5);
    },

    // Gong besar (event penting)
    gong() {
      ensureInit(); if (!ctx||_muted) return;
      gongAgeng(PELOG[0]*0.25, ctx.currentTime, 0.6);
    },

    // Kenong kecil
    kenong() {
      ensureInit(); if (!ctx||_muted) return;
      kenong(PELOG[0]*0.75, ctx.currentTime, 0.5);
    },

    // Notifikasi / toast
    notify() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      bonang(PELOG[2]*2, t, 0.4);
      bonang(PELOG[4]*2, t+0.1, 0.3);
    },

    // Beli item
    buy() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      [PELOG[0],PELOG[2],PELOG[4]].forEach((f,i)=>{
        bonang(f*2, t+i*0.08, 0.4);
      });
      kenong(PELOG[2]*0.75, t+0.25, 0.4);
    },

    // Error / gagal
    error() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      playTone(200,'sawtooth',0.1,0.5,t);
      playTone(150,'sawtooth',0.08,0.4,t+0.08);
    },

    // Connect wallet
    connect() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      [SLENDRO[0],SLENDRO[2],SLENDRO[4]].forEach((f,i)=>{
        bonang(f*2, t+i*0.1, 0.4);
      });
    },

    // Countdown tick
    tick() {
      ensureInit(); if (!ctx||_muted) return;
      playTone(600,'sine',0.04,0.25,ctx.currentTime);
    },

    // Countdown final (3,2,1)
    tickFinal() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      playTone(1200,'sine',0.06,0.5,t);
      playNoise(0.05, 0.2, t, 800, 3);
    },

    // Jebakan kena
    trapHit() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      playNoise(0.15, 0.5, t, 300, 3);
      playTone(250,'square',0.1,0.4,t+0.05);
    },

    // Random event positif
    eventGood() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      [SLENDRO[2],SLENDRO[3],SLENDRO[4]].forEach((f,i)=>bonang(f*2,t+i*0.07,0.4));
    },

    // Random event negatif
    eventBad() {
      ensureInit(); if (!ctx||_muted) return;
      const t=ctx.currentTime;
      [SLENDRO[2],SLENDRO[1],SLENDRO[0]].forEach((f,i)=>slenthem(f,t+i*0.09,0.4));
    }
  };

  // ═══════════════════════════════════════
  // VOLUME & MUTE
  // ═══════════════════════════════════════
  function setMusicVol(v) {
    _musicVol = Math.max(0, Math.min(1, v));
    if (musicGain) musicGain.gain.value = _musicVol;
  }
  function setSfxVol(v) {
    _sfxVol = Math.max(0, Math.min(1, v));
    if (sfxGain) sfxGain.gain.value = _sfxVol;
  }
  function mute()   { _muted=true;  if(masterGain) masterGain.gain.value=0; }
  function unmute() { _muted=false; if(masterGain) masterGain.gain.value=1; }
  function toggleMute() { _muted ? unmute() : mute(); return _muted; }
  function isMuted() { return _muted; }
  function currentBgm() { return _currentBgm; }

  // ═══════════════════════════════════════
  // EXPORT GLOBAL
  // ═══════════════════════════════════════
  window.SanjayaSound = {
    init, playBgm, stopBgm,
    sfx: SFX,
    setMusicVol, setSfxVol,
    mute, unmute, toggleMute,
    isMuted, currentBgm
  };

})();
