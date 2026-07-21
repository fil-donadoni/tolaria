// Shared latent Card Value primitive (ADR 0018, issue #195; extracted for
// issue #1113 / PRD #1107). Scores the WORTH of a card from its raw printed
// characteristics alone — no `GameState`, no battlefield context. This is the
// exact core `evaluate.ts`'s Hand term and resolution-choice ordering already
// used for the vs-AI Brain; it now ALSO backs the Limited Bot Drafter's Pick
// Heuristic (`convex/limited/botDrafter.ts`), so both consumers score card
// quality identically instead of drifting apart.
//
// Isomorphic (no `convex/server`, `convex/values`, `_generated`, `ctx.*`) —
// importable from Convex mutations (the Bot Drafter, server-side) AND from
// the client bundle (`src/lib/ai/bot-view.ts`, `src/lib/ai/selfplay/*`) via
// the `convex/gre` barrel. The client keeps importing FROM convex/, never the
// reverse (CLAUDE.md).
//
// PURE: no Math.random, no mutation. `evaluate.ts` re-exports `cardValueById`
// verbatim and keeps `cardValue(state, card)` / `evaluateCreature` locally
// (those genuinely need `GameState` — effective P/T through the layer system)
// but now delegates their shared body math (`creatureValueRaw`, the latent
// core) to this module so there is exactly one implementation.
import type { CardDefinition } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { manaValue } from "./constants";
import {
    dslAbilityScriptValue,
    dslRealizedAbilityScriptValue,
    dslSpellScriptValue,
} from "./ai";

// The pure creature body math (`creatureValueRaw`) now lives in the leaf module
// `./creatureBody` (issue #1426) so the per-Op value model (`gre/ai/**`) can
// reuse it for `createToken` without an import cycle back through this file.
// Re-exported here VERBATIM to preserve this module's public surface
// (`evaluate.ts` imports `creatureValueRaw` from `./cardValue`).
export { creatureValueRaw } from "./creatureBody";
import { creatureValueRaw } from "./creatureBody";

// --- Latent `cardValue` primitive (ADR 0018, issue #195) -------------------
// The worth of a specific card while it is NOT in play (hand / library /
// graveyard), used for the Hand term and (slice 4) the resolution-choice path,
// and now the Bot Drafter's Pick Heuristic's card-quality component.
// Creatures reuse the Forge `evaluateCreature` body, discounted because a card
// in hand still has to be cast (and survive) to realize its board value; non-
// creatures get `base + MV × k`. An `aiValue` override on the CardDefinition
// replaces the derived value verbatim.
const LATENT_DISCOUNT = 0.85; // latent creature worth = discounted realized
const NONCREATURE_BASE = 8; // base latent worth of a non-creature card (MV 0)
const W_NC_MV = 10; // per mana value, non-creature latent worth

/** Latent worth from a card's raw characteristics (ADR 0018), with the
 *  DSL-derived semantic layer wired in (PRD #1423, issue #1426). Precedence,
 *  highest first:
 *
 *    1. an explicit `aiValue` override — wins outright (the Forge `SVar`
 *       analog, correction-on-divergence);
 *    2. the DSL-derived value from the card's Effect Script(s) — a CREATURE is
 *       its discounted body PLUS its activated/triggered ability-script value
 *       (`dslAbilityValue`), a NON-CREATURE is its spell-script value
 *       (`dslSpellValue`, when it has an `effects[]` script);
 *    3. the `base + MV` fallback — a creature's discounted body, a
 *       non-creature's `NONCREATURE_BASE + MV × W_NC_MV`.
 *
 *  The DSL pieces are precomputed by the caller (which holds the
 *  `CardDefinition`) and passed in, so this core stays free of any card-def /
 *  Op-registry dependency. A basic land scores `NONCREATURE_BASE` (MV 0) —
 *  below its realized in-play worth, so developing it stays strictly positive
 *  (issue #149). */
export function latentValue(chars: {
    isCreature: boolean;
    power: number;
    toughness: number;
    manaValue: number;
    staticAbilities: readonly string[];
    aiValue?: number;
    /** DSL spell-script value (a non-creature's `effects[]`); undefined when
     *  the card has no spell script. */
    dslSpellValue?: number;
    /** DSL activated/triggered ability-script value (a creature's abilities);
     *  undefined/0 when it has none. */
    dslAbilityValue?: number;
}): number {
    if (chars.aiValue !== undefined) return chars.aiValue;
    if (chars.isCreature) {
        const body =
            LATENT_DISCOUNT *
            creatureValueRaw(
                Math.max(0, chars.power),
                Math.max(0, chars.toughness),
                chars.manaValue,
                chars.staticAbilities
            );
        return body + (chars.dslAbilityValue ?? 0);
    }
    // A non-creature: its DSL spell-script value if it has one, floored at the
    // `base + MV` fallback. The floor makes the semantic layer a strict UPLIFT
    // — a card whose script the current Op vocabulary can't yet value fully (a
    // backfilled Op, #1430) never drops BELOW its mana-value worth; a burn /
    // removal spell rises far above it. `aiValue` still overrides both.
    const fallback = NONCREATURE_BASE + chars.manaValue * W_NC_MV;
    if (chars.dslSpellValue !== undefined) {
        return Math.max(fallback, chars.dslSpellValue);
    }
    return fallback;
}

/** Derive the two DSL-script value pieces from a `CardDefinition` (context-free
 *  grounding — the card's worth in hand). Split out so both the id-keyed and
 *  the live-instance `cardValue` entry points share one derivation. */
export function dslLatentPieces(def: CardDefinition): {
    dslSpellValue?: number;
    dslAbilityValue?: number;
} {
    return {
        dslSpellValue: dslSpellScriptValue(def),
        dslAbilityValue: dslAbilityScriptValue(def),
    };
}

/** DSL pieces from a card's REGISTRY id — the projection-safe entry point for
 *  the live-instance `cardValue` (evaluate.ts). A `CardInstanceState.card` blob
 *  is stripped to `{ id }` by the wire projection, so the DSL scripts must be
 *  re-derived from the registry `CardDefinition` (keyed by the id that survives
 *  the wire), NEVER read off the fat instance blob. Returns `{}` for an unknown
 *  id (a token / off-registry card — it keeps the `base + MV` fallback). */
export function dslLatentPiecesById(cardId: string): {
    dslSpellValue?: number;
    dslAbilityValue?: number;
} {
    const def = tryGetDefinition(cardId);
    return def ? dslLatentPieces(def) : {};
}

/** Realized (in-play) DSL ability worth of a permanent from its REGISTRY id —
 *  the projection-safe entry point the board evaluator (`evaluateCreature`)
 *  adds ON TOP of the creature body so a utility creature IN PLAY is valued
 *  above a vanilla of the same size (review #1440). Un-discounted (its
 *  abilities are usable now), unlike the latent in-hand pieces. Derived from
 *  the registry `CardDefinition` keyed by the id that survives the wire
 *  projection — never the stripped fat `card.card` blob. Returns 0 for an
 *  unknown id (a token / off-registry card). */
export function dslRealizedAbilityValueById(cardId: string): number {
    const def = tryGetDefinition(cardId);
    return def ? dslRealizedAbilityScriptValue(def) : 0;
}

/** Latent worth of a card from its registry id alone — the resolution-choice
 *  entry point (ADR 0018, issue #197), and the Bot Drafter Pick Heuristic's
 *  card-quality term (issue #1113, PRD #1107 story 29). Derives the value from
 *  the `CardDefinition` (base P/T, mana value, keywords, `aiValue`, and the
 *  DSL-derived Effect Script value, PRD #1423) via the `latentValue` core
 *  above. Returns 0 for an unknown id (a token or a card the registry lacks —
 *  it simply ranks lowest). */
export function cardValueById(cardId: string): number {
    const def = tryGetDefinition(cardId);
    if (!def) return 0;
    return latentValue({
        isCreature: def.types.includes("Creature"),
        power: def.power ?? 0,
        toughness: def.toughness ?? 0,
        manaValue: manaValue(def.manaCost),
        staticAbilities: def.staticAbilities ?? [],
        aiValue: def.aiValue,
        ...dslLatentPieces(def),
    });
}
