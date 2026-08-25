// PLS (Planeshift) — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    CardPrint,
    Color,
    TriggeredAbility,
} from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { drawTrigger } from "../../abilities/triggers/drawTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Keldon Twilight — {1}{B}{R} Enchantment. "At the beginning of each player's
// end step, if no creatures attacked this turn, that player sacrifices a
// creature of their choice that they controlled since the beginning of the
// turn." (issue #1944, parent PRD #1935.)
//
// Three CR clauses, all data:
//
//  * "each player's end step" — `phaseTrigger({ phase: "END_STEP", scope:
//    "each" })` (CR 603.6a). The sacrificing player is "that player", i.e. the
//    player whose end step it is, read inside the Effect Script as
//    `{ ref: "$event.activePlayerId" }` (issue #1066 / ADR 0049) rather than
//    the plain `"controller"` selector — under `scope: "each"` the two are
//    different players on the opponent's turn, and only the event ref is
//    correct under any scope.
//
//  * "if no creatures attacked this turn" — a CR 603.4 intervening-if, so the
//    factory checks it BOTH when the trigger would fire and again immediately
//    before it resolves (CR 603.4); an attack declared in between is
//    impossible, but a resolution-time re-check is what the rule says and what
//    `phaseTrigger` wires for free. It reads the GAME-level
//    `creatureAttackedThisTurn` flag, not a scan of the per-creature
//    `hasAttackedThisTurn` flags: CR 506.4 keeps a creature that attacked
//    "having attacked" after it leaves combat, and an attacker that died in
//    combat is no longer on any battlefield to scan — a scan would report "no
//    creatures attacked" exactly on the turns that saw the most combat. "No
//    creatures" is any player's creatures, which is what a game-level flag says
//    and a controller-scoped scan would not.
//
//  * "that they controlled since the beginning of the turn" — the new
//    `EffectCardFilter.controlledSinceTurnStart` clause, backed by
//    `hasControlledSinceTurnStart` (`gre/controlContinuity.ts`): the
//    `enteredOnTurn` entry stamp AND the turn-scoped
//    `GameState.controlChangedThisTurn` ledger together, so a creature that
//    entered this turn, one whose control changed this turn (in either
//    direction), and one that left and re-entered this turn are all excluded.
//    Strictly stronger than `enteredThisTurn: false`, which sees only zone
//    changes and would let a stolen creature through.
//
// The sacrifice is always the player's own explicit pick (`choice(kind:
// "sacrifice-permanents")` feeding `sacrifice`), never engine-auto-selected —
// the project-wide sacrifice-choice convention, and the shape Mana Vortex's
// each-upkeep land sacrifice (`drk/blue.ts`) already uses. With no legal
// creature the choice clamps to zero candidates and the ability does nothing
// (CR 608.2b); the trigger still goes on the stack under its full oracle text
// and visibly resolves, which is the engine's existing "nothing to choose"
// signal (same as Mana Vortex on a landless board) — there is no notify/log Op
// in the vocabulary to say more, and inventing one would be a stop-and-issue
// case, not an authoring liberty.
export const keldonTwilight: CardDefinition = {
    id: "e071665e-bb72-42e0-a42d-0d0ff02abd2b",
    rarity: "rare",
    name: "Keldon Twilight",
    oracleText:
        "At the beginning of each player's end step, if no creatures attacked this turn, that player sacrifices a creature of their choice that they controlled since the beginning of the turn.",
    manaCost: { X: 1, B: 1, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "keldon-twilight-end-step-sac",
            oracleText:
                "At the beginning of each player's end step, if no creatures attacked this turn, that player sacrifices a creature of their choice that they controlled since the beginning of the turn.",
            phase: "END_STEP",
            scope: "each",
            // CR 603.4 — checked at trigger time AND re-checked at
            // resolution by the factory.
            interveningIf: (_event, _self, state) =>
                state?.creatureAttackedThisTurn !== true,
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$event.activePlayerId" },
                    zone: "battlefield",
                    filter: {
                        type: "Creature",
                        controlledSinceTurnStart: true,
                    },
                    count: 1,
                    prompt: "Keldon Twilight: sacrifice a creature you have controlled since the beginning of the turn.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        }),
    ],
};

// Phyrexian Tyranny — {U}{B}{R} Enchantment. "Whenever a player draws a
// card, that player loses 2 life unless they pay {2}." (issue #1946, parent
// PRD #1935, ADR 0079.)
//
// CR 117.3a — an "unless that player pays" clause is offered to the player
// the trigger IDENTIFIES, not to the enchantment's controller: here, whoever
// just drew. `drawTrigger({ scope: "each" })` fires on EITHER player's draw
// (CR 121.1), and the drawing player is read straight off the firing
// `CardDrawnEvent` via the newly-censused `{ ref: "$event.playerId" }`
// (`EVENT_FIELD_REGISTRY.CARD_DRAWN`, ADR 0049, mirroring
// `PHASE_BEGIN.activePlayerId` / issue #1066) — NOT the plain `"controller"`
// selector, which under `scope: "each"` would always resolve to Phyrexian
// Tyranny's own controller regardless of who drew.
//
// CR 120.3 — cards are drawn ONE AT A TIME. The engine's `emitCardDrawn`
// (`gre/state.ts`) already emits one `CARD_DRAWN` event per card, so a
// draw-three (or the draw-step draw) fires this ability once per card with
// no card-side work: `drawTrigger` / `emitCardDrawn` are shared choke points
// every draw already funnels through.
//
// The "unless they pay {2}" half reuses the existing `mayPay` (CR 117.3a /
// 118.4) + `if`/`loseLife` shape — the exact "unless you pay" punisher
// template Force Spike / Hasran Ogress already ship (`arn/black.ts`) — with
// the payer resolved to the drawing player instead of `"controller"`. No new
// Op, no new primitive: only the `player` ref differs from every prior
// mayPay card.
export const phyrexianTyranny: CardDefinition = {
    id: "e8440ca8-73ca-462b-a735-f6fb3d0de603",
    rarity: "rare",
    name: "Phyrexian Tyranny",
    oracleText:
        "Whenever a player draws a card, that player loses 2 life unless they pay {2}.",
    manaCost: { U: 1, B: 1, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        drawTrigger({
            id: "phyrexian-tyranny-unless-pay",
            oracleText:
                "Whenever a player draws a card, that player loses 2 life unless they pay {2}.",
            scope: "each",
            effects: [
                {
                    op: "mayPay",
                    player: { ref: "$event.playerId" },
                    cost: { X: 2 },
                    prompt: "Pay {2} or lose 2 life to Phyrexian Tyranny?",
                    bind: "$paid",
                },
                {
                    // CR 119.3 — unless paid, the drawing player loses 2
                    // life (not damage — no "damage prevention" interaction,
                    // no Fog).
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [
                        {
                            op: "loseLife",
                            player: { ref: "$event.playerId" },
                            amount: 2,
                        },
                    ],
                },
            ],
        }),
    ],
};

// ────────────────────────────────────────────────────────────────────────────
// PLS free tranche — two-colour gold cards (issue #1953, parent PRD #1935,
// ADR 0079). Planeshift's gold slice is built around one recurring template:
// a cheap-for-its-body gold creature whose ETB MANDATORILY returns a creature
// you control of its own two colours to its owner's hand (CR 603.6a). Eleven
// cards share it verbatim, so it is factored into `bounceOnEntry` below rather
// than copy-pasted — the project's "closure on the first card, shared helper on
// the second" rule.
// ────────────────────────────────────────────────────────────────────────────

/** Shared Effect Script for the Planeshift "When this creature enters, return
 *  a <C1> or <C2> creature you control to its owner's hand" template
 *  (CR 603.6a trigger, CR 400.7 zone change).
 *
 *  MANDATORY, not "you may" — so there is no `mayPay` gate. The choice is the
 *  controller's own explicit pick (`choice(kind: "choose-permanents")` feeding
 *  `moveZone`), never engine-auto-selected, per the project-wide
 *  return-to-hand-is-a-player-choice convention.
 *
 *  The ENTERING creature is itself always a legal pick: it is on the
 *  battlefield by the time its own ETB trigger resolves (CR 603.6a — the
 *  trigger fires on the entry and only then goes on the stack), and every card
 *  using this helper shares at least one colour with the filter, which is
 *  exactly why Cavern Harpy / Fleetfoot Panther / Horned Kavu can always
 *  "bounce themselves" when the board is otherwise empty. `count: 1` clamps to
 *  the available candidates (CR 608.2b), so the pathological zero-candidate
 *  board is a visible no-op rather than a stuck resolution.
 *
 *  The picked id is routed through `forEach { set: "bound" }` rather than fed
 *  straight to `moveZone`: a `choice` Op's `bind` stores the RAW picks array,
 *  while `moveZone.target` expects a `bindSnapshot`-encoded object ref — the
 *  `forEach` per-member loop is what snapshots each pick as `$each`. */
function bounceOnEntry(
    cardSlug: string,
    colors: [Color, Color],
    colorWords: string,
    subject = "creature"
): TriggeredAbility {
    const clause = `return a ${colorWords} ${subject} you control to its owner's hand`;
    return enteredTrigger({
        id: `${cardSlug}-etb-bounce`,
        oracleText: `When this ${subject === "creature" ? "creature" : "enchantment"} enters, ${clause}.`,
        scope: "self",
        effects: [
            {
                op: "choice",
                kind: "choose-permanents",
                player: "controller",
                zone: "battlefield",
                filter: {
                    type: subject === "creature" ? "Creature" : "Enchantment",
                    color: [...colors],
                },
                count: 1,
                prompt: `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`,
                bind: "$bounce",
            },
            {
                op: "forEach",
                select: { set: "bound", ref: "$bounce" },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ],
    });
}

// Ancient Spider — {2}{G}{W} Creature — Spider, 2/5. Pure keyword data: both
// "first strike" (CR 702.7) and "reach" (CR 702.17) are already-implemented
// Mechanics Registry rows, so the card needs no script at all.
export const ancientSpider: CardDefinition = {
    id: "75ca99de-57e7-47c4-b40a-6e41e3b18069", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Ancient Spider",
    oracleText:
        "First strike; reach (This creature can block creatures with flying.)",
    manaCost: { X: 2, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Spider"],
    power: 2,
    toughness: 5,
    staticAbilities: ["first strike", "reach"],
};

// Cavern Harpy — {U}{B} Creature — Harpy Beast, 2/1. The set's engine piece:
// the mandatory ETB bounce plus a free self-bounce for 1 life, which together
// let it re-trigger any other ETB indefinitely. The self-bounce is a plain
// activated ability with a CR 119.4 life cost (`cost: { life: 1 }`) — no mana,
// no tap, so it is usable the turn it enters (summoning sickness only gates
// {T} costs, CR 302.6).
export const cavernHarpy: CardDefinition = {
    id: "adfb0804-50d6-4bca-8733-72e01030a543", // PLS printing (scryfallId)
    rarity: "common",
    name: "Cavern Harpy",
    oracleText:
        "Flying\nWhen this creature enters, return a blue or black creature you control to its owner's hand.\nPay 1 life: Return this creature to its owner's hand.",
    manaCost: { U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Harpy", "Beast"],
    power: 2,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        bounceOnEntry("cavern-harpy", ["U", "B"], "blue or black"),
    ],
    activatedAbilities: [
        {
            id: "cavern-harpy-self-bounce",
            oracleText: "Pay 1 life: Return this creature to its owner's hand.",
            cost: { life: 1 },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};

// Daring Leap — {1}{W}{U} Instant. One target creature, three until-end-of-turn
// riders: a CR 613 layer-7c P/T modification (`pump`) and two CR 702 keyword
// grants (`grantAbility`). Three already-exercised Ops, no new vocabulary.
export const daringLeap: CardDefinition = {
    id: "37ec6c4b-2de0-4759-a25d-007706cb18cc", // PLS printing (scryfallId)
    rarity: "common",
    name: "Daring Leap",
    oracleText:
        "Target creature gets +1/+1 and gains flying and first strike until end of turn.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "pump",
            target: { target: 0 },
            power: 1,
            toughness: 1,
            duration: { phase: "end-of-turn" },
        },
        {
            op: "grantAbility",
            target: { target: 0 },
            ability: "flying",
            duration: { phase: "end-of-turn" },
        },
        {
            op: "grantAbility",
            target: { target: 0 },
            ability: "first strike",
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Eladamri's Call — {G}{W} Instant. The canonical CR 701.23 search: search,
// reveal (CR 701.20 — the reveal is public and is what distinguishes this from
// Demonic Tutor's silent fetch), put into hand, shuffle. `count: { min: 0,
// max: 1 }` because a search may legally fail to find (CR 701.23b) — a library
// with no creature card is a legal, visible no-op, not a stuck resolution.
export const eladamrisCall: CardDefinition = {
    id: "dcb79f39-5ef3-4ad6-9a43-04beb27d8480", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Eladamri's Call",
    oracleText:
        "Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
    manaCost: { G: 1, W: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Creature" },
            count: { min: 0, max: 1 },
            prompt: "Search your library for a creature card.",
            bind: "$called",
        },
        { op: "reveal", player: "controller", cards: { ref: "$called" } },
        {
            op: "moveZone",
            cards: { ref: "$called" },
            player: "controller",
            from: "library",
            to: "hand",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};

// Fleetfoot Panther — {1}{G}{W} Creature — Cat, 3/4. Flash (CR 702.8) is the
// whole point: cast in response, bounce a creature that is about to die or
// whose ETB you want again.
export const fleetfootPanther: CardDefinition = {
    id: "b70220d8-f81b-44a4-b92e-d66de8c1b4ce", // PLS printing (scryfallId)
    rarity: "uncommon",
    name: "Fleetfoot Panther",
    oracleText:
        "Flash\nWhen this creature enters, return a green or white creature you control to its owner's hand.",
    manaCost: { X: 1, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 3,
    toughness: 4,
    staticAbilities: ["flash"],
    triggeredAbilities: [
        bounceOnEntry("fleetfoot-panther", ["G", "W"], "green or white"),
    ],
};

// Gerrard's Command — {G}{W} Instant. Untap (CR 701.26b) then a CR 613 layer-7c
// pump, in oracle order.
export const gerrardsCommand: CardDefinition = {
    id: "d0fda263-b6a7-43e3-998a-72a9d84c4572", // PLS printing (scryfallId)
    rarity: "common",
    name: "Gerrard's Command",
    oracleText: "Untap target creature. It gets +3/+3 until end of turn.",
    manaCost: { G: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        { op: "tapUntap", action: "untap", target: { target: 0 } },
        {
            op: "pump",
            target: { target: 0 },
            power: 3,
            toughness: 3,
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Horned Kavu — {R}{G} Creature — Kavu, 3/4. A two-mana 3/4 whose whole cost is
// the mandatory bounce.
export const hornedKavu: CardDefinition = {
    id: "ecd79fbf-626d-4549-917b-435f16b973d9", // PLS printing (scryfallId)
    rarity: "common",
    name: "Horned Kavu",
    oracleText:
        "When this creature enters, return a red or green creature you control to its owner's hand.",
    manaCost: { R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 4,
    triggeredAbilities: [
        bounceOnEntry("horned-kavu", ["R", "G"], "red or green"),
    ],
};

// Lava Zombie — {1}{B}{R} Creature — Zombie, 4/3. Bounce template plus a
// firebreathing-shaped generic pump.
export const lavaZombie: CardDefinition = {
    id: "fd87185b-1242-4fb3-abee-44bc267ee5fb", // PLS printing (scryfallId)
    rarity: "common",
    name: "Lava Zombie",
    oracleText:
        "When this creature enters, return a black or red creature you control to its owner's hand.\n{2}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 1, B: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 4,
    toughness: 3,
    triggeredAbilities: [
        bounceOnEntry("lava-zombie", ["B", "R"], "black or red"),
    ],
    activatedAbilities: [
        {
            id: "lava-zombie-pump",
            oracleText: "{2}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Malicious Advice — {X}{U}{B} Instant. "Tap X target artifacts, creatures,
// and/or lands. You lose X life."
//
// The variable target COUNT is `count: "X"` (CR 107.3 / 601.2c — X is chosen at
// announcement and the target count is fixed there, not at resolution), the
// same shape Word of Binding (`drk/black.ts`) and Distorting Wake
// (`inv/blue.ts`) already use. The heterogeneous "artifacts, creatures, and/or
// lands" set is the array form of `TargetRequirement.type` — one requirement
// admitting three card types, NOT three separate requirements, because the
// player chooses freely among them (all X may be lands).
//
// The life loss is X too, read through the `{ X: true }` EffectValue. It is
// life LOSS, not damage (CR 119.3) — unpreventable by damage prevention. It is
// NOT independent of the targets, though: CR 608.2b fizzles the whole spell
// when EVERY target is illegal on resolution (`targetLegalityGate`,
// `gre/state.ts`), so nothing resolves and no life is lost. With at least one
// legal target left the spell resolves in full — the illegal targets are
// skipped and the life loss is still the announced X, not the surviving count.
export const maliciousAdvice: CardDefinition = {
    id: "7b1547c2-ae9f-4871-a675-4026bf20e7e1", // PLS printing (scryfallId)
    rarity: "common",
    name: "Malicious Advice",
    oracleText:
        "Tap X target artifacts, creatures, and/or lands. You lose X life.",
    manaCost: { X: "X", U: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Artifact", "Creature", "Land"], count: "X" },
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [
                { op: "tapUntap", action: "tap", target: { ref: "$each" } },
            ],
        },
        { op: "loseLife", player: "controller", amount: { X: true } },
    ],
};

// Marsh Crocodile — {2}{U}{B} Creature — Crocodile, 4/4. TWO separate ETB
// triggers (two Oracle lines = two `TriggeredAbility` entries, CR 603.1; they
// go on the stack in the controller's chosen order, CR 603.3b).
export const marshCrocodile: CardDefinition = {
    id: "813279d1-d7bd-4d49-bd9d-fc9a6595dd39", // PLS printing (scryfallId)
    rarity: "uncommon",
    name: "Marsh Crocodile",
    oracleText:
        "When this creature enters, return a blue or black creature you control to its owner's hand.\nWhen this creature enters, each player discards a card.",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Crocodile"],
    power: 4,
    toughness: 4,
    triggeredAbilities: [
        bounceOnEntry("marsh-crocodile", ["U", "B"], "blue or black"),
        enteredTrigger({
            id: "marsh-crocodile-etb-discard",
            oracleText:
                "When this creature enters, each player discards a card.",
            scope: "self",
            effects: [
                {
                    // CR 101.4 — `forEach { set: "players" }` walks players in
                    // APNAP order, so each player picks their own discard in
                    // turn order rather than the engine picking for them; with
                    // `simultaneous` the discards then happen together, so no
                    // player sees an earlier player's discarded card before
                    // making their own choice (CR 101.4a/101.4b).
                    op: "forEach",
                    select: { set: "players" },
                    simultaneous: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "discard-hand",
                            player: { ref: "$each" },
                            zone: "hand",
                            // CR 701.9a / 608.2b — the discard is MANDATORY, so
                            // it is an EXACT numeric count (the submit path
                            // enforces it as both floor and ceiling). The
                            // interpreter already clamps it to the hand
                            // actually held, raising no choice at all on an
                            // empty hand — `{ min: 0, max: 1 }` was not that
                            // clamp, it was a licence to discard nothing.
                            count: 1,
                            prompt: "Discard a card.",
                            bind: "$crocDiscard",
                        },
                        {
                            op: "discard",
                            player: { ref: "$each" },
                            cards: { ref: "$crocDiscard" },
                        },
                    ],
                },
            ],
        }),
    ],
};

// Razing Snidd — {4}{B}{R} Creature — Beast, 3/3. Bounce template plus a
// symmetric land sacrifice. "A land of their choice" is explicit in the modern
// Oracle text: each player picks their OWN land (CR 701.17a), which is the
// `choice(kind: "sacrifice-permanents")` feeding `sacrifice` shape Mana Vortex
// (`drk/blue.ts`) and Keldon Twilight (above) already use.
export const razingSnidd: CardDefinition = {
    id: "d2090b80-2ce2-4c9a-87fe-d221f3c677b4", // PLS printing (scryfallId)
    rarity: "uncommon",
    name: "Razing Snidd",
    oracleText:
        "When this creature enters, return a black or red creature you control to its owner's hand.\nWhen this creature enters, each player sacrifices a land of their choice.",
    manaCost: { X: 4, B: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        bounceOnEntry("razing-snidd", ["B", "R"], "black or red"),
        enteredTrigger({
            id: "razing-snidd-etb-sac-land",
            oracleText:
                "When this creature enters, each player sacrifices a land of their choice.",
            scope: "self",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    // CR 101.4 — every player picks (APNAP), then all the
                    // chosen lands are sacrificed together.
                    simultaneous: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "sacrifice-permanents",
                            player: { ref: "$each" },
                            zone: "battlefield",
                            filter: { type: "Land" },
                            count: 1,
                            prompt: "Sacrifice a land of your choice.",
                            bind: "$snidLand",
                        },
                        { op: "sacrifice", permanents: { ref: "$snidLand" } },
                    ],
                },
            ],
        }),
    ],
};

// Shivan Wurm — {3}{R}{G} Creature — Wurm, 7/7 trample. The template's payoff
// card: a five-mana 7/7 whose drawback is the mandatory bounce.
export const shivanWurm: CardDefinition = {
    id: "4bc72997-78b0-47aa-a029-bf55f77c3e73", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Shivan Wurm",
    oracleText:
        "Trample\nWhen this creature enters, return a red or green creature you control to its owner's hand.",
    manaCost: { X: 3, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 7,
    toughness: 7,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        bounceOnEntry("shivan-wurm", ["R", "G"], "red or green"),
    ],
};

// Silver Drake — {1}{W}{U} Creature — Drake, 3/3 flying.
export const silverDrake: CardDefinition = {
    id: "ac35ee86-96b2-47aa-a1ba-2988737f11ee", // PLS printing (scryfallId)
    rarity: "common",
    name: "Silver Drake",
    oracleText:
        "Flying\nWhen this creature enters, return a white or blue creature you control to its owner's hand.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        bounceOnEntry("silver-drake", ["W", "U"], "white or blue"),
    ],
};

// Sparkcaster — {2}{R}{G} Creature — Kavu, 5/3. Bounce template plus a targeted
// ping. CR 603.3d — a triggered ability chooses its targets when it is PUT ON
// THE STACK, which is what `TriggeredAbility.targetRequirement` wires; the
// modern Oracle text says "target player or planeswalker", the array form of
// `TargetRequirement.type`.
export const sparkcaster: CardDefinition = {
    id: "daf442b3-fa39-4f6a-90a0-22dcd9df649c", // PLS printing (scryfallId)
    rarity: "uncommon",
    name: "Sparkcaster",
    oracleText:
        "When this creature enters, return a red or green creature you control to its owner's hand.\nWhen this creature enters, it deals 1 damage to target player or planeswalker.",
    manaCost: { X: 2, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 5,
    toughness: 3,
    triggeredAbilities: [
        bounceOnEntry("sparkcaster", ["R", "G"], "red or green"),
        enteredTrigger({
            id: "sparkcaster-etb-ping",
            oracleText:
                "When this creature enters, it deals 1 damage to target player or planeswalker.",
            scope: "self",
            targetRequirement: { type: ["player", "Planeswalker"], count: 1 },
            effects: [
                {
                    op: "dealDamage",
                    amount: 1,
                    to: { target: 0 },
                    source: { ref: "$source" },
                },
            ],
        }),
    ],
};

// Steel Leaf Paladin — {4}{G}{W} Creature — Elf Knight, 4/4 first strike.
export const steelLeafPaladin: CardDefinition = {
    id: "28e8697f-fdf3-4a1a-a84d-dd29b17336c2", // PLS printing (scryfallId)
    rarity: "common",
    name: "Steel Leaf Paladin",
    oracleText:
        "First strike\nWhen this creature enters, return a green or white creature you control to its owner's hand.",
    manaCost: { X: 4, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Knight"],
    power: 4,
    toughness: 4,
    staticAbilities: ["first strike"],
    triggeredAbilities: [
        bounceOnEntry("steel-leaf-paladin", ["G", "W"], "green or white"),
    ],
};

// Terminate — {B}{R} Instant. The set's most-played card and the cleanest
// possible Effect Script: CR 701.8 destroy with the CR 701.19 regeneration
// shield explicitly denied (`cantBeRegenerated`, applied BEFORE the destroy so
// a shield already on the creature is stripped rather than consumed).
export const terminate: CardDefinition = {
    id: "190ca502-672d-4cc0-b6e0-b9de517058d0", // PLS printing (scryfallId)
    rarity: "common",
    name: "Terminate",
    oracleText: "Destroy target creature. It can't be regenerated.",
    manaCost: { B: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        { op: "destroy", target: { target: 0 }, cantBeRegenerated: true },
    ],
};

// Urza's Guilt — {2}{U}{B} Sorcery. "Each player draws two cards, then discards
// three cards, then loses 4 life."
//
// The two "then"s are CR 608.2 sequencing over the WHOLE group, not per player:
// every player draws, THEN every player discards, THEN every player loses life
// — so this is three successive `forEach { set: "players" }` passes rather than
// one pass with a three-Op body. That ordering is observable: a player who was
// at 4 life is still alive to discard, and a card drawn by the opponent is in
// hand (and therefore discardable) before anyone discards.
export const urzasGuilt: CardDefinition = {
    id: "d429233e-1cf9-4f87-b191-894a73e7a876", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Urza's Guilt",
    oracleText:
        "Each player draws two cards, then discards three cards, then loses 4 life.",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [{ op: "draw", player: { ref: "$each" }, count: 2 }],
        },
        {
            op: "forEach",
            select: { set: "players" },
            // CR 101.4 — every player chooses their three (APNAP), then all
            // the discards happen together.
            simultaneous: true,
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { ref: "$each" },
                    zone: "hand",
                    // CR 701.9a / 608.2b — the discard is MANDATORY: a plain
                    // numeric count is an EXACT count the submit path enforces
                    // as both floor and ceiling, and the interpreter already
                    // clamps it down to the hand actually held
                    // (`Math.min(op.count, available)`, and no choice at all on
                    // an empty hand). A `{ min: 0, max: 3 }` range would let a
                    // player legally submit `[]` and keep every card.
                    count: 3,
                    prompt: "Discard three cards.",
                    bind: "$guiltDiscard",
                },
                {
                    op: "discard",
                    player: { ref: "$each" },
                    cards: { ref: "$guiltDiscard" },
                },
            ],
        },
        {
            op: "forEach",
            select: { set: "players" },
            effects: [{ op: "loseLife", player: { ref: "$each" }, amount: 4 }],
        },
    ],
};

// Sawtooth Loon — {2}{W}{U} Creature — Bird, 2/2 flying. Bounce template plus
// a card-filtering ETB.
//
// "Put two cards from your hand on the BOTTOM of your library" is deliberately
// NOT the `putBack` Op: `putBack` is the CR 401.4 top-of-library shape (Jace's
// 0, Brainstorm) and has no bottom variant. The bottom is the `moveZone`
// cards-shape with `from: "hand"`, `to: "library"` — `moveCardById` appends to
// the library array, and `library[0]` is the top by convention, so an append IS
// the bottom. That `from: "hand"` → `to: "library"` pairing is a construct
// combination no shipped card exercises yet, so it earns its own hand-written
// GRE + wire test (per-Op regime, `.claude/rules/gre-development.md`).
//
// `count: 2` clamps to hand size (CR 608.2b) — a Loon resolving into an
// otherwise-empty hand puts back only the two cards it just drew.
export const sawtoothLoon: CardDefinition = {
    id: "31b0a87f-e946-4ef1-b30d-fe32c19a0f52", // PLS printing (scryfallId)
    rarity: "uncommon",
    name: "Sawtooth Loon",
    oracleText:
        "Flying\nWhen this creature enters, return a white or blue creature you control to its owner's hand.\nWhen this creature enters, draw two cards, then put two cards from your hand on the bottom of your library.",
    manaCost: { X: 2, W: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        bounceOnEntry("sawtooth-loon", ["W", "U"], "white or blue"),
        enteredTrigger({
            id: "sawtooth-loon-etb-filter",
            oracleText:
                "When this creature enters, draw two cards, then put two cards from your hand on the bottom of your library.",
            scope: "self",
            effects: [
                { op: "draw", player: "controller", count: 2 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 2,
                    prompt: "Put two cards from your hand on the bottom of your library.",
                    bind: "$bottomed",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$bottomed" },
                    player: "controller",
                    from: "hand",
                    to: "library",
                },
            ],
        }),
    ],
};

// Doomsday Specter — {2}{U}{B} Creature — Specter, 2/3 flying. Bounce template
// plus the Specter clause.
//
// NOT a `resolve()` card after all (issue #1953 flagged it as a candidate): the
// clause decomposes into two already-exercised Ops. "Look at that player's hand
// and choose a card from it" is `choice(kind: "choose-hand-card")` with
// `player: "controller"` (WHO chooses) split from `zoneOwnerId` (WHOSE hand) —
// the Thoughtseize shape (`lrw/black.ts`). Note there is deliberately NO
// `reveal` Op here: the Oracle text says "look at", a CR 701.20 private look
// for this creature's controller, not Thoughtseize's public "reveals their
// hand".
//
// The damaged player is read off the firing event through the censused
// `$event.damagedPlayer` ref (ADR 0049), the same way Blazing Specter
// (`inv/multicolor.ts`) does — NOT `"opponent"`, which would be the source's
// controller-relative opponent rather than the player actually dealt damage.
export const doomsdaySpecter: CardDefinition = {
    id: "85206cc1-5484-40c6-b11d-b8d6fad4fc5c", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Doomsday Specter",
    oracleText:
        "Flying\nWhen this creature enters, return a blue or black creature you control to its owner's hand.\nWhenever this creature deals combat damage to a player, look at that player's hand and choose a card from it. The player discards that card.",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Specter"],
    power: 2,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        bounceOnEntry("doomsday-specter", ["U", "B"], "blue or black"),
        {
            id: "doomsday-specter-combat-discard",
            oracleText:
                "Whenever this creature deals combat damage to a player, look at that player's hand and choose a card from it. The player discards that card.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "player",
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { ref: "$event.damagedPlayer" },
                    zone: "hand",
                    // CR 608.2b — an empty hand yields no candidates and the
                    // ability simply does nothing.
                    count: 1,
                    prompt: "Choose a card from that player's hand to discard.",
                    bind: "$specterPick",
                },
                {
                    op: "discard",
                    player: { ref: "$event.damagedPlayer" },
                    cards: { ref: "$specterPick" },
                },
            ],
        },
    ],
};

// Cloud Cover — {2}{W}{U} Enchantment. "Whenever another permanent you control
// becomes the target of a spell or ability an opponent controls, you may return
// that permanent to its owner's hand."
//
// CR 603.2b — the trigger event is `BECAME_TARGET`, emitted once per targeted
// object per targeting spell/ability, the same event Leovold (`cn2/multicolor.ts`)
// and Ward (CR 702.21a) already read. Three clauses, all in `matches`:
//   * "another permanent you control" — `event.target.type === "permanent"`
//     (a targeted PLAYER never triggers this), `event.target.id !== self.id`
//     ("another" — Cloud Cover itself does not bounce itself), and
//     `event.targetControllerId === self.controllerId`.
//   * "a spell or ability an opponent controls" —
//     `event.sourceControllerId !== self.controllerId`. `BECAME_TARGET` is
//     emitted for BOTH spells and abilities, so no stack-kind narrowing is
//     needed.
//
// "You may" is the bare cost-free `mayPay` + `if` shape (CR 601.2b), the same
// pairing Squee (`mmq/red.ts`) and Leovold use.
//
// "That permanent" is read off the firing event via the newly-censused
// `$event.targetPermanent` object ref (ADR 0049) — the object is neither the
// source nor an announced target slot, so no other construct can name it. The
// census row (`EVENT_FIELD_REGISTRY.BECAME_TARGET`, `cards/mechanicsRegistry.ts`)
// is the whole engine delta; the interpreter's generic `$event.<field>`
// object-family branch already resolves it, including the CR 608.2b
// battlefield-presence recheck that makes a permanent which already left the
// battlefield (killed in response) a silent no-op.
export const cloudCover: CardDefinition = {
    id: "943b3886-5556-474f-8dc1-18219e25abc3", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Cloud Cover",
    oracleText:
        "Whenever another permanent you control becomes the target of a spell or ability an opponent controls, you may return that permanent to its owner's hand.",
    manaCost: { X: 2, W: 1, U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "cloud-cover-return",
            oracleText:
                "Whenever another permanent you control becomes the target of a spell or ability an opponent controls, you may return that permanent to its owner's hand.",
            event: "BECAME_TARGET",
            matches: (event, self) =>
                event.type === "BECAME_TARGET" &&
                event.target.type === "permanent" &&
                event.target.id !== self.id &&
                event.targetControllerId === self.controllerId &&
                event.sourceControllerId !== self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Cloud Cover: return that permanent to its owner's hand?",
                    bind: "$cloudCoverReturn",
                },
                {
                    op: "if",
                    predicate: { binding: "$cloudCoverReturn" },
                    then: [
                        {
                            op: "moveZone",
                            target: { ref: "$event.targetPermanent" },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    ],
};

// Dralnu's Crusade — {1}{B}{R} Enchantment. "All Goblins get +1/+1. All Goblins
// are black and are Zombies in addition to their other creature types."
//
// A three-layer continuous static effect (CR 613), all DATA — the layer system
// (`gre/layers.ts`) computes it at read time:
//   * layer 4 (type/subtype) — `subtype-add` grants "Zombie". "In addition to
//     their other creature types" is exactly what `subtype-add` means (as
//     opposed to `subtype-set`, the Conspiracy-style replacement).
//   * layer 5 (colour) — see the DIVERGENCE (tracked-by: #2785) note below.
//   * layer 7c (P/T modification) — `pt-buff` +1/+1. NOT `pt-cda`: this is a
//     relative modification that stacks with other anthems, not a
//     characteristic-defining set.
//
// "ALL Goblins" is board-wide, either controller (CR 109.4) — the `applies`
// predicate deliberately carries NO `target.controllerId === source.controllerId`
// check, the same shape Bad Moon and Crusade (`lea/black.ts`, `lea/white.ts`)
// use. It also has no `target.id !== source.id` exclusion (unlike Goblin King's
// "OTHER Goblins"): Dralnu's Crusade is an Enchantment, never a Goblin itself,
// and the text has no "other".
//
// Layer dependency: the Goblin predicate reads `subtypes`, and the `subtype-add`
// only ADDS "Zombie" — a Goblin stays a Goblin, so the three effects cannot
// de-select each other regardless of application order.
//
// DIVERGENCE (tracked-by: #2785) (CR 613.1e / 105.2c) — "are black" is a colour SET (it replaces
// every other colour derivation), but the engine's only shipped layer-5 static
// is `color-grant`, which UNIONS the colour with the permanent's printed
// colours instead of replacing them. A mono-red Goblin correctly becomes black
// here; a Goblin that was already another colour keeps that colour as well, so
// e.g. protection from red still stops it. Same additive-vs-set gap Sinister
// Strength (`pls/black.ts`) documents in this very set, and the same tracking
// ticket — tracked-by: #2009.
export const dralnusCrusade: CardDefinition = {
    id: "6a35d227-4489-4a0b-8f81-eb8e5949e1fc", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Dralnu's Crusade",
    oracleText:
        "All Goblins get +1/+1.\nAll Goblins are black and are Zombies in addition to their other creature types.",
    manaCost: { X: 1, B: 1, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.hasSubtype(target, "Goblin"),
            power: 1,
            toughness: 1,
        },
        {
            kind: "subtype-add",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.hasSubtype(target, "Goblin"),
            subtypes: ["Zombie"],
        },
        {
            kind: "color-grant",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.hasSubtype(target, "Goblin"),
            colors: ["B"],
        },
    ],
};

// Natural Emergence — {2}{R}{G} Enchantment. "When this enchantment enters,
// return a red or green enchantment you control to its owner's hand.
// Lands you control are 2/2 creatures with first strike. They're still lands."
//
// The animation is three stacked continuous static effects (CR 613), all DATA:
//   * layer 4 (type) — `type-add` grants the Creature card type. The engine
//     APPENDS to `types[]` (`applySourceStaticEffects`, `gre/state.ts`) and
//     tracks the grant's origin, so "Land" is never removed. That append is
//     literally the "They're still lands" clause — a naive type-SET would break
//     it, which is why `type-add` (not `subtype-set`/a type replacement) is the
//     right primitive. A land that is now also a creature still taps for mana
//     and still counts for landfall/land-count effects.
//   * layer 7a (characteristic-defining P/T) — `pt-cda` computes a flat 2/2.
//     NOT `pt-buff`: a land's printed P/T is undefined, so an additive +2/+2
//     modification has nothing to modify; a CDA SETS the values, the same shape
//     Living Lands (`lea/green.ts`) and Kormus Bell (`lea/colorless.ts`) use for
//     exactly this "lands are N/N creatures" template.
//   * layer 6 (ability grant) — `keyword-grant` grants "first strike".
//
// "Lands YOU control" is the controller-scoped predicate
// (`target.controllerId === source.controllerId`), unlike Living Lands' global
// "All Forests". CR 302.6 — becoming a creature via a type grant does NOT reset
// summoning sickness, so a land that has been under your control since your
// turn began can attack the moment Natural Emergence resolves.
//
// The ETB is the same mandatory-return template as the gold creatures, retargeted
// at enchantments — and Natural Emergence itself is red-green, so it is always a
// legal choice (and the only one, on an otherwise enchantment-free board).
export const naturalEmergence: CardDefinition = {
    id: "c3eb4857-7c66-42e4-913c-97a0306366d5", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Natural Emergence",
    oracleText:
        "When this enchantment enters, return a red or green enchantment you control to its owner's hand.\nLands you control are 2/2 creatures with first strike. They're still lands.",
    manaCost: { X: 2, R: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        bounceOnEntry(
            "natural-emergence",
            ["R", "G"],
            "red or green",
            "enchantment"
        ),
    ],
    staticEffects: [
        {
            kind: "type-add",
            applies: (target, source) =>
                target.types.includes("Land") &&
                target.controllerId === source.controllerId,
            types: ["Creature"],
        },
        {
            kind: "pt-cda",
            applies: (target, source) =>
                target.types.includes("Land") &&
                target.controllerId === source.controllerId,
            compute: () => ({ power: 2, toughness: 2 }),
        },
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.types.includes("Land") &&
                target.controllerId === source.controllerId,
            keyword: "first strike",
        },
    ],
};

// Hull Breach — {R}{G} Sorcery. "Choose one — • Destroy target artifact.
// • Destroy target enchantment. • Destroy target artifact and target
// enchantment."
//
// CR 700.2 modal, so each mode carries its OWN `targetRequirement` and the
// card-level one stays undefined (CR 700.2d — only the chosen mode's targets
// need legal candidates).
//
// The third mode is two INDEPENDENT target groups, not one group of two: a
// single `{ type: ["Artifact", "Enchantment"], count: 2 }` requirement would
// happily let the player pick two artifacts, whereas the Oracle text forces
// exactly one of each. That is what `SpellMode.additionalTargetRequirements`
// (issue #1953) expresses — the per-mode twin of the card-level field Fumarole
// (`ice/multicolor.ts`) and Plague Spores (`inv/multicolor.ts`) already use.
// Groups are chosen in declaration order and concatenate onto the stack item's
// flat `targets` list, so the script reads them positionally: `{ target: 0 }`
// is the artifact, `{ target: 1 }` the enchantment.
//
// CR 700.2d also means mode 3 is simply unavailable when the board has no legal
// artifact OR no legal enchantment (`announceCast` validates every group before
// announcing) — the player falls back to mode 1 or 2, which is the correct
// rules outcome.
export const hullBreach: CardDefinition = {
    id: "6907fa19-29ed-4319-8835-68f424c92831", // PLS printing (scryfallId)
    rarity: "common",
    name: "Hull Breach",
    oracleText:
        "Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Destroy target artifact and target enchantment.",
    manaCost: { R: 1, G: 1 },
    types: ["Sorcery"],
    modes: [
        {
            id: "artifact",
            label: "Destroy target artifact",
            oracleText: "Destroy target artifact.",
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "enchantment",
            label: "Destroy target enchantment",
            oracleText: "Destroy target enchantment.",
            targetRequirement: { type: "Enchantment", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "both",
            label: "Destroy target artifact and target enchantment",
            oracleText: "Destroy target artifact and target enchantment.",
            targetRequirement: { type: "Artifact", count: 1 },
            additionalTargetRequirements: [{ type: "Enchantment", count: 1 }],
            effects: [
                { op: "destroy", target: { target: 0 } },
                { op: "destroy", target: { target: 1 } },
            ],
        },
    ],
};

// Meddling Mage — {W}{U} Creature — Human Wizard, 2/2. "As this creature
// enters, choose a nonland card name. Spells with the chosen name can't be
// cast."
//
// Two subsystems, deliberately kept apart:
//
//  1. The CHOICE (CR 614.12 / 614.12a) — "as it enters" is a replacement of
//     the entry event itself, raised on EVERY entry path (cast, reanimation, a
//     copy effect, `putFromHandOntoBattlefield`), not only a spell resolving —
//     `entersWith.asEnters`'s `name` kind (ADR 0100 D3, #2467). `filter:
//     { excludeType: "Land" }` is "nonland card name" enforced EXACTLY, closing
//     what the prior `resolveSteps` shape could only approximate (tracked-by: #2785) (its single
//     `nameRestriction: "no-basic-land"` rejected a basic land name but still
//     admitted a nonbasic one) — `applyNameCardSubmit`
//     (`convex/gre/pendingChoiceSubmit.ts`) checks the FULL filter, fail-closed,
//     at submit.
//
//  2. The RESTRICTION — a `cast-restriction` static (CR 601.3a), the SAME kind
//     Brand of Ill Omen (`ice/red.ts`) uses, evaluated read-time by the shared
//     cast gate `castProhibitionReason` (`cards/castRestrictions.ts`) that both
//     `getLegalActions` and the cast mutation call. Because it is a read-time
//     gate it needs no per-instance flag and auto-reverts the moment Meddling
//     Mage leaves the battlefield.
//
//     No frontend work: the client never re-derives cast legality — a hand
//     card's clickability reads the server-computed `legalActions` off the wire
//     (`src/components/board/board-hand-card.tsx`), and `getLegalActions`
//     already runs `castProhibitionReason`. The named card simply stops
//     offering "Cast", exactly as it does for Brand of Ill Omen.
//
//     CR 601.3a scope, faithfully: the lock applies to EVERY player (Meddling
//     Mage's own controller included) and only to CASTING. A named card can
//     still be discarded, cycled, put onto the battlefield by another effect,
//     or copied — none of those is casting.
export const meddlingMage: CardDefinition = {
    id: "176f84c6-aa5e-449c-bd2b-cc91a898f0c7", // PLS printing (scryfallId)
    rarity: "rare",
    name: "Meddling Mage",
    oracleText:
        "As this creature enters, choose a nonland card name.\nSpells with the chosen name can't be cast.",
    manaCost: { W: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    // AI valuation override (issue #1431 / #1519): the as-enters choice has no
    // Effect Script for `OP_VALUERS` to walk, so without this the bot would
    // price a 2/2 for two mana at the blind `base + MV` floor. Valued as a 2/2
    // body plus a soft Duress-grade disruption effect — real but conditional
    // (it only bites if the opponent holds a copy of the named card).
    aiValue: 150,
    entersWith: {
        asEnters: [{ kind: "name", filter: { excludeType: "Land" } }],
    },
    staticEffects: [
        {
            kind: "cast-restriction",
            id: "meddling-mage-name-lock",
            oracleText: "Spells with the chosen name can't be cast.",
            // CR 201.3 — names are compared exactly. The `name` as-enters
            // choice is mandatory (CR 614.12) and raised on every entry path
            // (#2467), so `chosenName` is set the instant the Mage exists; the
            // `undefined` guard is defensive, not a documented gap.
            forbids: (_caster, spell, source, _state, ctx) =>
                source.chosenName !== undefined &&
                ctx.getName(spell) === source.chosenName,
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PLS free tranche — three-colour gold cards + Ertai / Phelddagrif (#1954,
// parent PRD #1935). The four wedge Charms (Crosis's / Darigaaz's / Dromar's /
// Treva's) are modal instants (CR 601.2b "Choose one —"): the mode is chosen
// at ANNOUNCEMENT, before the spell goes on the stack, so each is
// `CardDefinition.modes: SpellMode[]` (the cast-time modal framework) rather
// than a resolution-time `optionChoice` Op — `optionChoice`'s own registry
// note and the catalogue guard `modalSpells.test.ts` both close that
// substitution for a genuine CR 700.2 spell mode (issue #1274). Each mode's
// body is an ordinary `effects: EffectOp[]`, the exact shape Hull Breach
// (this file, above) already ships. Every mode reuses already-exercised Ops
// (destroy / moveZone / dealDamage / pump / gainLife / counter / exile /
// draw / discard / choice) — no new Op, no `resolve()`.
// ─────────────────────────────────────────────────────────────────────────────

// Crosis's Charm — {U}{B}{R} Instant. "Choose one — Return target permanent
// to its owner's hand. / Destroy target nonblack creature. It can't be
// regenerated. / Destroy target artifact." (Modern Oracle text, verified
// against Scryfall — the 2001 printing read differently.) Mode 2 mirrors Dark
// Banishing's `excludeColors` + `cantBeRegenerated` shape exactly (ice/black.ts).
export const crosissCharm: CardDefinition = {
    id: "b59a9e75-9988-4040-a718-b1655fc20d11", // PLS 99
    rarity: "uncommon",
    name: "Crosis's Charm",
    oracleText:
        "Choose one —\n• Return target permanent to its owner's hand.\n• Destroy target nonblack creature. It can't be regenerated.\n• Destroy target artifact.",
    manaCost: { U: 1, B: 1, R: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "bounce",
            label: "Return target permanent to its owner's hand",
            oracleText: "Return target permanent to its owner's hand.",
            // "target permanent" of any type (Boomerang precedent, leg/blue.ts):
            // `type: "any"` only covers the CR 115.4 damageable set, so the
            // full CR 300.1 permanent-type list is used instead.
            targetRequirement: { type: [...PERMANENT_TYPES], count: 1 },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
        {
            id: "destroy-nonblack-creature",
            label: "Destroy target nonblack creature. It can't be regenerated.",
            oracleText:
                "Destroy target nonblack creature. It can't be regenerated.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeColors: "B",
            },
            effects: [
                {
                    op: "destroy",
                    target: { target: 0 },
                    cantBeRegenerated: true,
                },
            ],
        },
        {
            id: "destroy-artifact",
            label: "Destroy target artifact",
            oracleText: "Destroy target artifact.",
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Darigaaz's Charm — {B}{R}{G} Instant. "Choose one — Return target creature
// card from your graveyard to your hand. / Darigaaz's Charm deals 3 damage to
// any target. / Target creature gets +3/+3 until end of turn." Mode 1 mirrors
// Raise Dead's graveyard-target shape (lea/black.ts); mode 3 mirrors Giant
// Growth's `pump` shape (lea/green.ts).
export const darigaazsCharm: CardDefinition = {
    id: "cf4c9d6a-86eb-45be-9405-473eb263b94c", // PLS 100
    rarity: "uncommon",
    name: "Darigaaz's Charm",
    oracleText:
        "Choose one —\n• Return target creature card from your graveyard to your hand.\n• Darigaaz's Charm deals 3 damage to any target.\n• Target creature gets +3/+3 until end of turn.",
    manaCost: { B: 1, R: 1, G: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "regrowth-creature",
            label: "Return target creature card from your graveyard to your hand",
            oracleText:
                "Return target creature card from your graveyard to your hand.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
        {
            id: "damage",
            label: "Darigaaz's Charm deals 3 damage to any target",
            oracleText: "Darigaaz's Charm deals 3 damage to any target.",
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
        },
        {
            id: "pump",
            label: "Target creature gets +3/+3 until end of turn",
            oracleText: "Target creature gets +3/+3 until end of turn.",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 3,
                    toughness: 3,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Dromar's Charm — {W}{U}{B} Instant. "Choose one — You gain 5 life. /
// Counter target spell. / Target creature gets -2/-2 until end of turn."
export const dromarsCharm: CardDefinition = {
    id: "c7a1894c-af4e-4530-960f-2225916be8cb", // PLS 105
    rarity: "uncommon",
    name: "Dromar's Charm",
    oracleText:
        "Choose one —\n• You gain 5 life.\n• Counter target spell.\n• Target creature gets -2/-2 until end of turn.",
    manaCost: { W: 1, U: 1, B: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "gain-life",
            label: "You gain 5 life",
            oracleText: "You gain 5 life.",
            effects: [{ op: "gainLife", player: "controller", amount: 5 }],
        },
        {
            id: "counter",
            label: "Counter target spell",
            oracleText: "Counter target spell.",
            targetRequirement: { type: "spell", count: 1 },
            effects: [{ op: "counter", target: { target: 0 } }],
        },
        {
            id: "shrink",
            label: "Target creature gets -2/-2 until end of turn",
            oracleText: "Target creature gets -2/-2 until end of turn.",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: -2,
                    toughness: -2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Treva's Charm — {G}{W}{U} Instant. "Choose one — Destroy target
// enchantment. / Exile target attacking creature. / Draw a card, then discard
// a card." Mode 2's `combatRoleFilter: "attacking"` mirrors the DRK
// precedent (drk/colorless.ts); mode 3's draw-then-discard mirrors Jalum
// Tome's loot shape (atq/colorless.ts).
export const trevasCharm: CardDefinition = {
    id: "72acb67d-01cb-4fde-8b0b-199e8d1e396a", // PLS 129
    rarity: "uncommon",
    name: "Treva's Charm",
    oracleText:
        "Choose one —\n• Destroy target enchantment.\n• Exile target attacking creature.\n• Draw a card, then discard a card.",
    manaCost: { G: 1, W: 1, U: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "destroy-enchantment",
            label: "Destroy target enchantment",
            oracleText: "Destroy target enchantment.",
            targetRequirement: { type: "Enchantment", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "exile-attacker",
            label: "Exile target attacking creature",
            oracleText: "Exile target attacking creature.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            effects: [{ op: "exile", target: { target: 0 } }],
        },
        {
            id: "loot",
            label: "Draw a card, then discard a card",
            oracleText: "Draw a card, then discard a card.",
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        },
    ],
};

// Destructive Flow — {B}{R}{G} Enchantment. "At the beginning of each
// player's upkeep, that player sacrifices a nonbasic land of their choice."
// (Modern Oracle — the 2001 printing read "loses 2 life" for a nonland
// permanent; current wording is the land-sacrifice-only version verified via
// Scryfall.) Mirrors Mana Vortex's each-upkeep land-sacrifice trigger
// (drk/blue.ts) exactly, filtered to nonbasic via `excludeSupertype: "Basic"`
// instead of a bare land filter. `{ ref: "$event.activePlayerId" }` (issue
// #1066 / ADR 0049) reads the player whose upkeep it is — needed under
// `scope: "each"`, where that differs from the ability's own `"controller"`
// on the opponent's turn. Zero matching nonbasic lands clamps the choice to
// zero and the sacrifice is a no-op (CR 701.21a / 608.2b).
export const destructiveFlow: CardDefinition = {
    id: "7db86e34-c3ec-4a29-8779-81350a985644", // PLS 102
    rarity: "rare",
    name: "Destructive Flow",
    oracleText:
        "At the beginning of each player's upkeep, that player sacrifices a nonbasic land of their choice.",
    manaCost: { B: 1, R: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "destructive-flow-upkeep-sac",
            oracleText:
                "At the beginning of each player's upkeep, that player sacrifices a nonbasic land of their choice.",
            phase: "UPKEEP",
            scope: "each",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$event.activePlayerId" },
                    zone: "battlefield",
                    filter: { type: "Land", excludeSupertype: "Basic" },
                    count: 1,
                    prompt: "Destructive Flow: sacrifice a nonbasic land.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        }),
    ],
};

// Ertai, the Corrupted — {2}{W}{U}{B} Legendary Creature — Phyrexian Human
// Wizard, 3/4. "{U}, {T}, Sacrifice a creature or enchantment: Counter target
// spell." (Modern Oracle — the 2001 printing additionally named "activated or
// triggered ability"; current wording, verified via Scryfall, counters only a
// spell.) Two printings within PLS itself (PLS 107 / 107★ foil-only alt art,
// ADR 0014) — the canonical `CardDefinition` plus a sibling `CardPrint`,
// mirroring Skyship Weatherlight's own alt-art pair (colorless.ts, this set).
export const ertaiTheCorrupted: CardDefinition = {
    id: "66b950d9-8fef-4deb-b51b-26edb90abc56", // PLS 107 (canonical art)
    rarity: "rare",
    name: "Ertai, the Corrupted",
    oracleText:
        "{U}, {T}, Sacrifice a creature or enchantment: Counter target spell.",
    manaCost: { X: 2, W: 1, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Phyrexian", "Human", "Wizard"],
    power: 3,
    toughness: 4,
    activatedAbilities: [
        {
            id: "ertai-corrupted-counter",
            oracleText:
                "{U}, {T}, Sacrifice a creature or enchantment: Counter target spell.",
            cost: {
                mana: { U: 1 },
                tap: true,
                sacrificeFilter: { types: ["Creature", "Enchantment"] },
            },
            useStack: true,
            targetRequirement: { type: "spell", count: 1 },
            effects: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};

export const ertaiTheCorruptedAlt: CardPrint = {
    printId: "fbbfeb32-1654-4bf6-9a38-891f1a03e02b", // PLS 107★
    definitionId: ertaiTheCorrupted.id,
    setCode: "pls",
    rarity: "rare",
};

// Questing Phelddagrif — {1}{G}{W}{U} Legendary Creature — Phelddagrif, 4/4.
// "{G}: This creature gets +1/+1 until end of turn. Target opponent creates a
// 1/1 green Hippo creature token.\n{W}: This creature gains protection from
// black and from red until end of turn. Target opponent gains 2 life.\n{U}:
// This creature gains flying until end of turn. Target opponent may draw a
// card." Each ability pumps/grants Phelddagrif a keyword AND hands the
// TARGETED opponent a benefit — three independent `activatedAbilities[]`, no
// `resolve()`: the {U} ability's "target opponent MAY draw a card" is a
// cost-free `mayPay` whose `player` ref is the announced opponent target
// (`{ target: 0 }`, not `"controller"`) — the exact cross-player mayPay shape
// already shipped for "Counter target spell unless ITS CONTROLLER pays {N}"
// (`player: { controllerOf: { target: 0 } }`, e.g. ice/blue.ts), just resolved
// through the plain `{ target }` selector instead of `controllerOf`. The {W}
// ability's two-colour protection grant is two independent `grantAbility`
// Ops (Crimson Acolyte / Obsidian Acolyte precedent, inv/white.ts) — a
// temporary grant has no combined-quality string, unlike a permanent
// `staticAbilities[]` declaration (Sabertooth Nishoba, inv/multicolor.ts).
// Token art: Scryfall carries no printed "1/1 green Hippo" token (Questing
// Phelddagrif predates linked token products) — the TAKH Hippo token (3/3
// green Hippo) is the only Hippo token Scryfall has at all, pinned as a
// same-characteristics substitute (name/colour/creature-type match; P/T is
// carried by the TokenSpec itself, not the art).
export const questingPhelddagrif: CardDefinition = {
    id: "cea4cfef-6736-42a5-9f3e-10de8d0cd8d3", // PLS 119
    rarity: "rare",
    name: "Questing Phelddagrif",
    oracleText:
        "{G}: This creature gets +1/+1 until end of turn. Target opponent creates a 1/1 green Hippo creature token.\n{W}: This creature gains protection from black and from red until end of turn. Target opponent gains 2 life.\n{U}: This creature gains flying until end of turn. Target opponent may draw a card.",
    manaCost: { X: 1, G: 1, W: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Phelddagrif"],
    power: 4,
    toughness: 4,
    activatedAbilities: [
        {
            id: "questing-phelddagrif-green",
            oracleText:
                "{G}: This creature gets +1/+1 until end of turn. Target opponent creates a 1/1 green Hippo creature token.",
            cost: { mana: { G: 1 } },
            useStack: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "createToken",
                    token: {
                        name: "Hippo",
                        types: ["Creature"],
                        subtypes: ["Hippo"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                        // TAKH's printed Hippo token — same-characteristics
                        // substitute (see card-level note above).
                        imagePrintId: "1aea5e0b-dc4e-4055-9e13-1dfbc25a2f00",
                    },
                    controller: { target: 0 },
                },
            ],
        },
        {
            id: "questing-phelddagrif-white",
            oracleText:
                "{W}: This creature gains protection from black and from red until end of turn. Target opponent gains 2 life.",
            cost: { mana: { W: 1 } },
            useStack: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                {
                    op: "grantAbility",
                    ability: "protection from black",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    ability: "protection from red",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "gainLife",
                    player: { target: 0 },
                    amount: 2,
                },
            ],
        },
        {
            id: "questing-phelddagrif-blue",
            oracleText:
                "{U}: This creature gains flying until end of turn. Target opponent may draw a card.",
            cost: { mana: { U: 1 } },
            useStack: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "mayPay",
                    player: { target: 0 },
                    prompt: "Draw a card (Questing Phelddagrif)?",
                    bind: "$draw",
                },
                {
                    op: "if",
                    predicate: { binding: "$draw" },
                    then: [{ op: "draw", player: { target: 0 }, count: 1 }],
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PLS C4 — source-scoped prevention shields (#1955, parent PRD #1935).
// ─────────────────────────────────────────────────────────────────────────────

// Radiant Kavu — {R}{G}{W} Creature — Kavu, 3/3. "{R}{G}{W}: Prevent all
// combat damage blue creatures and black creatures would deal this turn."
// (CR 615 / 615.6 / 202.2.)
//
// The FILTER-scoped prevention shape: no target is named at all, so this is
// the `preventDamage` mode `"all-from-matching"` (issue #1955) rather than the
// id-scoped `"all-from-source"` its two white/green siblings use. The match is
// re-evaluated at the moment damage would be dealt, which is what makes "blue
// creatures and black creatures" cover a creature that BECOMES blue or black
// after the ability resolves (CR 615.6) as well as one that already was.
// `colors` is an OR-set (CR 202.2 — blue OR black, not both), and `cardType`
// pins it to creatures so a blue artifact's ping is untouched.
export const radiantKavu: CardDefinition = {
    id: "153077a8-38c0-44aa-9b84-cdd9ade50ad6", // PLS 120
    rarity: "rare",
    name: "Radiant Kavu",
    oracleText:
        "{R}{G}{W}: Prevent all combat damage blue creatures and black creatures would deal this turn.",
    manaCost: { R: 1, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "radiant-kavu-prevent",
            oracleText:
                "{R}{G}{W}: Prevent all combat damage blue creatures and black creatures would deal this turn.",
            cost: { mana: { R: 1, G: 1, W: 1 } },
            useStack: true,
            effects: [
                {
                    op: "preventDamage",
                    mode: "all-from-matching",
                    match: { colors: ["U", "B"], cardType: "Creature" },
                    combatOnly: true,
                },
            ],
        },
    ],
};

// Rith's Charm — {R}{G}{W} Instant. "Choose one — Destroy target nonbasic
// land. / Create three 1/1 green Saproling creature tokens. / Prevent all
// damage a source of your choice would deal this turn." (Modern Oracle text,
// verified against Scryfall.) A cast-time modal instant like its four wedge
// siblings above (`modes: SpellMode[]`, CR 601.2b / 700.2).
//
// Mode 3 is the ALL-damage form of the source-scoped shield — `combatOnly`
// omitted, so a shielded creature's activated-ability ping and a shielded
// burn spell are prevented as well as combat damage. That is the whole point
// of the clause versus Falling Timber's combat-only one.
//
// DIVERGENCE (tracked-by: #2785) — "a source of your choice" is NOT a target (CR 609.7), but the
// engine has no non-targeted source picker that can also reach a SPELL on the
// stack, so the mode declares a `targetRequirement` instead. This follows the
// shipped Circle of Protection precedent exactly (`makeCircleOfProtection`,
// `cards/abilities/index.ts`, whose whole cycle chooses its source the same
// way). Observable consequence: a shrouded/hexproof source cannot be chosen
// and "becomes the target" triggers fire when they should not.
// tracked-by: #2051.
//
// Players are excluded from the requirement (`PERMANENT_TYPES` + `"spell"`
// rather than the CoP cycle's `"any"`): a damage source is an object
// (CR 609.7), and a player-typed pick would key a shield that matches no
// damage source at all.
export const rithsCharm: CardDefinition = {
    id: "dd30f389-bac8-4b82-a8a7-6948d43a9f60", // PLS 122
    rarity: "uncommon",
    name: "Rith's Charm",
    oracleText:
        "Choose one —\n• Destroy target nonbasic land.\n• Create three 1/1 green Saproling creature tokens.\n• Prevent all damage a source of your choice would deal this turn.",
    manaCost: { R: 1, G: 1, W: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "destroy-nonbasic-land",
            label: "Destroy target nonbasic land",
            oracleText: "Destroy target nonbasic land.",
            targetRequirement: {
                type: "Land",
                count: 1,
                excludeSupertypes: "Basic",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "saprolings",
            label: "Create three 1/1 green Saproling creature tokens",
            oracleText: "Create three 1/1 green Saproling creature tokens.",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Saproling",
                        types: ["Creature"],
                        subtypes: ["Saproling"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                    },
                    controller: "controller",
                    count: 3,
                },
            ],
        },
        {
            id: "prevent-source",
            label: "Prevent all damage a source of your choice would deal this turn",
            oracleText:
                "Prevent all damage a source of your choice would deal this turn.",
            targetRequirement: {
                type: [...PERMANENT_TYPES, "spell"],
                count: 1,
            },
            effects: [
                {
                    op: "preventDamage",
                    mode: "all-from-source",
                    source: { target: 0 },
                },
            ],
        },
    ],
};
