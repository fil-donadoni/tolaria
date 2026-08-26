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
    remedyHtml,
} from "../dashboard/now-verdict-band.js";
// @ts-expect-error — see above; pure, so the `node` project can call them.
import {
    LIGHT_TONES,
    SECTION_IDS,
    nowLights,
    lightsHtml,
} from "../dashboard/now-lights.js";
// @ts-expect-error — see above; pure, so the `node` project can call it.
import { nowBodyHtml } from "../dashboard/now.js";

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

const dashboardSrc = (name: string) =>
    fs.readFileSync(
        path.join(import.meta.dirname, "..", "dashboard", name),
        "utf8"
    );

/** #2630 moved the payload→HTML composition out of the transport module and
 *  into `now.js`, so the "is it wired to the LIVE data" guards read that. */
const NOW = dashboardSrc("now.js");
const NOW_LOOP_STATUS = dashboardSrc("now-loop-status.js");
const DASHBOARD_CSS = fs.readFileSync(
    path.join(import.meta.dirname, "..", "dashboard", "dashboard.css"),
    "utf8"
);

/** Comments stripped, for the reason #2624 recorded — a prose mention of a
 *  call must never vouch for the call. */
const stripLineComments = (src: string) =>
    src
        .split("\n")
        .filter(
            (line) =>
                !line.trim().startsWith("//") && !line.trim().startsWith("*")
        )
        .join("\n");

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
        expect(stripLineComments(NOW)).toContain(
            "verdictBandHtml(data.verdict)"
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2630 — the four traffic lights
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A healthy `GatheredLoopStatus` payload. Every test below starts here and
 * overrides ONE field, so what it proves is attributable to that field.
 */
const payload = (over: Record<string, unknown> = {}) => ({
    verdict: {
        state: "RUNNING",
        sentence: "The driver is running.",
        remedy: "nothing to do",
        findings: [],
    },
    driver: {
        armed: true,
        pid: 4242,
        pidAlive: true,
        stopFilePresent: false,
        recentPasses: [
            {
                epoch: 1,
                pass: 7,
                claudeExit: 0,
                pct: "62",
                queueBefore: 180,
                queueAfter: 178,
                reason: "merged",
            },
        ],
    },
    claims: [],
    claimsError: null,
    queueDepth: { P0: 1, P1: 2, P2: 3, unprioritized: 4, total: 10 },
    queueDepthError: null,
    receiptsSummary: { total: 12, counts: [], interesting: [] },
    batch: "cfa2cdaf-591a-4b8f-9926-613d3e8543d6",
    priorityWarning: null,
    receiptErrors: [],
    ...over,
});

const claim = (state: string, issue = 2582) => ({
    issue,
    title: "a claimed issue",
    stage: "claimed",
    verdict: { state, reason: "" },
    priority: "P1",
    ageHours: 12,
});

const lightById = (data: ReturnType<typeof payload>, id: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (nowLights(data) as any[]).find((l) => l.id === id)!;

describe("telemetry dashboard — Now traffic lights (#2630)", () => {
    it("renders four lights, each with a number, a state word and a line of prose", () => {
        const lights = nowLights(payload()) as {
            label: string;
            number: unknown;
            word: string;
            prose: string;
            tone: string;
            target: string;
        }[];
        expect(lights.map((l) => l.label)).toEqual([
            "Driver",
            "Queue",
            "Claims",
            "Batch",
        ]);
        for (const l of lights) {
            expect(l.number, `${l.label} number`).toBeDefined();
            expect(l.word, `${l.label} word`).toMatch(/\S/);
            // A line of PROSE, not a restated word.
            expect(l.prose.length, `${l.label} prose`).toBeGreaterThan(20);
            expect(Object.keys(LIGHT_TONES)).toContain(l.tone);
        }
    });

    it("computes no verdict of its own — no light's word is a LOOP_VERDICT state", () => {
        // The line #2630 must not blur: the lights derive per-SUBSYSTEM facts
        // from the same raw fields the CLI's section renderers branch on, but
        // the loop's health verdict comes from `deriveLoopVerdict` alone. A
        // light reading STALLED would be a second health computation wearing a
        // subsystem's clothes, free to disagree with the band above it.
        const states = new Set<string>(LOOP_VERDICT_STATES);
        const inputs = [
            payload(),
            payload({ driver: { ...payload().driver, pidAlive: false } }),
            payload({ driver: { ...payload().driver, stopFilePresent: true } }),
            payload({ driver: { ...payload().driver, pid: null } }),
            payload({ claims: null, claimsError: "gh: quota exhausted" }),
            payload({ claims: [claim("orphan")] }),
            payload({ claims: [claim("suspect")] }),
            payload({ queueDepth: null, queueDepthError: "gh: 502" }),
            payload({ receiptErrors: [{ path: "a.json", error: "bad json" }] }),
        ];
        for (const data of inputs) {
            for (const l of nowLights(data) as { word: string }[]) {
                expect(states.has(l.word), `light word "${l.word}"`).toBe(
                    false
                );
            }
        }
    });

    it("a failed queue read is UNAVAILABLE, never a zero — the two must not look the same", () => {
        const failed = lightById(
            payload({ queueDepth: null, queueDepthError: "gh: quota 0/5000" }),
            "queue"
        );
        const empty = lightById(
            payload({
                queueDepth: {
                    P0: 0,
                    P1: 0,
                    P2: 0,
                    unprioritized: 0,
                    total: 0,
                },
            }),
            "queue"
        );
        expect(failed.word).toBe("UNAVAILABLE");
        expect(failed.tone).toBe("unknown");
        expect(failed.number).not.toBe(0);
        expect(failed.prose).toContain("gh: quota 0/5000");

        expect(empty.word).toBe("EMPTY");
        expect(empty.tone).toBe("good");
        expect(empty.number).toBe(0);
        // The whole point: the two renderings share nothing an operator could
        // mistake for the other.
        expect(failed.tone).not.toBe(empty.tone);
        expect(failed.word).not.toBe(empty.word);
    });

    it("a failed claims read is UNAVAILABLE, never `0 claimed` — the 0/5000-quota bug", () => {
        const failed = lightById(
            payload({ claims: null, claimsError: "gh: quota 0/5000" }),
            "claims"
        );
        const none = lightById(payload({ claims: [] }), "claims");
        expect(failed.word).toBe("UNAVAILABLE");
        expect(failed.tone).toBe("unknown");
        expect(failed.number).not.toBe(0);
        expect(none.word).toBe("NONE HELD");
        expect(none.tone).toBe("good");
        expect(none.number).toBe(0);
        expect(failed.tone).not.toBe(none.tone);
    });

    it("counts classifyClaim's verdict rather than re-deriving one — orphans are loud, suspects are amber", () => {
        expect(
            lightById(payload({ claims: [claim("orphan")] }), "claims")
        ).toMatchObject({ tone: "bad", word: "ORPHANED" });
        expect(
            lightById(payload({ claims: [claim("suspect")] }), "claims")
        ).toMatchObject({ tone: "warn", word: "UNSURE" });
        expect(
            lightById(payload({ claims: [claim("live")] }), "claims")
        ).toMatchObject({ tone: "good", word: "WORKING" });
    });

    it("a stale pid file is a fault; no pid file at all is not", () => {
        const base = payload().driver;
        expect(
            lightById(
                payload({ driver: { ...base, pidAlive: false } }),
                "driver"
            )
        ).toMatchObject({ tone: "bad", word: "DEAD" });
        expect(
            lightById(
                payload({ driver: { ...base, pid: null, pidAlive: false } }),
                "driver"
            )
        ).toMatchObject({ tone: "warn", word: "NO DRIVER" });
        expect(
            lightById(
                payload({ driver: { ...base, stopFilePresent: true } }),
                "driver"
            )
        ).toMatchObject({ tone: "warn", word: "STOP-FILE" });
        expect(lightById(payload(), "driver")).toMatchObject({
            tone: "good",
            word: "ALIVE",
        });
    });

    it("unreadable receipt files leave the batch count PARTIAL, not clean", () => {
        expect(
            lightById(
                payload({
                    receiptErrors: [{ path: "a.json", error: "bad json" }],
                }),
                "batch"
            )
        ).toMatchObject({ tone: "unknown", word: "PARTIAL" });
        expect(
            lightById(
                payload({
                    receiptsSummary: {
                        total: 3,
                        counts: [],
                        interesting: [
                            { issue: 1, role: "implement", outcome: "failed" },
                        ],
                    },
                }),
                "batch"
            )
        ).toMatchObject({ tone: "warn", word: "ATTENTION" });
        expect(lightById(payload(), "batch")).toMatchObject({
            tone: "good",
            word: "CLEAN",
        });
    });

    it("colour is never the only carrier — the state survives every class being stripped", () => {
        // Strip every class attribute (the colour channel) and every glyph
        // span, and the state must still be readable as words.
        const bare = lightsHtml(
            payload({
                claims: [claim("orphan")],
                queueDepthError: "gh: 502",
                queueDepth: null,
            })
        ).replace(/class="[^"]*"/g, "");
        for (const word of ["ALIVE", "UNAVAILABLE", "ORPHANED", "CLEAN"]) {
            expect(bare).toContain(word);
        }
    });

    it("every tone has a distinct non-colour glyph AND a rule in the stylesheet", () => {
        const tones = Object.keys(LIGHT_TONES);
        const glyphs = Object.values(LIGHT_TONES);
        expect(new Set(glyphs).size).toBe(glyphs.length);
        for (const tone of tones) {
            expect(DASHBOARD_CSS, `.ls-light.${tone}`).toContain(
                `.ls-light.${tone} {`
            );
        }
    });

    it("every light points at a section id the Now body actually renders", () => {
        // The click-to-scroll criterion, at the only seam a test can reach
        // without a browser: a light whose `data-target` names nothing would
        // scroll nowhere, silently.
        const html = nowBodyHtml(
            payload({ claims: [claim("live")] })
        ) as string;
        for (const l of nowLights(payload()) as { target: string }[]) {
            expect(html, `target ${l.target}`).toContain(`id="${l.target}"`);
            expect(lightsHtml(payload())).toContain(
                `data-target="${l.target}"`
            );
        }
        expect(Object.values(SECTION_IDS).sort()).toEqual(
            (nowLights(payload()) as { target: string }[])
                .map((l) => l.target)
                .sort()
        );
    });

    it("escapes the error prose it is handed — `gh` stderr is not trusted markup", () => {
        expect(
            lightsHtml(
                payload({
                    claims: null,
                    claimsError: "<img src=x onerror=alert(1)>",
                })
            )
        ).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("is wired to the LIVE payload — the composition root passes data straight through", () => {
        const src = stripLineComments(NOW);
        expect(src).toContain("lightsHtml(data)");
        expect(stripLineComments(NOW_LOOP_STATUS)).toContain(
            "nowBodyHtml(data)"
        );
    });
});

describe("telemetry dashboard — remedy copy affordance (#2630)", () => {
    it("copies the COMMAND, never the sentence that names it", () => {
        // `verdict.remedy` is prose: "`bun run loop:doctor` to inspect, …".
        const html = remedyHtml(
            "`bun run loop:doctor` to inspect, `bun run loop:doctor --release` to drop it"
        );
        expect(html).toContain('data-copy="bun run loop:doctor"');
        expect(html).toContain('data-copy="bun run loop:doctor --release"');
        // The prose around the commands is still prose.
        expect(html).toContain(" to inspect, ");
        // Nothing on the clipboard is a sentence.
        for (const m of html.matchAll(/data-copy="([^"]*)"/g)) {
            expect(m[1]).not.toContain(" to inspect");
        }
    });

    it("offers no copy affordance for a remedy that names no command", () => {
        const html = remedyHtml("check the driver log");
        expect(html).toBe("check the driver log");
        expect(html).not.toContain("ls-copy");
    });

    it("escapes both the prose and the command", () => {
        const html = remedyHtml('run `echo "<b>"` now');
        expect(html).toContain("&quot;&lt;b&gt;&quot;");
        expect(html).not.toContain("<b>");
    });
});
