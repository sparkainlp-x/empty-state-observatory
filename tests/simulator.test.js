import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { BENCHMARK } from "../web/benchmark-data.js";
import {
  ALPHA, CHANNEL_COUNT, STATE_COUNT, STATE_TO_CHANNEL, cascadeStep, edgeGradient,
  frameMetrics, hashSeed, simulatePair, vertexLaplacian,
} from "../web/simulator.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the bundled browser metrics are byte-for-byte equivalent to the checked-in synthetic JSON", () => {
  const report = JSON.parse(readFileSync(new URL("../web/benchmark.json", import.meta.url), "utf8"));
  assert.deepEqual(BENCHMARK, report);
  assert.equal(BENCHMARK.label, "SYNTHETIC");
});

test("replay restores the initial guess label as well as enabling both buttons", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const renderPair = app.slice(app.indexOf("function renderPair"), app.indexOf("\nfunction formatPercent"));
  assert.match(renderPair, /\$\(`#guess-\$\{side\}`\)\.disabled = false;/);
  assert.match(renderPair, /\$\(`#guess-\$\{side\}`\)\.textContent = "This run was disturbed →";/);
});

test("the browser model declares an explicit one-to-one 32-channel map", () => {
  assert.equal(STATE_COUNT, 32);
  assert.equal(CHANNEL_COUNT, 32);
  assert.deepEqual(STATE_TO_CHANNEL, Array.from({ length: 32 }, (_, i) => i));
  assert.throws(() => vertexLaplacian(Array(64).fill(0)), /exactly 32/);
  assert.throws(() => frameMetrics(Array(31).fill(0), Array(32).fill(0)), /exactly 32/);
});

test("the boundary operator annihilates constants and stable update preserves a constant", () => {
  assert.deepEqual(edgeGradient(Array(32).fill(2.5)), Array(32).fill(0));
  assert.deepEqual(vertexLaplacian(Array(32).fill(2.5)), Array(32).fill(0));
  assert.deepEqual(cascadeStep(Array(32).fill(2.5), undefined, ALPHA), Array(32).fill(2.5));
});

test("monitor thresholds use strict exceedance, not equality", () => {
  assert.equal(frameMetrics(Array(32).fill(0.055), Array(32).fill(0)).alarm, false);
  assert.equal(frameMetrics(Array(32).fill(0.055001), Array(32).fill(0)).alarm, true);
});

test("identical seeds and parameters replay byte-for-byte-equivalent values", () => {
  const one = simulatePair("shared-seed", { steps: 88, eventOnset: 47, eventChannel: 12, eventStrength: 0.21 });
  const two = simulatePair("shared-seed", { steps: 88, eventOnset: 47, eventChannel: 12, eventStrength: 0.21 });
  assert.deepEqual(one, two);
  assert.deepEqual(one.cleanTrace[0], Array(32).fill(0));
  assert.notDeepEqual(one.cleanTrace[47], one.disturbedTrace[47]);
  assert.ok(one.cleanTrace.every((frame) => frame.length === 32));
});

test("Python and browser simulators share the exact seed, event, and aligned traces", () => {
  const seed = "cross-runtime-seed";
  const js = simulatePair(seed, { steps: 80 });
  const script = [
    "import json",
    "from empty_state_observatory import simulate_pair",
    `p = simulate_pair(${JSON.stringify(seed)}, steps=80)`,
    "print(json.dumps({'event_onset': p.event_onset, 'event_channel': p.event_channel, 'event_strength': p.event_strength, 'disturbed_side': p.disturbed_side, 'clean_trace': p.clean_trace, 'disturbed_trace': p.disturbed_trace, 'reference': p.reference, 'disturbed_observation': p.disturbed_observation}, separators=(',', ':')))"
  ].join("\n");
  const raw = execFileSync("python3", ["-c", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: path.join(root, "src") },
  });
  const py = JSON.parse(raw);
  for (const field of ["event_onset", "event_channel", "event_strength", "disturbed_side", "clean_trace", "disturbed_trace", "reference", "disturbed_observation"]) {
    assert.deepEqual(js[field === "event_onset" ? "eventOnset" : field === "event_channel" ? "eventChannel" : field === "event_strength" ? "eventStrength" : field === "disturbed_side" ? "disturbedSide" : field === "clean_trace" ? "cleanTrace" : field === "disturbed_trace" ? "disturbedTrace" : field === "reference" ? "reference" : "disturbedObservation"], py[field], field);
  }
  assert.equal(hashSeed(seed), hashSeed(seed));
});
