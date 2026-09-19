import type { DimensionsM } from "@dreamgrid/contracts";

export type LengthUnit = "m" | "cm" | "mm" | "in" | "ft";

export const LENGTH_UNITS: readonly LengthUnit[] = ["in", "cm", "m", "ft", "mm"];

const METERS_PER_UNIT: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
  ft: 0.3048,
};

/** Convert a user-entered length to meters, rounded to the millimeter. */
export function toMeters(value: number, unit: LengthUnit): number {
  return Math.round(value * METERS_PER_UNIT[unit] * 1000) / 1000;
}

export function fromMeters(meters: number, unit: LengthUnit): number {
  return Math.round((meters / METERS_PER_UNIT[unit]) * 100) / 100;
}

export type ParsedDimensions = {
  widthM: number;
  heightM: number;
  depthM: number;
  unit: LengthUnit;
};

const UNIT_ALIASES: Record<string, LengthUnit> = {
  '"': "in",
  "''": "in",
  in: "in",
  inch: "in",
  inches: "in",
  cm: "cm",
  centimeter: "cm",
  centimeters: "cm",
  mm: "mm",
  millimeter: "mm",
  millimeters: "mm",
  m: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  ft: "ft",
  foot: "ft",
  feet: "ft",
  "'": "ft",
};

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`\s*("|''|'|in(?:ch(?:es)?)?|cm|mm|m(?:et(?:er|re)s?)?|ft|foot|feet)?`;
const AXIS = String.raw`\s*(?:\(?\s*(W|D|H|L)\s*\)?)?`;
const SEP = String.raw`\s*(?:x|×|X|\*|by)\s*`;

/**
 * Matches the common ways product pages state three dimensions, e.g.
 * `47.2"W x 23.6"D x 29.5"H`, `120 x 60 x 75 cm`, `W 120cm x D 60cm x H 75cm`,
 * `47.2 in. W × 23.6 in. D × 29.5 in. H`.
 */
const TRIPLE = new RegExp(
  `(?:(W|D|H|L)\\s*:?\\s*)?${NUMBER}${UNIT}\\.?${AXIS}${SEP}` +
    `(?:(W|D|H|L)\\s*:?\\s*)?${NUMBER}${UNIT}\\.?${AXIS}${SEP}` +
    `(?:(W|D|H|L)\\s*:?\\s*)?${NUMBER}${UNIT}\\.?${AXIS}`,
  "i",
);

function normalizeUnit(raw: string | undefined): LengthUnit | undefined {
  if (!raw) return undefined;
  return UNIT_ALIASES[raw.toLowerCase()];
}

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

/**
 * Parse "W x D x H"-style text into meters. Axis letters win when present;
 * otherwise the order is assumed to be width, depth, height (the retail
 * convention). Returns null when no three-number pattern is found.
 */
export function parseDimensionString(
  text: string,
  fallbackUnit: LengthUnit = "in",
): ParsedDimensions | null {
  const match = TRIPLE.exec(text);
  if (!match) return null;

  const entries = [
    { axis: match[1] ?? match[4], value: toNumber(match[2]), unit: normalizeUnit(match[3]) },
    { axis: match[5] ?? match[8], value: toNumber(match[6]), unit: normalizeUnit(match[7]) },
    { axis: match[9] ?? match[12], value: toNumber(match[10]), unit: normalizeUnit(match[11]) },
  ];

  const unit = entries.map((e) => e.unit).find((u): u is LengthUnit => u !== undefined) ?? fallbackUnit;
  const labeled = entries.every((e) => e.axis);
  const byAxis = new Map<string, number>();
  if (labeled) {
    for (const entry of entries) {
      const axis = entry.axis?.toUpperCase() === "L" ? "D" : entry.axis?.toUpperCase();
      if (axis) byAxis.set(axis, entry.value);
    }
  }

  const [width, depth, height] =
    labeled && byAxis.has("W") && byAxis.has("D") && byAxis.has("H")
      ? [byAxis.get("W") ?? 0, byAxis.get("D") ?? 0, byAxis.get("H") ?? 0]
      : [entries[0].value, entries[1].value, entries[2].value];

  return {
    widthM: toMeters(width, unit),
    depthM: toMeters(depth, unit),
    heightM: toMeters(height, unit),
    unit,
  };
}

export function toDimensionsM(parsed: ParsedDimensions): DimensionsM {
  return [parsed.widthM, parsed.heightM, parsed.depthM];
}
