"""Bounded image-authored geometry, not furniture templates or executable code."""

import json
import math
import struct
from pathlib import Path
from typing import Annotated, Any, Literal

from jsonschema import Draft202012Validator
from pydantic import Field, model_validator

from .models import Category, Data, Dimensions, ObservedDimension, PipelineError

Number = Annotated[float, Field(ge=-20, le=20, allow_inf_nan=False)]
Vector3 = Annotated[list[Number], Field(min_length=3, max_length=3)]
Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_-]{0,47}$")]
Color = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]


class Surface(Data):
    id: Identifier
    color: Color
    roughness: float = Field(ge=0, le=1)
    metallic: float = Field(ge=0, le=1)


class ProfilePoint(Data):
    radius: float = Field(ge=0, le=10)
    height: float = Field(ge=-10, le=10)


class GeometryPart(Data):
    id: Identifier
    primitive: Literal["rounded-box", "cylinder", "sphere", "lathe", "tube"]
    size: Vector3
    position: Vector3
    rotation: Annotated[list[float], Field(min_length=3, max_length=3)]
    material: Identifier
    bevel: float = Field(ge=0, le=0.1)
    # Closed cross-section for hollow shades/bowls, revolved around local +Y.
    profile: Annotated[list[ProfilePoint], Field(max_length=24)]
    # Local-space smooth tube centerline; endpoints stay fixed.
    path: Annotated[list[Vector3], Field(max_length=16)]
    tubeRadius: float = Field(ge=0, le=0.2)


class Emitter(Data):
    id: Identifier
    position: Vector3
    direction: Vector3
    kind: Literal["point", "spot"]
    glowMaterials: Annotated[list[Identifier], Field(max_length=4)]


class ImageGeometry(Data):
    title: str = Field(min_length=1, max_length=100)
    category: Category
    supported: bool
    limitations: Annotated[list[str], Field(max_length=8)]
    width: ObservedDimension
    height: ObservedDimension
    depth: ObservedDimension
    # Modeling coordinates in estimated meters; not claims of real product measurements.
    referenceSize: Vector3
    materials: Annotated[list[Surface], Field(min_length=1, max_length=12)]
    parts: Annotated[list[GeometryPart], Field(min_length=1, max_length=48)]
    lights: Annotated[list[Emitter], Field(max_length=4)]

    @model_validator(mode="after")
    def validate_geometry(self) -> "ImageGeometry":
        if not all(0.05 <= v <= 5 for v in self.referenceSize):
            raise ValueError("Invalid reference size")
        materials = {m.id for m in self.materials}
        if len(materials) != len(self.materials):
            raise ValueError("Duplicate materials")
        if len({p.id for p in self.parts}) != len(self.parts):
            raise ValueError("Duplicate parts")
        for p in self.parts:
            if p.material not in materials or not all(0.0001 <= v <= 5 for v in p.size):
                raise ValueError("Invalid part dimensions/material")
            if not all(math.isfinite(v) and abs(v) <= 360 for v in p.rotation):
                raise ValueError("Invalid rotation")
            if p.bevel > min(p.size) / 2:
                raise ValueError("Bevel exceeds physical part")
            if p.primitive == "lathe":
                if len(p.profile) < 3 or max(x.radius for x in p.profile) <= 0:
                    raise ValueError("Lathe requires a radial cross-section")
                if len({x.height for x in p.profile}) < 2:
                    raise ValueError("Flat lathe profile")
            elif p.profile:
                raise ValueError("Profile only applies to lathe")
            if p.primitive == "tube":
                if len(p.path) < 2 or p.tubeRadius <= 0:
                    raise ValueError("Tube requires a path/radius")
                if any(a == b for a, b in zip(p.path, p.path[1:], strict=False)):
                    raise ValueError("Duplicate tube points")
            elif p.path or p.tubeRadius:
                raise ValueError("Path only applies to tube")
        if len({light.id for light in self.lights}) != len(self.lights):
            raise ValueError("Duplicate emitters")
        for light in self.lights:
            if sum(v * v for v in light.direction) < 0.01:
                raise ValueError("Zero light direction")
            if not set(light.glowMaterials) <= materials:
                raise ValueError("Unknown glow material")
        return self


def repair_geometry(raw: Any) -> tuple[Any, list[str]]:
    """Fix the model-output slips that are safe to fix, so one stray number does not waste a build.

    Only bounded, geometry-preserving clamps: part sizes into the printable range, bevels to half
    the smallest side, reference size into 5 cm–5 m, and dropping a profile/path/tubeRadius that
    does not belong to the part's primitive. Anything structural (unknown material, duplicate ids,
    a lathe with no profile) is left for the strict validator to reject. Returns the repaired
    document and a human-readable list of what changed; both are content-safe to log.
    """

    if not isinstance(raw, dict):
        return raw, []
    notes: list[str] = []

    def clamp(v: float, lo: float, hi: float) -> float:
        return min(max(float(v), lo), hi)

    ref = raw.get("referenceSize")
    if isinstance(ref, list) and len(ref) == 3 and all(isinstance(v, int | float) for v in ref):
        fixed = [clamp(v, 0.05, 5) for v in ref]
        if fixed != [float(v) for v in ref]:
            raw["referenceSize"] = fixed
            notes.append("referenceSize clamped to 0.05–5 m")
    for part in raw.get("parts", []) if isinstance(raw.get("parts"), list) else []:
        if not isinstance(part, dict):
            continue
        pid = str(part.get("id", "?"))
        size = part.get("size")
        if (
            isinstance(size, list)
            and len(size) == 3
            and all(isinstance(v, int | float) for v in size)
        ):
            fixed = [clamp(v, 0.0001, 5) for v in size]
            if fixed != [float(v) for v in size]:
                part["size"] = fixed
                notes.append(f"{pid}: size clamped")
            bevel = part.get("bevel")
            if isinstance(bevel, int | float):
                limit = min(0.1, min(fixed) / 2)
                if bevel < 0 or bevel > limit:
                    part["bevel"] = clamp(bevel, 0, limit)
                    notes.append(f"{pid}: bevel clamped to {part['bevel']:.4f}")
        primitive = part.get("primitive")
        if primitive != "lathe" and part.get("profile"):
            part["profile"] = []
            notes.append(f"{pid}: dropped profile on {primitive}")
        if primitive != "tube":
            if part.get("path"):
                part["path"] = []
                notes.append(f"{pid}: dropped path on {primitive}")
            if part.get("tubeRadius"):
                part["tubeRadius"] = 0
                notes.append(f"{pid}: dropped tubeRadius on {primitive}")
    return raw, notes


def explain_validation_error(error: Exception) -> str:
    """One short, content-safe line naming the failing rule and where (never echoes values)."""

    errors = getattr(error, "errors", None)
    if not callable(errors):
        return error.__class__.__name__
    first = next(iter(errors()), None)
    if not first:
        return error.__class__.__name__
    loc = ".".join(str(x) for x in first.get("loc", ()) if x != "__root__")
    msg = str(first.get("msg", "")).removeprefix("Value error, ")
    return f"{msg} at {loc}" if loc else msg


class ModelLight(Data):
    id: str
    type: Literal["point", "spot"]
    positionM: Vector3
    direction: Vector3
    colorHex: Color
    intensityCd: float = Field(ge=0, le=500)
    rangeM: float = Field(gt=0, le=20)
    coneAngleRad: float = Field(gt=0, le=1.5708)
    penumbra: float = Field(ge=0, le=1)
    emissiveMaterialNames: list[str] = Field(max_length=4)


class Lighting(Data):
    coordinateSpace: Literal["model-local"]
    activation: Literal["night"]
    sources: list[ModelLight] = Field(max_length=4)
    disclosure: str


def compile_geometry(analysis: ImageGeometry, dims: Dimensions, root: Path) -> dict[str, Any]:
    if not analysis.supported:
        raise PipelineError(
            "Image cannot be represented reliably; use another view or provider.", 422
        )
    parts = []
    for p in analysis.parts:
        part: dict[str, Any] = {
            "id": p.id,
            "primitive": p.primitive,
            "role": "body",
            "dimensionsM": p.size,
            "positionM": p.position,
            "rotationDeg": p.rotation,
            "materialId": p.material,
            "cornerRadiusM": p.bevel,
        }
        if p.primitive == "lathe":
            part["profile"] = [[v.radius, v.height] for v in p.profile]
        if p.primitive == "tube":
            part.update(pathM=p.path, tubeRadiusM=p.tubeRadius)
        parts.append(part)
    spec: dict[str, Any] = {
        "schemaVersion": "1.0",
        "name": analysis.title,
        "category": analysis.category,
        "dimensionsM": dims.vector(),
        "materials": [
            {
                "id": m.id,
                "name": "DG_" + m.id,
                "baseColorHex": m.color,
                "roughness": m.roughness,
                "metallic": m.metallic,
            }
            for m in analysis.materials
        ],
        "parts": parts,
        "lights": [light.model_dump() for light in analysis.lights],
    }
    schema = json.loads(
        (root / "packages/contracts/schemas/furniture-spec.schema.json").read_text()
    )
    Draft202012Validator(schema).validate(spec)
    return spec


def lighting_from_glb(path: Path) -> dict[str, Any]:
    """Read post-normalization coordinates from the same file used by the renderer."""
    data = path.read_bytes()
    if len(data) > 2_000_000 or data[:4] != b"glTF" or len(data) < 20:
        raise PipelineError("Invalid lighting asset.", 422)
    length, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A or length > len(data) - 20:
        raise PipelineError("Invalid GLB metadata.", 422)
    document = json.loads(data[20 : 20 + length])
    rigs = [
        n["extras"]["dreamgridLighting"]
        for n in document.get("nodes", [])
        if "dreamgridLighting" in n.get("extras", {})
    ]
    if len(rigs) != 1:
        raise PipelineError("Generated lamp is missing normalized bulb metadata.", 422)
    return Lighting.model_validate(rigs[0]).model_dump()
