// rav — black cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Dark Confidant — {1}{B} Creature, Vintage Cube residue (issue #1302, parent
// PRD #620). Home set = earliest paper printing (ADR 0041) = Ravnica: City of
// Guilds; it was first implemented against the FIN reprint (wrong home set,
// wrong art), which now rides along as a `CardPrint` in `fin/black.ts`.
//
// "At the beginning of your upkeep, reveal the top card of your library and put
// that card into your hand. You lose life equal to its mana value."
// (CR 701.20a reveal + CR 202.3 mana value.) DSL-first: the reveal is
// PUBLIC (both players see the card + it stays visible in the controller's
// hand), so the op is `digMatchingToHand` — the CR 701.20a reveal sibling of
// `digToHand` — NOT `digToHand` (whose look is a PRIVATE peek that never marks
// the card known to the opponent nor pops a reveal dialog). `look: 1` reveals
// the single top card to every player (transient reveal dialog + persistent
// `markKnownToAll` "eye"), a match-all `filter: {}` keeps it (all revealed
// cards match ⇒ all go to hand, none to `destination`), and `bind` snapshots
// it so the trailing `loseLife` reads `manaValue: { of: { ref: "$revealed" } }`
// to size the life loss (CR 202.3b — an {X} in a library card's cost counts as
// 0). No leftover, no choice, no picker: the ability resolves in one shot.
// Both Ops are exercised by the interpreter suite (digMatchingToHand reveal +
// bind; loseLife+manaValue-of-ref, Reanimate) — the per-Op test regime plus
// this card's reveal-dialog interpreter test cover it (gre-development.md).
export const darkConfidant: CardDefinition = {
    id: "94f7a441-bf2d-46fb-a7b6-9bd6137f86d9", // RAV 81
    name: "Dark Confidant",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        phaseTrigger({
            id: "dark-confidant-upkeep",
            oracleText:
                "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "digMatchingToHand",
                    player: "controller",
                    look: 1,
                    // Match-all: the single revealed top card always goes to
                    // hand (Dark Confidant keeps unconditionally, unlike
                    // Desperate Research's name filter). Nothing is ever left
                    // for `destination`, so its value is inert here.
                    filter: {},
                    destination: "graveyard",
                    bind: "$revealed",
                },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { manaValue: { of: { ref: "$revealed" } } },
                },
            ],
        }),
    ],
};
