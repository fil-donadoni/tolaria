import { describe, it, expect } from "vitest";
import type { Readings, UnwalkedSurface } from "../ui-gate/floors.ts";
import {
    evaluateRun,
    verdictBlockLines,
    verdictDigestLines,
    zeroReadings,
    type DiffScope,
    type Evaluation,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import {
    attributeBatch,
    BATCH_RECEIPT_END,
    BATCH_RECEIPT_START,
    domDigest,
    formatBatchHead,
    parseBatchBanner,
    parseBatchHeadsFlag,
    settleAmbiguous,
    withBatchReceipt,
    type BatchHead,
} from "../ui-gate/batch-receipt.ts";
import { batchPassthrough, batchReceiptLines } from "../ui-gate/batch-run.ts";
import {
    extractVerdictBlock,
    verifyReceiptText,
    type ExpectedScope,
    type ReceiptVocabulary,
} from "../ui-gate/verify-receipt.ts";
import { skinReceiptInvalidForDiff } from "../lib/pr-refusals.ts";

/**
 * Issue #9106 — ONE `check:ui` walk for several UI PRs. Every receipt here is
 * rendered by the real `evaluateRun` / `verdictDigestLines`, exactly as the
 * walk inside the merged tree prints it; every refusal is an honest receipt
 * that does not cover the PR, or a PR whose content moved after the walk.
 */

const VIEWPORTS = ["1440x900x2", "390x844x3"];
const UNWALKED: UnwalkedSurface[] = [
    { surface: "game-board", reason: "no fixed position", issue: 3695 },
];
const ASSERTS: Record<string, readonly string[]> = {
    "deck-builder": [],
    lobby: ["mode tile: Solo game"],
    "lobby-vs-ai": [],
    "game-board": [],
};
const VOCAB: ReceiptVocabulary = {
    surfaceIds: ["deck-builder", "lobby", "lobby-vs-ai", "game-board"],
    viewportIds: VIEWPORTS,
    unwalked: UNWALKED,
    assertsBySurface: ASSERTS,
};
const BASE_SHA = "0123456789abcdef0123456789abcdef01234567";

const A: BatchHead = {
    pr: 9071,
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    dom: domDigest([{ path: "src/a.tsx", blob: "a1" }]),
};
const B: BatchHead = {
    pr: 9096,
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    dom: domDigest([{ path: "src/b.tsx", blob: "b1" }]),
};

/** The walk `check:ui --batch-heads=` makes of the merged tree. */
function batchRun(
    surfaces: readonly string[],
    heads: readonly BatchHead[],
    broken: (surface: string, viewport: string) => boolean = () => false
): Evaluation {
    const walks: SurfaceWalk[] = surfaces
        .filter((s) => !UNWALKED.some((u) => u.surface === s))
        .map((surface) => ({
            surface,
            status: "measured",
            measurements: VIEWPORTS.map((viewport) => ({
                viewport,
                readings: broken(surface, viewport)
                    ? ({ ...zeroReadings(), cardsStranded: 3 } as Readings)
                    : zeroReadings(),
                asserts: (ASSERTS[surface] ?? []).map((label) => ({
                    label,
                    ok: true,
                    detail: "",
                })),
            })),
        }));
    const diffScope: DiffScope = { base: BASE_SHA, surfaces, batch: heads };
    return evaluateRun({
        knownSurfaceIds: surfaces,
        walks,
        definedSurfaceIds: VOCAB.surfaceIds,
        viewportIds: VIEWPORTS,
        unwalked: UNWALKED,
        diffScope,
        assertsBySurface: ASSERTS,
    });
}

function prBody(lines: readonly string[]): string {
    return ["Closes #1", "", "```", ...lines, "```"].join("\n");
}

function expected(surfaces: string[], dom: string | undefined): ExpectedScope {
    return {
        base: "origin/staging",
        scope: { kind: "scoped", surfaces },
        ...(dom !== undefined ? { dom } : {}),
    };
}

describe("domDigest — a PR's DOM-reachable content identity (issue #9106)", () => {
    it("is independent of path order and changes with any blob", () => {
        const one = domDigest([
            { path: "src/a.tsx", blob: "x" },
            { path: "src/b.tsx", blob: "y" },
        ]);
        expect(
            domDigest([
                { path: "src/b.tsx", blob: "y" },
                { path: "src/a.tsx", blob: "x" },
            ])
        ).toBe(one);
        expect(
            domDigest([
                { path: "src/a.tsx", blob: "x" },
                { path: "src/b.tsx", blob: "z" },
            ])
        ).not.toBe(one);
        expect(
            domDigest([
                { path: "src/a.tsx", blob: "x" },
                { path: "src/b.tsx", blob: null },
            ])
        ).not.toBe(one);
        expect(one).toMatch(/^[0-9a-f]{16}$/);
    });
});

describe("the BATCH banner", () => {
    it("names the base, every head and the union scope, and parses back", () => {
        const ev = batchRun(["deck-builder", "lobby"], [A, B]);
        const banner = verdictBlockLines(ev)[0];
        expect(banner).toBe(
            `BATCH — base ${BASE_SHA}, heads ${formatBatchHead(A)} ${formatBatchHead(B)}, 2 surface(s) in scope: deck-builder, lobby (2 measured, 0 declared unwalked)`
        );
        const parsed = parseBatchBanner(banner)!;
        expect(parsed.base).toBe(BASE_SHA);
        expect(parsed.surfaces).toEqual(["deck-builder", "lobby"]);
        expect(parsed.heads.map((h) => [h.pr, h.dom])).toEqual([
            [A.pr, A.dom],
            [B.pr, B.dom],
        ]);
    });

    it("round-trips through the --batch-heads= flag", () => {
        const flag = [A, B].map(formatBatchHead).join(",");
        expect(parseBatchHeadsFlag(flag).map((h) => [h.pr, h.dom])).toEqual([
            [A.pr, A.dom],
            [B.pr, B.dom],
        ]);
        expect(() => parseBatchHeadsFlag("#1@zz~00")).toThrow(/batch-heads/);
    });
});

describe("verifyReceiptText — a BATCH receipt covers each PR it names", () => {
    const ev = batchRun(["deck-builder", "lobby", "game-board"], [A, B]);
    const digest = prBody(verdictDigestLines(ev));
    const full = prBody(verdictBlockLines(ev));

    it("accepts for PR A (scope ⊆ batch, A's content) and PR B alike, digest or full form", () => {
        for (const body of [digest, full]) {
            expect(
                verifyReceiptText(
                    body,
                    expected(["deck-builder"], A.dom),
                    VOCAB
                )
            ).toEqual({ ok: true, problems: [] });
            expect(
                verifyReceiptText(
                    body,
                    expected(["lobby", "game-board"], B.dom),
                    VOCAB
                ).ok
            ).toBe(true);
        }
    });

    it("refuses a PR whose content is no named head (changed or rebased onto its own files after the walk)", () => {
        const r = verifyReceiptText(
            digest,
            expected(["deck-builder"], "ffffffffffffffff"),
            VOCAB
        );
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toMatch(/no head the batch merged/);
    });

    it("refuses when no landing tree identity was given", () => {
        const r = verifyReceiptText(
            digest,
            expected(["deck-builder"], undefined),
            VOCAB
        );
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toMatch(
            /matched to the landing tree by content/
        );
    });

    it("refuses a PR whose own scope reaches a surface the batch did not walk", () => {
        const r = verifyReceiptText(
            digest,
            expected(["deck-builder", "lobby-vs-ai"], A.dom),
            VOCAB
        );
        expect(r.ok).toBe(false);
        expect(r.problems.join("\n")).toMatch(/walked no lobby-vs-ai/);
    });

    it("refuses a FULL or undecided landing scope", () => {
        expect(
            verifyReceiptText(
                digest,
                {
                    base: "x",
                    scope: { kind: "full", reason: "tokens" },
                    dom: A.dom,
                },
                VOCAB
            ).ok
        ).toBe(false);
        expect(
            verifyReceiptText(
                digest,
                {
                    base: "x",
                    scope: { kind: "undecided", reasons: ["?"] },
                    dom: A.dom,
                },
                VOCAB
            ).ok
        ).toBe(false);
    });

    it("refuses a banner edited to claim a surface the walk never measured", () => {
        // The banner parses and now covers lobby-vs-ai, but the digest was
        // taken over the rows of the surfaces actually walked.
        const forged = digest
            .replace(
                "deck-builder, lobby, game-board",
                "deck-builder, lobby, lobby-vs-ai, game-board"
            )
            .replace("3 surface(s)", "4 surface(s)");
        const r = verifyReceiptText(
            forged,
            expected(["deck-builder"], A.dom),
            VOCAB
        );
        expect(r.ok).toBe(false);
    });

    it("refuses a batch with any red cell, on this PR's surfaces or another's", () => {
        const red = batchRun(
            ["deck-builder", "lobby"],
            [A, B],
            (s) => s === "lobby"
        );
        expect(
            verifyReceiptText(
                prBody(verdictDigestLines(red)),
                expected(["deck-builder"], A.dom),
                VOCAB
            ).ok
        ).toBe(false);
    });

    it("reads the batch receipt section in preference to an older banner in the body", () => {
        const stale = prBody([
            "SCOPED — diff base origin/staging, 1 surface(s) in scope: lobby-vs-ai (1 measured, 0 declared unwalked)",
            "verdict-sha256: " + "0".repeat(64) + "  (2 lines)",
            "coverage: 1/1 surfaces measured, 0 declared unwalked",
        ]);
        const body = withBatchReceipt(stale, verdictDigestLines(ev));
        expect(
            verifyReceiptText(body, expected(["deck-builder"], A.dom), VOCAB).ok
        ).toBe(true);
    });
});

describe("batchReceiptLines — a clean PR's receipt when another PR went red", () => {
    it("is the walk's own digest when every surface passed", () => {
        const ev = batchRun(["deck-builder", "lobby"], [A, B]);
        expect(
            batchReceiptLines(
                ["deck-builder", "lobby"],
                BASE_SHA,
                [A, B],
                VOCAB
            )
        ).toEqual(verdictDigestLines(ev));
    });

    it("covers only the surfaces that passed, and verifies for the clean PR alone", () => {
        const lines = batchReceiptLines(
            ["deck-builder"],
            BASE_SHA,
            [A, B],
            VOCAB
        );
        expect(
            verifyReceiptText(
                prBody(lines),
                expected(["deck-builder"], A.dom),
                VOCAB
            ).ok
        ).toBe(true);
        expect(
            verifyReceiptText(prBody(lines), expected(["lobby"], B.dom), VOCAB)
                .ok
        ).toBe(false);
    });
});

describe("attributeBatch — a red stays attributable to the PR that caused it", () => {
    const scopes = new Map<number, readonly string[]>([
        [1, ["deck-builder"]],
        [2, ["lobby"]],
        [3, ["lobby", "lobby-vs-ai", "game-board"]],
    ]);
    const walked = ["deck-builder", "lobby", "lobby-vs-ai", "game-board"];
    const rowsOf = (red: string[]) => {
        const ev = batchRun(walked, [A, B], (s) => red.includes(s));
        return extractVerdictBlock(prBody(verdictBlockLines(ev)), VOCAB).block!;
    };

    it("a surface one PR reaches reds that PR only; the rest stay clean", () => {
        const block = rowsOf(["deck-builder"]);
        const a = attributeBatch(walked, block.rows, block.assertRows, scopes);
        expect([...a.red.keys()]).toEqual([1]);
        expect(a.red.get(1)!.join("\n")).toMatch(
            /FAIL deck-builder @ 1440x900x2: broken floor: cardsStranded 3/
        );
        expect(a.clean).toEqual([2, 3]);
        expect(a.ambiguous).toEqual([]);
    });

    it("a declared-unwalked surface has no row and still counts as passed", () => {
        const block = rowsOf([]);
        const a = attributeBatch(walked, block.rows, block.assertRows, scopes);
        expect(a.passSurfaces).toEqual(walked);
        expect(a.clean).toEqual([1, 2, 3]);
    });

    it("a surface several PRs reach is ambiguous until the solo re-walks settle it", () => {
        const block = rowsOf(["lobby"]);
        const a = attributeBatch(walked, block.rows, block.assertRows, scopes);
        expect(a.ambiguous).toEqual([{ surface: "lobby", candidates: [2, 3] }]);
        expect(a.clean).toEqual([1]);
        const settled = settleAmbiguous(
            a,
            new Map([
                [2, []],
                [3, ["lobby"]],
            ])
        );
        expect([...settled.red.keys()]).toEqual([3]);
        expect(settled.orphan).toEqual([]);
        // Red in the batch, green on every candidate alone: only in combination.
        const neither = settleAmbiguous(
            a,
            new Map([
                [2, []],
                [3, []],
            ])
        );
        expect(neither.red.size).toBe(0);
        expect(neither.orphan).toEqual(["lobby"]);
    });

    it("a red surface no PR's scope reaches is an orphan, red for nobody", () => {
        const block = rowsOf(["lobby-vs-ai"]);
        const a = attributeBatch(
            walked,
            block.rows,
            block.assertRows,
            new Map([[1, ["deck-builder"]]])
        );
        expect(a.orphan).toEqual(["lobby-vs-ai"]);
        expect(a.clean).toEqual([1]);
    });
});

describe("withBatchReceipt — the PR body section", () => {
    it("appends once, then replaces in place", () => {
        const once = withBatchReceipt("Body.\n", ["x"]);
        expect(once).toContain(BATCH_RECEIPT_START);
        const twice = withBatchReceipt(once, ["y"]);
        expect(twice.split(BATCH_RECEIPT_START)).toHaveLength(2);
        expect(twice).toContain("```\ny\n```");
        expect(twice).not.toContain("```\nx\n```");
        expect(twice.trimEnd().endsWith(BATCH_RECEIPT_END)).toBe(true);
    });
});

describe("batchPassthrough — the batch IS the scope", () => {
    it("keeps run-shaping flags and refuses scope-picking ones", () => {
        expect(
            batchPassthrough([
                "--batch=1,2",
                "--parallel=2",
                "--write-receipts",
                "--no-publish",
            ])
        ).toEqual(["--parallel=2"]);
        for (const f of [
            "--all",
            "--surface=lobby",
            "--viewport=1440x900x2",
            "--base=x",
            "--scope-only",
        ]) {
            expect(() => batchPassthrough([f])).toThrow(
                /cannot ride a --batch walk/
            );
        }
    });
});

describe("skinReceiptInvalidForDiff — the landing tree's content is computed only for a BATCH paste", () => {
    const ev = batchRun(["deck-builder", "lobby"], [A, B]);
    const body = prBody(verdictDigestLines(ev));
    const scopeOf = () => ({
        kind: "scoped" as const,
        surfaces: ["deck-builder"],
    });
    const owedOf = () => ({
        owed: true as const,
        rule: "tsx",
        path: "src/a.tsx",
    });
    const restores = () => false;

    it("passes the digest through and accepts a matching head", () => {
        // `verifyReceiptText` runs on the REAL lane vocabulary here, so the
        // fixture surfaces are unknown to it: the verdict must be the
        // identity's, not the vocabulary's — assert on the identity call.
        let asked = 0;
        skinReceiptInvalidForDiff(
            ["src/a.tsx"],
            "/nowhere",
            body,
            scopeOf,
            owedOf,
            restores,
            () => {
                asked++;
                return A.dom;
            }
        );
        expect(asked).toBe(1);
    });

    it("never computes it for a body without a BATCH banner", () => {
        let asked = 0;
        skinReceiptInvalidForDiff(
            ["src/a.tsx"],
            "/nowhere",
            "check:ui: no walk owed (x)",
            scopeOf,
            owedOf,
            restores,
            () => {
                asked++;
                return A.dom;
            }
        );
        expect(asked).toBe(0);
    });
});
