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
import { createHash } from "node:crypto";
import { CURVE_MAX_BUCKET } from "../../convex/limited/botDrafter";
import { EMPTY_PROFILE_LAYERS } from "../../convex/limited/cardProfilesCore";
import { archetypeScopeShareForPackSlots } from "../../convex/limited/planArchetype";
import {
    buildDraftLabCardProfile,
    buildDraftLabSeatDecks,
    runFullDraftLab,
    standardPackSlots,
} from "../../src/lib/limited/draftLabEngine";
import {
    auditSeatDeck,
    EARLY_MANA_VALUE,
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
    /** Colour coherence (issue #9335), report only — no Floor reads these.
     *  Mean over every early spell of the run (`DeckAudit.earlyCastability`). */
    earlyCastability: number | null;
    /** Share of the run's early spells below `EARLY_CASTABILITY_THRESHOLD`. */
    earlyBelowShare: number | null;
    /** `earlyBelowShare` by deck colour count, keyed like `colourCounts`. */
    earlyBelowShareByColours: Record<string, number | null>;
    /** Decks with a splash colour (`DeckAudit.splash` non-null). */
    splashDecks: number;
    /** Mean splash cards per splashing deck. */
    meanSplashCards: number | null;
    /** Share of the run's splash cards that are strained. */
    splashStrainedShare: number | null;
    meanOffColourDuals: number;
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

function earlyBelowShare(decks: readonly DeckAudit[]): number | null {
    const spells = decks.reduce((a, d) => a + d.earlyCastability.spells, 0);
    return spells === 0
        ? null
        : decks.reduce((a, d) => a + d.earlyCastability.below, 0) / spells;
}

export function aggregateAudit(decks: readonly DeckAudit[]): AuditAggregate {
    const colourCounts: Record<string, number> = {};
    for (const d of decks) {
        const k = String(d.colors.length);
        colourCounts[k] = (colourCounts[k] ?? 0) + 1;
    }
    const deckMeans = nonNull(decks.map((d) => d.meanCastability));
    const splashes = decks.flatMap((d) => (d.splash ? [d.splash] : []));
    const splashCards = splashes.reduce((a, s) => a + s.cards, 0);
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
        earlyCastability: mean(
            decks.flatMap((d) =>
                d.castability
                    .filter((c) => c.manaValue <= EARLY_MANA_VALUE)
                    .map((c) => c.p)
            )
        ),
        earlyBelowShare: earlyBelowShare(decks),
        earlyBelowShareByColours: Object.fromEntries(
            Object.keys(colourCounts).map((k) => [
                k,
                earlyBelowShare(
                    decks.filter((d) => String(d.colors.length) === k)
                ),
            ])
        ),
        splashDecks: splashes.length,
        meanSplashCards: mean(splashes.map((s) => s.cards)),
        splashStrainedShare:
            splashCards === 0
                ? null
                : splashes.reduce((a, s) => a + s.strained, 0) / splashCards,
        meanOffColourDuals: mean(decks.map((d) => d.offColourDuals)) ?? 0,
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
    // `runFullDraftLab` snapshots no DB profile rows, so the build reads the
    // same seed-only profiles this share is computed from.
    const scopeShare = archetypeScopeShareForPackSlots(
        packSlots,
        getCardProfile
    );
    const decks: DeckAudit[] = [];
    for (const seed of seeds) {
        const state = runFullDraftLab(seed, packSlots);
        for (const seat of buildDraftLabSeatDecks(state)) {
            decks.push(auditSeatDeck(seed, seat, getCardProfile, scopeShare));
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

/** Floors per scope, rounded DOWN to two decimals from a measured run on
 *  `1..DEFAULT_AUDIT_SEEDS`. First set from the baseline before any build
 *  change (`docs/research/draft-table-audit-baseline.md`), then re-set after
 *  the Auto-Build fixes of issue #8897
 *  (`docs/research/draft-table-audit-build-fixes.md`), then after the
 *  plan-first build of issue #8898
 *  (`docs/research/draft-table-audit-plan-first.md`): tightened where the
 *  build improved, loosened where it traded against the metric — each
 *  loosening says why below. None may loosen without saying why. A scope
 *  with no profiles declares no plan or Capability Floor. */
export const DRAFT_AUDIT_FLOORS: Readonly<Record<string, DraftAuditFloors>> = {
    "vintage-cube": {
        builtShare: 1,
        meanCastability: 0.86,
        // Loosened 0.77 → 0.76 after fetch lands became sources (issue
        // #9334, issue #9369). The new Fixing Value changes every pick, so
        // all eight tables are drafted again. The worst of 64 decks is one
        // seat's draw: across eight blocks of eight seeds it spans
        // 0.58–0.79 on trees whose mean castability is equal. On the old
        // tree, seeds 1..8 were the best block of the eight (0.772, median
        // 0.730). The 64-seed mean is unchanged (0.864 → 0.865), and so is
        // the 5th percentile. Only the last percent thickens, and that comes
        // from the scope-relative plan
        // (docs/research/draft-table-audit-floor-noise.md).
        worstDeckCastability: 0.76,
        // The plan-first build raised it past the baseline's 0.47.
        // Loosened 0.52 → 0.50 by the scope-relative plan (issue #9298):
        // control is the plan of 18 seats (was 38) and six plans are built.
        // Plan share counts spells carrying the plan's tag, so a narrower
        // plan reads a plan-neutral card (cheap removal) as off-plan and
        // lowers it by construction (0.526 → 0.505).
        // Loosened 0.50 → 0.48 once both changes were on one tree (issue
        // #9369): over 64 seeds, fetch lands leave the share where it was
        // (0.512 → 0.513), but seeds 1..8 are now the lowest of eight
        // blocks (0.482; median 0.515).
        meanPlanShare: 0.48,
        meanCapabilityPairs: 16.71,
    },
    lea: {
        builtShare: 1,
        // Loosened 0.79 → 0.76 and 0.51 → 0.49: the land count now follows
        // the curve and LEA's low curve plays 16 lands, not 17. The
        // castability model counts sources and not land drops, so one land
        // fewer always reads lower; it cannot see the spell it buys.
        meanCastability: 0.76,
        worstDeckCastability: 0.49,
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
        `early ${fmt(d.earlyCastability.mean)} (${d.earlyCastability.below}/${d.earlyCastability.spells} low)`,
        `splash ${d.splash ? `${d.splash.cards} (${d.splash.strained} strained)` : "—"}`,
        `offDuals ${d.offColourDuals}`,
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
    const earlyByColours = Object.entries(a.earlyBelowShareByColours)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => `${k}c ${fmt(v)}`)
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
        `earlyCastability (MV ≤ ${EARLY_MANA_VALUE}) ${fmt(a.earlyCastability)} · earlyBelowShare ${fmt(a.earlyBelowShare)}${earlyByColours ? ` (${earlyByColours})` : ""}`,
        `splashDecks ${a.splashDecks} · meanSplashCards ${fmt(a.meanSplashCards, 2)} · splashStrainedShare ${fmt(a.splashStrainedShare)} · meanOffColourDuals ${fmt(a.meanOffColourDuals, 2)}`,
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

// ── Receipt (issue #8895) ──────────────────────────────────────────────────

/** The text a receipt digest covers: the aggregate and verdict lines, never
 *  the sha or the wall-clock, so a re-run on the same tree digests the same. */
export function receiptDigest(
    run: DraftAuditRun,
    verdicts: readonly FloorVerdict[] | null
): string {
    const text = [
        ...formatAggregate(run),
        ...formatVerdict(run.scope, verdicts),
    ]
        .join("\n")
        .normalize("NFC");
    return createHash("sha256").update(text).digest("hex");
}

/** The one line a PR body carries per scope (`land:ready` re-derives it):
 *  `draft:audit: <scope> seeds 1..8 floors: PASS sha256:<hex>`. `floors` is
 *  `none` when the scope declares no Floor. */
export function formatReceiptLine(
    run: DraftAuditRun,
    verdicts: readonly FloorVerdict[] | null
): string {
    const state =
        verdicts === null
            ? "none"
            : floorsExitCode(verdicts) === 0
              ? "PASS"
              : "FAIL";
    return `draft:audit: ${run.scope} seeds ${run.seeds[0]}..${run.seeds[run.seeds.length - 1]} floors: ${state} sha256:${receiptDigest(run, verdicts)}`;
}
