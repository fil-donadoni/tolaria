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
    formatPlans,
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
    /** The lowest deck `meanCastability` of the run — reported; a single
     *  deck moves with any change to the picks, so the Floor reads the tail
     *  through `p5DeckCastability` where a scope declares it. */
    worstDeckCastability: number | null;
    /** The 5th percentile of deck `meanCastability` (nearest rank, the
     *  `⌊0.05 × (n − 1)⌋`-th lowest): the bottom tail of the table, robust to
     *  one unlucky seat (issue #9348). */
    p5DeckCastability: number | null;
    meanPlanShare: number | null;
    meanCapabilityPairs: number;
    meanLandCount: number;
    meanSpellCount: number;
    /** Mean spells per `curveBucket`. */
    meanCurve: number[];
    /** Decks by colour count (`"1"` … `"5"`). */
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
    /** Mean Maindeck spells with a pip outside the deck's colours (issue
     *  #9336), report only. */
    meanOffColourSpells: number;
    /** Decks by off-colour spell count (`"0"`, `"1"`, `"2"`, `"3+"`). */
    offColourSpellDecks: Record<string, number>;
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

/** The bucket an off-colour spell count reports under: its count, three and
 *  more together. */
const OFF_COLOUR_SPELLS_TOP_BUCKET = 3;

function offColourSpellDecks(
    decks: readonly DeckAudit[]
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const d of decks) {
        const k =
            d.offColourSpells >= OFF_COLOUR_SPELLS_TOP_BUCKET
                ? `${OFF_COLOUR_SPELLS_TOP_BUCKET}+`
                : String(d.offColourSpells);
        counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
}

/** Nearest-rank percentile: the `⌊q × (n − 1)⌋`-th lowest value. */
function percentile(values: readonly number[], q: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(q * (sorted.length - 1))];
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
        p5DeckCastability: percentile(deckMeans, 0.05),
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
        meanOffColourSpells: mean(decks.map((d) => d.offColourSpells)) ?? 0,
        offColourSpellDecks: offColourSpellDecks(decks),
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
    | "p5DeckCastability"
    | "meanPlanShare"
    | "meanCapabilityPairs";

export type DraftAuditFloors = Partial<Record<FloorMetric, number>>;

/** Floors per scope, rounded DOWN to two decimals from a measured run on
 *  `1..DEFAULT_AUDIT_SEEDS`. First set from the baseline before any build
 *  change (`docs/research/draft-table-audit-baseline.md`), then re-set after
 *  each build change measured in `docs/research/draft-table-audit-*.md`
 *  (build fixes, plan-first, castable value): tightened where the
 *  build improved, loosened where it traded against the metric — each
 *  loosening says why below. None may loosen without saying why. A scope
 *  with no profiles declares no plan or Capability Floor. */
export const DRAFT_AUDIT_FLOORS: Readonly<Record<string, DraftAuditFloors>> = {
    "vintage-cube": {
        builtShare: 1,
        // Tightened 0.86 → 0.88 by the castable-value colour choice (issue
        // #9336, `docs/research/draft-table-audit-castable-value.md`).
        meanCastability: 0.88,
        // The tail is held at the 5th percentile, not the worst deck (issue
        // #9348): one seat of 64 moves with any change to the picks, and the
        // worst-deck Floor moved four times in two days for single decks
        // (issues #9334, #9369, #9323). Set from the deck-aware fetch build,
        // 0.777 rounded down; the worst deck is reported beside it.
        // Loosened 0.77 → 0.76 (issue #9321): the base itself read 0.769 on
        // seeds 1..8 once PR #9516 landed after PR #9357; over 64
        // seeds p5 is 0.783 and seeds 1..8 are the lowest block but one.
        // Tightened 0.76 → 0.79 by the castable-value colour choice (issue
        // #9336): 0.767 → 0.793 on seeds 1..8.
        // Loosened 0.79 → 0.77 by the soft plan weights (issue #9356): over
        // 64 seeds p5 does not move (0.806 → 0.807), but seeds 1..8 become
        // the lowest of eight blocks (0.793 → 0.776; median 0.809).
        p5DeckCastability: 0.77,
        // Plan share counts a spell carrying ANY Archetype the Pool is
        // committed to (the soft plan weights, issue #9356). Seeds 1..8 are
        // often the lowest block of eight, so the Floor is that run rounded
        // down and each move is measured over 64 seeds in
        // docs/research/draft-table-audit-floor-noise.md: 0.69 after the
        // `lands-in-graveyard` Capability (0.699 on seeds 1..8, 0.728 over
        // 64; issue #9322).
        meanPlanShare: 0.69,
        meanCapabilityPairs: 16.71,
    },
    lea: {
        builtShare: 1,
        // Loosened 0.79 → 0.76 and 0.51 → 0.49: the land count now follows
        // the curve and LEA's low curve plays 16 lands, not 17. The
        // castability model counts sources and not land drops, so one land
        // fewer always reads lower; it cannot see the spell it buys.
        // Loosened 0.76 → 0.75 when the model began counting a source that
        // sacrifices itself for mana as half a source (issue #9337): Black
        // Lotus is LEA's one (0.761 → 0.7596 on seeds 1..8; 0.765 → 0.764
        // over 64 seeds at one meter).
        // Tightened 0.75 → 0.77 and 0.49 → 0.57 by the castable-value
        // colour choice (issue #9336): a deck no longer maindecks spells its
        // colours cannot pay; it splashes them or names their colour
        // (0.760 → 0.770, worst 0.492 → 0.576 on seeds 1..8).
        meanCastability: 0.77,
        worstDeckCastability: 0.57,
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
        `offSpells ${d.offColourSpells}`,
        `plan ${formatPlans(d.planArchetypes)} ${fmt(d.planShare, 2)}`,
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
        `meanCastability ${fmt(a.meanCastability)} · worstDeckCastability ${fmt(a.worstDeckCastability)} · p5DeckCastability ${fmt(a.p5DeckCastability)}`,
        `meanPlanShare ${fmt(a.meanPlanShare)} · meanCapabilityPairs ${fmt(a.meanCapabilityPairs, 2)}`,
        `meanLandCount ${fmt(a.meanLandCount, 2)} · meanSpellCount ${fmt(a.meanSpellCount, 2)} · colours ${colours}`,
        `meanCurve (MV 1..${CURVE_MAX_BUCKET}+) ${a.meanCurve
            .slice(1)
            .map((v) => v.toFixed(2))
            .join(" / ")}`,
        `meanUnreviewedShare archetypes ${fmt(a.meanUnreviewedShare.archetypes)} · capabilities ${fmt(a.meanUnreviewedShare.capabilities)}`,
        `earlyCastability (MV ≤ ${EARLY_MANA_VALUE}) ${fmt(a.earlyCastability)} · earlyBelowShare ${fmt(a.earlyBelowShare)}${earlyByColours ? ` (${earlyByColours})` : ""}`,
        `meanOffColourSpells ${fmt(a.meanOffColourSpells, 2)} · offColourSpellDecks ${Object.entries(
            a.offColourSpellDecks
        )
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([k, n]) => `${k} ${n}`)
            .join(", ")}`,
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
