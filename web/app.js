import { DEFAULT_STEPS, firstAlert, frameMetrics, simulatePair } from "./simulator.js";
import { BENCHMARK } from "./benchmark-data.js";

const $ = (selector) => document.querySelector(selector);
const seedInput = $("#seed-input");
const revealPanel = $("#reveal-panel");
const metricsGrid = $("#metrics-grid");
let currentPair;
let runA;
let runB;
let answered = false;

const params = new URLSearchParams(location.search);
if (params.has("seed")) seedInput.value = params.get("seed").slice(0, 64);

function runForSide(pair, side) {
  const disturbed = side === pair.disturbedSide;
  return {
    side,
    disturbed,
    trace: disturbed ? pair.disturbedTrace : pair.cleanTrace,
    observation: disturbed ? pair.disturbedObservation : pair.cleanObservation,
  };
}

function heatColor(value, maxAbs) {
  const strength = Math.min(1, Math.abs(value) / maxAbs);
  const mix = Math.pow(strength, 0.72);
  const low = value >= 0 ? [20, 28, 43] : [19, 31, 50];
  const high = value >= 0 ? [255, 137, 100] : [97, 161, 229];
  return `rgb(${low.map((channel, i) => Math.round(channel + (high[i] - channel) * mix)).join(",")})`;
}

function drawHeatmap(canvas, trace, scale) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const cellW = width / trace.length;
  const cellH = height / 32;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#080d17";
  ctx.fillRect(0, 0, width, height);
  for (let step = 0; step < trace.length; step++) {
    for (let channel = 0; channel < 32; channel++) {
      ctx.fillStyle = heatColor(trace[step][channel], scale);
      ctx.fillRect(step * cellW, channel * cellH, Math.ceil(cellW + 0.3), Math.ceil(cellH + 0.3));
    }
  }
  ctx.strokeStyle = "rgba(202,215,239,.11)";
  ctx.lineWidth = 1;
  for (let channel = 0; channel <= 32; channel += 8) {
    const y = channel * cellH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
}

function renderPair(pair) {
  currentPair = pair;
  answered = false;
  revealPanel.hidden = true;
  const leftSide = pair.disturbedSide === "A" ? "B" : "A";
  runA = runForSide(pair, leftSide);
  runB = runForSide(pair, pair.disturbedSide);
  // A deterministic seed bit decides which side is disturbed, while Run A/B remain neutral.
  if (pair.disturbedSide === "A") [runA, runB] = [runB, runA];
  const maxAbs = Math.max(0.04, ...pair.cleanTrace.flat().map(Math.abs), ...pair.disturbedTrace.flat().map(Math.abs));
  drawHeatmap($("#run-a-canvas"), runA.trace, maxAbs);
  drawHeatmap($("#run-b-canvas"), runB.trace, maxAbs);
  for (const side of ["a", "b"]) {
    $(`#run-${side}-card`).classList.remove("correct", "incorrect", "answered");
    $(`#run-${side}-status`).textContent = "AWAITING GUESS";
    $(`#guess-${side}`).disabled = false;
    $(`#guess-${side}`).textContent = "This run was disturbed →";
  }
  for (const canvas of [$("#run-a-canvas"), $("#run-b-canvas")]) {
    canvas.setAttribute("aria-label", `Synthetic heatmap of Run ${canvas.id.includes("a-") ? "A" : "B"}, 32 channels over ${pair.cleanTrace.length - 1} simulation steps. Color shows signed state value.`);
  }
}

function formatPercent(value) {
  return `${(100 * value).toFixed(2)}%`;
}

function metricCard(title, summary, className) {
  const delay = summary.median_delay_steps == null ? "—" : `${summary.median_delay_steps} steps`;
  return `<article class="metric-card ${className}"><h3>${title}</h3><div class="metric-values"><div><span>False alarms</span><strong>${formatPercent(summary.false_alarm_rate)}</strong></div><div><span>Detection</span><strong>${formatPercent(summary.detection_rate)}</strong></div><div><span>Median delay</span><strong>${delay}</strong></div><div><span>Misses</span><strong>${summary.misses}</strong></div></div></article>`;
}

function loadBenchmark() {
  const data = BENCHMARK;
  $("#benchmark-copy").textContent = `${data.label} · ${data.trials} seeded trials × ${data.steps_per_trial} steps · ${data.channel_count} explicitly mapped channels · false alarms are frame-level; detection and misses are trial-level.`;
  metricsGrid.innerHTML = metricCard("OES-32-INSPIRED MONITOR", data.oes32_inspired_monitor, "monitor") + metricCard("SCALAR RMS BASELINE", data.scalar_rms_baseline, "baseline");
}

function reveal(guess) {
  if (answered) return;
  answered = true;
  const actual = currentPair.disturbedSide;
  const correct = guess === actual;
  const disturbedRun = actual === "A" ? runA : runB;
  const first = firstAlert(disturbedRun.observation, currentPair.reference, currentPair.eventOnset);
  const onsetScores = frameMetrics(disturbedRun.observation[currentPair.eventOnset], currentPair.reference[currentPair.eventOnset]);
  const guessResult = $("#guess-result");
  guessResult.textContent = correct ? "A good read." : "The other run was disturbed.";
  $("#answer-copy").textContent = `Run ${actual} received the hidden pulse. Your guess was ${correct ? "correct" : "not quite"}. The reference monitor flagged ${first == null ? "no post-onset frame" : `step ${first} (${first - currentPair.eventOnset} steps after onset)`}.`;
  $("#event-onset").textContent = `step ${currentPair.eventOnset}`;
  $("#event-strength").textContent = `${currentPair.eventChannel} · ${currentPair.eventStrength.toFixed(3)}`;
  $("#event-alert").textContent = onsetScores.alarm ? `YES · peak ${onsetScores.peakResidual.toFixed(3)}` : `NO · peak ${onsetScores.peakResidual.toFixed(3)}`;
  revealPanel.hidden = false;
  for (const side of ["A", "B"]) {
    const sideLower = side.toLowerCase();
    const isActual = side === actual;
    const isGuess = side === guess;
    const card = $(`#run-${sideLower}-card`);
    const status = $(`#run-${sideLower}-status`);
    card.classList.add("answered", isActual ? "correct" : "incorrect");
    status.textContent = isActual ? "DISTURBED" : "CLEAN REFERENCE";
    $(`#guess-${sideLower}`).disabled = true;
    $(`#guess-${sideLower}`).textContent = isGuess ? (correct ? "YOUR GUESS · CORRECT" : "YOUR GUESS · NOT THIS RUN") : (isActual ? "HIDDEN PULSE REVEALED" : "CLEAN RUN");
  }
  revealPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function exportCsv() {
  const pair = currentPair;
  const rows = [["seed", "step", "channel", "run", "latent_state", "clean_reference_measurement", "run_measurement", "label"]];
  for (let step = 0; step < pair.cleanTrace.length; step++) {
    for (let channel = 0; channel < 32; channel++) {
      for (const side of ["A", "B"]) {
        const run = side === "A" ? runA : runB;
        const measurement = run.disturbed ? pair.disturbedObservation : pair.cleanObservation;
        rows.push([pair.seed, step, channel, side, run.trace[step][channel], pair.reference[step][channel], measurement[step][channel], run.disturbed ? "SYNTHETIC_DISTURBANCE" : "CLEAN"]);
      }
    }
  }
  const csv = rows.map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `empty-state-observatory-${pair.seed.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "seed"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function replay() {
  const seed = seedInput.value.trim() || "ESO-032";
  seedInput.value = seed;
  const query = new URLSearchParams(location.search);
  query.set("seed", seed);
  history.replaceState(null, "", `${location.pathname}?${query.toString()}`);
  renderPair(simulatePair(seed, { steps: DEFAULT_STEPS }));
}

$("#replay-button").addEventListener("click", replay);
$("#export-button").addEventListener("click", exportCsv);
$("#guess-a").addEventListener("click", () => reveal("A"));
$("#guess-b").addEventListener("click", () => reveal("B"));
seedInput.addEventListener("keydown", (event) => { if (event.key === "Enter") replay(); });
renderPair(simulatePair(seedInput.value, { steps: DEFAULT_STEPS }));
loadBenchmark();
