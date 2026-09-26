import { describe, expect, it } from "vitest";
import {
  coverageCoversWindow,
  floorDiv,
  mergeCoverage,
  windowForIndex,
  windowForTimestamp,
  windowIndexForTimestamp,
} from "../src/index.js";

const ANCHOR = 1758854400;
const P = 86400;

describe("period helpers (PLAN section 3 anchoring)", () => {
  it("floors integer division correctly, including negatives", () => {
    expect(floorDiv(7, 2)).toBe(3);
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(floorDiv(-1, 86400)).toBe(-1);
    expect(floorDiv(-86400, 86400)).toBe(-1);
    expect(floorDiv(86400, 86400)).toBe(1);
    expect(floorDiv(0, 5)).toBe(0);
    expect(() => floorDiv(1, 0)).toThrow();
  });

  it("anchors windows to the anchor timestamp, not midnight", () => {
    expect(windowIndexForTimestamp(ANCHOR, P, ANCHOR)).toBe(0);
    expect(windowIndexForTimestamp(ANCHOR, P, ANCHOR + P - 1)).toBe(0);
    expect(windowIndexForTimestamp(ANCHOR, P, ANCHOR + P)).toBe(1);
    expect(windowIndexForTimestamp(ANCHOR, P, ANCHOR - 1)).toBe(-1);
    // An anchor at an odd offset still produces clean windows.
    expect(
      windowIndexForTimestamp(ANCHOR + 3600, P, ANCHOR + 3600 + 2 * P + 59),
    ).toBe(2);
  });

  it("builds half-open windows [start, end)", () => {
    expect(windowForIndex(ANCHOR, P, 0)).toEqual({
      startSec: ANCHOR,
      endSec: ANCHOR + P,
    });
    expect(windowForIndex(ANCHOR, P, -1)).toEqual({
      startSec: ANCHOR - P,
      endSec: ANCHOR,
    });
    expect(windowForTimestamp(ANCHOR, P, ANCHOR + P + 5)).toEqual({
      startSec: ANCHOR + P,
      endSec: ANCHOR + 2 * P,
    });
  });

  it("rejects non-integer and non-positive inputs", () => {
    expect(() => windowIndexForTimestamp(ANCHOR, P, 1.5)).toThrow();
    expect(() => windowIndexForTimestamp(ANCHOR, 0, ANCHOR)).toThrow();
    expect(() => windowForIndex(1.5, P, 0)).toThrow();
  });

  it("merges overlapping and adjacent coverage ranges deterministically", () => {
    expect(
      mergeCoverage([
        { startSec: 100, endSec: 200 },
        { startSec: 0, endSec: 100 },
        { startSec: 300, endSec: 400 },
        { startSec: 50, endSec: 150 },
      ]),
    ).toEqual([
      { startSec: 0, endSec: 200 },
      { startSec: 300, endSec: 400 },
    ]);
    expect(() => mergeCoverage([{ startSec: 200, endSec: 100 }])).toThrow();
  });

  it("checks window containment in merged coverage", () => {
    const merged = mergeCoverage([
      { startSec: ANCHOR, endSec: ANCHOR + 10 * P },
      { startSec: ANCHOR + 13 * P, endSec: ANCHOR + 30 * P },
    ]);
    expect(coverageCoversWindow(merged, windowForIndex(ANCHOR, P, 0))).toBe(
      true,
    );
    expect(coverageCoversWindow(merged, windowForIndex(ANCHOR, P, 9))).toBe(
      true,
    );
    expect(coverageCoversWindow(merged, windowForIndex(ANCHOR, P, 10))).toBe(
      false,
    );
    expect(coverageCoversWindow(merged, windowForIndex(ANCHOR, P, 12))).toBe(
      false,
    );
    expect(coverageCoversWindow(merged, windowForIndex(ANCHOR, P, 13))).toBe(
      true,
    );
  });
});
