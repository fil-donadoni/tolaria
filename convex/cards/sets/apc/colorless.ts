// APC — colorless cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { CREATURE_SUBTYPES } from "../../../oracle/grammar/shared/subtypes";

// Dragon Arch — {5} Artifact. "{2}, {T}: You may put a multicolored creature
// card from your hand onto the battlefield."
//
// Sneak Attack's hand → battlefield template (usg/red.ts) with the "You may"
// spelled as `count: { min: 0, max: 1 }` — declining is a legal answer, so the
// activation is never a trap — and the ONE thing this card adds over it:
// "multicolored" (CR 105.2b) as `colorCountAtLeast: 2` rather than an OR over
// the five colours, which would admit every mono-coloured card. No follow-up
// clause at all: the creature enters and STAYS (no haste grant, no delayed
// sacrifice), which is exactly what makes this card the cheap end of the
// reanimator-adjacent shell rather than a Sneak Attack variant.
//
// `moveZone(from: "hand", to: "battlefield")` is CR 400.7's zone change; the
// creature is not CAST — casting is the process that puts a spell ON THE
// STACK (CR 601.2), and this one never goes there, so no cast-triggers fire.
//
// hand-tail: "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield." (#3806)
export const dragonArch: CardDefinition = {
    id: "eec581b8-e509-420c-b142-afaa6dd06cc8", // APC 135
    name: "Dragon Arch",
    rarity: "uncommon",
    oracleText:
        "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "dragon-arch-put",
            oracleText:
                "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    // CR 105.2b — "multicolored" is a COUNT of colours, never a
                    // colour: two or more of the five.
                    filter: { type: "Creature", colorCountAtLeast: 2 },
                    count: { min: 0, max: 1 },
                    prompt: "Put a multicolored creature card from your hand onto the battlefield (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
};

// Brass Herald — {6} 2/2 Artifact Creature — Golem (issue #3809). Three
// abilities linked by ONE choice (CR 607.2d — "the chosen type" refers only to
// the choice its own "choose a creature type" ability made):
//
//  - "As this creature enters, choose a creature type." — the CR 614.1c /
//    614.12a replacement `entersWith.asEnters: { kind: "subtypes" }`, made
//    BEFORE it enters and stored on `CardInstanceState.chosenSubtypes`
//    (Engineered Plague's shape, `ulg/black.ts`), from CR 205.3m's own table.
//  - The ETB (CR 603.6a) is Goblin Ringleader's reveal-four template
//    (`apc/red.ts`) with the chosen type in the filter: the reserved
//    `$source.chosenSubtype` ref reads the source's stored choice — its
//    departure-time last-known record if Brass Herald left before the trigger
//    resolved (CR 608.2h) — and fails CLOSED (nothing is kept) when there is
//    none. "Creature cards of the chosen type" is BOTH conditions: `type`
//    AND `subtype`, so a Tribal/Kindred non-creature card of that type stays
//    in the bottom pile.
//  - "Creatures of the chosen type get +1/+1." — every controller's, itself
//    included when Golem is chosen; a live `pt-buff` predicate, so a creature
//    whose types change later (layer 4 before 7c) is read on the next pass.
//
// hand-tail: Creatures of the chosen type get +1/+1. (#4446)
export const brassHerald: CardDefinition = {
    id: "89bd60a7-2ba4-4fce-bf74-2ea9b8fd4dbe", // APC 133
    name: "Brass Herald",
    rarity: "uncommon",
    oracleText:
        "As this creature enters, choose a creature type.\nWhen this creature enters, reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order.\nCreatures of the chosen type get +1/+1.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 2,
    toughness: 2,
    entersWith: {
        asEnters: [
            { kind: "subtypes", from: [...CREATURE_SUBTYPES], count: 1 },
        ],
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "brass-herald-reveal",
            oracleText:
                "When this creature enters, reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order.",
            scope: "self",
            effects: [
                {
                    op: "lookDistribute",
                    player: "controller",
                    look: 4,
                    take: 4,
                    keepTo: "hand",
                    filter: {
                        type: "Creature",
                        subtype: { ref: "$source.chosenSubtype" },
                    },
                    optional: false,
                    reveal: "window",
                    prompt: "Put all creature cards of the chosen type revealed this way into your hand; the rest go on the bottom of your library in any order.",
                },
            ],
        }),
    ],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) => {
                const chosen = source.chosenSubtypes?.[0];
                if (chosen === undefined) return false;
                return ctx.isCreature(target) && ctx.hasSubtype(target, chosen);
            },
            power: 1,
            toughness: 1,
        },
    ],
};

// Dodecapod — {4} 3/3 Artifact Creature — Golem (issue #3814). "If a spell or
// ability an opponent controls causes you to discard this card, put it onto
// the battlefield with two +1/+1 counters on it instead of putting it into your
// graveyard."
//
// A CR 614.1a discard replacement read off the card while it is still in its
// owner's HAND — the only zone a discard ever takes a card from (CR 701.9a) —
// so it is `appliesFromAnyZone` and matches only its own instance. Its scope
// is the discard's `origin` (`DiscardOrigin`): an EFFECT (CR 609.1) whose
// controller is not the discarding player. Discarding it to pay a cost (CR 118,
// CR 118.12's "unless" payments included), to the cleanup hand-size rule
// (CR 514.1), or to your own spell never applies. The counters are put on it
// AS it enters (CR 122.6), through the shared entry path. It is still a
// discard (CR 701.9c; the card's ruling "you've still discarded it"), so
// "whenever you discard" triggers fire.
//
// hand-tail: If a spell or ability an opponent controls causes you to discard this card, put it onto the battlefield with two +1/+1 counters on it instead of putting it into your graveyard. (#4327)
export const dodecapod: CardDefinition = {
    id: "ded8b992-a1c2-4e43-ad0a-ea3995a3c8b8", // APC 134
    name: "Dodecapod",
    rarity: "uncommon",
    oracleText:
        "If a spell or ability an opponent controls causes you to discard this card, put it onto the battlefield with two +1/+1 counters on it instead of putting it into your graveyard.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
    replacementEffects: [
        {
            id: "dodecapod-discard",
            oracleText:
                "If a spell or ability an opponent controls causes you to discard this card, put it onto the battlefield with two +1/+1 counters on it instead of putting it into your graveyard.",
            eventKind: "discard",
            appliesFromAnyZone: true,
            appliesTo: (event, self) =>
                event.kind === "discard" &&
                event.cardInstanceId === self.id &&
                event.origin.kind === "effect" &&
                event.origin.controllerId !== event.playerId,
            replace: (event, ctx) => {
                if (event.kind !== "discard") return { kind: "consumed" };
                ctx.putHandCardOntoBattlefield(
                    event.playerId,
                    event.cardInstanceId,
                    { "+1/+1": 2 }
                );
                return { kind: "consumed" };
            },
        },
    ],
};

// Emblazoned Golem — {2} Artifact Creature — Golem, 1/2 (issue #3811). "Kicker
// {X} / Spend only colored mana on X. No more than one mana of each color may
// be spent this way. / If this creature was kicked, it enters with X +1/+1
// counters on it."
//
// Blocked on a VARIABLE Kicker: CR 107.3a gives the spell one announced X that
// its Kicker cost shares, but `foldKickerCosts` (`gre/kicker.ts`) normalizes
// the kicker mana with no chosen X, the cast dialog's X stepper keys off the
// printed cost, and the Bot's X enumeration never looks at a kicker — the
// Verdeloth the Ancient gap. Its spend clause is a SECOND, different
// constraint from `ManaCost.xSpendColors` (issue #3811): "only coloured, at
// most one of each colour" is a distinctness rule across the X pips, not a
// per-pip colour set, so it cannot be owed as pips and ships with the card.
// tracked-by: #2141
// export const emblazonedGolem: CardDefinition = {
//     id: "98527fc6-4f4c-4ded-9e72-49186b7e5bd3", // APC 136
//     name: "Emblazoned Golem",
//     rarity: "uncommon",
//     manaCost: { X: 2 },
//     types: ["Artifact", "Creature"],
//     subtypes: ["Golem"],
//     power: 1,
//     toughness: 2,
// };
