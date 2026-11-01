// mh1 — red cards (ADR 0043 colour split).
import { defineCard, type EffectTokenSpec } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

/** The 1/1 red Elemental both of Seasoned Pyromancer's abilities create. */
const RED_ELEMENTAL_TOKEN: EffectTokenSpec = {
    name: "Elemental",
    types: ["Creature"],
    subtypes: ["Elemental"],
    colors: ["R"],
    power: 1,
    toughness: 1,
};

// Seasoned Pyromancer — {1}{R}{R} 2/2 Human Shaman.
//
// The ETB is the Gerrard's Verdict shape (`sets/apc/multicolor.cards.ts`,
// issue #3807): a two-card `discard-hand` pick bound as a Picks Binding, the
// `discard`, the draw, then a `createToken` whose count is a `count` construct
// narrowed to that binding by `picks` and to nonland cards by `filter`. The
// lookup is not graveyard-only: a discard a replacement redirected to exile
// (madness, Dauthi Voidwalker) still counts, while one redirected into a
// library has undefined characteristics and counts 0 (CR 701.9c). The count
// is read once, after the draw (CR 608.2h) — the drawn cards are not picks.
//
// The graveyard ability exiles its own source as the cost (`exileThis` with
// `activateFromGraveyard`), so it functions only from the graveyard
// (CR 113.6m).
// hand-tail: Discard two cards (#1363)
export const seasonedPyromancer = defineCard(() => ({
    id: "2e139ad1-1079-49e9-babd-6399c44ad333",
    name: "Seasoned Pyromancer",
    rarity: "mythic",
    oracleText:
        "When this creature enters, discard two cards, then draw two cards. For each nonland card discarded this way, create a 1/1 red Elemental creature token.\n{3}{R}{R}, Exile this card from your graveyard: Create two 1/1 red Elemental creature tokens.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Shaman"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "seasoned-pyromancer-etb",
            oracleText:
                "When this creature enters, discard two cards, then draw two cards. For each nonland card discarded this way, create a 1/1 red Elemental creature token.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: "controller",
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$discarded",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discarded" },
                },
                { op: "draw", player: "controller", count: 2 },
                {
                    op: "createToken",
                    controller: "controller",
                    count: {
                        count: {
                            zone: "graveyard",
                            controller: "controller",
                            filter: { excludeType: "Land" },
                            picks: { ref: "$discarded" },
                        },
                    },
                    token: RED_ELEMENTAL_TOKEN,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "seasoned-pyromancer-graveyard",
            oracleText:
                "{3}{R}{R}, Exile this card from your graveyard: Create two 1/1 red Elemental creature tokens.",
            cost: { mana: { X: 3, R: 2 }, exileThis: true },
            useStack: true,
            activateFromGraveyard: true,
            effects: [
                {
                    op: "createToken",
                    controller: "controller",
                    count: 2,
                    token: RED_ELEMENTAL_TOKEN,
                },
            ],
        },
    ],
}));
