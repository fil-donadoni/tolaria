// Draft Table Audit — the per-deck report (issue #8894, PRD #8772): what one
// Auto-Built seat's Maindeck looks like, measured. Shared by the seeded CLI
// (`scripts/lib/draft-audit.ts`, which aggregates a run and holds it against
// the Floors) and the Draft Lab's Built deck view (issue #8899), so the owner
// judges a deck by eye with the very numbers the gate holds — one module,
// never a copy. Pure: no DB, no Convex call (ADR 0074).
import { FORMAT_RULES } from "@convex/formats";
import type { AutoBuildCardMeta } from "@convex/limited/autoBuild";
import {
    hasColouredPip as hasPip,
    hypergeometricAtLeast,
    pipCastability,
} from "@convex/limited/castability";
import {
    curveBucket,
    CURVE_MAX_BUCKET,
    sourceCountsByColor,
} from "@convex/limited/botDrafter";
import type {
    CardProfile,
    GetCardProfile,
} from "@convex/limited/cardProfilesCore";
import type { DraftLabSeatDeck } from "./draftLabEngine";
import { draftLabGetAutoBuildCardMeta } from "./draftLabCardMeta";

// ── Castability model ──────────────────────────────────────────────────────
// The model is `convex/limited/castability.ts`'s, the one the builder scores
// with — never a copy here.

export { hypergeometricAtLeast };

/** One Maindeck spell's castability under the declared model, a source being
 *  any OTHER Maindeck card that produces the colour (`producedColors`: lands,
 *  Moxen, mana creatures alike). A spell with no coloured pip is excluded from
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
        sourceCountsByColor(others)
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
