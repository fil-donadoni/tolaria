// EXO — green cards, split by colour per ADR 0043. The registry's
// `import * as exo from "./sets/exo"` resolves through exo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Survival of the Fittest — {1}{G} Enchantment. "{G}, Discard a creature
// card: Search your library for a creature card, reveal that card, put it
// into your hand, then shuffle." (CR 701.23 search / 400.7 zone change /
// 701.24 shuffle.) Unblocked by issue #901: `ActivatedAbility.cost` gained a
// `discardFilter` leg (mirrors `sacrificeFilter`'s player-choice discipline —
// the activator picks WHICH matching creature card in hand to discard via a
// dedicated picker, `selectActivationDiscardCost`; never auto-picked). The
// search/reveal/hand/shuffle tail is the same DSL composition Stoneforge
// Mystic's ETB uses (issue #677/#945): `choice`(kind: "search-library") +
// `reveal` + `moveZone`(library → hand) + `libraryLook`(shuffle).
export const survivalOfTheFittest: CardDefinition = {
    id: "c060c178-3c0e-493f-b6f0-ead5b1d6f191",
    name: "Survival of the Fittest",
    rarity: "rare",
    manaCost: { generic: 1, G: 1 },
    types: ["Enchantment"],
    oracleText:
        "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
    activatedAbilities: [
        {
            id: "survival-of-the-fittest-tutor",
            oracleText:
                "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
            cost: {
                mana: { G: 1 },
                discardFilter: { filter: { type: "Creature" }, count: 1 },
            },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Creature" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a creature card.",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};

// Oath of Druids — {1}{G} Enchantment (issue #2707). "At the beginning of each
// player's upkeep, that player chooses target player who controls more
// creatures than they do and is their opponent. The first player may reveal
// cards from the top of their library until they reveal a creature card. If
// the first player does, that player puts that card onto the battlefield and
// all other cards revealed this way into their graveyard."
//
// ONE Oracle line = ONE `TriggeredAbility` (CR 603.2), built from two general
// pieces rather than a card-shaped one:
//
//  * TARGETING (CR 603.3d) — `playerControlsMoreThan: { type: "Creature",
//    than: "active" }`, the comparative player-target predicate. "that player"
//    and "they" are both the UPKEEP player, which under `scope: "each"` is the
//    active player, never the enchantment's controller — so `than: "active"`,
//    and NOT `controller: "opponent"`, which is relative to the chooser (this
//    ability's controller) and is the wrong seat on the opponent's upkeep. The
//    "and is their opponent" half needs no clause of its own: a strict `>`
//    already excludes the baseline seat. With no legal target the trigger is
//    removed from the stack as it is announced (CR 603.3d,
//    `raiseTriggerTargetSelection`), and the printed ruling's "the ability
//    doesn't resolve if it's no longer true at that time" is the CR 608.2b
//    player-kind re-check (`playerTargetStillMeetsRestrictions`, gre/state.ts).
//
//  * RESOLUTION — the "may" is the DSL's cost-free `mayPay` + `if` pair
//    (issue #680: `mayPay` with no `cost` IS "you may …", binding a boolean
//    the `if` reads), and the taken branch is one `revealUntilMatch` Op:
//    match → battlefield, rest → graveyard. Both the player offered the
//    decision and the library dug are `{ ref: "$event.activePlayerId" }`
//    (issue #1066 / ADR 0049 — the scoped player read straight off the firing
//    PHASE_BEGIN event), because "the first player" is the upkeep player, not
//    the ability's controller.
//
// The announced target is a LEGALITY GATE only — nothing in the body reads
// slot 0, exactly as the Oracle text describes (the target player is named,
// then never acted on).
//
// WHO CHOOSES THE TARGET — out of scope, and unobservable here: CR 601.2c has
// the ability's CONTROLLER choose targets, while the Oracle text hands the
// choice to the upkeep player ("that player chooses target player"). A
// non-controller target chooser is a multiplayer-shaped seam this engine does
// not have, and it is out of scope because it can never be observed: the
// engine is 2-player, so the comparative predicate admits at most ONE
// candidate — the single non-active seat — and `raiseTriggerTargetSelection`
// auto-selects a sole legal target without prompting anyone. There is no game
// state in which the two choosers could pick differently.
//
// compiler-gap: At the beginning of each player's upkeep, that player chooses target player who controls more creatures than they do and is their opponent. The first player may reveal cards from the top of their library until they reveal a creature card. If the first player does, that player puts that card onto the battlefield and all other cards revealed this way into their graveyard. (#2693)
export const oathOfDruids: CardDefinition = {
    id: "cf14de50-d123-400c-862e-2c95fd2aa23f",
    name: "Oath of Druids",
    rarity: "rare",
    manaCost: { generic: 1, G: 1 },
    types: ["Enchantment"],
    oracleText:
        "At the beginning of each player's upkeep, that player chooses target player who controls more creatures than they do and is their opponent. The first player may reveal cards from the top of their library until they reveal a creature card. If the first player does, that player puts that card onto the battlefield and all other cards revealed this way into their graveyard.",
    triggeredAbilities: [
        phaseTrigger({
            id: "oath-of-druids-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, that player chooses target player who controls more creatures than they do and is their opponent. The first player may reveal cards from the top of their library until they reveal a creature card. If the first player does, that player puts that card onto the battlefield and all other cards revealed this way into their graveyard.",
            phase: "UPKEEP",
            scope: "each",
            targetRequirement: {
                type: "player",
                count: 1,
                playerControlsMoreThan: { type: "Creature", than: "active" },
            },
            effects: [
                {
                    op: "mayPay",
                    player: { ref: "$event.activePlayerId" },
                    prompt: "Oath of Druids: reveal cards from the top of your library until you reveal a creature card?",
                    bind: "$oath",
                },
                {
                    op: "if",
                    predicate: { binding: "$oath" },
                    then: [
                        {
                            op: "revealUntilMatch",
                            player: { ref: "$event.activePlayerId" },
                            filter: { type: "Creature" },
                            match: "battlefield",
                            rest: "graveyard",
                        },
                    ],
                },
            ],
        }),
    ],
};
