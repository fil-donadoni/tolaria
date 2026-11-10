// Draft Table Audit (issue #8894, PRD #8772): what decks does the draft Bot
// actually end up with? For each seed, eight Bots draft the scope through the
// Draft Lab's pure synthetic engine (`runFullDraftLab`, seed profile layers
// only, no DB) and every seat is Auto-Built (`buildDraftLabSeatDecks`, the
// server's own `autoBuildDeck`). Each deck is measured here; the run's
// aggregate is held against declared Floors.
//
// Pure and deterministic: a function of `(scope, seeds)` and the checked-in
// catalogue, ratings and profiles. The CLI is `scripts/draft-audit.ts`. The
// per-deck report itself lives in `src/lib/limited/draftTableAudit.ts`, shared
// with the Draft Lab's Built deck view (issue #8899).
import { CURVE_MAX_BUCKET } from "../../convex/limited/botDrafter";
import { EMPTY_PROFILE_LAYERS } from "../../convex/limited/cardProfilesCore";
import {
    buildDraftLabCardProfile,
    buildDraftLabSeatDecks,
    runFullDraftLab,
    standardPackSlots,
} from "../../src/lib/limited/draftLabEngine";
import {
    auditSeatDeck,
    mean,
    type DeckAudit,
} from "../../src/lib/limited/draftTableAudit";

export {
    auditSeatDeck,
    castabilityOf,
    hypergeometricAtLeast,
    type DeckAudit,
    type SpellCastability,
} from "../../src/lib/limited/draftTableAudit";

/** Seeds a default run drafts: `1..DEFAULT_AUDIT_SEEDS`. The Floors below are
 *  measured on exactly this set; a run on another set is diagnostic. */
export const DEFAULT_AUDIT_SEEDS = 8;

// ── Run + aggregate ────────────────────────────────────────────────────────

export interface AuditAggregate {
    decks: number;
    /** Share of seats whose Auto-Build reached the format's Maindeck floor. */
    builtShare: number;
    unresolved: number;
    /** Mean over every coloured Maindeck spell of the run. */
    meanCastability: number | null;
    /** The lowest deck `meanCastability` of the run. */
    worstDeckCastability: number | null;
    meanPlanShare: number | null;
    meanCapabilityPairs: number;
    meanLandCount: number;
    meanSpellCount: number;
    /** Mean spells per `curveBucket`. */
    meanCurve: number[];
    /** Decks by colour count (`"2"`, `"3"`). */
    colourCounts: Record<string, number>;
    meanUnreviewedShare: {
        archetypes: number | null;
        capabilities: number | null;
    };
}

export interface DraftAuditRun {
    scope: string;
    seeds: number[];
    decks: DeckAudit[];
    aggregate: AuditAggregate;
}

function nonNull(values: readonly (number | null)[]): number[] {
    return values.filter((v): v is number => v !== null);
}

export function aggregateAudit(decks: readonly DeckAudit[]): AuditAggregate {
    const colourCounts: Record<string, number> = {};
    for (const d of decks) {
        const k = String(d.colors.length);
        colourCounts[k] = (colourCounts[k] ?? 0) + 1;
    }
    const deckMeans = nonNull(decks.map((d) => d.meanCastability));
    return {
        decks: decks.length,
        builtShare:
            decks.length === 0
                ? 0
                : decks.filter((d) => d.legal).length / decks.length,
        unresolved: decks.reduce((a, d) => a + d.unresolved, 0),
        meanCastability: mean(
            decks.flatMap((d) => d.castability.map((c) => c.p))
        ),
        worstDeckCastability:
            deckMeans.length === 0 ? null : Math.min(...deckMeans),
        meanPlanShare: mean(nonNull(decks.map((d) => d.planShare))),
        meanCapabilityPairs: mean(decks.map((d) => d.capabilityPairs)) ?? 0,
        meanLandCount: mean(decks.map((d) => d.landCount)) ?? 0,
        meanSpellCount: mean(decks.map((d) => d.spellCount)) ?? 0,
        meanCurve: Array.from(
            { length: CURVE_MAX_BUCKET + 1 },
            (_, b) => mean(decks.map((d) => d.curve[b])) ?? 0
        ),
        colourCounts,
        meanUnreviewedShare: {
            archetypes: mean(
                nonNull(decks.map((d) => d.unreviewedShare.archetypes))
            ),
            capabilities: mean(
                nonNull(decks.map((d) => d.unreviewedShare.capabilities))
            ),
        },
    };
}

/** Seeds `1..count`. */
export function auditSeeds(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i + 1);
}

/** Drafts and builds one table per seed and measures every seat. */
export function runDraftAudit(
    scope: string,
    seeds: readonly number[]
): DraftAuditRun {
    const packSlots = standardPackSlots(scope);
    const getCardProfile = buildDraftLabCardProfile(
        packSlots,
        EMPTY_PROFILE_LAYERS
    );
    const decks: DeckAudit[] = [];
    for (const seed of seeds) {
        const state = runFullDraftLab(seed, packSlots);
        for (const seat of buildDraftLabSeatDecks(state)) {
            decks.push(auditSeatDeck(seed, seat, getCardProfile));
        }
    }
    return {
        scope,
        seeds: [...seeds],
        decks,
        aggregate: aggregateAudit(decks),
    };
}

// ── Floors ─────────────────────────────────────────────────────────────────

/** A metric the Floors hold, read off the aggregate. Every one is "higher is
 *  better"; `null` on the aggregate (nothing to measure) breaks no Floor. */
export type FloorMetric =
    | "builtShare"
    | "meanCastability"
    | "worstDeckCastability"
    | "meanPlanShare"
    | "meanCapabilityPairs";

export type DraftAuditFloors = Partial<Record<FloorMetric, number>>;

/** Floors per scope: the baseline measured on HEAD before any build change
 *  (`docs/research/draft-table-audit-baseline.md`, `1..DEFAULT_AUDIT_SEEDS`),
 *  each rounded DOWN to two decimals so the build ships no worse. Later
 *  slices tighten them; none may loosen one without saying why. A scope with
 *  no profiles declares no plan or Capability Floor. */
export const DRAFT_AUDIT_FLOORS: Readonly<Record<string, DraftAuditFloors>> = {
    "vintage-cube": {
        builtShare: 1,
        meanCastability: 0.76,
        worstDeckCastability: 0.55,
        meanPlanShare: 0.47,
        meanCapabilityPairs: 12,
    },
    lea: {
        builtShare: 1,
        meanCastability: 0.79,
        worstDeckCastability: 0.51,
    },
};

export interface FloorVerdict {
    metric: FloorMetric;
    floor: number;
    value: number | null;
    held: boolean;
}

export function checkFloors(
    aggregate: AuditAggregate,
    floors: DraftAuditFloors
): FloorVerdict[] {
    return (Object.entries(floors) as [FloorMetric, number][]).map(
        ([metric, floor]) => {
            const value = aggregate[metric];
            return {
                metric,
                floor,
                value,
                held: value === null || value >= floor,
            };
        }
    );
}

/** The CLI's exit code: 1 when any Floor is broken, else 0 (also when the
 *  scope declares none). */
export function floorsExitCode(
    verdicts: readonly FloorVerdict[] | null
): 0 | 1 {
    return verdicts?.some((v) => !v.held) ? 1 : 0;
}

// ── Rendering ──────────────────────────────────────────────────────────────

const fmt = (v: number | null, digits = 3): string =>
    v === null ? "—" : v.toFixed(digits);

export function formatDeckLine(d: DeckAudit): string {
    const curve = d.curve.slice(1).join("/");
    return [
        `seed ${d.seed} seat ${d.seatIndex}`,
        `colours ${d.colors.join("")}`,
        `main ${d.mainSize}${d.legal ? "" : " ILLEGAL"}`,
        `lands ${d.landCount}`,
        `curve ${curve}`,
        `cast ${fmt(d.meanCastability)}`,
        `plan ${d.planArchetype ?? "—"} ${fmt(d.planShare, 2)}`,
        `pairs ${d.capabilityPairs}`,
        `unreviewed A ${fmt(d.unreviewedShare.archetypes, 2)} C ${fmt(d.unreviewedShare.capabilities, 2)}`,
    ].join(" · ");
}

export function formatAggregate(run: DraftAuditRun): string[] {
    const a = run.aggregate;
    const colours = Object.entries(a.colourCounts)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, n]) => `${k}c ${n}`)
        .join(", ");
    return [
        `scope ${run.scope} · seeds ${run.seeds[0]}..${run.seeds[run.seeds.length - 1]} (${run.seeds.length}) · decks ${a.decks}`,
        `builtShare ${fmt(a.builtShare)} · unresolved ${a.unresolved}`,
        `meanCastability ${fmt(a.meanCastability)} · worstDeckCastability ${fmt(a.worstDeckCastability)}`,
        `meanPlanShare ${fmt(a.meanPlanShare)} · meanCapabilityPairs ${fmt(a.meanCapabilityPairs, 2)}`,
        `meanLandCount ${fmt(a.meanLandCount, 2)} · meanSpellCount ${fmt(a.meanSpellCount, 2)} · colours ${colours}`,
        `meanCurve (MV 1..${CURVE_MAX_BUCKET}+) ${a.meanCurve
            .slice(1)
            .map((v) => v.toFixed(2))
            .join(" / ")}`,
        `meanUnreviewedShare archetypes ${fmt(a.meanUnreviewedShare.archetypes)} · capabilities ${fmt(a.meanUnreviewedShare.capabilities)}`,
    ];
}

export function formatVerdict(
    scope: string,
    verdicts: readonly FloorVerdict[] | null
): string[] {
    if (verdicts === null) return [`floors: none declared for ${scope}`];
    const broken = verdicts.filter((v) => !v.held);
    return [
        ...verdicts.map(
            (v) =>
                `floor ${v.metric} ≥ ${v.floor}: ${fmt(v.value)} ${v.held ? "held" : "BROKEN"}`
        ),
        broken.length === 0
            ? "floors: PASS"
            : `floors: FAIL (${broken.map((v) => v.metric).join(", ")})`,
    ];
}
