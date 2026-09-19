"""Small deterministic templates: AI chooses parameters, never code or operations."""

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from .models import TEMPLATES, Analysis, Dimensions, PipelineError

STYLE_VERSION = "image-geometry-v2"


def compile_recipe(analysis: Analysis, dimensions: Dimensions, root: Path) -> dict[str, Any]:
    template = analysis.template
    if template not in TEMPLATES:
        raise PipelineError("This furniture shape is not supported by the current templates.", 422)
    width, height, depth = dimensions.vector()
    parts: list[dict[str, Any]] = []

    def box(
        name: str,
        size: list[float],
        pos: list[float],
        material: str = "frame",
        primitive: str = "rounded-box",
    ) -> None:
        parts.append(
            {
                "id": name,
                "primitive": primitive,
                "role": "body",
                "dimensionsM": size,
                "positionM": pos,
                "rotationDeg": [0, 0, 0],
                "materialId": material,
                "cornerRadiusM": min(size) * 0.15,
            }
        )

    # Original curated geometry keeps the established style for these two families.
    if template in {"bed", "chair-sled"}:
        slug = "college-bed" if template == "bed" else "campus-chair"
        spec: dict[str, Any] = json.loads((root / "assets/specs" / f"{slug}.json").read_text())
        spec["name"] = analysis.title[:100] or "Furniture"
        spec["dimensionsM"] = dimensions.vector()
        for material in spec["materials"]:
            if material["id"] == "wood" or material["id"].startswith("oak"):
                material["baseColorHex"] = analysis.frameColor
            elif material["id"] in {"seat", "back", "mattress", "navy"}:
                material["baseColorHex"] = analysis.accentColor
    else:
        thickness = min(width, depth, height) * 0.055
        if template.startswith("desk"):
            box("desktop", [width, thickness, depth], [0, height - thickness / 2, 0])
            if template == "desk-table":
                for x in [-1, 1]:
                    for z in [-1, 1]:
                        box(
                            f"leg-{x}-{z}",
                            [thickness, height - thickness, thickness],
                            [
                                x * (width * 0.43),
                                (height - thickness) / 2,
                                z * depth * 0.4,
                            ],
                        )
            else:
                for x in [-1, 1]:
                    box(
                        f"side-{x}",
                        [thickness, height - thickness, depth * 0.93],
                        [
                            x * (width - thickness) / 2,
                            (height - thickness) / 2,
                            0,
                        ],
                    )
                side = -1 if analysis.drawerSide == "left" else 1
                cabinet_width = width * 0.36
                center = side * (width / 2 - cabinet_width / 2 - thickness)
                box(
                    "pedestal",
                    [cabinet_width, height - thickness, depth * 0.88],
                    [
                        center,
                        (height - thickness) / 2,
                        0,
                    ],
                )
                count = analysis.drawerCount
                step = (height - thickness * 3) / count
                for index in range(count):
                    y = thickness + step * (index + 0.5)
                    box(
                        f"drawer-{index}",
                        [cabinet_width * 0.93, step * 0.91, thickness],
                        [
                            center,
                            y,
                            depth * 0.46,
                        ],
                    )
                    box(
                        f"pull-{index}",
                        [cabinet_width * 0.65, thickness * 0.2, thickness],
                        [
                            center,
                            y + step * 0.29,
                            depth * 0.47,
                        ],
                        "accent",
                    )
                box(
                    "modesty",
                    [width * 0.8, height * 0.45, thickness],
                    [
                        0,
                        height * 0.67,
                        -depth * 0.43,
                    ],
                )
        elif template == "chair":
            seat_y = height * 0.55
            box("seat", [width, height * 0.065, depth * 0.84], [0, seat_y, depth * 0.06], "accent")
            box(
                "back",
                [width * 0.9, height * 0.36, depth * 0.08],
                [
                    0,
                    height * 0.82,
                    -depth * 0.44,
                ],
                "accent",
            )
            for x in [-1, 1]:
                for z in [-1, 1]:
                    leg_height = height * 0.9 if z == -1 else seat_y
                    box(
                        f"leg-{x}-{z}",
                        [thickness, leg_height, thickness],
                        [
                            x * width * 0.4,
                            leg_height / 2,
                            z * depth * 0.4,
                        ],
                    )
        elif template == "shelf":
            for x in [-1, 1]:
                box(
                    f"side-{x}",
                    [thickness, height, depth],
                    [
                        x * (width - thickness) / 2,
                        height / 2,
                        0,
                    ],
                )
            for index in range(analysis.shelfCount):
                y = thickness / 2 + (height - thickness) * index / (analysis.shelfCount - 1)
                box(f"shelf-{index}", [width - thickness * 2, thickness, depth], [0, y, 0])
        elif template == "lamp":
            box(
                "base",
                [width * 0.75, height * 0.08, depth * 0.75],
                [
                    0,
                    height * 0.04,
                    0,
                ],
                primitive="cylinder",
            )
            box(
                "stem",
                [width * 0.07, height * 0.61, depth * 0.07],
                [
                    0,
                    height * 0.35,
                    0,
                ],
                primitive="cylinder",
            )
            box(
                "shade",
                [width, height * 0.38, depth],
                [
                    0,
                    height * 0.81,
                    0,
                ],
                "accent",
                primitive="shade",
            )
        spec = {
            "schemaVersion": "1.0",
            "name": analysis.title[:100] or "Furniture",
            "category": TEMPLATES[template][0],
            "dimensionsM": dimensions.vector(),
            "materials": [
                {
                    "id": "frame",
                    "name": "Frame",
                    "baseColorHex": analysis.frameColor,
                    "roughness": 0.6,
                    "metallic": 0,
                },
                {
                    "id": "accent",
                    "name": "Accent",
                    "baseColorHex": analysis.accentColor,
                    "roughness": 0.8,
                    "metallic": 0,
                },
            ],
            "parts": parts,
        }
    schema = json.loads(
        (root / "packages/contracts/schemas/furniture-spec.schema.json").read_text()
    )
    Draft202012Validator(schema).validate(spec)
    return spec
