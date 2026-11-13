// Draft Table Audit — the per-deck report (issue #8894, PRD #8772): what one
// Auto-Built seat's Maindeck looks like, measured. Shared by the seeded CLI
// (`scripts/lib/draft-audit.ts`, which aggregates a run and holds it against
// the Floors) and the Draft Lab's Built deck view (issue #8899), so the owner
// judges a deck by eye with the very numbers the gate holds — one module,
// never a copy. Pure: no DB, no Convex call (ADR 0074).
import type { Color } from "@convex/cards/types";
import { FORMAT_RULES } from "@convex/formats";
import type { AutoBuildCardMeta } from "@convex/limited/autoBuild";
import {
    hasColouredPip as hasPip,
    hypergeometricAtLeast,
    manaSourceKinds,
    pipCastability,
} from "@convex/limited/castability";
import {
    archetypeCommitment,
    curveBucket,
    CURVE_MAX_BUCKET,
    poolProfiles,
    sourceWeight,
} from "@convex/limited/botDrafter";
import {
    choosePlanArchetype,
    type ArchetypeScopeShare,
} from "@convex/limited/planArchetype";
import type {
    CardProfile,
    GetCardProfile,
} from "@convex/limited/cardProfilesCore";
import { resolveFetchSources } from "@convex/limited/manaSourceColors";
import type { DraftLabSeatDeck } from "./draftLabEngine";
import { draftLabGetAutoBuildCardMeta } from "./draftLabCardMeta";

// ── Castability model ──────────────────────────────────────────────────────
// The model is `convex/limited/castability.ts`'s, the one the builder scores
// with — never a copy here.

export { hypergeometricAtLeast };

/** One Maindeck spell's castability under the declared model (each source
 *  pays one pip), a source being any OTHER Maindeck card that produces a
 *  colour (`producedColors`: lands, Moxen, mana creatures alike). A spell with no coloured pip is excluded from
 *  every mean (it is castable by this model whatever the mana base). */
export function castabilityOf(
    spell: AutoBuildCardMeta,
    deck: readonly AutoBuildCardMeta[],
    spellIndex: number
): number {
    const others = deck.filter((_, i) => i !== spellIndex);
    return pipCastability(
        spell.pips,
        spell.manaValue,
        deck.length,
        manaSourceKinds(others, sourceWeight)
    );
}

function hasColouredPip(meta: AutoBuildCardMeta): boolean {
    return hasPip(meta.pips);
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
    /** `castability[]` restricted to the early spells (issue #9335). */
    earlyCastability: EarlyCastability;
    /** `null` for a two-colour deck (issue #9335). */
    splash: SplashDiscipline | null;
    /** Maindeck lands producing a colour outside `colors` (issue #9335). */
    offColourDuals: number;
    /** Maindeck spells with a coloured pip outside `colors` (issue #9336). */
    offColourSpells: number;
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

export function mean(values: readonly number[]): number | null {
    return values.length === 0
        ? null
        : values.reduce((a, b) => a + b, 0) / values.length;
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

// ── Colour coherence (issue #9335) ─────────────────────────────────────────
// Report only, no Floor: the baseline the third-colour, one-shot-source and
// castability-model follow-ups are measured against.

/** A spell is EARLY at this mana value or below: the turns a stumble costs
 *  most, and the splash cards a deck cannot wait to cast. */
export const EARLY_MANA_VALUE = 2;

/** An early spell below this castability counts as a stumble. */
export const EARLY_CASTABILITY_THRESHOLD = 0.8;

/** The number of true colours (CR 105.1): a source producing this many is
 *  any-colour fixing, never off-colour. */
const TRUE_COLOR_COUNT = 5;

export interface EarlyCastability {
    /** Coloured Maindeck spells of mana value ≤ `EARLY_MANA_VALUE`. */
    spells: number;
    /** Mean of their castability; `null` with none. */
    mean: number | null;
    /** How many read below `EARLY_CASTABILITY_THRESHOLD`. */
    below: number;
}

export interface SplashDiscipline {
    /** Maindeck cards with a pip in a colour past the deck's first two
     *  (`colors[2..]`, the third colour Auto-Build adds last). */
    cards: number;
    /** Of those, how many have a double pip in a splash colour or mana value
     *  ≤ `EARLY_MANA_VALUE`: the splash cards a third colour pays worst. */
    strained: number;
}

export function earlyCastability(
    castability: readonly SpellCastability[]
): EarlyCastability {
    const early = castability.filter((c) => c.manaValue <= EARLY_MANA_VALUE);
    return {
        spells: early.length,
        mean: mean(early.map((c) => c.p)),
        below: early.filter((c) => c.p < EARLY_CASTABILITY_THRESHOLD).length,
    };
}

export function splashDiscipline(
    colors: readonly string[],
    main: readonly AutoBuildCardMeta[]
): SplashDiscipline | null {
    const splash = colors.slice(2) as Color[];
    if (splash.length === 0) return null;
    const splashing = main.filter((m) =>
        splash.some((c) => (m.pips[c] ?? 0) > 0)
    );
    return {
        cards: splashing.length,
        strained: splashing.filter(
            (m) =>
                m.manaValue <= EARLY_MANA_VALUE ||
                splash.some((c) => (m.pips[c] ?? 0) >= 2)
        ).length,
    };
}

/** Maindeck lands producing a true colour outside the deck's. A land that
 *  produces every colour (City of Brass, a basic-land fetch) is any-colour
 *  fixing and never counts. */
export function countOffColourDuals(
    colors: readonly string[],
    main: readonly AutoBuildCardMeta[]
): number {
    const deckColors = new Set(colors);
    return main.filter((m) => {
        if (!m.isLand) return false;
        const produced = new Set(m.producedColors.filter((c) => c !== "C"));
        return (
            produced.size < TRUE_COLOR_COUNT &&
            [...produced].some((c) => !deckColors.has(c))
        );
    }).length;
}

/** Maindeck spells with a coloured pip in a colour outside the deck's: the
 *  cards a build plays although its colours cannot pay them (issue #9336). */
export function countOffColourSpells(
    colors: readonly string[],
    main: readonly AutoBuildCardMeta[]
): number {
    const deckColors = new Set(colors);
    return main.filter(
        (m) =>
            !m.isLand &&
            (Object.entries(m.pips) as [Color, number][]).some(
                ([c, n]) => n > 0 && c !== "C" && !deckColors.has(c)
            )
    ).length;
}

// ── Measure ────────────────────────────────────────────────────────────────

/** Measures one Auto-Built seat. */
export function auditSeatDeck(
    seed: number,
    seat: DraftLabSeatDeck,
    getCardProfile: GetCardProfile,
    scopeShare: ArchetypeScopeShare | null
): DeckAudit {
    const resolved = seat.deck.cards.map((c) =>
        draftLabGetAutoBuildCardMeta(c.cardId)
    );
    // A fetch land supplies the colours of the Maindeck lands it can find
    // (issue #9348).
    const main = resolveFetchSources(
        resolved.filter((m): m is AutoBuildCardMeta => m !== null)
    );
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
    // The plan the build chose: the same function, the same scope share
    // (issue #9298).
    const planArchetype = choosePlanArchetype(
        archetypeCommitment(poolProfiles(poolMetas, getCardProfile)),
        poolMetas.length,
        scopeShare
    );
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
        earlyCastability: earlyCastability(castability),
        splash: splashDiscipline(seat.deck.colors, main),
        offColourDuals: countOffColourDuals(seat.deck.colors, main),
        offColourSpells: countOffColourSpells(seat.deck.colors, main),
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
