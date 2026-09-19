"""Pipeline HTTP models. Public schemas are mirrored in packages/contracts.

Existing Product/ModelAsset/SceneItem contracts are unchanged.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Category = Literal["bed", "desk", "chair", "shelf", "lamp"]
Template = Literal["bed", "desk-pedestal", "desk-table", "chair", "chair-sled", "shelf", "lamp"]
Source = Literal["product_text", "product_url", "image_label", "estimated", "user"]
Size = Annotated[float, Field(ge=0.05, le=5, allow_inf_nan=False)]


class Data(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Dimensions(Data):
    widthM: Size
    heightM: Size
    depthM: Size

    def vector(self) -> list[float]:
        return [self.widthM, self.heightM, self.depthM]


class Measurement(Data):
    valueM: Size
    source: Source
    evidence: str = Field(max_length=240)


class DimensionReview(Data):
    width: Measurement
    height: Measurement
    depth: Measurement


class PrepareRequest(Data):
    imageDataUrl: str = Field(min_length=30, max_length=8_000_000)
    sourceUrl: str | None = Field(default=None, max_length=2048)
    productText: str = Field(default="", max_length=6000)
    categoryHint: Category | None = None
    mode: Literal["live", "preset"] = "live"


class Usage(Data):
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    cached: bool = False


class PreparedImport(Data):
    importId: str
    expiresAt: str
    title: str
    category: Category
    template: Template
    dimensions: DimensionReview
    warnings: list[str]
    analysisMethod: Literal["gpt", "preset"]
    usage: Usage


class GenerateRequest(Data):
    importId: str = Field(pattern=r"^[a-f0-9]{32}$")
    productId: str = Field(min_length=1, max_length=100)
    dimensions: Dimensions
    confirmed: Literal[True]
    acceptEstimated: bool = False


class GenerationJob(Data):
    jobId: str
    status: Literal["queued", "generating", "ready", "failed"]
    asset: dict[str, Any] | None = None
    dimensions: DimensionReview
    error: str | None = None
    cached: bool = False


class ObservedDimension(Data):
    # Nullable measurements: never infer absolute scale from an unlabeled photograph.
    valueM: float | None
    source: Literal["product_text", "product_url", "image_label", "unknown"]
    evidence: str


class Analysis(Data):
    """Small structured AI output, not a mesh or executable program."""

    title: str
    template: Literal[
        "bed",
        "desk-pedestal",
        "desk-table",
        "chair",
        "chair-sled",
        "shelf",
        "lamp",
        "unsupported",
    ]
    frameColor: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    accentColor: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    drawerCount: int = Field(ge=1, le=4)
    drawerSide: Literal["left", "right"]
    shelfCount: int = Field(ge=2, le=6)
    width: ObservedDimension
    height: ObservedDimension
    depth: ObservedDimension


class PipelineError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


TEMPLATES: dict[str, tuple[Category, list[float], str]] = {
    "bed": ("bed", [0.9652, 0.9398, 2.1717], "Example dorm bed; not this product's size"),
    "desk-pedestal": ("desk", [1.0668, 0.762, 0.6096], "Example 42-inch dorm desk"),
    "desk-table": ("desk", [1.0668, 0.762, 0.6096], "Example 42-inch dorm desk"),
    "chair": ("chair", [0.48895, 0.8382, 0.5588], "Example desk chair; not an armchair"),
    "chair-sled": ("chair", [0.48895, 0.8382, 0.5588], "Example sled desk chair"),
    "shelf": ("shelf", [0.7, 1.2, 0.3], "Illustrative shelf size, not a product measurement"),
    "lamp": ("lamp", [0.28, 0.45, 0.28], "Illustrative table-lamp size"),
}
