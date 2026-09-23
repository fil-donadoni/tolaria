// APC — black cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { colorChoiceModes } from "../../abilities/chooseColor";

// Dead Ringers — {4}{B} Sorcery. "Destroy two target nonblack creatures unless
// either one is a color the other isn't. They can't be regenerated."
//
// The "unless" clause is a RESOLUTION gate, not a targeting restriction: any
// two nonblack creatures are legal targets, and the comparison is made when
// the spell resolves. So the two halves land on different fields —
// `excludeColors: "B"` on the announced requirement (CR 105.2, the same
// "target nonblack creature" spelling Terror uses), and the colour-IDENTITY
// gate on an `if` whose predicate is the new `sameColors` (issue #3806).
//
// `sameColors`, not `sharesColor`: a green-white creature shares a colour with
// a mono-green one and is emphatically not the SAME colours as it, which is
// the whole point of the printed line. The predicate is the oracle's "unless
// either one is a color the other isn't" inverted into the gate that lets the
// destruction happen — a double negative on the card, a set equality here.
//
// Two COLOURLESS creatures ARE destroyed: neither is a colour the other isn't
// (CR 105.2c — colourless is the absence of colour, not a sixth colour). This
// is exactly where `sharesColor` would have been wrong, since a colourless
// object shares nothing with anything, itself included.
//
// One target gone by resolution destroys NEITHER creature — `sameColors` reads
// false on a missing side, which is CR 608.2b's "if part of the effect
// requires information about an illegal target, it fails to determine any such
// information; any part of the effect that requires that information won't
// happen".
//
// hand-tail: "Destroy two target nonblack creatures unless either one is a color the other isn't. They can't be regenerated." (#3806)
export const deadRingers: CardDefinition = {
    id: "9b78028c-3ebd-432d-b628-e1fa284f08f3", // APC 37
    name: "Dead Ringers",
    rarity: "common",
    oracleText:
        "Destroy two target nonblack creatures unless either one is a color the other isn't. They can't be regenerated.",
    manaCost: { X: 4, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 2, excludeColors: "B" },
    effects: [
        {
            op: "if",
            predicate: { sameColors: { target: 0 }, with: { target: 1 } },
            then: [
                {
                    op: "destroy",
                    target: { target: 0 },
                    cantBeRegenerated: true,
                },
                {
                    op: "destroy",
                    target: { target: 1 },
                    cantBeRegenerated: true,
                },
            ],
        },
    ],
};

// Mind Extraction — {2}{B} Sorcery. "As an additional cost to cast this spell,
// sacrifice a creature. Target player reveals their hand and discards all cards
// of each of the sacrificed creature's colors."
//
// The creature is gone before the spell is ever on the stack (CR 601.2f — the
// cost is paid at announcement), so the colours it is "of" can only be LAST
// KNOWN INFORMATION (CR 608.2h). `additionalCosts.sacrificeFilter` already
// snapshots the victim; issue #3806 adds its layer-5 colours (CR 613.1e) to
// that snapshot and the `{ sacrificed: { read: "colors" } }` form of
// `EffectCardFilter.color` that reads them back.
//
// "ALL cards of EACH of the ... colors" is the bulk `discard` filter shape
// (Cabal Therapy's, issue #2713) — no player choice, the filter alone decides
// — over the colour field's own OR-across-the-array semantics: a card is
// discarded if it is ANY of the sacrificed creature's colours, which for a
// gold victim is the union, not the intersection.
//
// Sacrificing a COLOURLESS creature discards nothing (CR 105.2c — there are no
// colours for a card to be "of"). That is the empty-set reading the dynamic
// filter fails CLOSED to, and it is also what the card does: the reveal still
// happens, the discard finds no matches.
//
// hand-tail: "Target player reveals their hand and discards all cards of each of the sacrificed creature's colors." (#3806)
export const mindExtraction: CardDefinition = {
    id: "7d77ddcc-e66b-4036-8a55-ec42953918d1", // APC 42
    name: "Mind Extraction",
    rarity: "common",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nTarget player reveals their hand and discards all cards of each of the sacrificed creature's colors.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    additionalCosts: { sacrificeFilter: { types: "Creature" } },
    targetRequirement: { type: "player", count: 1 },
    effects: [
        // CR 701.20a — the whole hand becomes public before anything is
        // discarded, so both players can check the discard against it.
        { op: "reveal", player: { target: 0 }, zone: "hand" },
        {
            op: "discard",
            player: { target: 0 },
            filter: { color: { sacrificed: { read: "colors" } } },
        },
    ],
};

// Zombie Boa — {4}{B} 3/3 Creature — Zombie Snake (issue #3809). "{1}{B}:
// Choose a color. Whenever this creature becomes blocked by a creature of that
// color this turn, destroy that creature. Activate only as a sorcery."
//
// The colour choice is the established `colorChoiceModes` composition (one
// `optionChoice` mode per colour, CR 105.1 — never colorless), each mode
// scheduling the SAME delayed trigger with its own literal colour. The trigger
// is the `becomes-blocked-by` watch (CR 509.3d): it watches this creature,
// fires once PER creature blocking it, and only for a blocker of the chosen
// colour — the colour is part of the trigger event, so a blocker of another
// colour puts nothing on the stack. "That creature" is the blocker, read off
// the live firing event. The watch lasts the rest of the turn (CR 514.2 purge)
// and each activation adds its own, so two activations naming the same colour
// destroy a blocker twice over — harmlessly — exactly as two instances would.
//
// compiler-gap: {1}{B}: Choose a color. Whenever this creature becomes blocked by a creature of that color this turn, destroy that creature. Activate only as a sorcery. (#2693)
export const zombieBoa: CardDefinition = {
    id: "1fb8c277-3154-47c9-835f-327cac297a5e", // APC 54
    name: "Zombie Boa",
    rarity: "common",
    oracleText:
        "{1}{B}: Choose a color. Whenever this creature becomes blocked by a creature of that color this turn, destroy that creature. Activate only as a sorcery.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Snake"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "zombie-boa-watch",
            oracleText:
                "{1}{B}: Choose a color. Whenever this creature becomes blocked by a creature of that color this turn, destroy that creature. Activate only as a sorcery.",
            cost: { mana: { X: 1, B: 1 } },
            useStack: true,
            sorcerySpeedOnly: true,
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose a color (Zombie Boa).",
                    modes: colorChoiceModes((color) => [
                        {
                            op: "delayedTrigger",
                            timing: "becomes-blocked-by",
                            oracleText:
                                "Whenever this creature becomes blocked by a creature of that color this turn, destroy that creature.",
                            watch: { ref: "$source" },
                            blockerColors: [color],
                            effects: [
                                {
                                    op: "destroy",
                                    target: { ref: "$event.blockerId" },
                                },
                            ],
                        },
                    ]),
                },
            ],
        },
    ],
};

// Suppress — {2}{B} Sorcery (issue #3812). "Target player exiles all cards
// from their hand face down. At the beginning of the end step of that player's
// next turn, that player returns those cards to their hand."
//
// Three engine pieces, none card-shaped:
//   • The exile is the whole-zone `moveZone` with `faceDown` — CR 406.3: the
//     oracle grants no look, so the cards "can't be examined by any player",
//     their owner included (no knower, `isFaceDownExile` reads the producer).
//   • `bindAll` records exactly the cards that went, and the delayed trigger
//     freezes them with a `{ select: { set: "bound" } }` list capture — CR
//     603.7c: a card that has since left exile is a new object and is not
//     returned.
//   • `player-next-turn-end-step` is "the end step of THAT PLAYER's NEXT
//     turn" (CR 603.7 / 513.1): targeting yourself skips this turn's end step.
// An empty hand exiles nothing and the trigger still fires, returning nothing.
//
// hand-tail: "Target player exiles all cards from their hand face down. At the beginning of the end step of that player's next turn, that player returns those cards to their hand." (#4342)
export const suppress: CardDefinition = {
    id: "642eefde-8727-44ff-9e04-373abfcd0679", // APC 52
    name: "Suppress",
    rarity: "uncommon",
    oracleText:
        "Target player exiles all cards from their hand face down. At the beginning of the end step of that player's next turn, that player returns those cards to their hand.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "moveZone",
            player: { target: 0 },
            from: "hand",
            to: "exile",
            faceDown: true,
            bindAll: "$exiled",
        },
        {
            op: "delayedTrigger",
            timing: "player-next-turn-end-step",
            oracleText:
                "At the beginning of the end step of that player's next turn, that player returns those cards to their hand.",
            targetPlayer: { target: 0 },
            capture: {
                $player: { target: 0 },
                $exiled: { select: { set: "bound", ref: "$exiled" } },
            },
            effects: [
                {
                    op: "moveZone",
                    cards: { ref: "$exiled" },
                    player: { ref: "$player" },
                    from: "exile",
                    to: "hand",
                },
            ],
        },
    ],
};
