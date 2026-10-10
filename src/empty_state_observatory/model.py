"""Deterministic, synthetic 32-state ring evolution; not a physical model."""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Sequence

STATE_COUNT = 32
CHANNEL_COUNT = 32
STATE_TO_CHANNEL = tuple(range(STATE_COUNT))  # Explicit identity bijection: no truncation.
ALPHA = 0.18
BACKGROUND_FORCE = 0.002
MEASUREMENT_NOISE = 0.003
DEFAULT_STEPS = 160
_U32 = 0xFFFFFFFF


@dataclass(frozen=True)
class SimulationPair:
    seed: str
    clean_trace: tuple[tuple[float, ...], ...]
    disturbed_trace: tuple[tuple[float, ...], ...]
    clean_observation: tuple[tuple[float, ...], ...]
    reference: tuple[tuple[float, ...], ...]
    disturbed_observation: tuple[tuple[float, ...], ...]
    event_onset: int
    event_channel: int
    event_strength: float
    disturbed_side: str


class XorShift32:
    """Small specified PRNG so a seed deterministically replays in Python and JS."""

    def __init__(self, seed: int) -> None:
        state = seed & _U32
        self.state = state if state else 0xA341316C

    def random(self) -> float:
        x = self.state
        x ^= (x << 13) & _U32
        x ^= x >> 17
        x ^= (x << 5) & _U32
        self.state = x & _U32
        return self.state / 4294967296.0


def hash_seed(value: str | int) -> int:
    """FNV-1a over UTF-8 bytes, matching the browser implementation."""
    h = 2166136261
    for byte in str(value).encode("utf-8"):
        h = ((h ^ byte) * 16777619) & _U32
    return h or 0xA341316C


def _vector(values: Sequence[float], name: str) -> tuple[float, ...]:
    if len(values) != STATE_COUNT:
        raise ValueError(f"{name} must contain exactly {STATE_COUNT} values; got {len(values)}")
    result = tuple(float(v) for v in values)
    if not all(math.isfinite(v) for v in result):
        raise ValueError(f"{name} values must all be finite")
    return result


def edge_gradient(state: Sequence[float]) -> tuple[float, ...]:
    """Oriented edge differences for the 32-edge periodic boundary operator."""
    x = _vector(state, "state")
    return tuple(x[(i + 1) % STATE_COUNT] - x[i] for i in range(STATE_COUNT))


def vertex_laplacian(state: Sequence[float]) -> tuple[float, ...]:
    """Return BᵀBx on the ring, composing edge boundary and coboundary maps."""
    x = _vector(state, "state")
    grad = edge_gradient(x)
    return tuple(grad[(i - 1) % STATE_COUNT] - grad[i] for i in range(STATE_COUNT))


def cascade_step(
    state: Sequence[float],
    drive: Sequence[float] | None = None,
    *,
    alpha: float = ALPHA,
) -> tuple[float, ...]:
    """Apply one stable explicit heat step plus an optional synthetic drive."""
    x = _vector(state, "state")
    u = (0.0,) * STATE_COUNT if drive is None else _vector(drive, "drive")
    if not math.isfinite(alpha) or not 0.0 < alpha <= 0.25:
        raise ValueError("alpha must be finite and in (0, 0.25] for this non-negative update")
    grad = edge_gradient(x)
    return tuple(
        x[i] - alpha * (grad[(i - 1) % STATE_COUNT] - grad[i]) + u[i]
        for i in range(STATE_COUNT)
    )


def _trace(forcing: Sequence[Sequence[float]], onset: int | None, channel: int, strength: float) -> tuple[tuple[float, ...], ...]:
    state = (0.0,) * STATE_COUNT
    frames: list[tuple[float, ...]] = [state]
    for step, drive in enumerate(forcing, start=1):
        updated = list(cascade_step(state, drive))
        if step == onset:
            # A compact, localized pulse spreads over a five-channel neighborhood.
            for offset, weight in ((0, 1.0), (-1, 0.46), (1, 0.46), (-2, 0.16), (2, 0.16)):
                updated[(channel + offset) % STATE_COUNT] += strength * weight
        state = tuple(updated)
        frames.append(state)
    return tuple(frames)


def _measurement(
    trace: Sequence[Sequence[float]], seed: int, salt: int,
) -> tuple[tuple[float, ...], ...]:
    rng = XorShift32(seed ^ salt)
    return tuple(
        tuple(value + (2.0 * rng.random() - 1.0) * MEASUREMENT_NOISE for value in frame)
        for frame in trace
    )


def simulate_pair(
    seed: str | int,
    *,
    steps: int = DEFAULT_STEPS,
    event_onset: int | None = None,
    event_channel: int | None = None,
    event_strength: float | None = None,
) -> SimulationPair:
    """Create aligned clean/disturbed synthetic runs and independent measurements."""
    if not isinstance(steps, int) or steps < 40:
        raise ValueError("steps must be an integer of at least 40")
    seed_text = str(seed)
    base = hash_seed(seed_text)
    params = XorShift32(base ^ 0x2C1B3C6D)
    low = max(20, steps // 4)
    high = min(steps - 20, (3 * steps) // 4)
    chosen_onset = event_onset if event_onset is not None else low + int(params.random() * (high - low + 1))
    chosen_channel = event_channel if event_channel is not None else int(params.random() * STATE_COUNT)
    chosen_strength = event_strength if event_strength is not None else 0.10 + 0.18 * params.random()
    if not isinstance(chosen_onset, int) or not 1 <= chosen_onset <= steps:
        raise ValueError("event_onset must be an integer within the simulated steps")
    if not isinstance(chosen_channel, int) or not 0 <= chosen_channel < STATE_COUNT:
        raise ValueError(f"event_channel must be in [0, {STATE_COUNT - 1}]")
    if not math.isfinite(chosen_strength) or chosen_strength <= 0:
        raise ValueError("event_strength must be a finite positive number")

    forcing_rng = XorShift32(base ^ 0x7F4A7C15)
    forcing = tuple(
        tuple((2.0 * forcing_rng.random() - 1.0) * BACKGROUND_FORCE for _ in range(STATE_COUNT))
        for _ in range(steps)
    )
    clean = _trace(forcing, None, chosen_channel, 0.0)
    disturbed = _trace(forcing, chosen_onset, chosen_channel, chosen_strength)
    clean_obs = _measurement(clean, base, 0x1987A2B1)
    reference = _measurement(clean, base, 0x41C64E6D)
    disturbed_obs = _measurement(disturbed, base, 0x6D2B79F5)
    side_rng = XorShift32(base ^ 0x3C6EF372)
    side = "A" if side_rng.random() < 0.5 else "B"

    return SimulationPair(
        seed=seed_text,
        clean_trace=clean,
        disturbed_trace=disturbed,
        clean_observation=clean_obs,
        reference=reference,
        disturbed_observation=disturbed_obs,
        event_onset=chosen_onset,
        event_channel=chosen_channel,
        event_strength=chosen_strength,
        disturbed_side=side,
    )
