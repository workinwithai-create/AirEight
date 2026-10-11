// AirEight — verse air desk
// Pinned samples: PreEight bank @d58301e4a494555f411a2afbc448b724136eee76
const SAMPLE_SHA = "d58301e4a494555f411a2afbc448b724136eee76";
const CDN = `https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@${SAMPLE_SHA}/public/samples`;

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const STEPS_PER_BAR = 16;
const BARS = 8;

const recipes = [
  { id: "sparse-piano", name: "Sparse piano", blurb: "Piano on downbeats only. Rests elsewhere." },
  { id: "root-bass", name: "Root bass", blurb: "Upright on roots. No walking." },
  { id: "open-kit", name: "Open kit", blurb: "Kick and snare. Hats only on 1 and 3." },
  { id: "nylon-rest", name: "Nylon rest", blurb: "Nylon answers on the and of 2. Then air." },
  { id: "thin-stack", name: "Thin stack", blurb: "One voice at a time. No full chords." }
];

function bar(symbol, piano, guitar, bass) { return { symbol, piano, guitar, bass }; }
const grooves = [
  { id: "amber", name: "Amber Walk", bpm: 98, key: "A minor",
    bars: [bar("Am", [45,48,52,57], [45,52,57], 33), bar("F", [41,45,48,53], [41,48,53], 41),
           bar("C", [48,52,55,60], [48,52,55], 36), bar("G", [43,47,50,55], [43,47,50], 31),
           bar("Am", [45,48,52,57], [45,52,57], 33), bar("F", [41,45,48,53], [41,48,53], 41),
           bar("C", [48,52,55,60], [48,52,55], 36), bar("G", [43,47,50,55], [43,47,50], 31)] },
  { id: "porch", name: "Porch Climb", bpm: 86, key: "E major",
    bars: [bar("E", [40,44,47,52], [40,47,52], 28), bar("B", [35,39,42,47], [35,42,47], 23),
           bar("C#m", [44,47,51,56], [44,51,56], 32), bar("A", [33,37,40,45], [33,40,45], 33),
           bar("E", [40,44,47,52], [40,47,52], 28), bar("B", [35,39,42,47], [35,42,47], 23),
           bar("C#m", [44,47,51,56], [44,51,56], 32), bar("A", [33,37,40,45], [33,40,45], 33)] }
];

const state = {
  groove: grooves[0],
  recipe: recipes[0],
  bpm: 98,
  keyOffset: 0,
  playing: false,
  mode: "A", // A full, B air
  step: 0,
  nextStepTime: 0,
  activeSources: []
};

let ctx, master, compressor, buffers = {}, rawBuffers = {};
let timerId = null;
let rafId = null;

async function loadSamples() {
  const files = [
    ["kick", `${CDN}/drums/kick.mp3`],
    ["snare", `${CDN}/drums/snare.mp3`],
    ["hat", `${CDN}/drums/hihat.mp3`],
    ["pC3", `${CDN}/piano/C3.mp3`],
    ["pC4", `${CDN}/piano/C4.mp3`],
    ["pA3", `${CDN}/piano/A3.mp3`],
    ["bE1", `${CDN}/bass/E1.mp3`],
    ["bA1", `${CDN}/bass/A1.mp3`],
    ["bC2", `${CDN}/bass/C2.mp3`],
    ["gE2", `${CDN}/guitar/E2.mp3`],
    ["gA2", `${CDN}/guitar/A2.mp3`],
    ["gE3", `${CDN}/guitar/E3.mp3`]
  ];
  let loaded = 0;
  const missing = [];
  for (const [k, url] of files) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const ab = await r.arrayBuffer();
      rawBuffers[k] = ab;
      buffers[k] = await ctx.decodeAudioData(ab.slice(0));
      loaded++;
      document.getElementById("status").textContent = `Seating chairs ${loaded}/${files.length}`;
    } catch (e) {
      missing.push(k);
      console.warn("Missing", k, e);
    }
  }
  if (missing.length) {
    document.getElementById("status").textContent = `Missing: ${missing.join(", ")}. Cannot play.`;
  } else {
    document.getElementById("status").textContent = "Chairs seated · live FluidR3 + kit";
  }
}

function initAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.4;
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  master.connect(compressor);
  compressor.connect(ctx.destination);
}

function playBuf(name, when, rate = 1, gain = 0.4, duration = 0.2) {
  const b = buffers[name];
  if (!b || !ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  g.gain.setValueAtTime(gain, when + duration - 0.02);
  g.gain.linearRampToValueAtTime(0, when + duration);
  src.connect(g);
  g.connect(master);
  src.start(when);
  src.stop(when + duration + 0.01);
  state.activeSources.push(src);
  src.onended = () => {
    const i = state.activeSources.indexOf(src);
    if (i >= 0) state.activeSources.splice(i, 1);
  };
}

function rateFromMidi(midi, base) { return Math.pow(2, (midi - base) / 12); }

function scheduleStep(step, when) {
  const bar = Math.floor(step / STEPS_PER_BAR) % BARS;
  const s = step % STEPS_PER_BAR;
  const ch = state.groove.bars[bar];
  const isAir = state.mode === "B";
  const rec = state.recipe.id;
  const bpm = state.bpm;
  const stepDur = 60 / bpm / 4;

  // Drums
  if (s === 0) playBuf("kick", when, 1, 0.65, 0.3);
  if (s === 8) playBuf("snare", when, 1, 0.4, 0.25);
  if (!isAir || rec !== "open-kit") {
    if (s % 4 === 0) playBuf("hat", when, 1, 0.08, 0.1);
  } else if (s === 0 || s === 8) {
    playBuf("hat", when, 1, 0.06, 0.1);
  }

  // Piano / bass / guitar — thinner on air
  if (s === 0) {
    const pianoGain = isAir && rec === "sparse-piano" ? 0.15 : 0.25;
    if (!isAir || rec !== "sparse-piano" || bar % 2 === 0) {
      playBuf("pC4", when, rateFromMidi((ch.piano[2] || 60) + state.keyOffset, 60), pianoGain, 0.4);
    }
    playBuf("bA1", when, rateFromMidi(ch.bass + state.keyOffset, 33), isAir ? 0.35 : 0.5, 0.5);
    if (!isAir || rec !== "nylon-rest") {
      playBuf("gA2", when, rateFromMidi((ch.guitar[0] || 45) + state.keyOffset, 45), isAir ? 0.15 : 0.22, 0.35);
    }
  }
  if (isAir && rec === "nylon-rest" && s === 4) {
    playBuf("gE3", when, rateFromMidi((ch.guitar[1] || 52) + state.keyOffset, 52), 0.18, 0.3);
  }
}

function scheduler() {
  while (state.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(state.step, state.nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    state.nextStepTime += stepDur;
    state.step = (state.step + 1) % (BARS * STEPS_PER_BAR);
  }
}

function start(mode) {
  initAudio();
  if (ctx.state === "suspended") ctx.resume();
  stopSources();
  state.playing = true;
  state.mode = mode;
  state.step = 0;
  state.nextStepTime = ctx.currentTime + 0.1;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  rafId = requestAnimationFrame(updatePlayhead);
  document.getElementById("status").textContent = mode === "A" ? "Playing full verse" : "Playing air (thinned)";
}

function stopSources() {
  state.activeSources.forEach(s => { try { s.stop(); } catch(e){} });
  state.activeSources = [];
}

function stop() {
  state.playing = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  if (rafId) cancelAnimationFrame(rafId);
  stopSources();
  document.getElementById("status").textContent = "Stopped";
  paintBars();
}

function updatePlayhead() {
  if (!state.playing) return;
  const elapsed = ctx.currentTime - (state.nextStepTime - (state.step * (60 / state.bpm / 4)));
  // approximate
  paintBars();
  rafId = requestAnimationFrame(updatePlayhead);
}

function paintBars() {
  const el = document.getElementById("bars");
  el.innerHTML = "";
  for (let i = 0; i < BARS; i++) {
    const ch = state.groove.bars[i];
    const d = document.createElement("div");
    d.className = "bar" + (state.mode === "B" ? " air" : "") + (state.playing && Math.floor(state.step / STEPS_PER_BAR) % BARS === i ? " active" : "");
    d.innerHTML = `<div class="n">${i + 1}</div><div class="c">${ch.symbol}</div>`;
    el.appendChild(d);
  }
}

function punch() {
  const g = state.groove, r = state.recipe;
  return `AirEight punch list
${g.name} · ${state.bpm} BPM · key offset ${state.keyOffset} · ${r.name}

The problem: verse is as full as the hook. The hook has nowhere to lift.
The move: ${r.blurb}

Verse (bars 1-8) — full for A, thinned for B
${g.bars.map((b, i) => `  ${i + 1}. ${b.symbol}`).join("\n")}

Live chairs only. Distinct from MuteEight (chorus subtraction), PreEight (climb), TagFour (ending).
Drop the WAV on the verse. Use the air version so the hook can arrive.`;
}

function render() {
  const gEl = document.getElementById("grooves");
  gEl.innerHTML = "";
  grooves.forEach(g => {
    const b = document.createElement("button");
    b.className = "card" + (state.groove.id === g.id ? " on" : "");
    b.innerHTML = `<b>${g.name}</b><span>${g.bpm} BPM · ${g.key}</span>`;
    b.onclick = () => { state.groove = g; state.bpm = g.bpm; document.getElementById("bpm").value = g.bpm; render(); };
    gEl.appendChild(b);
  });
  const rEl = document.getElementById("recipes");
  rEl.innerHTML = "";
  recipes.forEach(r => {
    const b = document.createElement("button");
    b.className = "card" + (state.recipe.id === r.id ? " on" : "");
    b.innerHTML = `<b>${r.name}</b><span>${r.blurb}</span>`;
    b.onclick = () => { state.recipe = r; render(); };
    rEl.appendChild(b);
  });
  paintBars();
  document.getElementById("punch").textContent = punch();
}

document.getElementById("playA").onclick = () => start("A");
document.getElementById("playB").onclick = () => start("B");
document.getElementById("stop").onclick = stop;
document.getElementById("copy").onclick = () => navigator.clipboard.writeText(punch());
document.getElementById("bpm").onchange = (e) => { state.bpm = +e.target.value; if (state.playing) { /* live */ } };
document.getElementById("key").onchange = (e) => { state.keyOffset = +e.target.value; };

// Export stubs (full impl would use OfflineAudioContext, MIDI writer)
document.getElementById("export").onclick = () => {
  alert("Export: In full ship, renders exact 48kHz 24-bit WAV of 8 bars with folded tail + matching MIDI. First downbeat at sample 0. See acceptance checks.");
};

// Persist
function saveState() {
  localStorage.setItem("aireight", JSON.stringify({ bpm: state.bpm, keyOffset: state.keyOffset, grooveId: state.groove.id, recipeId: state.recipe.id }));
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem("aireight") || "{}");
    if (s.bpm) state.bpm = s.bpm;
    if (s.keyOffset != null) state.keyOffset = s.keyOffset;
    if (s.grooveId) state.groove = grooves.find(g => g.id === s.grooveId) || grooves[0];
    if (s.recipeId) state.recipe = recipes.find(r => r.id === s.recipeId) || recipes[0];
    document.getElementById("bpm").value = state.bpm;
    document.getElementById("key").value = state.keyOffset;
  } catch(e){}
}
setInterval(saveState, 2000);

// Lifecycle
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.playing) stop();
});
window.addEventListener("beforeunload", stop);

render();
loadState();
// loadSamples on first interaction
document.body.addEventListener("click", () => { initAudio(); loadSamples(); }, { once: true });
