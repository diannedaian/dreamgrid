"""Decode once, remove metadata, and bound image cost before any paid request."""

import base64
import binascii
import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from .models import PipelineError


def normalize_image(data_url: str) -> str:
    header, separator, encoded = data_url.partition(",")
    if not separator or header not in {
        "data:image/jpeg;base64",
        "data:image/png;base64",
        "data:image/webp;base64",
    }:
        raise PipelineError("Upload a JPEG, PNG, or WebP image (not a URL or SVG).")
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 5_000_000:
            raise PipelineError("Image exceeds 5 MB. Resize it before uploading.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as original:
                if original.width * original.height > 20_000_000:
                    raise PipelineError("Image exceeds 20 megapixels.")
                if original.format not in {"JPEG", "PNG", "WEBP"}:
                    raise PipelineError("Unsupported image content.")
                picture = ImageOps.exif_transpose(original).convert("RGBA")
                picture.thumbnail((1024, 1024))
                background = Image.new("RGBA", picture.size, "white")
                background.alpha_composite(picture)
                output = io.BytesIO()
                background.convert("RGB").save(output, format="JPEG", quality=85)
    except (
        binascii.Error,
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        raise PipelineError("The uploaded image could not be decoded safely.") from error
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
