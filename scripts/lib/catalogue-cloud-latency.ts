/**
 * The pure half of `scripts/perf-catalogue-cloud.ts` (issue #4167, PRD issue
 * #4161, ADR 0113 Amendment III): who the script may target, when it may
 * print a verdict, the synthetic catalogue it packs and the statistics it
 * reports. Everything here is a function of its arguments — no network, no
 * child process — so the refusals are testable without a deployment.
 */
import type { CardDefinition } from "../../convex/cards/types";

/** The budget ADR 0113 Amendment III § Decision 5 fixes: added CPU per
 *  mutation attributable to the catalogue, measured on cloud. */
export const CATALOGUE_LATENCY_BUDGET_MS = 100;

/** The block sizes the sweep measures when the operator names none. */
export const DEFAULT_SWEEP_BLOCK_ROWS: readonly number[] = [8, 16, 32, 64];

/** The scale the sweep measures at — the catalogue the compiler is heading
 *  for (~35k Oracle cards). */
export const DEFAULT_SYNTHETIC_ROWS = 35_000;

/** How many distinct definitions a "deck" asks for: the spike's 76 — a
 *  60-card deck plus sideboard, plus the opponent's distinct cards, each in
 *  its own block because ids are UUIDs. */
export const DEFAULT_DECK_DEFINITIONS = 76;

const DEPLOYMENT_NAME = /^dev:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Why `deployment` may not be pushed to, or `null` when it may. The script
 * pushes with `convex dev`, and only to a deployment NAMED `dev:<name>`: a
 * `prod:` / `preview:` / `local:` selector, a bare name (which the CLI may
 * resolve to anything) or a deploy key is refused before a byte leaves.
 * `forbidden` holds the deployments the repository itself is configured
 * against — the measurement harness replaces every function on its target,
 * so it never lands on one the app runs on.
 */
export function deploymentRefusal(
    deployment: string,
    forbidden: readonly string[]
): string | null {
    if (!DEPLOYMENT_NAME.test(deployment)) {
        return (
            `refusing ${JSON.stringify(deployment)}: name a throwaway CLOUD dev deployment as ` +
            "`dev:<name>` (never prod:, preview:, local: or a deploy key)"
        );
    }
    if (forbidden.includes(deployment)) {
        return (
            `refusing ${deployment}: the repository's own env files target it — ` +
            "the harness replaces every function there; create a throwaway project"
        );
    }
    return null;
}

/**
 * Why a measurement taken against `cloudUrl` is not a verdict, or `null` when
 * it is. `cloudUrl` is what the DEPLOYMENT reports as its own
 * `CONVEX_CLOUD_URL` from inside the harness, not what the operator typed: a
 * local backend or a self-hosted one answers with its own address, and only
 * Convex cloud CPU is what a player feels (cloud measured ~2x slower than the
 * dev machine, ADR 0113 Amendment III).
 */
export function verdictRefusal(cloudUrl: string | undefined): string | null {
    let parsed: URL;
    try {
        parsed = new URL(cloudUrl ?? "");
    } catch {
        return `no verdict: the deployment reported ${JSON.stringify(cloudUrl)} as its URL`;
    }
    if (
        parsed.protocol !== "https:" ||
        !parsed.hostname.endsWith(".convex.cloud")
    ) {
        return (
            `no verdict: ${parsed.origin} is not Convex cloud — a local or self-hosted ` +
            "backend's CPU is not what a player feels"
        );
    }
    return null;
}

/**
 * The catalogue at `target` rows, built from the real rows: each copy past
 * the first rewrites the id's leading byte (still a lowercase UUID, so the
 * packed lookup accepts it) and suffixes the name, so ids and names stay
 * unique — the name index and the dictionary see a catalogue's variety, not
 * one row repeated. Returned sorted by id in code-point order, the order the
 * packer requires.
 */
export function synthesizeRows(
    rows: readonly CardDefinition[],
    target: number
): CardDefinition[] {
    if (rows.length === 0) throw new Error("no rows to synthesize from");
    const out: CardDefinition[] = [];
    const seen = new Set<string>();
    for (let copy = 0; out.length < target && copy < 256; copy++) {
        for (const row of rows) {
            if (out.length >= target) break;
            const id =
                copy === 0
                    ? row.id
                    : copy.toString(16).padStart(2, "0") + row.id.slice(2);
            if (seen.has(id)) continue;
            seen.add(id);
            out.push(
                copy === 0 ? row : { ...row, id, name: `${row.name} ~${copy}` }
            );
        }
    }
    if (out.length < target) {
        throw new Error(`could only synthesize ${out.length} unique rows`);
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** `count` ids spread evenly across the sorted rows — at 35k rows and any
 *  swept block size each lands in its own block, as a real deck's UUIDs do. */
export function deckIds(
    rows: readonly CardDefinition[],
    count: number
): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
        ids.push(rows[Math.floor(((i + 0.5) * rows.length) / count)]!.id);
    }
    return ids;
}

/** The `q`-quantile of `values` (nearest rank). */
export function quantile(values: readonly number[], q: number): number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(q * sorted.length) - 1)
    );
    return sorted[rank]!;
}

export interface CaseSummary {
    /** What the case asks the catalogue for. */
    readonly label: string;
    /** Median of the per-round differences from the empty mutation, ms. */
    readonly medianMs: number;
    /** p90 of the same differences, ms. */
    readonly p90Ms: number;
}

/**
 * Median and p90 of `case − empty`, paired per round: both calls of a round
 * share the network's mood, so the round trip (~124 ms on the spike's link)
 * cancels and only what the catalogue added remains.
 */
export function summarizeCase(
    label: string,
    caseMs: readonly number[],
    emptyMs: readonly number[]
): CaseSummary {
    if (caseMs.length !== emptyMs.length) {
        throw new Error(
            `${label}: ${caseMs.length} samples against ${emptyMs.length} empty ones`
        );
    }
    const diffs = caseMs.map((ms, i) => ms - emptyMs[i]!);
    return {
        label,
        medianMs: quantile(diffs, 0.5),
        p90Ms: quantile(diffs, 0.9),
    };
}

/** PASS when every case's MEDIAN added latency is within the budget — the
 *  median is the budget's unit (ADR 0113 Amendment III measured medians); the
 *  p90 is reported beside it, not judged. */
export function catalogueVerdict(
    cases: readonly CaseSummary[],
    budgetMs: number = CATALOGUE_LATENCY_BUDGET_MS
): "PASS" | "FAIL" {
    return cases.every((c) => c.medianMs <= budgetMs) ? "PASS" : "FAIL";
}
