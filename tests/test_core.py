import math

import pytest

from empty_state_observatory import (
    ALPHA,
    CHANNEL_COUNT,
    STATE_COUNT,
    STATE_TO_CHANNEL,
    cascade_step,
    edge_gradient,
    frame_metrics,
    run_benchmark,
    simulate_pair,
    vertex_laplacian,
)


def test_contract_is_exactly_32_states_with_explicit_identity_mapping():
    assert STATE_COUNT == CHANNEL_COUNT == 32
    assert STATE_TO_CHANNEL == tuple(range(32))
    with pytest.raises(ValueError, match="exactly 32"):
        edge_gradient([0.0] * 64)
    with pytest.raises(ValueError, match="exactly 32"):
        frame_metrics([0.0] * 31, [0.0] * 32)


def test_boundary_gradient_sums_to_zero_and_constant_is_harmonic():
    assert math.isclose(sum(edge_gradient([float(i) for i in range(32)])), 0.0, abs_tol=1e-12)
    assert vertex_laplacian([3.5] * 32) == (0.0,) * 32


def test_unforced_laplacian_update_is_nonexpansive():
    state = tuple(math.sin(i * 0.37) + 0.2 * math.cos(i * 0.11) for i in range(32))
    energy_before = sum(value * value for value in state)
    for _ in range(200):
        state = cascade_step(state, alpha=ALPHA)
    energy_after = sum(value * value for value in state)
    assert energy_after <= energy_before + 1e-12
    with pytest.raises(ValueError, match="alpha"):
        cascade_step(state, alpha=0.251)


def test_seeded_pair_replays_with_aligned_clean_forcing_and_hidden_event():
    first = simulate_pair("unit-seed", steps=96, event_onset=44, event_channel=7, event_strength=0.2)
    second = simulate_pair("unit-seed", steps=96, event_onset=44, event_channel=7, event_strength=0.2)
    assert first == second
    assert first.clean_trace[0] == first.disturbed_trace[0] == (0.0,) * 32
    assert first.clean_trace[40] == first.disturbed_trace[40]
    assert first.clean_trace[44] != first.disturbed_trace[44]
    assert all(len(frame) == 32 for frame in first.clean_trace)
    assert len(first.clean_trace) == len(first.reference) == 97
    assert first.event_onset == 44
    assert first.disturbed_side in {"A", "B"}


def test_invalid_width_is_rejected_not_truncated_or_averaged():
    pair = simulate_pair("width", steps=80)
    with pytest.raises(ValueError, match="exactly 32"):
        frame_metrics(pair.reference[0] + (0.0,), pair.reference[0])
    with pytest.raises(ValueError, match="exactly 32"):
        cascade_step([0.0] * 64)


def test_monitor_threshold_equality_is_not_an_alarm():
    at_threshold = frame_metrics([0.055] * 32, [0.0] * 32)
    over_threshold = frame_metrics([0.055001] * 32, [0.0] * 32)
    assert not at_threshold.alarm
    assert over_threshold.alarm


def test_benchmark_is_deterministic_and_reports_all_required_metrics():
    first = run_benchmark(trials=8, steps=80)
    second = run_benchmark(trials=8, steps=80)
    assert first == second
    assert first["label"] == "SYNTHETIC"
    assert first["channel_count"] == 32
    for detector in ("oes32_inspired_monitor", "scalar_rms_baseline"):
        summary = first[detector]
        assert 0.0 <= summary["false_alarm_rate"] <= 1.0
        assert 0.0 <= summary["detection_rate"] <= 1.0
        assert 0 <= summary["misses"] <= 8
        assert summary["false_alarm_frames"] <= summary["clean_frames"]
        if summary["detected_trials"]:
            assert summary["median_delay_steps"] >= 0
