const tracks = [
  { file: "music/track-1.mp3",  title: "Helix No. 1",  artist: "T. Schürger", label: "#f3ead5" },
  { file: "music/track-2.mp3",  title: "Helix No. 2",  artist: "T. Schürger", label: "#dfe7ea" },
  { file: "music/track-3.mp3",  title: "Helix No. 3",  artist: "T. Schürger", label: "#e4ecd9" },
  { file: "music/track-8.mp3",  title: "Helix No. 8",  artist: "T. Schürger", label: "#f2dcd6" },
  { file: "music/track-10.mp3", title: "Helix No. 10", artist: "T. Schürger", label: "#f4e8bf" },
  { file: "music/track-12.mp3", title: "Helix No. 12", artist: "T. Schürger", label: "#e2ddd6" },
];

const $ = (id) => document.getElementById(id);

const audio = $("audio");
const deck = document.querySelector(".deck");
const cassette = $("cassette");
const label = $("label");
const playBtn = $("playBtn");
const seek = $("seek");
const seekFill = $("seekFill");
const volume = $("volume");
const muteBtn = $("muteBtn");
const shuffleBtn = $("shuffleBtn");
const repeatBtn = $("repeatBtn");
const autoBtn = $("autoBtn");
const playlistEl = $("playlist");

const state = {
  index: 0,
  shuffle: false,
  repeat: "off",       // off | all | one
  autoplay: true,
  order: tracks.map((_, i) => i),
  seeking: false,
  switching: false,
  durations: [],
};

/* ---------------- helpers ---------------- */

function fmt(sec) {
  if (!isFinite(sec)) return "0:00";
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function save() {
  try {
    localStorage.setItem("side-a", JSON.stringify({
      index: state.index,
      volume: volume.value,
      shuffle: state.shuffle,
      repeat: state.repeat,
      autoplay: state.autoplay,
    }));
  } catch { /* storage blocked, not a big deal */ }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem("side-a"));
    if (!saved) return;
    if (saved.index in tracks) state.index = saved.index;
    if (saved.volume != null) volume.value = saved.volume;
    state.shuffle = !!saved.shuffle;
    state.repeat = saved.repeat || "off";
    state.autoplay = saved.autoplay !== false;
  } catch { /* ignore bad data */ }
}

/* ---------------- playlist ---------------- */

function buildPlaylist() {
  playlistEl.innerHTML = "";
  tracks.forEach((t, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <button type="button">
        <span class="num">${String(i + 1).padStart(2, "0")}</span>
        <span class="name">${t.title}</span>
        <span class="len">--:--</span>
      </button>`;
    li.querySelector("button").addEventListener("click", () => {
      if (i === state.index) togglePlay();
      else loadTrack(i, true);
    });
    playlistEl.appendChild(li);
  });
}

// read each file's length without downloading the whole thing
function fetchDurations() {
  tracks.forEach((t, i) => {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.src = t.file;
    probe.addEventListener("loadedmetadata", () => {
      state.durations[i] = probe.duration;
      playlistEl.children[i].querySelector(".len").textContent = fmt(probe.duration);
      updateTotal();
      probe.src = "";
    }, { once: true });
  });
}

function updateTotal() {
  const known = state.durations.filter(Boolean);
  const sum = known.reduce((a, b) => a + b, 0);
  $("total").textContent = `${tracks.length} tracks · ${fmt(sum)} total`;
}

function markCurrent() {
  [...playlistEl.children].forEach((li, i) => li.classList.toggle("is-current", i === state.index));
}

/* ---------------- loading tracks ---------------- */

function showTrack(t) {
  $("title").textContent = t.title;
  $("artist").textContent = t.artist;
  $("labelTitle").textContent = t.title;
  label.style.background = t.label;
  document.title = `${t.title} — Side A`;

  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: "Mixtape Vol. 1",
    });
  }
}

/*
  Changing tracks ejects the cassette, swaps the label while it's out
  of sight and slides it back in. Audio switches at the same time.
*/
function loadTrack(i, autoPlay) {
  if (state.switching) return;
  const n = tracks.length;
  state.index = (i + n) % n;
  const t = tracks[state.index];

  state.switching = true;
  cassette.classList.remove("is-loading");
  cassette.classList.add("is-ejecting");

  setTimeout(() => {
    audio.src = t.file;
    audio.load();
    showTrack(t);
    markCurrent();
    reel.shown = 0;     // fresh tape is fully on the left spool
    updateProgress();

    cassette.classList.remove("is-ejecting");
    void cassette.offsetWidth;
    cassette.classList.add("is-loading");
    state.switching = false;

    if (autoPlay) play();
    save();
  }, 430);
}

/* ---------------- transport ---------------- */

function play() {
  const p = audio.play();
  if (p) p.catch(() => { /* blocked until the user interacts — fine */ });
}

function pause() { audio.pause(); }

function togglePlay() {
  audio.paused ? play() : pause();
}

function stop() {
  audio.pause();
  audio.currentTime = 0;
}

function next(fromEnded = false) {
  const pos = state.order.indexOf(state.index);
  const atEnd = pos === state.order.length - 1;

  if (fromEnded && atEnd && state.repeat === "off") {
    // end of the tape
    stop();
    return;
  }
  loadTrack(state.order[(pos + 1) % state.order.length], fromEnded || !audio.paused);
}

function prev() {
  // like most players: first press restarts the song
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const pos = state.order.indexOf(state.index);
  const n = state.order.length;
  loadTrack(state.order[(pos - 1 + n) % n], !audio.paused);
}

function makeOrder() {
  const rest = tracks.map((_, i) => i).filter((i) => i !== state.index);
  if (state.shuffle) {
    // Fisher–Yates
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    state.order = [state.index, ...rest];
  } else {
    state.order = tracks.map((_, i) => i);
  }
}

/* ---------------- toggles ---------------- */

function renderToggles() {
  shuffleBtn.classList.toggle("is-on", state.shuffle);
  shuffleBtn.setAttribute("aria-pressed", state.shuffle);

  repeatBtn.classList.toggle("is-on", state.repeat !== "off");
  repeatBtn.textContent = `Repeat: ${state.repeat}`;
  audio.loop = state.repeat === "one";

  autoBtn.classList.toggle("is-on", state.autoplay);
  autoBtn.setAttribute("aria-pressed", state.autoplay);
}

shuffleBtn.addEventListener("click", () => {
  state.shuffle = !state.shuffle;
  makeOrder();
  renderToggles();
  save();
});

repeatBtn.addEventListener("click", () => {
  const modes = ["off", "all", "one"];
  state.repeat = modes[(modes.indexOf(state.repeat) + 1) % modes.length];
  renderToggles();
  save();
});

autoBtn.addEventListener("click", () => {
  state.autoplay = !state.autoplay;
  renderToggles();
  save();
});

/* ---------------- progress + seeking ---------------- */

function updateProgress() {
  const d = audio.duration || 0;
  const t = audio.currentTime || 0;
  if (!state.seeking) {
    seek.value = d ? (t / d) * 1000 : 0;
    $("elapsed").textContent = fmt(t);
  }
  $("duration").textContent = fmt(d);
  seekFill.style.width = (seek.value / 10) + "%";
}

seek.addEventListener("input", () => {
  state.seeking = true;
  seekFill.style.width = (seek.value / 10) + "%";
  $("elapsed").textContent = fmt((seek.value / 1000) * (audio.duration || 0));
});

seek.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  state.seeking = false;
});

/* ---------------- volume ---------------- */

function applyVolume() {
  const v = volume.value / 100;
  audio.volume = v;
  muteBtn.classList.toggle("is-muted", audio.muted || v === 0);
  muteBtn.classList.toggle("is-low", v > 0 && v < 0.5);
  muteBtn.setAttribute("aria-label", audio.muted ? "Unmute" : "Mute");
  // filled part of the fader
  volume.style.background =
    `linear-gradient(var(--orange), var(--orange)) left center / ${volume.value}% 4px no-repeat,
     linear-gradient(var(--panel), var(--panel)) center / 100% 4px no-repeat`;
}

volume.addEventListener("input", () => {
  audio.muted = false;
  applyVolume();
  save();
});

muteBtn.addEventListener("click", (e) => {
  e.preventDefault();          // it's inside a <label>
  audio.muted = !audio.muted;
  applyVolume();
});

/* ---------------- reels ---------------- */

/*
  Tape is conserved, so r_left² + r_right² stays constant as it winds across.
  Both reels move the same length of tape each frame, which means the
  smaller pack has to spin faster (angle = length / radius) — same as a real deck.
*/
const reel = {
  rMin: 12,
  rMax: 30,
  shown: 0,       // progress currently drawn (eases toward the real value)
  angleL: 0,
  angleR: 0,
};

const packL = $("packL");
const packR = $("packR");
const hubL = $("hubL");
const hubR = $("hubR");
const tapePath = $("tapePath");

function radiusFor(p) {
  const { rMin, rMax } = reel;
  return Math.sqrt(rMin * rMin + p * (rMax * rMax - rMin * rMin));
}

let lastFrame = performance.now();

function drawReels() {
  const now = performance.now();
  const dt = Math.min(Math.max(now - lastFrame, 0) / 1000, 0.1);
  lastFrame = now;

  const target = audio.duration ? audio.currentTime / audio.duration : 0;
  const before = reel.shown;

  // ease toward the target so seeking looks like fast-forward / rewind
  const gap = target - reel.shown;
  reel.shown += Math.abs(gap) < 0.002 ? gap : gap * Math.min(dt * 8, 1);

  const rL = radiusFor(1 - reel.shown);
  const rR = radiusFor(reel.shown);

  // "length" of tape that moved this frame, scaled so normal playback
  // gives a believable spin speed whatever the song length is
  const tapeLength = (audio.duration || 180) * 55;
  let moved = (reel.shown - before) * tapeLength;
  moved = Math.max(-40, Math.min(40, moved));   // cap the blur during big seeks

  reel.angleL += (moved / rL) * (180 / Math.PI);
  reel.angleR += (moved / rR) * (180 / Math.PI);

  packL.setAttribute("r", rL.toFixed(2));
  packR.setAttribute("r", rR.toFixed(2));
  hubL.setAttribute("transform", `translate(50 35) rotate(${reel.angleL.toFixed(1)})`);
  hubR.setAttribute("transform", `translate(170 35) rotate(${reel.angleR.toFixed(1)})`);

  // tape leaves the bottom of each pack and runs along the bottom of the window
  const k = 0.72;
  tapePath.setAttribute("d",
    `M${50 - rL * k} ${35 + rL * k} L14 70 M206 70 L${170 + rR * k} ${35 + rR * k}`);

  requestAnimationFrame(drawReels);
}

/* ---------------- audio events ---------------- */

audio.addEventListener("play", () => {
  deck.classList.add("is-playing");
  document.body.classList.add("is-playing");
  playBtn.setAttribute("aria-label", "Pause");
});

audio.addEventListener("pause", () => {
  deck.classList.remove("is-playing");
  document.body.classList.remove("is-playing");
  playBtn.setAttribute("aria-label", "Play");
});

audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("loadedmetadata", () => {
  state.durations[state.index] = audio.duration;
  updateProgress();
});

audio.addEventListener("ended", () => {
  if (!state.autoplay) {
    stop();
    return;
  }
  next(true);
});

audio.addEventListener("error", () => {
  $("title").textContent = "Couldn't load this track";
  $("artist").textContent = tracks[state.index].file;
});

/* ---------------- buttons ---------------- */

playBtn.addEventListener("click", togglePlay);
$("stopBtn").addEventListener("click", stop);
$("nextBtn").addEventListener("click", () => next());
$("prevBtn").addEventListener("click", prev);

/* ---------------- keyboard ---------------- */

function flashKey(btn) {
  btn.classList.add("is-down");
  setTimeout(() => btn.classList.remove("is-down"), 120);
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const onSlider = e.target.type === "range";

  switch (e.key) {
    case " ":
      if (e.target.tagName === "BUTTON") return;   // let the button handle it
      e.preventDefault();
      togglePlay();
      break;
    case "ArrowRight":
      if (onSlider) return;
      audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || 0);
      break;
    case "ArrowLeft":
      if (onSlider) return;
      audio.currentTime = Math.max(audio.currentTime - 5, 0);
      break;
    case "ArrowUp":
    case "ArrowDown":
      if (onSlider) return;
      e.preventDefault();
      volume.value = Number(volume.value) + (e.key === "ArrowUp" ? 5 : -5);
      audio.muted = false;
      applyVolume();
      save();
      break;
    case "n": case "N": flashKey($("nextBtn")); next(); break;
    case "p": case "P": flashKey($("prevBtn")); prev(); break;
    case "m": case "M": muteBtn.click(); break;
    case "s": case "S": shuffleBtn.click(); break;
    case "r": case "R": repeatBtn.click(); break;
  }
});

/* ---------------- media keys / lock screen ---------------- */

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", play);
  navigator.mediaSession.setActionHandler("pause", pause);
  navigator.mediaSession.setActionHandler("previoustrack", prev);
  navigator.mediaSession.setActionHandler("nexttrack", () => next());
}

/* ---------------- start ---------------- */

restore();
buildPlaylist();
fetchDurations();
makeOrder();
renderToggles();
applyVolume();

audio.src = tracks[state.index].file;
showTrack(tracks[state.index]);
markCurrent();
requestAnimationFrame(drawReels);
