// Draft Table Audit (issue #8894, PRD #8772): what decks does the draft Bot
// actually end up with? For each seed, eight Bots draft the scope through the
// Draft Lab's pure synthetic engine (`runFullDraftLab`, seed profile layers
// only, no DB) and every seat is Auto-Built (`buildDraftLabSeatDecks`, the
// server's own `autoBuildDeck`). Each deck is measured here; the run's
// aggregate is held against declared Floors.
//
// Pure and deterministic: a function of `(scope, seeds)` and the checked-in
// catalogue, ratings and profiles. The CLI is `scripts/draft-audit.ts`.
import { FORMAT_RULES } from "../../convex/formats";
import type { Color } from "../../convex/cards/types";
import type { AutoBuildCardMeta } from "../../convex/limited/autoBuild";
import {
    curveBucket,
    CURVE_MAX_BUCKET,
    sourceCountsByColor,
} from "../../convex/limited/botDrafter";
import {
    EMPTY_PROFILE_LAYERS,
    type CardProfile,
    type GetCardProfile,
} from "../../convex/limited/cardProfilesCore";
import {
    buildDraftLabCardProfile,
    buildDraftLabSeatDecks,
    runFullDraftLab,
    standardPackSlots,
    type DraftLabSeatDeck,
} from "../../src/lib/limited/draftLabEngine";
import { draftLabGetAutoBuildCardMeta } from "../../src/lib/limited/draftLabCardMeta";

/** Seeds a default run drafts: `1..DEFAULT_AUDIT_SEEDS`. The Floors below are
 *  measured on exactly this set; a run on another set is diagnostic. */
export const DEFAULT_AUDIT_SEEDS = 8;

/** Opening hand size, the first of the cards seen by a turn (castability). */
const OPENING_HAND = 7;

const TRUE_COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];

// ── Castability model ──────────────────────────────────────────────────────

/** `P(X ≥ atLeast)` for `X ~ Hypergeometric(population, successes, draws)`. */
export function hypergeometricAtLeast(
    population: number,
    successes: number,
    draws: number,
    atLeast: number
): number {
    if (atLeast <= 0) return 1;
    const n = Math.min(draws, population);
    if (successes < atLeast || n < atLeast) return 0;
    const lnC = (a: number, b: number): number => {
        let s = 0;
        for (let i = 0; i < b; i++) s += Math.log(a - i) - Math.log(i + 1);
        return s;
    };
    const failures = population - successes;
    let below = 0;
    for (let k = Math.max(0, n - failures); k < atLeast; k++) {
        below += Math.exp(
            lnC(successes, k) + lnC(failures, n - k) - lnC(population, n)
        );
    }
    return Math.max(0, Math.min(1, 1 - below));
}

/** The declared castability model. A spell of mana value `mv` is cast on the
 *  play on turn `max(1, mv)`, having seen `7 + turn − 1` cards of the
 *  Maindeck. For each coloured pip colour `c` it needs `pips[c]` sources of
 *  `c` among those cards, where a source is any OTHER Maindeck card that
 *  produces `c` (`producedColors`: lands, Moxen, mana creatures alike). The
 *  colours are treated as independent hypergeometric draws and multiplied.
 *
 *  Not modelled, deliberately: the generic part of the cost and the total land
 *  drop (a "pays its pips" measure, not a "cast on curve" one), a dual paying
 *  only one pip at a time, colourless `{C}` pips, mulligans, the draw on the
 *  draw. A spell with no coloured pip is excluded from every mean (it is
 *  castable by this model whatever the mana base). */
export function castabilityOf(
    spell: AutoBuildCardMeta,
    deck: readonly AutoBuildCardMeta[],
    spellIndex: number
): number {
    const others = deck.filter((_, i) => i !== spellIndex);
    const sources = sourceCountsByColor(others);
    const draws = OPENING_HAND + Math.max(1, Math.round(spell.manaValue)) - 1;
    let p = 1;
    for (const c of TRUE_COLORS) {
        const pips = spell.pips[c] ?? 0;
        if (pips <= 0) continue;
        p *= hypergeometricAtLeast(deck.length, sources[c] ?? 0, draws, pips);
    }
    return p;
}

function hasColouredPip(meta: AutoBuildCardMeta): boolean {
    return TRUE_COLORS.some((c) => (meta.pips[c] ?? 0) > 0);
}

// ── Per-deck report ────────────────────────────────────────────────────────

export interface SpellCastability {
    cardId: string;
    manaValue: number;
    p: number;
}

export interface DeckAudit {
    seed: number;
    seatIndex: number;
    colors: readonly string[];
    mainSize: number;
    /** `mainSize ≥ FORMAT_RULES.limited.minMain`. */
    legal: boolean;
    landCount: number;
    spellCount: number;
    /** Maindeck cards no registry entry resolves — 0 on a sound catalogue. */
    unresolved: number;
    /** Spell count per `curveBucket` (index 1..`CURVE_MAX_BUCKET`; 0 unused). */
    curve: number[];
    /** Every Maindeck spell with a coloured pip. */
    castability: SpellCastability[];
    /** Mean of `castability[].p`; `null` with no coloured spell. */
    meanCastability: number | null;
    /** The Pool's deepest Archetype: most Pool cards tagged with it (copies
     *  count), ties by id. `null` when no Pool card carries one. */
    planArchetype: string | null;
    /** Share of the Maindeck's spells tagged with `planArchetype`. */
    planShare: number | null;
    /** Distinct `(provider, requirer, capability)` with both cards in the
     *  Maindeck, provider ≠ requirer. */
    capabilityPairs: number;
    /** Per layer, the share of Maindeck cards carrying that layer's data whose
     *  row is unreviewed; `null` when no Maindeck card carries the layer. */
    unreviewedShare: { archetypes: number | null; capabilities: number | null };
}

function mean(values: readonly number[]): number | null {
    return values.length === 0
        ? null
        : values.reduce((a, b) => a + b, 0) / values.length;
}

function deepestArchetype(
    poolMetas: readonly AutoBuildCardMeta[],
    getCardProfile: GetCardProfile
): string | null {
    const depth = new Map<string, number>();
    for (const meta of poolMetas) {
        for (const a of getCardProfile(meta.cardId)?.archetypes ?? []) {
            depth.set(a, (depth.get(a) ?? 0) + 1);
        }
    }
    let best: string | null = null;
    let bestDepth = 0;
    for (const [a, d] of [...depth].sort(([x], [y]) => x.localeCompare(y))) {
        if (d > bestDepth) {
            best = a;
            bestDepth = d;
        }
    }
    return best;
}

function countCapabilityPairs(
    profiles: ReadonlyMap<string, CardProfile>
): number {
    const pairs = new Set<string>();
    for (const [providerId, provider] of profiles) {
        for (const [requirerId, requirer] of profiles) {
            if (providerId === requirerId) continue;
            for (const cap of provider.provides) {
                if (requirer.requires.includes(cap)) {
                    pairs.add(`${providerId}|${requirerId}|${cap}`);
                }
            }
        }
    }
    return pairs.size;
}

function unreviewedShare(
    profiles: readonly CardProfile[],
    carries: (p: CardProfile) => boolean,
    reviewed: (p: CardProfile) => boolean
): number | null {
    const carrying = profiles.filter(carries);
    return carrying.length === 0
        ? null
        : carrying.filter((p) => !reviewed(p)).length / carrying.length;
}

/** Measures one Auto-Built seat. */
export function auditSeatDeck(
    seed: number,
    seat: DraftLabSeatDeck,
    getCardProfile: GetCardProfile
): DeckAudit {
    const resolved = seat.deck.cards.map((c) =>
        draftLabGetAutoBuildCardMeta(c.cardId)
    );
    const main = resolved.filter((m): m is AutoBuildCardMeta => m !== null);
    const spells = main.filter((m) => !m.isLand);

    const curve = Array.from({ length: CURVE_MAX_BUCKET + 1 }, () => 0);
    for (const s of spells) curve[curveBucket(s.manaValue)] += 1;

    const castability: SpellCastability[] = [];
    main.forEach((m, i) => {
        if (m.isLand || !hasColouredPip(m)) return;
        castability.push({
            cardId: m.cardId,
            manaValue: m.manaValue,
            p: castabilityOf(m, main, i),
        });
    });

    const poolMetas = seat.pool
        .map((c) => draftLabGetAutoBuildCardMeta(c.scryfallId))
        .filter((m): m is AutoBuildCardMeta => m !== null);
    const planArchetype = deepestArchetype(poolMetas, getCardProfile);
    const planShare =
        planArchetype === null || spells.length === 0
            ? null
            : spells.filter((s) =>
                  getCardProfile(s.cardId)?.archetypes.includes(planArchetype)
              ).length / spells.length;

    const profiles = new Map<string, CardProfile>();
    for (const m of main) {
        if (m.isBasicLand || profiles.has(m.cardId)) continue;
        const profile = getCardProfile(m.cardId);
        if (profile) profiles.set(m.cardId, profile);
    }
    const profileList = [...profiles.values()];

    return {
        seed,
        seatIndex: seat.seatIndex,
        colors: seat.deck.colors,
        mainSize: seat.deck.cards.length,
        legal: seat.deck.cards.length >= FORMAT_RULES.limited.minMain,
        landCount: main.length - spells.length,
        spellCount: spells.length,
        unresolved: resolved.length - main.length,
        curve,
        castability,
        meanCastability: mean(castability.map((c) => c.p)),
        planArchetype,
        planShare,
        capabilityPairs: countCapabilityPairs(profiles),
        unreviewedShare: {
            archetypes: unreviewedShare(
                profileList,
                (p) => p.archetypes.length > 0,
                (p) => p.archetypesReviewed
            ),
            capabilities: unreviewedShare(
                profileList,
                (p) =>
                    p.provides.length > 0 ||
                    p.requires.length > 0 ||
                    (p.comboEdges?.length ?? 0) > 0,
                (p) => p.capabilitiesReviewed
            ),
        },
    };
}

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
