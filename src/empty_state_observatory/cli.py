"""Command-line entry points for synthetic benchmark and data export."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import sys

from .model import CHANNEL_COUNT, simulate_pair
from .monitor import run_benchmark


def _benchmark(args: argparse.Namespace) -> int:
    report = run_benchmark(trials=args.trials, steps=args.steps)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.out:
        Path(args.out).write_text(rendered, encoding="utf-8")
    sys.stdout.write(rendered)
    return 0


def _export(args: argparse.Namespace) -> int:
    pair = simulate_pair(
        args.seed,
        steps=args.steps,
        event_onset=args.onset,
        event_channel=args.channel,
        event_strength=args.strength,
    )
    output = Path(args.out)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["run", "step", "channel", "clean_state", "disturbed_state", "clean_reference", "disturbed_observation"])
        for step in range(args.steps + 1):
            for channel in range(CHANNEL_COUNT):
                writer.writerow([
                    pair.disturbed_side,
                    step,
                    channel,
                    f"{pair.clean_trace[step][channel]:.12g}",
                    f"{pair.disturbed_trace[step][channel]:.12g}",
                    f"{pair.reference[step][channel]:.12g}",
                    f"{pair.disturbed_observation[step][channel]:.12g}",
                ])
    print(json.dumps({
        "label": "SYNTHETIC",
        "seed": pair.seed,
        "out": str(output),
        "event_onset_step": pair.event_onset,
        "event_channel": pair.event_channel,
        "event_strength": pair.event_strength,
        "disturbed_side": pair.disturbed_side,
        "channel_count": CHANNEL_COUNT,
        "rows": (args.steps + 1) * CHANNEL_COUNT,
    }, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="empty-state-observatory", description="Synthetic 32-channel paired-run game and benchmark")
    sub = parser.add_subparsers(dest="command", required=True)
    bench = sub.add_parser("benchmark", help="run the deterministic synthetic detector benchmark")
    bench.add_argument("--trials", type=int, default=200)
    bench.add_argument("--steps", type=int, default=160)
    bench.add_argument("--out", help="also write the JSON report to this file")
    bench.set_defaults(handler=_benchmark)
    export = sub.add_parser("export", help="export one paired synthetic run as CSV")
    export.add_argument("--seed", required=True)
    export.add_argument("--steps", type=int, default=160)
    export.add_argument("--onset", type=int)
    export.add_argument("--channel", type=int)
    export.add_argument("--strength", type=float)
    export.add_argument("--out", required=True)
    export.set_defaults(handler=_export)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.handler(args)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    return 2
