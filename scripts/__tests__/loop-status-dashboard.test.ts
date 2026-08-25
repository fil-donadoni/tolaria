import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { LOOP_VERDICT_STATES } from "../lib/loop-status";
// @ts-expect-error — a browser ES module with no type declarations; it is
// deliberately plain JS (no build step on the dashboard, #2625) and pure, so
// the `node` vitest project can import and CALL it.
import {
    VERDICT_TONE,
    verdictTone,
    verdictBandHtml,
} from "../dashboard/now-verdict-band.js";

/**
 * #2624 — the dashboard is the SECOND consumer of the shared verdict. Before
 * #2624 `renderLoopStatus` hand-concatenated `d.armed` / `d.pidAlive` /
 * `d.stopFilePresent` into its own health wording, independently of
 * `renderDriverLines` in `lib/loop-status.ts` — two formatters of the same
 * three facts, neither ranking them, free to word the same state differently.
 *
 * #2625 moved the band out of the inline `<script>` and into
 * `scripts/dashboard/now-verdict-band.js`, a pure `verdict → HTML` function.
 * So these guards now CALL the renderer instead of grepping its source: the
 * previous version could only prove that certain identifiers appeared in a
 * string of JavaScript, which is why it needed comment-stripping to stop a
 * banner comment satisfying every assertion on its own.
 */

const NOW_LOOP_STATUS = fs.readFileSync(
    path.join(import.meta.dirname, "..", "dashboard", "now-loop-status.js"),
    "utf8"
);

describe("telemetry dashboard — loop verdict band (#2624)", () => {
    it("renders the shared verdict's sentence, remedy and findings rather than composing its own", () => {
        const html = verdictBandHtml({
            state: "STALLED",
            sentence: "No pass has finished in 3h",
            remedy: "check the driver log",
            findings: [{ code: "NO_PROGRESS", detail: "queue unchanged" }],
        });
        expect(html).toContain("No pass has finished in 3h");
        expect(html).toContain("check the driver log");
        expect(html).toContain("NO_PROGRESS");
        expect(html).toContain("queue unchanged");
        // The raw driver facts are NOT what the band states.
        expect(html).not.toContain("armed");
        expect(html).not.toContain("stop-file");
    });

    it("names EVERY verdict state in its tone map, so a new state cannot ship unstyled", () => {
        for (const state of LOOP_VERDICT_STATES) {
            expect(
                Object.prototype.hasOwnProperty.call(VERDICT_TONE, state)
            ).toBe(true);
        }
    });

    it("falls back to the loud tone on an unknown state — an unrecognised verdict must never render as health", () => {
        expect(verdictTone("A STATE THE ENGINE GREW LATER")).toBe("bad");
        expect(
            verdictBandHtml({
                state: "A STATE THE ENGINE GREW LATER",
                sentence: "s",
                remedy: "r",
            })
        ).toContain('class="ls-verdict-state bad"');
    });

    it("escapes the verdict it is handed — the sentence is prose from another module", () => {
        expect(
            verdictBandHtml({
                state: "IDLE",
                sentence: "<img src=x onerror=alert(1)>",
                remedy: "r",
            })
        ).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("is wired to the LIVE verdict — the panel passes data.verdict straight through", () => {
        // The one thing an executable test on a pure function cannot see: that
        // the panel actually calls it, with the payload's own verdict rather
        // than a constant. Comments stripped, for the reason #2624 recorded —
        // a prose mention of `data.verdict` must not vouch for the call.
        const src = NOW_LOOP_STATUS.split("\n")
            .filter((line) => !line.trim().startsWith("//"))
            .join("\n");
        expect(src).toContain("verdictBandHtml(data.verdict)");
    });
});
