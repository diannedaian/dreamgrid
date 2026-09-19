"""Deterministic conversion of unambiguous quoted measurements, never visual scale guesses."""

import re


def quoted_meters(evidence: str) -> float | None:
    # Leave compound/fractional/multi-axis text for review instead of misreading it.
    if len(re.findall(r"\d+(?:\.\d+)?", evidence)) != 1:
        return None
    match = re.search(
        r"(?<![\d.\-/])(\d+(?:\.\d+)?)\s*"
        r'(inches|inch|in\b|[″"]|centimeters|cm\b|millimeters|mm\b|meters|m\b)',
        evidence,
        re.IGNORECASE,
    )
    if not match:
        return None
    value, unit = float(match[1]), match[2].lower()
    factor = (
        0.0254
        if unit.startswith("in") or unit in {"″", '"'}
        else (
            0.01 if unit in {"centimeters", "cm"} else 0.001 if unit in {"millimeters", "mm"} else 1
        )
    )
    return round(value * factor, 9)
