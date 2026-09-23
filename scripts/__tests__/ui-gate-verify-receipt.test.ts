import { describe, it, expect } from "vitest";
import type { Readings, UnwalkedSurface } from "../ui-gate/floors.ts";
import {
    DIAGNOSTIC_SEPARATOR,
    DIGEST_HEADER,
    diagnosticLines,
    evaluateRun,
    formatResultRow,
    VERDICT_DIGEST_PREFIX,
    verdictBlockLines,
    verdictDigest,
    verdictDigestLines,
    zeroReadings,
    type DiffScope,
    type Evaluation,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import {
    extractVerdictBlock,
    parseResultRowLine,
    verifyReceiptText,
    type ExpectedScope,
    type ReceiptVocabulary,
} from "../ui-gate/verify-receipt.ts";

/**
 * `land` re-derives a pasted receipt's VERDICT BLOCK from the diff's scope and
 * refuses on any mismatch or any line that is not `PASS`; it never reads the
 * DIAGNOSTIC BLOCK (ADR 0132 §6, issue #3648; the transport check itself is
 * issue #2760).
 *
 * Every receipt here is produced the way `check:ui` produces one — a walk
 * through the real `evaluateRun`, rendered by the real `verdictBlockLines` /
 * `diagnosticLines` — and every negative case tampers with the RENDERED TEXT,
 * exactly like a human editing a PR body, or renders an honest run that simply
 * is not green.
 */

const VIEWPORTS = ["1440x900x2", "390x844x3", "844x390x3"];
const UNWALKED: UnwalkedSurface[] = [
    { surface: "game-board", reason: "no fixed position", issue: 3695 },
];
/** Two surfaces promise something, two promise nothing — the shape the real
 *  table has while `ASSERTION_DEBT` is still being drained (issue #3649). */
const ASSERTS: Record<string, readonly string[]> = {
    "deck-builder": [],
    lobby: ["mode tile: Solo game", "Loadout primary action"],
    "lobby-vs-ai": ["dialog primary: Play vs AI"],
    "game-board": [],
};
const VOCAB: ReceiptVocabulary = {
    surfaceIds: ["deck-builder", "lobby", "lobby-vs-ai", "game-board"],
    viewportIds: VIEWPORTS,
    unwalked: UNWALKED,
    assertsBySurface: ASSERTS,
};
const BASE = "origin/base";

type Cell = Readings | "infra" | "missing";

/** An honest `check:ui` run over `surfaces`; `at` changes one cell. */
function run(
    surfaces: readonly string[],
    opts: {
        diffScope?: DiffScope | null;
        at?: (surface: string, viewport: string) => Cell | undefined;
        unreachable?: string[];
        /** Break ONE promise: the labels this cell reports as failed. */
        assertFails?: (surface: string, viewport: string) => string[];
    } = {}
): Evaluation {
    const walks: SurfaceWalk[] = surfaces
        .filter((s) => !UNWALKED.some((u) => u.surface === s))
        .map((surface): SurfaceWalk => {
            if (opts.unreachable?.includes(surface)) {
                return { surface, status: "unreachable", reason: "no tile" };
            }
            const cells = VIEWPORTS.map(
                (viewport) =>
                    [
                        viewport,
                        opts.at?.(surface, viewport) ?? zeroReadings(),
                    ] as const
            );
            return {
                surface,
                status: "measured",
                measurements: cells
                    .filter(([, c]) => typeof c !== "string")
                    .map(([viewport, c]) => {
                        const broken = new Set(
                            opts.assertFails?.(surface, viewport) ?? []
                        );
                        return {
                            viewport,
                            readings: c as Readings,
                            asserts: (ASSERTS[surface] ?? []).map((label) => ({
                                label,
                                ok: !broken.has(label),
                                detail: broken.has(label)
                                    ? 'reachable `[data-mode-tile="solo"]` — no element matches it'
                                    : "",
                            })),
                        };
                    }),
                infra: cells
                    .filter(([, c]) => c === "infra")
                    .map(([viewport]) => ({
                        viewport,
                        signature: "function-timeout" as const,
                        load: 21.7,
                        reason: "timed out",
                    })),
            };
        });
    return evaluateRun({
        knownSurfaceIds: surfaces,
        walks,
        definedSurfaceIds: VOCAB.surfaceIds,
        viewportIds: VIEWPORTS,
        unwalked: UNWALKED,
        diffScope: opts.diffScope ?? null,
        assertsBySurface: ASSERTS,
    });
}

/** A PR body carrying the receipt as `check:ui` prints it. */
function body(ev: Evaluation, facts: string[] = ["wall time: 42s"]): string {
    return [
        "Closes #3648",
        "",
        "## check:ui receipt",
        "",
        "```",
        "─── check:ui ───────────────────────────────────────────────────",
        ...verdictBlockLines(ev),
        DIAGNOSTIC_SEPARATOR,
        ...diagnosticLines(ev),
        ...facts,
        "",
        "✓ check:ui passed",
        "```",
    ].join("\n");
}

const ALL = VOCAB.surfaceIds;
const verify = (text: string, expected: ExpectedScope | null = null) =>
    verifyReceiptText(text, expected, VOCAB);
const scoped = (surfaces: string[], base = BASE): ExpectedScope => ({
    base,
    scope: { kind: "scoped", surfaces },
});

describe("verify-receipt — an all-PASS verdict block matching its scope lands", () => {
    it("accepts a full RECEIPT, with no landing diff and with any landing diff", () => {
        const text = body(run(ALL));
        expect(verify(text)).toEqual({ ok: true, problems: [] });
        expect(verify(text, scoped(["lobby"]))).toEqual({
            ok: true,
            problems: [],
        });
        expect(
            verify(text, { base: BASE, scope: { kind: "full", reason: "css" } })
        ).toEqual({ ok: true, problems: [] });
    });

    it("accepts a SCOPED receipt whose surfaces are exactly the landing diff's scope", () => {
        const surfaces = ["lobby", "lobby-vs-ai"];
        const text = body(
            run(surfaces, { diffScope: { base: BASE, surfaces } })
        );
        expect(verify(text, scoped(surfaces))).toEqual({
            ok: true,
            problems: [],
        });
    });

    it("accepts a scope containing a declared-unwalked surface, which owes no line", () => {
        const surfaces = ["lobby", "game-board"];
        const text = body(
            run(surfaces, { diffScope: { base: BASE, surfaces } })
        );
        expect(text).not.toMatch(/^PASS +game-board/m);
        expect(verify(text, scoped(surfaces))).toEqual({
            ok: true,
            problems: [],
        });
    });

    it("accepts an empty SCOPED receipt only for an empty scope", () => {
        const text = body(run([], { diffScope: { base: BASE, surfaces: [] } }));
        expect(verify(text, scoped([])).ok).toBe(true);
        expect(verify(text, scoped(["lobby"])).ok).toBe(false);
    });
});

describe("verify-receipt — two receipts differing only in the diagnostic block verify identically", () => {
    it("ignores shape readings, load, infra history, console errors and wall time", () => {
        const quiet = body(run(ALL), [
            "machine load: start 2.0, end 2.4",
            "console errors: none",
            "wall time: 201s",
        ]);
        const busy = body(
            run(ALL, {
                at: () => ({
                    ...zeroReadings(),
                    cardsOcc: 7,
                    small: 31,
                    starved: 2,
                }),
            }),
            [
                "machine load: start 24.9, end 30.1",
                "console errors: 3",
                "  390x844x3: WebSocket reconnect",
                "wall time: 544s",
            ]
        );
        expect(quiet).not.toBe(busy);
        expect(verify(busy)).toEqual(verify(quiet));
        expect(verify(busy)).toEqual({ ok: true, problems: [] });
    });

    it("never reads past the coverage line, even a line shaped like a verdict", () => {
        const text = body(run(ALL), [
            "FAIL     lobby                1440x900x2   broken floor: cardsZero 1",
        ]);
        expect(verify(text)).toEqual({ ok: true, problems: [] });
    });
});

describe("verify-receipt — any line that is not PASS refuses", () => {
    it("refuses one FAIL line, naming the cell and the broken Floor", () => {
        const text = body(
            run(ALL, {
                at: (s, v) =>
                    s === "lobby" && v === "390x844x3"
                        ? { ...zeroReadings(), hOverflow: 12 }
                        : undefined,
            })
        );
        const result = verify(text);
        expect(result.ok).toBe(false);
        expect(result.problems[0]).toBe(
            "the receipt carries 1 FAIL line(s) (lobby @ 390x844x3: broken floor: hOverflow 12) — a broken Floor is a defect in the tree: fix it and re-run check:ui"
        );
    });

    it("refuses one INFRA line", () => {
        const text = body(
            run(ALL, {
                at: (s, v) =>
                    s === "deck-builder" && v === "844x390x3"
                        ? "infra"
                        : undefined,
            })
        );
        const result = verify(text);
        expect(result.ok).toBe(false);
        expect(result.problems[0]).toMatch(
            /^the receipt carries 1 INFRA line\(s\) \(deck-builder @ 844x390x3: function-timeout\)/
        );
    });

    it("refuses one UNWALKED line (a surface the run could not reach)", () => {
        const text = body(run(ALL, { unreachable: ["lobby-vs-ai"] }));
        const result = verify(text);
        expect(result.ok).toBe(false);
        expect(result.problems[0]).toMatch(
            /^the receipt carries 1 UNWALKED line\(s\) \(lobby-vs-ai @ —: unreachable\)/
        );
    });

    it("refuses one UNWALKED line (a viewport that produced no measurement)", () => {
        const text = body(
            run(ALL, {
                at: (s, v) =>
                    s === "lobby" && v === "1440x900x2" ? "missing" : undefined,
            })
        );
        const result = verify(text);
        expect(result.ok).toBe(false);
        expect(result.problems[0]).toMatch(
            /^the receipt carries 1 UNWALKED line\(s\) \(lobby @ 1440x900x2: no measurement at this viewport\)/
        );
    });
});

describe("verify-receipt — the verdict block must be the one its scope re-derives", () => {
    it("refuses a receipt missing one cell, even with every other line intact", () => {
        const text = body(run(ALL)).replace(
            `${formatResultRow({ surface: "lobby", viewport: "844x390x3", verdict: "PASS", detail: "every floor at zero" })}\n`,
            ""
        );
        expect(text).not.toBe(body(run(ALL)));
        const result = verify(text);
        expect(result.ok).toBe(false);
        expect(result.problems).toEqual([
            "the receipt is missing 1 cell(s) its scope owes: lobby @ 844x390x3",
        ]);
    });

    it("refuses a full-lane banner pasted over a subset's lines, whatever the banner says", () => {
        const subset = run(["lobby"], {
            diffScope: { base: BASE, surfaces: ["lobby"] },
        });
        const [, ...rest] = verdictBlockLines(subset);
        const forged = [verdictBlockLines(run(ALL))[0], ...rest].join("\n");
        const result = verify(forged);
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /missing 6 cell\(s\) its scope owes: deck-builder @ 1440x900x2/
        );
    });

    it("refuses a line for a declared-unwalked surface — it is outside what the scope walks", () => {
        const extra = formatResultRow({
            surface: "game-board",
            viewport: "1440x900x2",
            verdict: "PASS",
            detail: "every floor at zero",
        });
        const text = body(run(ALL)).replace(
            /^coverage: /m,
            `${extra}\ncoverage: `
        );
        expect(verify(text).problems).toEqual([
            "the receipt carries 1 line(s) outside its scope: game-board @ 1440x900x2",
        ]);
    });

    it("refuses a deleted banner", () => {
        const [, ...rest] = verdictBlockLines(run(ALL));
        expect(verify(rest.join("\n")).problems[0]).toMatch(
            /^no RECEIPT\/SCOPED\/DIAGNOSTIC banner line found/
        );
    });

    it("refuses an altered banner when the lines and coverage still match", () => {
        const text = body(run(ALL)).replace(
            "RECEIPT — full lane run, 4 surface(s)",
            "RECEIPT — full lane run, 5 surface(s)"
        );
        expect(verify(text).problems).toEqual([
            expect.stringMatching(/^banner mismatch:/),
        ]);
    });

    it("refuses a tampered coverage line when the banner and every line still match", () => {
        const text = body(run(ALL)).replace(
            "coverage: 3/4 surfaces measured",
            "coverage: 4/4 surfaces measured"
        );
        expect(verify(text).problems).toEqual([
            expect.stringMatching(/^coverage line mismatch:/),
        ]);
    });

    it("refuses a deleted coverage line", () => {
        const text = body(run(ALL)).replace(/^coverage: .*\n/m, "");
        expect(verify(text).problems[0]).toMatch(
            /^no `coverage: …` line found/
        );
    });

    it("refuses a line whose padding was reflowed, though it parses to the same cell (PR #2783/#2786)", () => {
        const line = formatResultRow({
            surface: "lobby",
            viewport: "390x844x3",
            verdict: "PASS",
            detail: "every floor at zero",
        });
        const text = body(run(ALL)).replace(line, line.replace(/ +/g, " "));
        expect(verify(text).problems).toEqual([
            expect.stringMatching(
                /^line for lobby @ 390x844x3 does not match the renderer:/
            ),
        ]);
    });

    it("refuses lines that are all present and exact but reordered", () => {
        const lines = verdictBlockLines(run(ALL));
        [lines[1], lines[2]] = [lines[2], lines[1]];
        expect(verify(lines.join("\n")).problems).toEqual([
            "the verdict lines are not in the order check:ui prints them (surface table, then viewport matrix, then the assertions)",
        ]);
    });
});

describe("verify-receipt — scope: RECEIPT, SCOPED, DIAGNOSTIC (issues #2742, #3628)", () => {
    const surfaces = ["lobby", "lobby-vs-ai"];
    const scopedText = body(
        run(surfaces, { diffScope: { base: BASE, surfaces } })
    );

    it("refuses a SCOPED receipt missing a surface the landing diff reaches", () => {
        const result = verify(
            scopedText,
            scoped([...surfaces, "deck-builder"])
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /missing 3 cell\(s\) its scope owes: deck-builder @ 1440x900x2/
        );
    });

    it("refuses a SCOPED receipt covering a surface outside the landing diff's scope", () => {
        const result = verify(scopedText, scoped(["lobby"]));
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /3 line\(s\) outside its scope: lobby-vs-ai @ 1440x900x2/
        );
    });

    it("refuses a SCOPED receipt taken against another base", () => {
        expect(
            verify(scopedText, scoped(surfaces, "origin/other")).problems
        ).toEqual([expect.stringMatching(/^banner mismatch:/)]);
    });

    it("refuses a SCOPED receipt when the landing diff forces the full run", () => {
        expect(
            verify(scopedText, {
                base: BASE,
                scope: {
                    kind: "full",
                    reason: "src/index.css is a stylesheet",
                },
            }).problems
        ).toEqual([
            "the landing diff forces the full run (src/index.css is a stylesheet) — a SCOPED receipt cannot cover it; paste a full RECEIPT",
        ]);
    });

    it("refuses a SCOPED receipt with no landing diff to re-derive its scope", () => {
        expect(verify(scopedText).problems[0]).toMatch(
            /^a SCOPED receipt covers only what its diff reaches, and no landing diff was given/
        );
    });

    it("refuses an honest DIAGNOSTIC, even one naming exactly the scoped surfaces", () => {
        const text = body(run(surfaces));
        expect(text).toContain("DIAGNOSTIC — NOT a PR receipt");
        expect(verify(text, scoped(surfaces)).problems).toEqual([
            "a DIAGNOSTIC (a hand-picked --surface= subset) is not a PR receipt — paste a full RECEIPT, or the SCOPED run of the landing diff",
        ]);
    });
});

describe("verify-receipt — parseResultRowLine / extractVerdictBlock", () => {
    it("round-trips every verdict through formatResultRow", () => {
        for (const verdict of ["PASS", "FAIL", "INFRA", "UNWALKED"] as const) {
            const row = {
                surface: "lobby-vs-ai",
                viewport: "844x390x3",
                verdict,
                detail: "some  detail — with spaces",
            };
            expect(
                parseResultRowLine(
                    formatResultRow(row),
                    VOCAB.surfaceIds,
                    VIEWPORTS
                )
            ).toEqual(row);
        }
    });

    it("does not let one surface id swallow another as a prefix (longest-first)", () => {
        const row = parseResultRowLine(
            formatResultRow({
                surface: "lobby-vs-ai",
                viewport: "1440x900x2",
                verdict: "PASS",
                detail: "x",
            }),
            ["lobby", "lobby-vs-ai"],
            VIEWPORTS
        );
        expect(row?.surface).toBe("lobby-vs-ai");
    });

    it("parses the em dash as a null viewport, and returns null for no known vocabulary", () => {
        expect(
            parseResultRowLine(
                formatResultRow({
                    surface: "lobby",
                    viewport: null,
                    verdict: "UNWALKED",
                    detail: "d",
                }),
                VOCAB.surfaceIds,
                VIEWPORTS
            )?.viewport
        ).toBeNull();
        expect(
            parseResultRowLine(
                "PASS nowhere 1x1 d",
                VOCAB.surfaceIds,
                VIEWPORTS
            )
        ).toBeNull();
    });

    it("stops the verdict block at the first coverage line", () => {
        const { block } = extractVerdictBlock(body(run(ALL)), VOCAB);
        expect(block?.rows).toHaveLength(9);
        expect(block?.coverageLine).toBe(
            "coverage: 3/4 surfaces measured, 1 declared unwalked: game-board (issue #3695)"
        );
    });
});

/**
 * NAMED ASSERTIONS ARE PART OF THE VERDICT BLOCK (ADR 0132 §3, issue #3649).
 * `land` re-derives them from the surface table exactly as it re-derives the
 * cells: a promise that failed, a promise nobody pasted and a promise the
 * table never made are all refusals, and none of them can be edited away in a
 * PR body.
 */
describe("verify-receipt — the assertion lines", () => {
    it("carries one PASS line per promise per viewport, and verifies", () => {
        const text = body(run(ALL));
        for (const viewport of VIEWPORTS) {
            expect(text).toContain(
                `assert   lobby                ${viewport.padEnd(12)} PASS mode tile: Solo game`
            );
        }
        expect(verify(text)).toEqual({ ok: true, problems: [] });
    });

    it("refuses a receipt whose own run broke a promise", () => {
        const text = body(
            run(ALL, {
                assertFails: (surface, viewport) =>
                    surface === "lobby" && viewport === VIEWPORTS[1]
                        ? ["mode tile: Solo game"]
                        : [],
            })
        );
        const { ok, problems } = verify(text);
        expect(ok).toBe(false);
        expect(problems.join("\n")).toContain("FAIL assertion line(s)");
        expect(problems.join("\n")).toContain('"mode tile: Solo game"');
    });

    it("refuses a paste with a FAIL assertion line edited to PASS-by-deletion", () => {
        const text = body(run(ALL))
            .split("\n")
            .filter(
                (line) =>
                    line !==
                    `assert   lobby                ${VIEWPORTS[0].padEnd(12)} PASS mode tile: Solo game`
            )
            .join("\n");
        const { ok, problems } = verify(text);
        expect(ok).toBe(false);
        expect(problems.join("\n")).toContain("missing 1 assertion line(s)");
        expect(problems.join("\n")).toContain(
            "an assertion nobody ran is not one that passed"
        );
    });

    it("refuses an assertion line the surface table never declared", () => {
        const text = body(run(ALL)).replace(
            "mode tile: Solo game",
            "mode tile: Invented"
        );
        const { ok, problems } = verify(text);
        expect(ok).toBe(false);
        expect(problems.join("\n")).toContain(
            "assertion line(s) the surface table does not declare"
        );
    });

    it("refuses an assertion line whose padding was reflowed", () => {
        const text = body(run(ALL)).replace(
            `assert   lobby                ${VIEWPORTS[0].padEnd(12)} PASS mode tile: Solo game`,
            `assert lobby ${VIEWPORTS[0]} PASS mode tile: Solo game`
        );
        const { ok, problems } = verify(text);
        expect(ok).toBe(false);
        expect(problems.join("\n")).toMatch(
            /does not match the renderer|could not parse/
        );
    });

    it("owes the assertions of every surface a SCOPED receipt covers, and no others", () => {
        const surfaces = ["lobby"];
        const text = body(
            run(surfaces, { diffScope: { base: BASE, surfaces } })
        );
        expect(text).not.toContain("dialog primary: Play vs AI");
        expect(verify(text, scoped(surfaces))).toEqual({
            ok: true,
            problems: [],
        });
    });
});

/**
 * THE DIGEST FORM (issue #4419). The verdict block grows with the SURFACE
 * TABLE, not with the diff, and at 52 surfaces it outgrew GitHub's
 * 65,536-character pull-request body — so the receipt could no longer be
 * pasted where `land` reads it. The digest carries the same claim in three
 * lines, and it is the SAME re-derivation behind it: these cases are the
 * full-paste cases above, said in hashes.
 */
describe("verify-receipt — the digest form", () => {
    /** A PR body carrying the three digest lines `check:ui` prints. */
    const digestBody = (ev: Evaluation): string =>
        [
            "Closes #4419",
            "",
            "## UI receipt",
            "",
            "```",
            DIGEST_HEADER,
            ...verdictDigestLines(ev),
            "```",
        ].join("\n");

    it("accepts a digest of the same run the full paste would carry", () => {
        expect(verify(digestBody(run(ALL)))).toEqual({
            ok: true,
            problems: [],
        });
    });

    it("the digest it accepts is the hash of the block it would have diffed", () => {
        const ev = run(ALL);
        const middle = verdictBlockLines(ev).slice(1, -1);
        expect(verdictDigestLines(ev)[1]).toBe(
            `${VERDICT_DIGEST_PREFIX}${verdictDigest(middle)}  (${middle.length} lines)`
        );
    });

    it("refuses a hash that is not this tree's", () => {
        const tampered = digestBody(run(ALL)).replace(
            /verdict-sha256: [0-9a-f]{64}/,
            `${VERDICT_DIGEST_PREFIX}${"0".repeat(64)}`
        );
        const result = verify(tampered);
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/verdict digest mismatch/);
    });

    it("refuses a run that was not green, though its banner and coverage line are", () => {
        const red = run(ALL, {
            at: (s, v) =>
                s === "lobby" && v === "390x844x3"
                    ? { ...zeroReadings(), hOverflow: 1 }
                    : undefined,
        });
        const result = verify(digestBody(red));
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/verdict digest mismatch/);
    });

    it("refuses a line count that does not match the scope's", () => {
        const wrong = digestBody(run(ALL)).replace(
            /\(\d+ lines\)/,
            "(3 lines)"
        );
        const result = verify(wrong);
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /the digest claims 3 verdict line\(s\)/
        );
    });

    it("refuses a digest with verdict rows beside it — half a block is not a block", () => {
        const ev = run(ALL);
        const half = [
            "```",
            DIGEST_HEADER,
            verdictDigestLines(ev)[0],
            verdictDigestLines(ev)[1],
            verdictBlockLines(ev)[1],
            verdictDigestLines(ev)[2],
            "```",
        ].join("\n");
        const result = verify(half);
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /could not parse as a verdict line/
        );
    });

    it("still refuses a SCOPED digest the landing diff does not justify", () => {
        const ev = run(["lobby"], {
            diffScope: { base: BASE, kind: "scoped", surfaces: ["lobby"] },
        });
        const result = verify(
            digestBody(ev),
            scoped(["lobby", "deck-builder"])
        );
        expect(result.ok).toBe(false);
    });
});
