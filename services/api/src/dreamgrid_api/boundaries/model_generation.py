"""Provider-neutral boundary for Dianne's model-generation pipeline.

Concrete OpenAI, Blender, Meshy, or Tripo code should implement this protocol
in a separate adapter module. No provider SDK types belong here.
"""

from dataclasses import dataclass
from typing import Literal, Protocol

DimensionsM = tuple[float, float, float]
GenerationMethod = Literal["gpt-blender", "meshy", "tripo", "public-preset"]


@dataclass(frozen=True)
class ModelGenerationRequest:
    """Minimum provider-neutral input needed to start model generation."""

    product_id: str
    image_url: str
    dimensions_m: DimensionsM


@dataclass(frozen=True)
class GeneratedModel:
    """Normalized output expected by the web scene.

    The implementation must export GLB in meters, with a bottom-center pivot
    and positive-Z forward axis, as required by the project manifesto.
    """

    asset_id: str
    product_id: str
    glb_url: str
    dimensions_m: DimensionsM
    generation_method: GenerationMethod
    disclosure: str


class ModelGenerationGateway(Protocol):
    """Port implemented by a model-generation orchestration adapter."""

    async def generate(self, request: ModelGenerationRequest) -> GeneratedModel:
        """Generate and normalize one model, or raise an adapter-specific error."""
        ...
