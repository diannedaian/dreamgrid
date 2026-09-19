export function normalizeModelAssetUrl(url: string): string {
  const normalized = url.trim();

  if (!normalized) {
    throw new Error("A model asset URL is required.");
  }

  if (/^javascript:/i.test(normalized)) {
    throw new Error("The model asset URL uses an unsupported protocol.");
  }

  return normalized;
}
