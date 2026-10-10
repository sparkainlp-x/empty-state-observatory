"""Synthetic 32-channel consistency metrics and reproducible benchmark."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import statistics
from typing import Sequence

from .model import CHANNEL_COUNT, SimulationPair, simulate_pair

PEAK_THRESHOLD = 0.055
ANTIPODAL_THRESHOLD = 0.045
FOLD8_THRESHOLD = 0.045
RMS_BASELINE_THRESHOLD = 0.025


@dataclass(frozen=True)
class FrameMetrics:
    peak_residual: float
    antipodal_residual: float
    fold8_residual: float

    @property
    def alarm(self) -> bool:
        return (
            self.peak_residual > PEAK_THRESHOLD
            or self.antipodal_residual > ANTIPODAL_THRESHOLD
            or self.fold8_residual > FOLD8_THRESHOLD
        )


def _state(values: Sequence[float], label: str) -> tuple[float, ...]:
    if len(values) != CHANNEL_COUNT:
        raise ValueError(f"{label} must contain exactly {CHANNEL_COUNT} channels; got {len(values)}")
    row = tuple(float(v) for v in values)
    if not all(math.isfinite(v) for v in row):
        raise ValueError(f"{label} values must all be finite")
    return row


def frame_metrics(observation: Sequence[float], reference: Sequence[float]) -> FrameMetrics:
    """Score one observed 32-vector against its time-aligned clean reference."""
    observed = _state(observation, "observation")
    clean = _state(reference, "reference")
    residual = tuple(observed[i] - clean[i] for i in range(CHANNEL_COUNT))
    peak = max(abs(value) for value in residual)
    antipodal = max(abs(residual[i] - residual[i + 16]) for i in range(16))
    fold8 = max(
        abs(residual[8 * ring + node] - residual[8 * ring + (node + 1) % 8])
        for ring in range(4)
        for node in range(8)
    )
    return FrameMetrics(peak, antipodal, fold8)


def rms_residual(observation: Sequence[float], reference: Sequence[float]) -> float:
    observed = _state(observation, "observation")
    clean = _state(reference, "reference")
    return math.sqrt(sum((observed[i] - clean[i]) ** 2 for i in range(CHANNEL_COUNT)) / CHANNEL_COUNT)


def _first_alert(trace: Sequence[Sequence[float]], reference: Sequence[Sequence[float]], *, start: int, baseline: bool = False) -> int | None:
    if len(trace) != len(reference):
        raise ValueError("trace and reference must have equal time lengths")
    for step in range(start, len(trace)):
        if baseline:
            flagged = rms_residual(trace[step], reference[step]) > RMS_BASELINE_THRESHOLD
        else:
            flagged = frame_metrics(trace[step], reference[step]).alarm
        if flagged:
            return step
    return None


def _summary(false_frames: int, clean_frames: int, delays: list[int], misses: int, trials: int) -> dict[str, float | int | None]:
    return {
        "false_alarm_frames": false_frames,
        "clean_frames": clean_frames,
        "false_alarm_rate": false_frames / clean_frames if clean_frames else 0.0,
        "detection_rate": (trials - misses) / trials if trials else 0.0,
        "detected_trials": trials - misses,
        "misses": misses,
        "median_delay_steps": float(statistics.median(delays)) if delays else None,
    }


def run_benchmark(*, trials: int = 200, steps: int = 160) -> dict[str, object]:
    """Evaluate deterministic clean frames and paired disturbances over seed labels."""
    if not isinstance(trials, int) or trials < 1:
        raise ValueError("trials must be a positive integer")
    if not isinstance(steps, int) or steps < 40:
        raise ValueError("steps must be an integer of at least 40")

    oes_false = baseline_false = clean_frames = 0
    oes_delays: list[int] = []
    baseline_delays: list[int] = []
    oes_misses = baseline_misses = 0
    for index in range(trials):
        pair: SimulationPair = simulate_pair(f"bench-{index:06d}", steps=steps)
        clean_frames += len(pair.reference)
        for observed, reference in zip(pair.clean_observation, pair.reference, strict=True):
            oes_false += int(frame_metrics(observed, reference).alarm)
            baseline_false += int(rms_residual(observed, reference) > RMS_BASELINE_THRESHOLD)

        first = _first_alert(pair.disturbed_observation, pair.reference, start=pair.event_onset)
        if first is None:
            oes_misses += 1
        else:
            oes_delays.append(first - pair.event_onset)
        first_baseline = _first_alert(
            pair.disturbed_observation, pair.reference, start=pair.event_onset, baseline=True,
        )
        if first_baseline is None:
            baseline_misses += 1
        else:
            baseline_delays.append(first_baseline - pair.event_onset)

    return {
        "label": "SYNTHETIC",
        "model": "32-state periodic boundary/Laplacian cascade",
        "trials": trials,
        "steps_per_trial": steps,
        "channel_count": CHANNEL_COUNT,
        "time_aligned_clean_reference": True,
        "thresholds": {
            "peak_residual_strictly_greater_than": PEAK_THRESHOLD,
            "antipodal_residual_strictly_greater_than": ANTIPODAL_THRESHOLD,
            "fold8_residual_strictly_greater_than": FOLD8_THRESHOLD,
            "baseline_rms_strictly_greater_than": RMS_BASELINE_THRESHOLD,
        },
        "oes32_inspired_monitor": _summary(oes_false, clean_frames, oes_delays, oes_misses, trials),
        "scalar_rms_baseline": _summary(baseline_false, clean_frames, baseline_delays, baseline_misses, trials),
    }
