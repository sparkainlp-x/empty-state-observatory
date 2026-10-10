"""Synthetic Empty-State Observatory reference implementation."""
from .model import (
    ALPHA,
    CHANNEL_COUNT,
    STATE_COUNT,
    STATE_TO_CHANNEL,
    SimulationPair,
    cascade_step,
    edge_gradient,
    hash_seed,
    simulate_pair,
    vertex_laplacian,
)
from .monitor import (
    ANTIPODAL_THRESHOLD,
    FOLD8_THRESHOLD,
    PEAK_THRESHOLD,
    RMS_BASELINE_THRESHOLD,
    FrameMetrics,
    frame_metrics,
    rms_residual,
    run_benchmark,
)

__all__ = [
    "ALPHA", "CHANNEL_COUNT", "STATE_COUNT", "STATE_TO_CHANNEL", "SimulationPair",
    "ANTIPODAL_THRESHOLD", "FOLD8_THRESHOLD", "PEAK_THRESHOLD", "RMS_BASELINE_THRESHOLD",
    "FrameMetrics", "cascade_step", "edge_gradient", "frame_metrics", "hash_seed",
    "rms_residual", "run_benchmark", "simulate_pair", "vertex_laplacian",
]
