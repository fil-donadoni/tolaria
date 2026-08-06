// ROE — colorless cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    GameEvent,
    PermanentView,
    TriggeredAbility,
} from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// ═════════════════════════════════════════════════════════════════════════════
// Emrakul, the Aeons Torn — PRD #1301 slice S3 (issue #2319). Shipped once both
// engine slices landed: annihilator N (CR 702.86, #2295) and the `colored-spell`
// protection quality (CR 702.16a, #2296). Modern Scryfall oracle (ADR 0004);
// {15} 15/15 Legendary Creature — Eldrazi, mythic, validated against Scryfall.
// ═════════════════════════════════════════════════════════════════════════════

/** CR 603.2 / 603.6e — "When Emrakul is put into a graveyard from anywhere, its
 *  owner shuffles their graveyard into their library."
 *
 *  ONE `TriggeredAbility` on an ARRAY `event`, never one near-duplicate ability
 *  per event (a duplicate renders the same Oracle line N times on the stack;
 *  `triggerDedup.test.ts` guards it). The FOUR events partition graveyard entry:
 *  battlefield death (CR 700.4), discard (CR 701.8), mill (CR 701.17), and
 *  `CARD_PUT_INTO_GRAVEYARD` — the residual catch-all without which "from
 *  anywhere" misses a "put the rest into your graveyard" dig, which is NOT a
 *  mill (CR 701.17a). `PERMANENT_LEFT` is deliberately EXCLUDED: it is emitted
 *  from the same `removePermanentTo` call as `CREATURE_DIED`, so listing both
 *  would fire this trigger twice on every battlefield death. Same shape as
 *  Worldspine Wurm (`rtr/green.ts`) and Blightsteel Colossus (`mbs/colorless.ts`).
 *
 *  `zone: "graveyard"` (CR 603.6e) puts this on `collectTriggers`'s graveyard
 *  pass, which matches every card CURRENTLY SITTING in a graveyard against
 *  every event in the batch — the only scan that also reaches a hand/library
 *  origin, where there is no live battlefield permanent to anchor the default
 *  pass.
 *
 *  THE DELTA vs. the Wurm / the Colossus: those two shuffle only THEMSELVES
 *  back; Emrakul shuffles its owner's WHOLE graveyard. Three Ops, and the first
 *  one is load-bearing beyond its own move:
 *   1. Emrakul itself → library, binding `$emrakul`. `$source` is NOT available
 *      as a player ref here — `runEffectScript` seeds the implicit `$source`
 *      binding only when `ctx.getOwnerId(sourceInstanceId)` resolves, and that
 *      primitive is battlefield-scoped, so a graveyard-resident source is never
 *      bound and `{ ref: "$source.owner" }` would resolve to undefined and skip
 *      the Op (CR 608.2b) — silently. `moveZone`'s `target`-shape has its own
 *      unconditional graveyard recovery for `$source` (interpreter.ts), and the
 *      snapshot it binds carries SNAP_OWNER = the graveyard PILE's owner. That
 *      is the CR 108.3 owner, immutable and correct even after a control-change
 *      effect — the trigger says "its OWNER", not whoever controlled Emrakul
 *      when it died.
 *   2. the REST of that owner's graveyard → their library: the bulk whole-zone
 *      `moveZone` shape (`player` + `from` + `to`, both restricted to
 *      `MovableZone`, which admits `library`) — the same shape Timetwister's
 *      "shuffles their hand and graveyard into their library" uses.
 *   3. shuffle (CR 701.20).
 *  Steps 1+2 together move exactly the set the Oracle names (Emrakul is itself
 *  in that graveyard when the trigger resolves), and step 3 randomizes, so the
 *  split into two moves is outcome-identical to one sweep.
 *
 *  KNOWN ENGINE GAP, pre-existing and shared with both sibling cards: a card
 *  put into a graveyard FROM THE STACK routes through `sendStackItemToGraveyard`,
 *  which emits no event at all, so no member of the array can observe it. Not
 *  reachable by countering here (`cantBeCountered`), and documented as out of
 *  scope for this family in `rtr/green.ts`. */
function emrakulShuffleGraveyardFromAnywhere(): TriggeredAbility {
    return {
        id: "emrakul-shuffle-graveyard",
        oracleText:
            "When Emrakul is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.",
        event: [
            "CREATURE_DIED",
            "CARD_DISCARDED",
            "CARD_MILLED",
            "CARD_PUT_INTO_GRAVEYARD",
        ],
        zone: "graveyard",
        matches: (event: GameEvent, self: PermanentView): boolean => {
            if (event.type === "CREATURE_DIED") {
                return event.creatureInstanceId === self.id;
            }
            if (
                event.type === "CARD_DISCARDED" ||
                event.type === "CARD_MILLED" ||
                event.type === "CARD_PUT_INTO_GRAVEYARD"
            ) {
                return event.cardInstanceId === self.id;
            }
            return false;
        },
        effects: [
            {
                op: "moveZone",
                target: { ref: "$source" },
                to: "library",
                bind: "$emrakul",
            },
            {
                op: "moveZone",
                player: { ref: "$emrakul.owner" },
                from: "graveyard",
                to: "library",
            },
            {
                op: "libraryLook",
                action: "shuffle",
                player: { ref: "$emrakul.owner" },
            },
        ],
    };
}

export const emrakulTheAeonsTorn: CardDefinition = {
    id: "67600383-bbb8-411c-b8e6-2296650bc747",
    name: "Emrakul, the Aeons Torn",
    rarity: "mythic",
    oracleText:
        "This spell can't be countered.\nWhen you cast this spell, take an extra turn after this one.\nFlying, protection from spells that are one or more colors, annihilator 6\nWhen Emrakul is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.",
    manaCost: { X: 15 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Eldrazi"],
    power: 15,
    toughness: 15,
    // CR 701.5a — "This spell can't be countered", honoured at the counter site.
    cantBeCountered: true,
    // CR 702.9 flying; CR 702.16a protection from spells that are one or more
    // colors (the spell-restricted any-colour quality, #2296 — a CONJUNCTION:
    // the source must BE a spell AND have at least one colour, so a coloured
    // CREATURE still blocks and damages Emrakul normally, and an ability of a
    // coloured permanent still affects it, CR 113.3); CR 702.86 annihilator 6.
    // The annihilator string is the ONLY input the keyword needs —
    // `expandAnnihilator` is chained into the `getDefinition` seam and emits
    // both the reminder text and the enforcing CR 702.86a attack trigger.
    staticAbilities: [
        "flying",
        "protection from spells that are one or more colors",
        "annihilator 6",
    ],
    triggeredAbilities: [
        // CR 603.6e — "When you cast this spell, take an extra turn after this
        // one." Fires on the CAST (the trigger goes on the stack above Emrakul
        // itself), not on resolution, so the extra turn is taken even if the
        // spell never resolves.
        spellCastTrigger({
            id: "emrakul-cast-extra-turn",
            oracleText:
                "When you cast this spell, take an extra turn after this one.",
            scope: "self",
            effects: [{ op: "extraTurn", player: "controller" }],
        }),
        emrakulShuffleGraveyardFromAnywhere(),
    ],
};
