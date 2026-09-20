import type { Product } from "@dreamgrid/contracts";

/** Similarity of two tag lists in [0, 1]; empty lists count as no evidence (0). */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const tag of setA) {
    if (setB.has(tag)) shared += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : shared / union;
}

/** Style tags count fully, color tags at half weight. Result in [0, 1]. */
export function styleSimilarity(from: Product, to: Product): number {
  const style = jaccard(from.styleTags, to.styleTags);
  const color = jaccard(from.colorTags, to.colorTags);
  return (style + color * 0.5) / 1.5;
}

/** Shared style/color tags, for human-readable reasons. */
export function sharedTags(from: Product, to: Product): string[] {
  const toTags = new Set([...to.styleTags, ...to.colorTags]);
  return [...new Set([...from.styleTags, ...from.colorTags])].filter((tag) =>
    toTags.has(tag),
  );
}

/**
 * How well a candidate's floor footprint fits where the current item sits.
 * Smaller is fine (1). Larger is penalized by the worst overflow ratio, so a
 * candidate 25% wider scores 0.75 and one twice as deep scores 0.
 */
export function footprintFit(current: Product, candidate: Product): number {
  const [currentW, , currentD] = current.dimensionsM;
  const [candidateW, , candidateD] = candidate.dimensionsM;
  const overflowW = currentW > 0 ? Math.max(0, (candidateW - currentW) / currentW) : 0;
  const overflowD = currentD > 0 ? Math.max(0, (candidateD - currentD) / currentD) : 0;
  return Math.max(0, 1 - Math.max(overflowW, overflowD));
}

/**
 * Closeness of a candidate to target dimensions in [0, 1]: 1 minus the mean
 * relative error across width, height, and depth. Shared with product search.
 */
export function dimensionFit(
  target: readonly [number, number, number],
  candidate: readonly [number, number, number],
): number {
  let totalError = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const expected = target[axis];
    const actual = candidate[axis];
    totalError += expected > 0 ? Math.abs(actual - expected) / expected : 0;
  }
  return Math.max(0, 1 - totalError / 3);
}
