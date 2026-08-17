// VIS — green cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    CardDefinition,
    PermanentView,
    StaticEffectContext,
} from "../../../../convex/cards/types";
import { cumulativeUpkeepTrigger } from "../../abilities/cumulativeUpkeep";

// Natural Order — {2}{G}{G} Sorcery. "As an additional cost to cast this
// spell, sacrifice a green creature. Search your library for a green
// creature card, put it onto the battlefield, then shuffle." (CR 118.8
// additional cost / 701.19 search / 400.7 / 701.24 shuffle.) The additional
// cost reuses `additionalCosts.sacrificeFilter` (a `PermanentFilter`, already
// supports `colors`); the search reuses the `choice` Op's `filter.color`
// (issue #677).
export const naturalOrder: CardDefinition = {
    id: "0845f0b0-9413-4ddd-861d-9607636bebc6",
    name: "Natural Order",
    rarity: "rare",
    manaCost: { X: 2, G: 2 },
    types: ["Sorcery"],
    oracleText:
        "As an additional cost to cast this spell, sacrifice a green creature.\nSearch your library for a green creature card, put it onto the battlefield, then shuffle.",
    additionalCosts: {
        sacrificeFilter: { types: "Creature", colors: "G" },
    },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Creature", color: "G" },
            count: 1,
            prompt: "Search your library for a green creature card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "battlefield",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};

// Elephant Grass — {G} Enchantment. Three clauses, all directed at the
// controller ("you"):
//   1. Cumulative upkeep {1} (CR 702.24 / ADR 0042) — the `cumulativeUpkeepTrigger`
//      template. Generic {1} per age counter, all-or-nothing, sacrifice on decline.
//   2. "Black creatures can't attack you." — a `global-attack-restriction`
//      (CR 508.1c, the Moat kind). Because that kind is scanned board-wide with no
//      built-in direction, the predicate itself scopes the lock to attacks against
//      the SOURCE's controller (`attacker.controllerId !== source.controllerId` — in
//      2-player combat the only creatures attacking "you" are the opponent's).
//   3. "Nonblack creatures can't attack you unless their controller pays {2} for
//      each creature they control that's attacking you." — the new
//      `attack-mana-tax` kind (CR 508.1c/1g, #1053): the collector
//      (`collectAttackManaTax`) already scopes the tax to sources controlled by the
//      player being attacked, so the predicate only filters colour (nonblack).
export const elephantGrass: CardDefinition = {
    id: "f4c1f5a7-0d28-43ab-9b66-937e963f42cd",
    name: "Elephant Grass",
    rarity: "uncommon",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    oracleText:
        "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nBlack creatures can't attack you.\nNonblack creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "elephant-grass-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
    staticEffects: [
        {
            // Clause 2: black creatures can't attack you (CR 508.1c).
            kind: "global-attack-restriction",
            id: "elephant-grass-black-cant-attack-you",
            forbids: (
                attacker: PermanentView,
                source: PermanentView,
                _state,
                ctx: StaticEffectContext
            ) =>
                ctx.isCreature(attacker) &&
                ctx.getColors(attacker).includes("B") &&
                // Directed at the source's controller: only forbid attacks the
                // opponent makes against you (the Elephant Grass controller).
                attacker.controllerId !== source.controllerId,
            oracleText: "Black creatures can't attack you (Elephant Grass).",
        },
        {
            // Clause 3: nonblack creatures pay {2} each to attack you (CR
            // 508.1c/1g, #1053). Direction is enforced by the collector; the
            // predicate only filters colour.
            kind: "attack-mana-tax",
            id: "elephant-grass-nonblack-attack-tax",
            taxes: (attacker: PermanentView, _source, _state, ctx) =>
                ctx.isCreature(attacker) &&
                !ctx.getColors(attacker).includes("B"),
            costPerAttacker: { X: 2 },
            oracleText:
                "Nonblack creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you (Elephant Grass).",
        },
    ],
};
