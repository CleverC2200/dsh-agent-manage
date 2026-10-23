#!/usr/bin/env python3
"""Render a standalone answer HTML by replacing ANSWER_DATA in the skill template."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


START = "    /* ANSWER_DATA_START */"
END = "    /* ANSWER_DATA_END */"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render the answer visualization HTML template.")
    parser.add_argument("--data", required=True, type=Path, help="UTF-8 JSON file containing ANSWER_DATA")
    parser.add_argument("--output", required=True, type=Path, help="Destination HTML file")
    parser.add_argument("--template", type=Path, help="Optional template override")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    skill_root = Path(__file__).resolve().parents[1]
    template_path = args.template or skill_root / "assets" / "answer-visualization-template.html"

    data = json.loads(args.data.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("ANSWER_DATA must be a JSON object")

    source = template_path.read_text(encoding="utf-8")
    start = source.find(START)
    end = source.find(END)
    if start < 0 or end < 0 or end <= start:
        raise ValueError("Template is missing valid ANSWER_DATA markers")

    payload = json.dumps(data, ensure_ascii=False, indent=2)
    replacement = f"{START}\n    const ANSWER_DATA = {payload};\n{END}"
    rendered = source[:start] + replacement + source[end + len(END) :]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

