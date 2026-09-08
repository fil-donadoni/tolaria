// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Lights } from "../Lights";
import {
    LIGHT_GLYPHS,
    lightGlyph,
    nowLights,
    SECTION_IDS,
} from "../../../lib/nowLights";
import { TONES, type Tone } from "../../../lib/tones";
import type {
    ClaimRow,
    ClaimVerdictState,
    LoopVerdictState,
    NowPayload,
} from "../../../lib/nowPayload";

/**
 * The four traffic lights (#2630), migrated with their subject in PRD #3148 S4
 * from `scripts/__tests__/loop-status-dashboard.test.ts`.
 *
 * THE LINE #2630 MUST NOT BLUR: a light derives a per-SUBSYSTEM fact from the
 * same raw fields the CLI's section renderers branch on; the loop's HEALTH
 * verdict comes from `deriveLoopVerdict` alone. A light reading `STALLED`
 * would be a second health computation wearing a subsystem's clothes, free to
 * disagree with the band above it.
 *
 * The other rule these cases exist for is that a FAILED read and an EMPTY one
 * must share nothing an operator could mistake for the other. At 0/5000
 * GraphQL quota this page once rendered "0 claimed" — an idle, drained loop —
 * at the exact moment GitHub was unreachable.
 */

/** A healthy payload. Every case overrides ONE field, so what it proves is
 *  attributable to that field. */
const payload = (over: Partial<NowPayload> = {}): NowPayload =>
    ({
        verdict: {
            state: "RUNNING",
            sentence: "The driver is running.",
            remedy: "nothing to do",
            remedyAction: null,
            findings: [],
        },
        driver: {
            armed: true,
            pid: 4242,
            pidAlive: true,
            stopFilePresent: false,
            recentPasses: [],
        },
        claims: [],
        claimsError: null,
        queueDepth: { P0: 1, P1: 2, P2: 3, unprioritized: 4, total: 10 },
        queueDepthError: null,
        receiptsSummary: { total: 12, counts: [], interesting: [] },
        batch: "cfa2cdaf-591a-4b8f-9926-613d3e8543d6",
        batchStartedAt: null,
        priorityWarning: null,
        receiptErrors: [],
        timelinePasses: [],
        recentMerges: [],
        recentMergesError: null,
        recentMergesTruncated: false,
        dependentsError: null,
        ...over,
    }) as unknown as NowPayload;

const claim = (state: ClaimVerdictState, issue = 2582): ClaimRow => ({
    issue,
    title: "a claimed issue",
    stage: "claimed",
    verdict: { state, reason: "" },
    priority: "P1",
    ageHours: 12,
    dependents: 0,
});

const lightById = (data: NowPayload, id: string) =>
    nowLights(data).find((l) => l.id === id)!;

const renderLights = (data: NowPayload) =>
    render(
        <TooltipProvider>
            <Lights data={data} />
        </TooltipProvider>
    );

describe("traffic lights — a subsystem fact, never a second health verdict", () => {
    it("renders four lights, each with a number, a state word and a line of prose", () => {
        const lights = nowLights(payload());
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
            expect(TONES as readonly string[]).toContain(l.tone);
        }
    });

    it("computes no verdict of its own — no light's word is a LOOP_VERDICT state, on any input", () => {
        const states = new Set<string>([
            "NEEDS ATTENTION",
            "STALLED",
            "STOPPED",
            "RUNNING",
            "IDLE",
        ] satisfies LoopVerdictState[]);
        const base = payload();
        const inputs = [
            payload(),
            payload({ driver: { ...base.driver, pidAlive: false } }),
            payload({ driver: { ...base.driver, stopFilePresent: true } }),
            payload({ driver: { ...base.driver, pid: null } }),
            payload({ claims: null, claimsError: "gh: quota exhausted" }),
            payload({ claims: [claim("orphan")] }),
            payload({ claims: [claim("suspect")] }),
            payload({ queueDepth: null, queueDepthError: "gh: 502" }),
            payload({
                receiptErrors: [{ path: "a.json", error: "bad json" }],
            }),
        ];
        for (const data of inputs) {
            for (const l of nowLights(data)) {
                expect(states.has(l.word), `light word "${l.word}"`).toBe(
                    false
                );
            }
        }
    });
});

describe("traffic lights — a failed read and an empty one share nothing", () => {
    it("a failed queue read is UNAVAILABLE, never a zero", () => {
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

    it("renders the failed read's own prose as text — `gh` stderr is data, not markup", () => {
        renderLights(
            payload({
                claims: null,
                claimsError: "<img src=x onerror=alert(1)>",
            })
        );
        expect(
            screen.getByText(/<img src=x onerror=alert\(1\)>/)
        ).not.toBeNull();
        expect(document.querySelectorAll("img").length).toBe(0);
    });
});

describe("traffic lights — each subsystem's own words", () => {
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
                            {
                                issue: 1,
                                role: "implement",
                                outcome: "failed",
                            },
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
});

describe("traffic lights — colour is never the only carrier (#2630 AC)", () => {
    it("the state survives every class being stripped — it is readable as WORDS", () => {
        const { container } = renderLights(
            payload({
                claims: [claim("orphan")],
                queueDepth: null,
                queueDepthError: "gh: 502",
            })
        );
        const bare = container.innerHTML.replace(/class="[^"]*"/g, "");
        for (const word of ["ALIVE", "UNAVAILABLE", "ORPHANED", "CLEAN"]) {
            expect(bare, word).toContain(word);
        }
    });

    it("every tone a light can EMIT has a distinct non-colour glyph, so a reader who sees neither hue nor prose weight can still tell them apart", () => {
        // Pointed at the producer, not at the tone vocabulary: `neutral` is a
        // tone this page has (a value with no verdict attached) and no light
        // ever wears, so requiring a glyph for it would be a rule about
        // nothing. What must hold is that every tone `nowLights` actually
        // returns, over every input shape this suite exercises, has its own
        // mark.
        const base = payload().driver;
        const emitted = new Set<Tone>();
        for (const data of [
            payload(),
            payload({ driver: { ...base, pidAlive: false } }),
            payload({ driver: { ...base, stopFilePresent: true } }),
            payload({ claims: [claim("orphan")] }),
            payload({ claims: null, claimsError: "gh: 502" }),
            payload({
                receiptErrors: [{ path: "a.json", error: "bad json" }],
            }),
        ]) {
            for (const l of nowLights(data)) emitted.add(l.tone);
        }
        // Vacuity guard: the matrix really does reach more than one tone.
        expect(emitted.size).toBeGreaterThanOrEqual(4);
        const glyphs = [...emitted].map((t) => lightGlyph(t));
        expect(new Set(glyphs).size).toBe(glyphs.length);
        for (const tone of emitted) {
            expect(LIGHT_GLYPHS[tone], tone).toBeDefined();
        }
    });

    it("every light points at a section id the Now view actually renders — a target naming nothing would scroll nowhere, silently", () => {
        const targets = nowLights(payload()).map((l) => l.target);
        expect([...targets].sort()).toEqual(Object.values(SECTION_IDS).sort());
        renderLights(payload());
        for (const light of nowLights(payload())) {
            expect(
                screen.getByRole("button", { name: new RegExp(light.label) }),
                light.target
            ).not.toBeNull();
        }
    });
});
