/**
 * THE BATCH RECEIPT (issue #9106) — one `check:ui` walk for several UI PRs,
 * a red attributed to the PR that caused it. Pure: no git, no browser, no gh.
 * The orchestration that builds the merged tree and walks it is
 * `batch-run.ts`; the receipt it prints is `receipt.ts`'s, with this banner.
 *
 * WHY A SCOPED RECEIPT CANNOT BE SHARED. `verify-receipt.ts` re-derives the
 * verdict block from the PR's OWN diff scope and refuses a cell outside it, so
 * a walk of PRs A+B (scope A ∪ B) is refused by both unless they reach exactly
 * the same surfaces.
 *
 * WHAT A BATCH RECEIPT CLAIMS. "The tree base + every named head, merged, held
 * every Floor and every Named Assertion on these surfaces." A PR may land on
 * it when (a) its own re-derived scope is a subset of the banner's surfaces and
 * (b) it IS one of the named heads.
 *
 * IDENTITY IS BY CONTENT, NOT BY SHA. A head sha would be wrong twice: `land:ready`'s
 * preflight rebases a PR that is behind (new sha, same change), and the
 * `pr-check` runner checks out the merge ref, whose HEAD is no head at all.
 * What the walk proved is the CONTENT of the PR's DOM-reachable paths, so that
 * is what the banner names: `domDigest` — SHA-256 over each such path and its
 * blob id at the head (`-` for a deletion). The verifier computes the same
 * digest over the landing tree; a rebase that left those files alone verifies,
 * one that changed any of them (a conflict resolution, a base change to the
 * same file) does not, and the PR walks again — fail closed. The sha stays on
 * the banner for the reader.
 */
import { createHash } from "node:crypto";
import type { AssertRow, ResultRow } from "./receipt.ts";

/** One PR merged into the walked tree. */
export interface BatchHead {
    pr: number;
    /** The head commit merged — informational, never compared. */
    sha: string;
    /** `domDigest` of the PR's DOM-reachable changed paths at `sha`. */
    dom: string;
}

/** Characters of a sha / digest the banner prints. 16 hex = 64 bits: a
 *  collision needs a deliberate attack on a receipt nobody profits from. */
export const BATCH_ID_LENGTH = 16;

/** One DOM-reachable path of a PR and its blob id at the head; `null` for a
 *  path the head deletes. */
export interface DomEntry {
    path: string;
    blob: string | null;
}

/**
 * The content identity of a PR's DOM-reachable change: SHA-256 over
 * `path\0blob` lines, sorted by path, truncated to `BATCH_ID_LENGTH`. An empty
 * list has a digest too — a PR whose diff reaches no DOM path never owes a
 * walk, but the function stays total.
 */
export function domDigest(entries: readonly DomEntry[]): string {
    const lines = [...entries]
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((e) => `${e.path}\0${e.blob ?? "-"}`);
    return createHash("sha256")
        .update(lines.join("\n"))
        .digest("hex")
        .slice(0, BATCH_ID_LENGTH);
}

/** `#9071@<sha16>~<dom16>` — the banner's spelling of one head. */
export function formatBatchHead(h: BatchHead): string {
    return `#${h.pr}@${h.sha.slice(0, BATCH_ID_LENGTH)}~${h.dom}`;
}

/** The inverse of `formatBatchHead`, or `null`. */
export function parseBatchHead(token: string): BatchHead | null {
    const m = /^#(\d+)@([0-9a-f]{7,40})~([0-9a-f]{16})$/.exec(token);
    if (!m) return null;
    return { pr: Number(m[1]), sha: m[2], dom: m[3] };
}

/** The `--batch-heads=` flag value `batch-run.ts` hands the walk: comma-joined
 *  heads in `formatBatchHead`'s spelling. */
export function parseBatchHeadsFlag(value: string): BatchHead[] {
    const tokens = value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    const heads = tokens.map(parseBatchHead);
    const bad = tokens.filter((_, i) => heads[i] === null);
    if (bad.length > 0 || heads.length === 0) {
        throw new Error(
            `--batch-heads= takes #<pr>@<sha>~<dom16>[,…]; could not read ${bad.join(", ") || "an empty list"}`
        );
    }
    return heads as BatchHead[];
}

/** The banner's head list, as printed: `heads #A@… #B@…`. */
export function batchHeadsText(heads: readonly BatchHead[]): string {
    return heads.map(formatBatchHead).join(" ");
}

/** What a pasted `BATCH —` banner names. Parsed, never trusted beyond the two
 *  checks `verify-receipt.ts` makes against it (scope ⊆ surfaces, a matching
 *  head); everything else is re-rendered and compared. */
export interface ParsedBatchBanner {
    base: string;
    heads: BatchHead[];
    surfaces: string[];
}

/**
 * Parse `BATCH — base <ref>, heads <h> <h>…, N surface(s) in scope: a, b (…)`.
 * The surfaces list ends at ` (` — the counts suffix `receiptKindLine` appends.
 */
export function parseBatchBanner(line: string): ParsedBatchBanner | null {
    const m =
        /^BATCH — base (\S+), heads ((?:#\d+@[0-9a-f]+~[0-9a-f]+ ?)+), (\d+) surface\(s\) in scope: (.+?) \(\d+ measured, \d+ declared unwalked\)$/.exec(
            line
        );
    if (!m) return null;
    const heads = m[2].trim().split(" ").map(parseBatchHead);
    if (heads.some((h) => h === null)) return null;
    const surfaces = m[4].split(", ").filter(Boolean);
    if (surfaces.length !== Number(m[3])) return null;
    return { base: m[1], heads: heads as BatchHead[], surfaces };
}

// ─────────────────────────────────────────────────────────────────────────────
// Attribution on red
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchAttribution {
    /** The walked scope's surfaces with no red line in this run, in the
     *  scope's order — a declared-unwalked surface has no line and counts as
     *  passed, exactly as a SCOPED receipt counts it. */
    passSurfaces: string[];
    /** PRs whose whole scope passed: they get the batch receipt. */
    clean: number[];
    /** PRs a red surface belongs to ALONE, with that surface's red lines. */
    red: Map<number, string[]>;
    /** A red surface several PRs reach: re-walk it on each candidate alone. */
    ambiguous: { surface: string; candidates: number[] }[];
    /** A red surface NO PR's own scope reaches — the merge itself (two
     *  changes that only break together), or a surface the union scope adds
     *  through `surfaces.ts`. Every PR in the batch stays unproven on it. */
    orphan: string[];
}

/**
 * Which PR each red surface belongs to. `walked` is the batch's scope (the
 * banner's surfaces). A surface is red when any of its
 * rows or assertion lines is not `PASS`; a PR is clean when no surface of
 * its own scope is red. A red surface reached by one PR reds that PR; by
 * several, it is ambiguous until a solo re-walk settles it; by none, it is
 * an orphan, and an orphan reds nobody but proves nothing either — it is
 * reported, and the PRs it does not touch still land.
 */
export function attributeBatch(
    walked: readonly string[],
    rows: readonly ResultRow[],
    assertRows: readonly AssertRow[],
    scopes: ReadonlyMap<number, readonly string[]>
): BatchAttribution {
    const redLines = new Map<string, string[]>();
    const push = (surface: string, line: string) => {
        const list = redLines.get(surface) ?? [];
        list.push(line);
        redLines.set(surface, list);
    };
    for (const r of rows) {
        if (r.verdict !== "PASS") {
            push(
                r.surface,
                `${r.verdict} ${r.surface} @ ${r.viewport ?? "—"}: ${r.detail}`
            );
        }
    }
    for (const a of assertRows) {
        if (a.verdict !== "PASS") {
            push(
                a.surface,
                `FAIL ${a.surface} @ ${a.viewport}: assertion ${JSON.stringify(a.label)}`
            );
        }
    }
    const passSurfaces = walked.filter((s) => !redLines.has(s));

    const red = new Map<number, string[]>();
    const ambiguous: BatchAttribution["ambiguous"] = [];
    const orphan: string[] = [];
    for (const [surface, lines] of redLines) {
        const candidates = [...scopes]
            .filter(([, s]) => s.includes(surface))
            .map(([pr]) => pr);
        if (candidates.length === 0) orphan.push(surface);
        else if (candidates.length === 1) {
            red.set(candidates[0], [
                ...(red.get(candidates[0]) ?? []),
                ...lines,
            ]);
        } else ambiguous.push({ surface, candidates });
    }
    const pass = new Set(passSurfaces);
    const clean = [...scopes]
        .filter(([, s]) => s.every((surface) => pass.has(surface)))
        .map(([pr]) => pr);
    return { passSurfaces, clean, red, ambiguous, orphan };
}

/**
 * Settle the ambiguous surfaces with the solo re-walks: `solo` maps each
 * candidate PR to the surfaces that went red when it was walked alone. A
 * candidate red alone owns the surface; a surface red in the batch and green
 * on every candidate alone is an orphan — it breaks only in combination.
 */
export function settleAmbiguous(
    attribution: BatchAttribution,
    solo: ReadonlyMap<number, readonly string[]>
): BatchAttribution {
    const red = new Map(attribution.red);
    const orphan = [...attribution.orphan];
    for (const { surface, candidates } of attribution.ambiguous) {
        const owners = candidates.filter((pr) =>
            (solo.get(pr) ?? []).includes(surface)
        );
        if (owners.length === 0) {
            orphan.push(surface);
            continue;
        }
        for (const pr of owners) {
            red.set(pr, [
                ...(red.get(pr) ?? []),
                `${surface}: red when #${pr} was walked alone`,
            ]);
        }
    }
    return { ...attribution, red, ambiguous: [], orphan };
}

// ─────────────────────────────────────────────────────────────────────────────
// The PR body section
// ─────────────────────────────────────────────────────────────────────────────

export const BATCH_RECEIPT_START = "<!-- check:ui batch receipt -->";
export const BATCH_RECEIPT_END = "<!-- /check:ui batch receipt -->";

/**
 * `body` with the batch receipt section set to `lines` — replaced when the
 * markers are there, appended otherwise. The verifier reads the section in
 * preference to any other banner in the body (`verify-receipt.ts`
 * `extractVerdictBlock`), so an older single-PR paste above it is inert.
 */
export function withBatchReceipt(
    body: string,
    lines: readonly string[]
): string {
    const section = [
        BATCH_RECEIPT_START,
        "```",
        ...lines,
        "```",
        BATCH_RECEIPT_END,
    ].join("\n");
    const start = body.indexOf(BATCH_RECEIPT_START);
    const end = body.indexOf(BATCH_RECEIPT_END);
    if (start !== -1 && end > start) {
        return (
            body.slice(0, start) +
            section +
            body.slice(end + BATCH_RECEIPT_END.length)
        );
    }
    return `${body.replace(/\s*$/, "")}\n\n${section}\n`;
}

/** The part of `body` the verifier reads: the batch receipt section when the
 *  markers hold one, else the whole body. */
export function receiptRegion(body: string): string {
    const start = body.indexOf(BATCH_RECEIPT_START);
    const end = body.indexOf(BATCH_RECEIPT_END);
    if (start === -1 || end <= start) return body;
    return body.slice(start + BATCH_RECEIPT_START.length, end);
}
