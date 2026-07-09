const DIGIT_MASKS = [
  ["a", "b", "c", "d", "e", "f"],
  ["b", "c"],
  ["a", "b", "g", "e", "d"],
  ["a", "b", "c", "d", "g"],
  ["f", "g", "b", "c"],
  ["a", "f", "g", "c", "d"],
  ["a", "f", "e", "d", "c", "g"],
  ["a", "b", "c"],
  ["a", "b", "c", "d", "e", "f", "g"],
  ["a", "b", "c", "d", "f", "g"]
];

const SEGMENTS = ["a", "b", "c", "d", "e", "f", "g"];
const NORMAL_REFRESH_HZ = 30;
const ANIMATION_REFRESH_HZ = 60;
const MAX_SCORE = 21;
const SCORE_21_ARM_MS = 2000;
const VIBRATION_MS = 500;
const IR_MS = 1250;
const CELEBRATION_MS = 10000;
const OTA_WINDOW_MS = 10 * 60 * 1000;
const IR_NOTES = [659, 784, 988, 1175, 988, 1319];
const IR_DURATIONS = [90, 90, 110, 130, 110, 180];
const WIN_NOTES = [
  523, 659, 784, 1047, 988, 784, 880, 988,
  1047, 1319, 1175, 988, 1047, 784, 880, 988,
  1175, 1319, 1568, 1319, 1175, 1047, 988, 1047
];
const WIN_DURATIONS = [
  140, 140, 160, 220, 140, 140, 160, 220,
  140, 140, 160, 220, 140, 140, 160, 220,
  160, 160, 260, 180, 180, 180, 180, 1100
];

const boards = {
  A: createBoard("A"),
  B: createBoard("B")
};

const simulatorStartedAt = Date.now();
let wirelessEnabled = true;
let otaWindowEndsAt = Date.now() + OTA_WINDOW_MS;
let refreshHz = NORMAL_REFRESH_HZ;
let soundEnabled = true;
let speakerVolume = 60;
let brightnessMode = "auto";
let celebrationEnabled = true;
let sensorFeedbackEnabled = true;
let gameStartedAt = new Date();
let lastScoreEvent = null;
let scoreHistory = [];
let audioContext = null;
let activeAudioNodes = [];

function createBoard(id) {
  return {
    id,
    teamName: id === "A" ? "Team A" : "Team B",
    score: 0,
    scoreColor: "#ff2222",
    battery: "good",
    sleeping: false,
    deepSleeping: false,
    effect: "none",
    effectEndsAt: 0,
    score21Since: null,
    celebrationStarted: false,
    display: document.getElementById(`display-${id.toLowerCase()}`),
    state: document.getElementById(`state-${id.toLowerCase()}`),
    buttonLed: document.getElementById(`button-led-${id.toLowerCase()}`),
    batteryEl: document.getElementById(`battery-${id.toLowerCase()}`),
    teamLabel: document.getElementById(`team-label-${id.toLowerCase()}`)
  };
}

function makeDigit() {
  const digit = document.createElement("div");
  digit.className = "digit";

  for (const segmentName of SEGMENTS) {
    const segment = document.createElement("div");
    segment.className = `segment ${segmentName}`;
    segment.dataset.segment = segmentName;

    for (let i = 0; i < 3; i++) {
      const led = document.createElement("span");
      led.className = "led";
      segment.appendChild(led);
    }

    digit.appendChild(segment);
  }

  return digit;
}

function initDisplays() {
  for (const board of Object.values(boards)) {
    board.display.appendChild(makeDigit());
    board.display.appendChild(makeDigit());
  }
}

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    log("browser audio is not supported here");
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function stopMelody() {
  for (const node of activeAudioNodes) {
    try {
      node.oscillator.stop(0);
    } catch (error) {
      // Oscillators throw if they already stopped; that is harmless cleanup.
    }
    try {
      node.oscillator.disconnect();
      node.gain.disconnect();
    } catch (error) {
      // Disconnection can also fail after natural note completion.
    }
  }
  activeAudioNodes = [];
}

function playMelody(notes, durations) {
  if (!soundEnabled || speakerVolume === 0) {
    return false;
  }

  const context = ensureAudioContext();
  if (!context) {
    return false;
  }

  stopMelody();

  let startsAt = context.currentTime + 0.02;
  const masterGain = Math.min(0.24, Math.max(0, speakerVolume / 100) * 0.24);

  for (let i = 0; i < notes.length; i++) {
    const durationSeconds = durations[i] / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = startsAt;
    const noteEnd = noteStart + durationSeconds;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(notes[i], noteStart);
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(masterGain, noteStart + 0.008);
    gain.gain.setValueAtTime(masterGain, Math.max(noteStart + 0.008, noteEnd - 0.012));
    gain.gain.linearRampToValueAtTime(0, noteEnd);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.01);
    const activeNode = { oscillator, gain };
    activeAudioNodes.push(activeNode);
    oscillator.addEventListener("ended", () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch (error) {
        // Manual stops may already have disconnected these nodes.
      }
      activeAudioNodes = activeAudioNodes.filter((node) => node !== activeNode);
    });

    startsAt = noteEnd + 0.01;
  }

  return true;
}

function setDigit(digitEl, value, color) {
  const activeSegments = value === null ? [] : DIGIT_MASKS[value];
  for (const segment of digitEl.querySelectorAll(".segment")) {
    const isOn = activeSegments.includes(segment.dataset.segment);
    segment.classList.toggle("on", isOn);
    segment.style.setProperty("--led-color", color);
  }
}

function colorForBoard(board, now) {
  if (board.effect === "vibration") {
    return Math.floor(now / 90) % 2 === 0 ? "#ffffff" : "#331010";
  }

  if (board.effect === "ir") {
    return board.randomColor;
  }

  if (board.effect === "celebration") {
    const hue = Math.floor((now / 24) % 360);
    return `hsl(${hue}, 100%, 55%)`;
  }

  return board.scoreColor;
}

function renderBoard(board, now) {
  const digits = board.display.querySelectorAll(".digit");
  const color = colorForBoard(board, now);
  const tens = board.score >= 10 ? Math.floor(board.score / 10) : null;
  const ones = board.score % 10;

  if (board.effect === "vibration" && color === "#331010") {
    setDigit(digits[0], null, color);
    setDigit(digits[1], null, color);
  } else {
    setDigit(digits[0], tens, color);
    setDigit(digits[1], ones, color);
  }

  board.buttonLed.classList.toggle("sleeping", board.sleeping);
  if (!board.sleeping) {
    const batteryColor = board.battery === "good" ? "#20d071" : board.battery === "low" ? "#ff9f1a" : "#ff4a4a";
    board.buttonLed.style.background = batteryColor;
    board.buttonLed.style.boxShadow = `0 0 18px ${batteryColor}`;
  }

  board.state.textContent = stateText(board);
  board.teamLabel.textContent = `${teamNameFor(board)} score`;
}

function stateText(board) {
  if (board.deepSleeping) return "Deep sleep. Press score button to wake.";
  if (board.sleeping) return "Resting. Press score button to wake.";
  if (board.effect === "vibration") return "Vibration feedback. Score did not change.";
  if (board.effect === "ir") return "IR feedback and short melody. Score did not change.";
  if (board.effect === "celebration") return "Score 21 celebration.";
  return "Ready";
}

function scoreButton(boardId) {
  const board = boards[boardId];
  if (board.deepSleeping || board.sleeping) {
    wakeBoard(board);
    log(`${teamNameFor(board)} (${boardId}): woke from sleep`);
    return;
  }

  const oldScore = board.score;
  board.score = board.score >= MAX_SCORE ? 0 : board.score + 1;
  board.score21Since = board.score === MAX_SCORE ? Date.now() : null;
  board.celebrationStarted = false;
  recordScoreChange(board, oldScore, board.score, oldScore >= MAX_SCORE ? "score_wrap_to_zero" : "score_button");
  log(`${teamNameFor(board)} (${boardId}): score button ${oldScore} -> ${board.score}`);
}

function holdReset(boardId) {
  const board = boards[boardId];
  const oldScore = board.score;
  stopMelody();
  board.score = 0;
  board.score21Since = null;
  board.celebrationStarted = false;
  board.effect = "none";
  recordScoreChange(board, oldScore, board.score, "hold_reset");
  log(`${teamNameFor(board)} (${boardId}): held button 5 seconds -> reset to 0`);
  sendFeedback(boardId, "reset");
}

function triggerVibration(boardId, remote = false) {
  const board = boards[boardId];
  wakeBoard(board);
  board.effect = "vibration";
  board.effectEndsAt = Date.now() + VIBRATION_MS;
  log(`${teamNameFor(board)} (${boardId}): vibration feedback${remote ? " from other board" : ""}`);
  if (!remote) sendFeedback(boardId, "vibration");
}

function triggerIr(boardId, remote = false) {
  const board = boards[boardId];
  wakeBoard(board);
  board.effect = "ir";
  board.effectEndsAt = Date.now() + IR_MS;
  board.randomColor = randomColor();
  if (!remote) {
    playMelody(IR_NOTES, IR_DURATIONS);
  }
  log(`${teamNameFor(board)} (${boardId}): IR feedback${remote ? " from other board, visual only" : ""}${remote ? "" : soundText()}`);
  if (!remote) sendFeedback(boardId, "ir");
}

function triggerCelebration(boardId, remote = false) {
  const board = boards[boardId];
  wakeBoard(board);
  board.effect = "celebration";
  board.effectEndsAt = Date.now() + CELEBRATION_MS;
  board.celebrationStarted = true;
  if (!remote) {
    playMelody(WIN_NOTES, WIN_DURATIONS);
  }
  log(`${teamNameFor(board)} (${boardId}): score 21 celebration${remote ? " from other board, visual only" : ""}${remote ? "" : soundText()}`);
  if (!remote) sendFeedback(boardId, "celebration");
}

function soundText() {
  if (!soundEnabled || speakerVolume === 0) {
    return " with sound muted";
  }
  return ` at volume ${speakerVolume}`;
}

function sendFeedback(sourceId, type) {
  if (!wirelessEnabled) {
    log(`${sourceId}: ESP-NOW feedback skipped because wireless is off`);
    return;
  }

  const targetId = sourceId === "A" ? "B" : "A";
  if (type === "vibration") triggerVibration(targetId, true);
  if (type === "ir") triggerIr(targetId, true);
  if (type === "celebration") triggerCelebration(targetId, true);
  if (type === "reset") triggerVibration(targetId, true);
}

function wakeBoard(board) {
  board.sleeping = false;
  board.deepSleeping = false;
}

function teamNameFor(board) {
  const fallback = board.id === "A" ? "Team A" : "Team B";
  const name = board.teamName.trim();
  return name.length > 0 ? name : fallback;
}

function setTeamName(boardId, shouldLog = true) {
  const board = boards[boardId];
  const input = document.getElementById(`team-name-${boardId.toLowerCase()}`);
  const previousName = teamNameFor(board);
  board.teamName = input.value.trim().slice(0, 18);
  input.value = teamNameFor(board);
  renderBoard(board, Date.now());
  updateGameSummary();

  const nextName = teamNameFor(board);
  if (shouldLog && previousName !== nextName) {
    log(`Board ${boardId}: team name changed from ${previousName} to ${nextName}`);
  }
}

function recordScoreChange(board, oldScore, newScore, reason) {
  const entry = {
    type: "score",
    time: new Date(),
    teamName: teamNameFor(board),
    boardId: board.id,
    oldScore,
    newScore,
    reason
  };

  scoreHistory.unshift(entry);
  lastScoreEvent = entry;
  trimScoreHistory();
  renderScoreHistory();
  updateGameSummary();
}

function recordNewGame() {
  const entry = {
    type: "new_game",
    time: new Date(),
    reason: "new_game"
  };

  scoreHistory = [entry];
  lastScoreEvent = entry;
  renderScoreHistory();
  updateGameSummary();
}

function trimScoreHistory() {
  scoreHistory = scoreHistory.slice(0, 80);
}

function renderScoreHistory() {
  const list = document.getElementById("score-history-list");
  list.replaceChildren();

  if (scoreHistory.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No score changes yet.";
    list.appendChild(item);
    return;
  }

  for (const entry of scoreHistory) {
    const item = document.createElement("li");
    const time = entry.time.toLocaleTimeString();
    if (entry.type === "new_game") {
      item.textContent = `${time} - New game started`;
    } else {
      item.textContent = `${time} - ${entry.teamName} (${entry.boardId}): ${entry.oldScore} -> ${entry.newScore} (${reasonLabel(entry.reason)})`;
    }
    list.appendChild(item);
  }
}

function reasonLabel(reason) {
  if (reason === "score_button") return "score button";
  if (reason === "hold_reset") return "held reset";
  if (reason === "score_wrap_to_zero") return "wrapped after 21";
  if (reason === "new_game") return "new game";
  return reason;
}

function updateGameSummary() {
  const scoreLine = `${teamNameFor(boards.A)} ${boards.A.score} | ${teamNameFor(boards.B)} ${boards.B.score}`;
  document.getElementById("game-started").textContent = `Game started: ${gameStartedAt.toLocaleTimeString()} - ${scoreLine}`;

  const lastScoreEl = document.getElementById("last-score-event");
  if (!lastScoreEvent) {
    lastScoreEl.textContent = "Last score: none yet";
    return;
  }

  if (lastScoreEvent.type === "new_game") {
    lastScoreEl.textContent = "Last score: new game started";
    return;
  }

  const winnerText = lastScoreEvent.newScore === MAX_SCORE ? " - reached 21" : "";
  lastScoreEl.textContent = `Last score: ${lastScoreEvent.teamName} ${lastScoreEvent.oldScore} -> ${lastScoreEvent.newScore}${winnerText}`;
}

function batteryMillivoltsFor(board) {
  if (board.battery === "low") return 3550;
  if (board.battery === "charge") return 3300;
  return 3900;
}

function sleepStateFor(board) {
  if (board.deepSleeping) return "deep_sleep";
  if (board.sleeping) return "light_sleep";
  return "awake";
}

function effectNameFor(board) {
  if (board.effect === "vibration") return "vibration";
  if (board.effect === "ir") return "ir";
  if (board.effect === "celebration") return "score_21_celebration";
  return "none";
}

function lastFeedbackTypeFor(board) {
  if (board.effect === "vibration") return "vibration";
  if (board.effect === "ir") return "ir";
  if (board.effect === "celebration") return "score_21";
  return "none";
}

function appBoardPayload(board, now) {
  const otaRemainingSeconds = Math.max(0, Math.floor((otaWindowEndsAt - now) / 1000));
  const brightness = Number(document.getElementById("ambient-light").value);

  return {
    teamName: teamNameFor(board),
    score: board.score,
    scoreColor: board.scoreColor.toUpperCase(),
    batteryMillivolts: batteryMillivoltsFor(board),
    batteryState: board.battery,
    connected: board.id === "A" || wirelessEnabled,
    brightness,
    brightnessMode,
    soundEnabled,
    soundVolume: speakerVolume,
    otaWindowOpen: otaRemainingSeconds > 0,
    otaRemainingSeconds,
    sleepState: sleepStateFor(board),
    effectMode: effectNameFor(board),
    lastFeedbackType: lastFeedbackTypeFor(board)
  };
}

function updateAppPayload(now) {
  const payload = {
    protocolVersion: 1,
    primaryBoardId: "A",
    generatedAtMs: now - simulatorStartedAt,
    portal: {
      ssid: "Cornhole-Scoreboard-A",
      url: "http://192.168.4.1",
      adminPinRequired: true,
      otaRequiresButtonPress: true
    },
    boards: {
      A: appBoardPayload(boards.A, now),
      B: appBoardPayload(boards.B, now)
    },
    wireless: {
      peerBoardId: wirelessEnabled ? 2 : 0,
      expectedPeerBoardId: 2,
      pairId: 3225755905,
      linkState: wirelessEnabled ? "good" : "lost",
      linkQualityPercent: wirelessEnabled ? 96 : 0,
      lastSeenAgeMs: wirelessEnabled ? 850 : 999999,
      receivedStatusCount: wirelessEnabled ? 42 : 0,
      missedStatusCount: wirelessEnabled ? 1 : 12,
      lastSequence: wirelessEnabled ? 42 : 0,
      lastSequenceGap: wirelessEnabled ? 0 : 12,
      localStatusSequence: 43,
      peerHeardStatusSequence: wirelessEnabled ? 42 : 0,
      peerStatusLag: wirelessEnabled ? 1 : 43,
      peerHearsThisBoard: wirelessEnabled,
      localFeedbackSequence: 7,
      peerHeardFeedbackSequence: wirelessEnabled ? 7 : 0,
      statusIntervalMs: 2000,
      staleAfterMs: 7000,
      broadcastPeer: false,
      encryptedPeer: true,
      sourceMac: wirelessEnabled ? "24:6F:28:AA:BB:CC" : "00:00:00:00:00:00",
      pairIdMatch: wirelessEnabled,
      senderRoleMatch: wirelessEnabled,
      targetRoleMatch: wirelessEnabled,
      sourceMacMatch: wirelessEnabled,
      rejectedPairCount: 0,
      rejectedRoleCount: 0,
      rejectedMacCount: 0
    },
    audio: {
      format: "pcm_s16le_mono_22050",
      slots: {
        ir: {
          boardA: { custom: false, verified: false, checksum: 0, size: 0, lengthMs: 0, state: "idle", progress: 0 },
          boardB: { verified: false, checksum: 0, size: 0, state: "idle", progress: 0 }
        },
        win: {
          boardA: { custom: false, verified: false, checksum: 0, size: 0, lengthMs: 0, state: "idle", progress: 0 },
          boardB: { verified: false, checksum: 0, size: 0, state: "idle", progress: 0 }
        }
      }
    },
    settings: {
      celebrationEnabled,
      sensorFeedbackEnabled
    }
  };

  document.getElementById("app-payload").textContent = JSON.stringify(payload, null, 2);
}

function newGame() {
  stopMelody();
  for (const board of Object.values(boards)) {
    board.score = 0;
    board.score21Since = null;
    board.celebrationStarted = false;
    board.effect = "none";
  }

  gameStartedAt = new Date();
  recordNewGame();
  log(`new game started: ${teamNameFor(boards.A)} vs ${teamNameFor(boards.B)}`);
}

function clearScoreHistory() {
  scoreHistory = [];
  lastScoreEvent = null;
  renderScoreHistory();
  updateGameSummary();
  log("score history cleared");
}

function simulateIdle(minutes) {
  stopMelody();
  for (const board of Object.values(boards)) {
    board.sleeping = true;
    board.deepSleeping = minutes >= 15;
    board.effect = "none";
  }
  log(`all boards: simulated ${minutes} minutes idle`);
}

function randomColor() {
  return `hsl(${Math.floor(Math.random() * 360)}, 100%, 55%)`;
}

function log(message) {
  const list = document.getElementById("log-list");
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
  list.prepend(item);
  while (list.children.length > 60) {
    list.lastElementChild.remove();
  }
}

function updateEffects(now) {
  refreshHz = NORMAL_REFRESH_HZ;
  for (const board of Object.values(boards)) {
    if (board.effect !== "none" && now >= board.effectEndsAt) {
      board.effect = "none";
    }

    if (board.score === MAX_SCORE && board.score21Since && !board.celebrationStarted && now - board.score21Since >= SCORE_21_ARM_MS) {
      triggerCelebration(board.id);
    }

    if (board.effect === "celebration") {
      refreshHz = ANIMATION_REFRESH_HZ;
    }
  }
}

function updateStatus(now) {
  document.getElementById("wireless-status").textContent = `ESP-NOW: ${wirelessEnabled ? "on" : "off"}`;
  const otaRemainingMs = Math.max(0, otaWindowEndsAt - now);
  const minutes = Math.floor(otaRemainingMs / 60000);
  const seconds = Math.floor((otaRemainingMs % 60000) / 1000).toString().padStart(2, "0");
  document.getElementById("ota-status").textContent = `OTA: ${minutes}:${seconds}`;
  document.getElementById("refresh-status").textContent = `Refresh: ${refreshHz} Hz`;
  updateAppPayload(now);
}

function applyAmbientLight() {
  const value = Number(document.getElementById("ambient-light").value);
  log(`ambient light set to ${value}%`);
}

function applyScoreColor() {
  const color = document.getElementById("score-color").value;
  for (const board of Object.values(boards)) {
    board.scoreColor = color;
  }
  log(`score color set to ${color.toUpperCase()}`);
}

function applySoundEnabled() {
  soundEnabled = document.getElementById("sound-enabled").checked;
  if (!soundEnabled) {
    stopMelody();
  }
  log(`sound ${soundEnabled ? "enabled" : "disabled"}`);
}

function applySpeakerVolume() {
  speakerVolume = Number(document.getElementById("speaker-volume").value);
  if (speakerVolume === 0) {
    stopMelody();
  }
  log(`speaker volume set to ${speakerVolume}`);
}

function testSpeaker() {
  playMelody(IR_NOTES, IR_DURATIONS);
  log(`speaker test${soundText()}`);
}

function tick() {
  const now = Date.now();
  updateEffects(now);
  for (const board of Object.values(boards)) {
    renderBoard(board, now);
  }
  updateStatus(now);
  window.setTimeout(tick, 1000 / refreshHz);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const boardId = button.dataset.board;
  const action = button.dataset.action;

  if (action === "score") scoreButton(boardId);
  if (action === "hold-reset") holdReset(boardId);
  if (action === "vibration") triggerVibration(boardId);
  if (action === "ir") triggerIr(boardId);
});

document.getElementById("toggle-wireless").addEventListener("click", () => {
  wirelessEnabled = !wirelessEnabled;
  log(`ESP-NOW ${wirelessEnabled ? "enabled" : "disabled"}`);
});

document.getElementById("ota-restart").addEventListener("click", () => {
  otaWindowEndsAt = Date.now() + OTA_WINDOW_MS;
  log("OTA window restarted");
});

document.getElementById("idle-five").addEventListener("click", () => simulateIdle(5));
document.getElementById("idle-fifteen").addEventListener("click", () => simulateIdle(15));
document.getElementById("test-speaker").addEventListener("click", testSpeaker);
document.getElementById("new-game").addEventListener("click", newGame);
document.getElementById("clear-log").addEventListener("click", () => {
  document.getElementById("log-list").replaceChildren();
});
document.getElementById("clear-score-history").addEventListener("click", clearScoreHistory);
document.getElementById("ambient-light").addEventListener("input", applyAmbientLight);
document.getElementById("score-color").addEventListener("input", applyScoreColor);
document.getElementById("sound-enabled").addEventListener("change", applySoundEnabled);
document.getElementById("speaker-volume").addEventListener("input", applySpeakerVolume);
document.getElementById("team-name-a").addEventListener("input", () => setTeamName("A", false));
document.getElementById("team-name-b").addEventListener("input", () => setTeamName("B", false));
document.getElementById("team-name-a").addEventListener("change", () => setTeamName("A"));
document.getElementById("team-name-b").addEventListener("change", () => setTeamName("B"));

initDisplays();
applyAmbientLight();
applyScoreColor();
renderScoreHistory();
updateGameSummary();
log("simulator ready");
tick();
