import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { LOOP_VERDICT_STATES } from "../lib/loop-status";

/**
 * #2624 — the dashboard is the SECOND consumer of the shared verdict, and the
 * one with no test harness of its own: `renderLoopStatus` is inline JS inside
 * `telemetry-dashboard.html`, served verbatim by `telemetry-serve.ts`.
 *
 * Before #2624 that function hand-concatenated `d.armed` / `d.pidAlive` /
 * `d.stopFilePresent` into its own health wording, independently of
 * `renderDriverLines` in `lib/loop-status.ts` — two formatters of the same
 * three facts, neither ranking them, free to word the same state differently.
 * These are source-level guards against that shape coming back, and against
 * the engine growing a verdict state the page renders unstyled.
 */

const HTML = fs.readFileSync(
    path.join(import.meta.dirname, "..", "telemetry-dashboard.html"),
    "utf8"
);

/**
 * `renderLoopStatus`'s body — the function this issue changed, isolated so a
 * match somewhere else on the page cannot vouch for it, and with `//` comment
 * lines STRIPPED. The comment stripping is not cosmetic: without it, the
 * banner comment above the verdict band (which names `data.verdict` in prose)
 * satisfied every `toContain` below on its own, and the guard stayed green
 * with the band rewired to `const verdict = null`.
 */
function renderLoopStatusSource(): string {
    const start = HTML.indexOf("function renderLoopStatus(data) {");
    expect(start).toBeGreaterThan(-1);
    const end = HTML.indexOf("async function refreshLoopStatus()", start);
    expect(end).toBeGreaterThan(start);
    return HTML.slice(start, end)
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
}

describe("telemetry dashboard — loop verdict band (#2624)", () => {
    it("renders the shared verdict's sentence and remedy rather than composing its own", () => {
        const src = renderLoopStatusSource();
        expect(src).toContain("data.verdict");
        expect(src).toContain("verdict.sentence");
        expect(src).toContain("verdict.remedy");
        expect(src).toContain("verdict.findings");
    });

    it("names EVERY verdict state in its tone map, so a new state cannot ship unstyled", () => {
        const src = renderLoopStatusSource();
        const toneMap = src.slice(
            src.indexOf("const VERDICT_TONE = {"),
            src.indexOf("const verdictTone")
        );
        expect(toneMap.length).toBeGreaterThan(0);
        for (const state of LOOP_VERDICT_STATES) {
            // Quoted (`"NEEDS ATTENTION"`) or bare (`STALLED`) — prettier
            // drops the quotes from identifier-shaped keys.
            expect(
                toneMap.includes(`"${state}"`) ||
                    new RegExp(`\\b${state}\\b`).test(toneMap)
            ).toBe(true);
        }
    });

    it("falls back to the loud tone on an unknown state — an unrecognised verdict must never render as health", () => {
        const src = renderLoopStatusSource();
        expect(src).toMatch(/VERDICT_TONE\[verdict\.state\]\s*\?\?\s*"bad"/);
    });
});
