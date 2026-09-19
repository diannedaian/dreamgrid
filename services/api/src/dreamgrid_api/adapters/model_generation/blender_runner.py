"""Isolated, time-limited trusted Blender process. No model-authored code is run."""

import asyncio
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Protocol

from dreamgrid_api.config import Settings

from .models import PipelineError


class Builder(Protocol):
    async def build(self, spec: dict[str, Any], target: Path, fused: bool) -> bool: ...


class BlenderBuilder:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def build(self, spec: dict[str, Any], target: Path, fused: bool) -> bool:
        if target.is_file() and 20 < target.stat().st_size < 2_000_000:
            with target.open("rb") as stream:
                if stream.read(4) == b"glTF":
                    return True
        executable = shutil.which(self.settings.blender_path)
        if not executable:
            raise PipelineError(
                "Blender is unavailable. Set DREAMGRID_BLENDER_PATH on the backend.", 503
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="build-", dir=target.parent) as temporary:
            work = Path(temporary)
            recipe = work / "furniture.json"
            recipe.write_text(json.dumps(spec))
            command = [
                executable,
                "--background",
                "--factory-startup",
                "--disable-autoexec",
                "--python-exit-code",
                "1",
                "--python",
                str(self.settings.project_root / "tools/blender/build_asset.py"),
                "--",
                "--spec",
                str(recipe),
                "--output",
                str(work),
                "--glb",
                str(work / "model.glb"),
                "--no-render",
                "--asset-only",
                "--fit-envelope",
            ]
            if fused:
                command.extend(["--fuse-material", "wood"])
            # Do not pass backend credentials or arbitrary environment into Blender.
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env={
                    key: value
                    for key, value in os.environ.items()
                    if key in {"PATH", "HOME", "TMPDIR", "SYSTEMROOT", "LANG"}
                },
            )
            try:
                await asyncio.wait_for(process.wait(), timeout=35)
            except (TimeoutError, asyncio.CancelledError):
                if process.returncode is None:
                    process.kill()
                await process.wait()
                raise
            if process.returncode != 0:
                raise PipelineError(
                    "Blender could not build this model. Try a simpler template.", 422
                )
            exported = work / "model.glb"
            report = json.loads((work / "validation.json").read_text())
            if (
                not exported.is_file()
                or exported.stat().st_size > 2_000_000
                or report["triangles"] > 40_000
                or any(
                    abs(a - b) > 1e-5
                    for a, b in zip(
                        report["dimensionsM"],
                        spec["dimensionsM"],
                        strict=True,
                    )
                )
            ):
                raise PipelineError("Generated model failed validation.", 422)
            exported.replace(target)
        return False
