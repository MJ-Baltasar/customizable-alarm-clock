(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // constant
  // ---------------------------------------------------------------------
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
  const RAMP_SECONDS = 45;
  const RAMP_START_VOL = 0.06;
  const RAMP_END_VOL = 1;

  const BUILTIN_PATTERNS = {
    "classic-beep": {
      name: "Classic beep",
      patternGap: 350,
      notes: [{ freq: 880, dur: 0.15, type: "square", vol: 0.14 }],
    },
    "gentle-chime": {
      name: "Gentle chime",
      patternGap: 900,
      notes: [
        { freq: 523.25, dur: 0.4, type: "sine", vol: 0.12, gap: 0.05 },
        { freq: 659.25, dur: 0.4, type: "sine", vol: 0.12, gap: 0.05 },
        { freq: 783.99, dur: 0.6, type: "sine", vol: 0.12 },
      ],
    },
    "digital-alarm": {
      name: "Digital alarm",
      patternGap: 200,
      notes: [
        { freq: 1046, dur: 0.12, type: "square", vol: 0.11 },
        { freq: 740, dur: 0.12, type: "square", vol: 0.11 },
      ],
    },
    "ascending-alert": {
      name: "Ascending alert",
      patternGap: 450,
      notes: [
        { freq: 440, dur: 0.12, type: "sawtooth", vol: 0.1 },
        { freq: 554, dur: 0.12, type: "sawtooth", vol: 0.1 },
        { freq: 659, dur: 0.12, type: "sawtooth", vol: 0.1 },
        { freq: 880, dur: 0.16, type: "sawtooth", vol: 0.12 },
      ],
    },
    "retro-blip": {
      name: "Retro blip",
      patternGap: 260,
      notes: [
        { freq: 220, dur: 0.08, type: "square", vol: 0.1 },
        { freq: 330, dur: 0.08, type: "square", vol: 0.1 },
        { freq: 440, dur: 0.08, type: "square", vol: 0.1 },
        { freq: 330, dur: 0.08, type: "square", vol: 0.1 },
      ],
    },
    "soft-pulse": {
      name: "Soft pulse",
      patternGap: 700,
      notes: [{ freq: 330, dur: 0.5, type: "triangle", vol: 0.13 }],
    },
  };

  function pad2(n) { return n.toString().padStart(2, "0"); }
  function makeId() { return Math.random().toString(36).slice(2, 10); }
  function formatTime12(hh, mm) {
    const h = ((hh + 11) % 12) + 1;
    const period = hh < 12 ? "AM" : "PM";
    return { h, m: pad2(mm), period };
  }
  function describeRepeat(days) {
    if (days.every((d) => d)) return "Every day";
    if (days.every((d) => !d)) return "Once";
    const weekdays = [1, 2, 3, 4, 5];
    const weekend = [0, 6];
    if (weekdays.every((i) => days[i]) && weekend.every((i) => !days[i])) return "Weekdays";
    if (weekend.every((i) => days[i]) && weekdays.every((i) => !days[i])) return "Weekends";
    return days.map((on, i) => (on ? DAY_LABELS[i] : null)).filter(Boolean).join(", ");
  }
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------------------------------------------------------------------
  // persistence: localStorage for structured data, IndexedDB for audio blobs
  // ---------------------------------------------------------------------
  const LS_ALARMS = "alarmclock.alarms";
  const LS_LIBRARY = "alarmclock.library"; // metadata only, no audio
  const LS_SETTINGS = "alarmclock.settings";

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // storage full or unavailable; app still works for this session
    }
  }

  const DB_NAME = "alarmclock-db";
  const DB_STORE = "sounds";
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGetAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------
  let alarms = loadJSON(LS_ALARMS, [
    { id: makeId(), time: "07:00", label: "Wake up", days: [false, true, true, true, true, true, false], enabled: true },
    { id: makeId(), time: "12:30", label: "Lunch break", days: [false, false, false, false, false, false, false], enabled: true },
  ]);

  const savedLibraryMeta = loadJSON(LS_LIBRARY, null);
  let library = savedLibraryMeta
    ? savedLibraryMeta.map((s) => ({ ...s, buffer: null }))
    : Object.entries(BUILTIN_PATTERNS).map(([id, def]) => ({
        id, name: def.name, kind: "builtin", enabled: true,
      }));

  const settings = loadJSON(LS_SETTINGS, { snoozeMinutes: 10 });

  let activeTab = "alarms";
  let firingAlarm = null;
  let nowPlayingName = null;
  let previewingId = null;

  const lastFiredMap = {};
  const snoozeQueue = [];
  const snoozeCountMap = {};

  let audioCtx = null;
  let alarmGain = null;
  let previewGain = null;
  let stopCurrentAlarmSound = null;
  let stopCurrentPreview = null;
  const bag = { queue: [], lastId: null };

  function persistAlarms() { saveJSON(LS_ALARMS, alarms); }
  function persistLibraryMeta() {
    saveJSON(LS_LIBRARY, library.map((s) => ({ id: s.id, name: s.name, kind: s.kind, enabled: s.enabled })));
  }
  function persistSettings() { saveJSON(LS_SETTINGS, settings); }

  // ---------------------------------------------------------------------
  // audio engine
  // ---------------------------------------------------------------------
  function getCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      alarmGain = audioCtx.createGain();
      alarmGain.gain.value = 1;
      alarmGain.connect(audioCtx.destination);
      previewGain = audioCtx.createGain();
      previewGain.gain.value = 0.8;
      previewGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function startVolumeRamp() {
    const ctx = getCtx();
    const g = alarmGain.gain;
    const t0 = ctx.currentTime;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(RAMP_START_VOL, t0);
    g.linearRampToValueAtTime(RAMP_END_VOL, t0 + RAMP_SECONDS);
  }

  function playPatternLoop(patternKey, destination) {
    const ctx = getCtx();
    const dest = destination || alarmGain;
    const pattern = BUILTIN_PATTERNS[patternKey];
    if (!pattern) return () => {};
    let cancelled = false;
    const timeouts = [];

    function playNote(note) {
      const osc = ctx.createOscillator();
      osc.type = note.type || "sine";
      osc.frequency.value = note.freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(note.vol || 0.12, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + note.dur);
      osc.connect(g);
      g.connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + note.dur + 0.05);
    }
    function loop() {
      if (cancelled) return;
      let t = 0;
      pattern.notes.forEach((note) => {
        const id = setTimeout(() => { if (!cancelled) playNote(note); }, t);
        timeouts.push(id);
        t += (note.dur + (note.gap || 0)) * 1000;
      });
      const loopId = setTimeout(loop, t + pattern.patternGap);
      timeouts.push(loopId);
    }
    loop();
    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  }

  function playBufferLoop(buffer, destination) {
    const ctx = getCtx();
    const dest = destination || alarmGain;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.6;
    source.connect(g);
    g.connect(dest);
    source.start();
    return () => { try { source.stop(); } catch (e) {} };
  }

  function getSoundForAlarm(alarm) {
    if (alarm && alarm.soundId) {
      const fixed = library.find((s) => s.id === alarm.soundId && (s.kind === "builtin" || s.buffer));
      if (fixed) return fixed;
      // the chosen sound was deleted since this alarm was set - fall back to rotation
    }
    return getNextSound();
  }

  function getNextSound() {
    const enabled = library.filter((s) => s.enabled && (s.kind === "builtin" || s.buffer));
    if (enabled.length === 0) return null;
    if (bag.queue.length === 0) {
      let shuffled = shuffle(enabled.map((s) => s.id));
      if (shuffled.length > 1 && shuffled[0] === bag.lastId) {
        [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
      }
      bag.queue = shuffled;
    }
    const nextId = bag.queue.shift();
    bag.lastId = nextId;
    return library.find((s) => s.id === nextId);
  }

  // ---------------------------------------------------------------------
  // notifications + wake lock
  // ---------------------------------------------------------------------
  let wakeLockSentinel = null;
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
    } catch (e) {
      // best-effort only; battery saver or unsupported browsers may block this
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestWakeLock();
      runTriggerCheck(); // catch up immediately after the tab was backgrounded
    }
  });

  function notifyAlarm(alarm) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const n = new Notification(alarm.label || "Alarm", {
        body: `${alarm.time} · tap to open`,
        tag: "alarmclock-firing",
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) {
      // notification construction can fail on some platforms (e.g. iOS Safari)
    }
  }

  // ---------------------------------------------------------------------
  // dom refs
  // ---------------------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const clockTime = el("clockTime");
  const clockPeriod = el("clockPeriod");
  const clockDate = el("clockDate");
  const alarmsList = el("alarmsList");
  const builtinSoundsList = el("builtinSoundsList");
  const customSoundsList = el("customSoundsList");
  const uploadError = el("uploadError");
  const modalOverlay = el("modalOverlay");
  const modalTitle = el("modalTitle");
  const modalTime = el("modalTime");
  const modalLabel = el("modalLabel");
  const modalDays = el("modalDays");
  const modalSound = el("modalSound");
  const modalSoundPreview = el("modalSoundPreview");
  const firingOverlay = el("firingOverlay");
  const firingTag = el("firingTag");
  const firingTime = el("firingTime");
  const firingLabel = el("firingLabel");
  const firingSound = el("firingSound");
  const volumeFill = el("volumeFill");
  const snoozeRow = el("snoozeRow");
  const reliabilityBanner = el("reliabilityBanner");

  let editingId = null;
  let draftDays = [false, false, false, false, false, false, false];
  let draftSoundId = "";

  // ---------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------
  function renderClock() {
    const now = new Date();
    const { h, m, period } = formatTime12(now.getHours(), now.getMinutes());
    clockTime.firstChild.textContent = `${pad2(h)}:${m}`;
    clockPeriod.textContent = period;
    clockDate.textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  function renderAlarms() {
    const sorted = [...alarms].sort((a, b) => a.time.localeCompare(b.time));
    if (sorted.length === 0) {
      alarmsList.innerHTML = `<div class="empty-state">No alarms yet. Add one to get started.</div>`;
      return;
    }
    alarmsList.innerHTML = sorted.map((alarm) => {
      const [aH, aM] = alarm.time.split(":").map(Number);
      const { h, m, period } = formatTime12(aH, aM);
      const soundLabel = alarm.soundId
        ? (library.find((s) => s.id === alarm.soundId)?.name || "Shuffle")
        : "Shuffle";
      return `
        <div class="alarm-card ${alarm.enabled ? "" : "disabled"}">
          <div class="alarm-dot ${alarm.enabled ? "on" : ""}"></div>
          <div class="alarm-main">
            <div class="alarm-time">${pad2(h)}:${m}<span class="period">${period}</span></div>
            <div class="alarm-meta">${escapeHtml(alarm.label || "Alarm")} · ${describeRepeat(alarm.days)} · 🔊 ${escapeHtml(soundLabel)}</div>
          </div>
          <div class="alarm-actions">
            <button class="toggle ${alarm.enabled ? "on" : ""}" data-action="toggle-alarm" data-id="${alarm.id}" aria-label="Toggle alarm"><div class="toggle-knob"></div></button>
            <button class="btn-outline" data-action="edit-alarm" data-id="${alarm.id}">Edit</button>
            <button class="btn-danger" data-action="delete-alarm" data-id="${alarm.id}">Delete</button>
          </div>
        </div>`;
    }).join("");
  }

  function soundRowHtml(sound, deletable) {
    const playing = previewingId === sound.id;
    return `
      <div class="sound-row ${sound.enabled ? "" : "disabled"}">
        <button class="sound-preview ${playing ? "playing" : ""}" data-action="preview-sound" data-id="${sound.id}" aria-label="Preview">${playing ? "■" : "▶"}</button>
        <div class="sound-main">
          <div class="sound-name">${escapeHtml(sound.name)}</div>
          <div class="sound-kind">${sound.kind === "builtin" ? "Built-in" : "Uploaded"}</div>
        </div>
        <button class="toggle ${sound.enabled ? "on" : ""}" data-action="toggle-sound" data-id="${sound.id}" aria-label="Toggle sound"><div class="toggle-knob"></div></button>
        ${deletable ? `<button class="btn-danger" data-action="delete-sound" data-id="${sound.id}">Delete</button>` : ""}
      </div>`;
  }

  function renderSounds() {
    const builtin = library.filter((s) => s.kind === "builtin");
    const custom = library.filter((s) => s.kind === "custom");
    builtinSoundsList.innerHTML = builtin.map((s) => soundRowHtml(s, false)).join("");
    customSoundsList.innerHTML = custom.length
      ? custom.map((s) => soundRowHtml(s, true)).join("")
      : `<div class="panel-hint" style="text-align:center;">No custom sounds yet.</div>`;
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function renderModalDays() {
    modalDays.innerHTML = DAY_SHORT.map((d, i) =>
      `<button type="button" class="day-btn ${draftDays[i] ? "active" : ""}" data-day="${i}">${d}</button>`
    ).join("");
  }

  function renderModalSoundOptions() {
    const options = [`<option value="">🔀 Shuffle (different each time)</option>`]
      .concat(
        library.map(
          (s) =>
            `<option value="${s.id}" ${s.id === draftSoundId ? "selected" : ""}>${escapeHtml(s.name)}${s.kind === "custom" ? " (uploaded)" : ""}</option>`
        )
      );
    modalSound.innerHTML = options.join("");
    modalSound.value = draftSoundId || "";
  }

  function renderSnoozeRow() {
    snoozeRow.innerHTML = [5, 10, 15].map((mins) =>
      `<button class="snooze-pill ${settings.snoozeMinutes === mins ? "active" : ""}" data-mins="${mins}">${mins} min</button>`
    ).join("");
    el("snoozeBtn").textContent = `Snooze ${settings.snoozeMinutes} min`;
  }

  function renderFiring() {
    if (!firingAlarm) {
      firingOverlay.classList.remove("show");
      return;
    }
    firingOverlay.classList.add("show");
    const originalId = firingAlarm.originalId || firingAlarm.id;
    const count = snoozeCountMap[originalId] || 0;
    firingTag.textContent = "ALARM" + (count > 0 ? ` · SNOOZED ${count}×` : "");
    firingTime.textContent = firingAlarm.time;
    firingLabel.textContent = firingAlarm.label || "Alarm";
    firingSound.textContent = `Now playing: ${nowPlayingName || "…"}`;
    volumeFill.style.animation = "none";
    // eslint-disable-next-line no-unused-expressions
    volumeFill.offsetHeight; // force reflow so the animation restarts
    volumeFill.style.animation = `ringGrow ${RAMP_SECONDS}s linear forwards`;
    renderSnoozeRow();
  }

  // ---------------------------------------------------------------------
  // alarm engine
  // ---------------------------------------------------------------------
  function beginFiring(alarm) {
    firingAlarm = alarm;
    renderFiring();
    startVolumeRamp();
    const chosen = getSoundForAlarm(alarm);
    if (!chosen) {
      nowPlayingName = "Classic beep (default)";
      stopCurrentAlarmSound = playPatternLoop("classic-beep");
    } else if (chosen.kind === "builtin") {
      nowPlayingName = chosen.name;
      stopCurrentAlarmSound = playPatternLoop(chosen.id);
    } else {
      nowPlayingName = chosen.name;
      stopCurrentAlarmSound = playBufferLoop(chosen.buffer);
    }
    renderFiring();
    notifyAlarm(alarm);
  }

  function stopFiring() {
    if (stopCurrentAlarmSound) { stopCurrentAlarmSound(); stopCurrentAlarmSound = null; }
    firingAlarm = null;
    nowPlayingName = null;
    renderFiring();
  }

  function runTriggerCheck() {
    if (firingAlarm) return;
    const now = new Date();

    const dueIdx = snoozeQueue.findIndex((s) => s.fireAt <= now);
    if (dueIdx !== -1) {
      const due = snoozeQueue.splice(dueIdx, 1)[0];
      beginFiring({
        id: due.id,
        time: `${pad2(due.fireAt.getHours())}:${pad2(due.fireAt.getMinutes())}`,
        label: due.label,
        originalId: due.originalId,
      });
      return;
    }

    const hh = now.getHours(), mm = now.getMinutes(), dow = now.getDay();
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${hh}-${mm}`;

    for (const alarm of alarms) {
      if (!alarm.enabled) continue;
      const [aH, aM] = alarm.time.split(":").map(Number);
      if (aH !== hh || aM !== mm) continue;
      const isRepeating = alarm.days.some((d) => d);
      if (isRepeating && !alarm.days[dow]) continue;
      if (lastFiredMap[alarm.id] === minuteKey) continue;

      lastFiredMap[alarm.id] = minuteKey;
      snoozeCountMap[alarm.id] = 0;
      beginFiring(alarm);
      if (!isRepeating) {
        alarm.enabled = false;
        persistAlarms();
        renderAlarms();
      }
      break;
    }
  }

  setInterval(() => { renderClock(); runTriggerCheck(); }, 1000);

  // ---------------------------------------------------------------------
  // event handling
  // ---------------------------------------------------------------------
  el("tabAlarmsBtn").addEventListener("click", () => switchTab("alarms"));
  el("tabSoundsBtn").addEventListener("click", () => switchTab("sounds"));
  function switchTab(tab) {
    activeTab = tab;
    el("tabAlarmsBtn").classList.toggle("active", tab === "alarms");
    el("tabSoundsBtn").classList.toggle("active", tab === "sounds");
    el("panelAlarms").classList.toggle("active", tab === "alarms");
    el("panelSounds").classList.toggle("active", tab === "sounds");
  }

  el("addAlarmBtn").addEventListener("click", () => {
    editingId = null;
    draftDays = [false, false, false, false, false, false, false];
    draftSoundId = "";
    modalTitle.textContent = "New alarm";
    modalTime.value = "07:00";
    modalLabel.value = "";
    renderModalDays();
    renderModalSoundOptions();
    modalOverlay.classList.add("show");
  });
  el("modalCancelBtn").addEventListener("click", () => {
    if (stopModalPreview) stopModalPreview();
    modalOverlay.classList.remove("show");
  });
  modalDays.addEventListener("click", (e) => {
    const btn = e.target.closest(".day-btn");
    if (!btn) return;
    const i = Number(btn.dataset.day);
    draftDays[i] = !draftDays[i];
    renderModalDays();
  });
  modalSound.addEventListener("change", () => {
    draftSoundId = modalSound.value;
    if (stopModalPreview) { stopModalPreview(); stopModalPreview = null; }
    modalSoundPreview.classList.remove("playing");
    modalSoundPreview.textContent = "▶";
  });
  let stopModalPreview = null;
  modalSoundPreview.addEventListener("click", () => {
    if (stopModalPreview) {
      stopModalPreview();
      stopModalPreview = null;
      modalSoundPreview.classList.remove("playing");
      modalSoundPreview.textContent = "▶";
      return;
    }
    const soundId = modalSound.value;
    const sound = soundId ? library.find((s) => s.id === soundId) : getNextSound();
    if (!sound) return;
    getCtx();
    const stop = sound.kind === "builtin"
      ? playPatternLoop(sound.id, previewGain)
      : playBufferLoop(sound.buffer, previewGain);
    stopModalPreview = stop;
    modalSoundPreview.classList.add("playing");
    modalSoundPreview.textContent = "■";
    setTimeout(() => {
      if (stopModalPreview === stop) {
        stop();
        stopModalPreview = null;
        modalSoundPreview.classList.remove("playing");
        modalSoundPreview.textContent = "▶";
      }
    }, 2600);
  });
  el("modalSaveBtn").addEventListener("click", () => {
    const time = modalTime.value || "07:00";
    const label = modalLabel.value.trim();
    const soundId = draftSoundId || null;
    if (editingId) {
      const a = alarms.find((x) => x.id === editingId);
      if (a) { a.time = time; a.label = label; a.days = [...draftDays]; a.soundId = soundId; }
    } else {
      alarms.push({ id: makeId(), time, label, days: [...draftDays], enabled: true, soundId });
    }
    persistAlarms();
    renderAlarms();
    if (stopModalPreview) { stopModalPreview(); stopModalPreview = null; }
    modalOverlay.classList.remove("show");
  });

  alarmsList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "toggle-alarm") {
      const a = alarms.find((x) => x.id === id);
      if (a) a.enabled = !a.enabled;
      persistAlarms();
      renderAlarms();
    } else if (action === "delete-alarm") {
      alarms = alarms.filter((x) => x.id !== id);
      for (let i = snoozeQueue.length - 1; i >= 0; i--) {
        if (snoozeQueue[i].originalId === id) snoozeQueue.splice(i, 1);
      }
      delete snoozeCountMap[id];
      persistAlarms();
      renderAlarms();
    } else if (action === "edit-alarm") {
      const a = alarms.find((x) => x.id === id);
      if (!a) return;
      editingId = id;
      draftDays = [...a.days];
      draftSoundId = a.soundId || "";
      modalTitle.textContent = "Edit alarm";
      modalTime.value = a.time;
      modalLabel.value = a.label || "";
      renderModalDays();
      renderModalSoundOptions();
      modalOverlay.classList.add("show");
    }
  });

  function togglePreview(sound) {
    if (previewingId === sound.id) {
      if (stopCurrentPreview) stopCurrentPreview();
      stopCurrentPreview = null;
      previewingId = null;
      renderSounds();
      return;
    }
    if (stopCurrentPreview) { stopCurrentPreview(); stopCurrentPreview = null; }
    getCtx();
    const stop = sound.kind === "builtin"
      ? playPatternLoop(sound.id, previewGain)
      : playBufferLoop(sound.buffer, previewGain);
    stopCurrentPreview = stop;
    previewingId = sound.id;
    renderSounds();
    setTimeout(() => {
      if (stopCurrentPreview === stop) {
        stop();
        stopCurrentPreview = null;
        previewingId = null;
        renderSounds();
      }
    }, 2600);
  }

  function soundClickHandler(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const sound = library.find((s) => s.id === id);
    if (!sound) return;
    if (action === "preview-sound") {
      togglePreview(sound);
    } else if (action === "toggle-sound") {
      sound.enabled = !sound.enabled;
      persistLibraryMeta();
      renderSounds();
    } else if (action === "delete-sound") {
      if (previewingId === id && stopCurrentPreview) { stopCurrentPreview(); stopCurrentPreview = null; previewingId = null; }
      library = library.filter((s) => s.id !== id);
      let touched = false;
      alarms.forEach((a) => { if (a.soundId === id) { a.soundId = null; touched = true; } });
      if (touched) { persistAlarms(); renderAlarms(); }
      persistLibraryMeta();
      idbDelete(id);
      renderSounds();
    }
  }
  builtinSoundsList.addEventListener("click", soundClickHandler);
  customSoundsList.addEventListener("click", soundClickHandler);

  el("uploadInput").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    uploadError.style.display = "none";
    files.forEach((file) => {
      if (!file.type.startsWith("audio/")) {
        uploadError.textContent = `"${file.name}" isn't an audio file.`;
        uploadError.style.display = "block";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result;
        const ctx = getCtx();
        ctx.decodeAudioData(
          arrayBuffer.slice(0),
          (buffer) => {
            const id = makeId();
            const name = file.name.replace(/\.[^/.]+$/, "");
            library.push({ id, name, kind: "custom", enabled: true, buffer });
            persistLibraryMeta();
            idbPut({ id, name, blob: new Blob([arrayBuffer], { type: file.type }) });
            renderSounds();
          },
          () => {
            uploadError.textContent = `Couldn't read "${file.name}". Try a different file.`;
            uploadError.style.display = "block";
          }
        );
      };
      reader.readAsArrayBuffer(file);
    });
    e.target.value = "";
  });

  el("snoozeBtn").addEventListener("click", () => {
    if (!firingAlarm) return;
    const originalId = firingAlarm.originalId || firingAlarm.id;
    snoozeCountMap[originalId] = (snoozeCountMap[originalId] || 0) + 1;
    const fireAt = new Date(Date.now() + settings.snoozeMinutes * 60000);
    snoozeQueue.push({ id: makeId(), originalId, label: firingAlarm.label || "Alarm", fireAt });
    stopFiring();
  });
  el("dismissBtn").addEventListener("click", () => {
    if (firingAlarm) delete snoozeCountMap[firingAlarm.originalId || firingAlarm.id];
    stopFiring();
  });
  snoozeRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".snooze-pill");
    if (!btn) return;
    settings.snoozeMinutes = Number(btn.dataset.mins);
    persistSettings();
    renderSnoozeRow();
  });

  // ---------------------------------------------------------------------
  // reliability banner + notifications
  // ---------------------------------------------------------------------
  const BANNER_DISMISSED_KEY = "alarmclock.bannerDismissed";
  if (!localStorage.getItem(BANNER_DISMISSED_KEY)) {
    reliabilityBanner.style.display = "flex";
  }
  el("dismissBanner").addEventListener("click", () => {
    reliabilityBanner.style.display = "none";
    localStorage.setItem(BANNER_DISMISSED_KEY, "1");
  });
  el("enableNotifBtn").addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    el("enableNotifBtn").textContent = perm === "granted" ? "Notifications on" : "Enable notifications";
  });

  // ---------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------
  async function init() {
    // load any custom sound blobs from IndexedDB and decode them
    try {
      const stored = await idbGetAll();
      if (stored.length) {
        const ctx = getCtx();
        for (const rec of stored) {
          const meta = library.find((s) => s.id === rec.id);
          if (!meta) continue;
          const arrayBuffer = await rec.blob.arrayBuffer();
          try {
            const buffer = await new Promise((resolve, reject) =>
              ctx.decodeAudioData(arrayBuffer, resolve, reject)
            );
            meta.buffer = buffer;
          } catch (e) {
            // skip sounds that fail to decode (corrupted or unsupported format)
          }
        }
      }
    } catch (e) {
      // IndexedDB unavailable (e.g. private browsing) - custom sounds just won't persist
    }
    renderSounds();
    renderAlarms();
    renderClock();
    requestWakeLock();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {
        // offline-first still works without the service worker on this load;
        // it'll register successfully once served over http(s)
      });
    }
  }
  init();
})();
