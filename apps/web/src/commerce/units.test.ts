// @vitest-environment node

import { describe, expect, it } from "vitest";

import { fromMeters, parseDimensionString, toDimensionsM, toMeters } from "./units";

describe("toMeters / fromMeters", () => {
  it("converts common retail units to meters at millimeter precision", () => {
    expect(toMeters(120, "cm")).toBe(1.2);
    expect(toMeters(47.2, "in")).toBe(1.199);
    expect(toMeters(6, "ft")).toBe(1.829);
    expect(toMeters(750, "mm")).toBe(0.75);
    expect(toMeters(2.5, "m")).toBe(2.5);
  });

  it("round-trips through fromMeters", () => {
    expect(fromMeters(1.2, "cm")).toBe(120);
    expect(fromMeters(0.0254, "in")).toBe(1);
  });
});

describe("parseDimensionString", () => {
  it('parses 47.2"W x 23.6"D x 29.5"H (inches with axis labels)', () => {
    const parsed = parseDimensionString('47.2"W x 23.6"D x 29.5"H');

    expect(parsed).toEqual({ widthM: 1.199, depthM: 0.599, heightM: 0.749, unit: "in" });
  });

  it("parses 120 x 60 x 75 cm as width, depth, height", () => {
    const parsed = parseDimensionString("Dimensions: 120 x 60 x 75 cm");

    expect(parsed).toEqual({ widthM: 1.2, depthM: 0.6, heightM: 0.75, unit: "cm" });
  });

  it("parses labeled metric values in any order", () => {
    const parsed = parseDimensionString("H 75cm x W 120cm x D 60cm");

    expect(parsed).toEqual({ widthM: 1.2, depthM: 0.6, heightM: 0.75, unit: "cm" });
  });

  it("parses inches with periods, unicode multiplication sign, and L for depth", () => {
    const parsed = parseDimensionString("47.2 in. W × 23.6 in. L × 29.5 in. H");

    expect(parsed?.unit).toBe("in");
    expect(parsed?.widthM).toBe(1.199);
    expect(parsed?.depthM).toBe(0.599);
    expect(parsed?.heightM).toBe(0.749);
  });

  it("falls back to the given unit when none is written", () => {
    expect(parseDimensionString("30 x 20 x 10", "cm")).toEqual({
      widthM: 0.3,
      depthM: 0.2,
      heightM: 0.1,
      unit: "cm",
    });
  });

  it("returns null when there is no three-number pattern", () => {
    expect(parseDimensionString("Available in oak and walnut")).toBeNull();
    expect(parseDimensionString("Width 120 cm")).toBeNull();
  });

  it("maps to the contract's [width, height, depth] order", () => {
    const parsed = parseDimensionString("120 x 60 x 75 cm");
    expect(parsed && toDimensionsM(parsed)).toEqual([1.2, 0.75, 0.6]);
  });
});
