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
import type { CardDefinition, PermanentView } from "../cards/types";
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

// Issue #1508 — bound on a NON-CREATURE's DSL spell-script value. Context-free
// grounding (`gre/ai/grounding.ts`) always takes the `if` walker's `then`
// branch (a card's own effect is assumed to happen), so a spell whose real
// payoff is gated behind a rare/near-never-true condition — an alternate win
// condition (`winGame`, WIN_GAME_VALUE = 100000, Coalition Victory), or a
// "prevent ALL damage" effect modeled as a very large literal `preventDamage`
// amount (Glyph of Destruction / Indestructible Aura, amount: 9999 ×
// LIFE_PER_POINT = ~80000) — gets valued as if its huge payoff were certain.
// That raw scalar feeds straight into `evaluate.ts`'s unweighted `hand` term,
// and the reward band saturates at a material margin of only ±500
// (`MATERIAL_FULL`, `gre/search.ts`) — a SINGLE such card in hand pins the
// reward at the band edge regardless of anything else in play, so losing a
// creature (or any other real material swing) reads as free.
//
// Capping the SCRIPT-DERIVED component here — not the raw `OP_VALUERS`
// magnitude (kept at its full scale so `if`/`optionChoice`'s "pick the best
// mode" comparisons and ordering assertions stay meaningful) and not the
// creature body (a genuinely huge creature, e.g. Worldspine Wurm, is real
// signal that must NOT be squashed) — is the narrowest fix: every consumer of
// a non-creature's latent worth (the Hand term, the Bot Drafter pick
// heuristic, the board-permanent term for a non-creature/non-land permanent)
// goes through this one `latentValue` composition, so one bound here closes
// off the whole "a card's own effect assumed certain" saturation class rather
// than patching `winGame` alone. Comfortably above every real catalogue
// script's context-free value (Ashes to Ashes tops out around 460) is NOT the
// goal — the goal is staying well clear of `MATERIAL_FULL` (500) so a single
// hand card, even at the cap, still leaves headroom for a creature dying (a
// ~170-200 point swing) to move the reward. Reusing `EXTRA_TURN_VALUE` (300,
// `ai/opValuers.ts` — already documented there as "the biggest single-Op
// swing in the basis") keeps the bound tied to an existing, principled
// magnitude rather than an arbitrary new number.
const MAX_LATENT_SCRIPT_VALUE = 300;

/** Latent worth from a card's raw characteristics (ADR 0018), with the
 *  DSL-derived semantic layer wired in (PRD #1423, issue #1426), and the
 *  `aiEffects` shadow-script mechanism (issue #1431). PRD #1423's precedence
 *  is ONE rule applied identically to both card classes — an explicit
 *  `aiValue` override always wins outright (the Forge `SVar` analog,
 *  correction-on-divergence) over the derived script value, which in turn
 *  beats the blind `base + MV` fallback. Highest first:
 *
 *    1. an explicit `aiValue` override wins outright (both classes) — for a
 *       CREATURE, over the whole computed worth (body + ability scripts); for
 *       a NON-CREATURE, over its spell-script value. This is the
 *       correction-on-divergence knob PRD #1423 exists to preserve: a card
 *       whose script `OP_VALUERS` misvalues keeps a per-card escape hatch
 *       regardless of card type (issue #1512 — a prior revision let the
 *       non-creature script value override `aiValue`, silently redefining
 *       this order and leaving non-creatures with no override left; fixed
 *       here so both branches agree);
 *    2. CREATURE (no override): its discounted body PLUS its
 *       activated/triggered ability-script value (`dslAbilityValue`) — each
 *       ability script is itself a real `effects[]` if present, else its
 *       `aiEffects` shadow script (folded in by the caller, issue #1431);
 *    3. NON-CREATURE (no override): its spell-script value (`dslSpellValue` —
 *       a real `effects[]` if present, else its `aiEffects` shadow script,
 *       again folded in by the caller) when it has one, floored at
 *       `base + MV`;
 *    4. the `base + MV` fallback — `NONCREATURE_BASE + MV × W_NC_MV` — when
 *       neither an override nor a script apply.
 *
 *  So for the non-creature spell-script chain issue #1431 introduced, the
 *  order is exactly: `aiValue` scalar → real `effects[]` / `aiEffects` shadow
 *  script → `base + MV`.
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
    /** DSL spell-script value (a non-creature's `effects[]`/`aiEffects`);
     *  undefined when the card has no spell script. */
    dslSpellValue?: number;
    /** DSL activated/triggered ability-script value (a creature's
     *  `effects[]`/`aiEffects` abilities); undefined/0 when it has none. */
    dslAbilityValue?: number;
}): number {
    if (chars.isCreature) {
        // A creature's `aiValue` overrides its WHOLE computed worth (body +
        // ability scripts) outright — unaffected by the effects[]→aiEffects
        // chain below, which targets the spell-script (non-creature) path.
        if (chars.aiValue !== undefined) return chars.aiValue;
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
    // A non-creature: an explicit `aiValue` override wins outright (issue
    // #1512 — PRD #1423's order applied to this branch too, matching the
    // CREATURE branch above instead of letting the DSL script silently
    // outrank the per-card correction knob).
    if (chars.aiValue !== undefined) return chars.aiValue;
    // No override: its DSL spell-script value (real `effects[]`, else its
    // `aiEffects` shadow script) if it has one, floored at the `base + MV`
    // fallback. The floor makes the semantic layer a strict UPLIFT — a card
    // whose script the current Op vocabulary can't yet value fully (a
    // backfilled Op, #1430) never drops BELOW its mana-value worth; a burn /
    // removal spell rises far above it.
    const fallback = NONCREATURE_BASE + chars.manaValue * W_NC_MV;
    if (chars.dslSpellValue !== undefined) {
        // Clamp BEFORE the floor comparison (issue #1508) — an ordinary
        // script's value is always well under the cap, so this is a no-op for
        // every real card except the rare "if always assumes then" / literal
        // sentinel-amount outliers the cap exists to bound.
        const bounded = Math.min(chars.dslSpellValue, MAX_LATENT_SCRIPT_VALUE);
        return Math.max(fallback, bounded);
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
 *  unknown id (a token / off-registry card).
 *
 *  `self` is the live permanent whose worth is being read. It decides each
 *  triggered ability's CR 603.4 check-time gate (issue #1936): an Evoke
 *  Incarnation IN PLAY is charged its self-sacrifice only when it was actually
 *  evoked — a hard-cast one used to eat the same cost for a trigger that can
 *  never fire on it. Omit it and a gated ability is merely weighted. */
export function dslRealizedAbilityValueById(
    cardId: string,
    self?: PermanentView
): number {
    const def = tryGetDefinition(cardId);
    return def ? dslRealizedAbilityScriptValue(def, undefined, self) : 0;
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
