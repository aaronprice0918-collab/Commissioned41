import { describe, expect, it } from "vitest";
import { jacketFileDaysLeft, jacketFileFresh } from "./jacketFile";

const NOW = new Date("2026-07-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("jacketFileFresh", () => {
  it("is fresh inside 90 days and expired after", () => {
    expect(jacketFileFresh({ path: "u/d.pdf", pages: 10, savedAt: daysAgo(0) }, NOW)).toBe(true);
    expect(jacketFileFresh({ path: "u/d.pdf", pages: 10, savedAt: daysAgo(89) }, NOW)).toBe(true);
    expect(jacketFileFresh({ path: "u/d.pdf", pages: 10, savedAt: daysAgo(90) }, NOW)).toBe(false);
    expect(jacketFileFresh({ path: "u/d.pdf", pages: 10, savedAt: daysAgo(200) }, NOW)).toBe(false);
  });

  it("treats missing/garbage refs as expired", () => {
    expect(jacketFileFresh(null, NOW)).toBe(false);
    expect(jacketFileFresh(undefined, NOW)).toBe(false);
    expect(jacketFileFresh({ path: "", pages: 0, savedAt: daysAgo(1) }, NOW)).toBe(false);
    expect(jacketFileFresh({ path: "u/d.pdf", pages: 0, savedAt: "not-a-date" }, NOW)).toBe(false);
  });
});

describe("jacketFileDaysLeft", () => {
  it("counts down and floors at zero", () => {
    expect(jacketFileDaysLeft({ path: "u/d.pdf", pages: 1, savedAt: daysAgo(0) }, NOW)).toBe(90);
    expect(jacketFileDaysLeft({ path: "u/d.pdf", pages: 1, savedAt: daysAgo(89.5) }, NOW)).toBe(1);
    expect(jacketFileDaysLeft({ path: "u/d.pdf", pages: 1, savedAt: daysAgo(120) }, NOW)).toBe(0);
  });
});
