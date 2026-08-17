// ECL — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition, EffectOp, PermanentView } from "../../types";
import { PROTECTION_FROM_EACH_OPPONENT } from "../../../gre/protection";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { evokeTrigger } from "../../abilities/evoke";

// ═══════════════════════════════════════════════════════════════════════════
// ECL Elemental Incarnation cycle — Vibrance / Deceit / Wistfulness
// (Vintage Cube, issues #682/#684, shipped by #1927 under PRD #1736).
//
// Every member shares one shape, so it is documented once here:
//
//  • COST — printed {N}{A/B}{A/B} and Evoke {A/B}{A/B}, both GUILD-HYBRID (CR
//    202.1a / 107.4e) declared via `ManaCost.hybrid` and payable with mana of
//    either colour (PRD #1736, #1738/#1739). That cost gap — NOT evoke, NOT
//    spent-mana tracking, both of which shipped with #900 — is the single
//    thing that kept all three stubbed.
//
//  • EVOKE (CR 702.74a) is two abilities. The alternative cast permission is
//    `CardDefinition.evoke` (an `AlternativeCost` with a pure MANA leg — the
//    Dash-shaped `mana` field, not Solitude/Grief's `handCost` pitch leg);
//    the "sacrifice it when it enters" half is `evokeTrigger(name)`, added
//    alongside the card's own ETB abilities.
//
//  • "IF {C}{C} WAS SPENT TO CAST IT" (CR 106.4 / 202.3, issue #900) —
//    `noteManaSpent: true` makes the engine record the per-colour mana spent
//    on the cast; `resolveTopOfStack` snapshots it onto the entering
//    permanent as `notedManaSpentOnCast`, which each ETB ability reads from
//    its CR 603.4 check-time `condition`. A colour clause and the evoke cost
//    interact exactly as printed: evoking Vibrance for {R/G}{R/G} paid with
//    two red mana still satisfies "if {R}{R} was spent".
//
//  • Two Oracle sentences = two independent `TriggeredAbility` entries, each
//    with its own condition and (where the sentence targets) its own
//    `targetRequirement` — a trigger whose condition fails is never put on
//    the stack, so no target is chosen for it.
//
// DSL-first (ADR 0045): every Op used below is already exercised by a shipped
// card (Grief's reveal/choose/discard, Expedition Map's search-reveal-to-hand,
// Teferi's bounce, Relic of Sauron's loot, Zuran Spellcaster's dealDamage), so
// the per-Op regime applies — no hand-written per-card GRE or wire test.
// ═══════════════════════════════════════════════════════════════════════════

/** "If {C}{C} was spent to cast it" (CR 106.4) — a check-time `condition`
 *  over the permanent's `notedManaSpentOnCast` snapshot. Generic in colour
 *  and pip count so all three Incarnations share one predicate. */
function manaSpentOnCastAtLeast(color: string, pips: number) {
    return (_event: unknown, self: PermanentView): boolean =>
        (self.notedManaSpentOnCast?.[color] ?? 0) >= pips;
}

// Vibrance — {3}{R/G}{R/G} Creature — Elemental Incarnation, 4/4 (ECL 249).
// "When this creature enters, if {R}{R} was spent to cast it, this creature
// deals 3 damage to any target. When this creature enters, if {G}{G} was
// spent to cast it, search your library for a land card, reveal it, put it
// into your hand, then shuffle. You gain 2 life. Evoke {R/G}{R/G}."
//
// The green clause's search is `count: { min: 0, max: 1 }` because CR 701.23b
// lets a player fail to find even on a mandatory search.
export const vibrance: CardDefinition = {
    id: "b9f71c3b-0840-475f-9c17-fdacbc7f3213",
    name: "Vibrance",
    rarity: "mythic",
    oracleText:
        "When this creature enters, if {R}{R} was spent to cast it, this creature deals 3 damage to any target.\nWhen this creature enters, if {G}{G} was spent to cast it, search your library for a land card, reveal it, put it into your hand, then shuffle. You gain 2 life.\nEvoke {R/G}{R/G}",
    manaCost: {
        generic: 3,
        hybrid: [
            ["R", "G"],
            ["R", "G"],
        ],
    },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 4,
    toughness: 4,
    noteManaSpent: true,
    evoke: {
        id: "evoke",
        description: "Evoke {R/G}{R/G}",
        mana: {
            hybrid: [
                ["R", "G"],
                ["R", "G"],
            ],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "vibrance-etb-damage",
            oracleText:
                "When this creature enters, if {R}{R} was spent to cast it, this creature deals 3 damage to any target.",
            scope: "self",
            condition: manaSpentOnCastAtLeast("R", 2),
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
        }),
        enteredTrigger({
            id: "vibrance-etb-land",
            oracleText:
                "When this creature enters, if {G}{G} was spent to cast it, search your library for a land card, reveal it, put it into your hand, then shuffle. You gain 2 life.",
            scope: "self",
            condition: manaSpentOnCastAtLeast("G", 2),
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Land" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a land card.",
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
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        }),
        evokeTrigger("Vibrance"),
    ],
};

// Figure of Fable — {G/W} Creature — Kithkin, 1/1 (Vintage Cube, issue #684,
// shipped by #1749). "{G/W}: This creature becomes a Kithkin Scout with base
// power and toughness 2/3. {1}{G/W}{G/W}: If this creature is a Scout, it
// becomes a Kithkin Soldier with base power and toughness 4/5.
// {3}{G/W}{G/W}{G/W}: If this creature is a Soldier, it becomes a Kithkin
// Avatar with base power and toughness 7/8 and protection from each of your
// opponents."
//
// The EVE-era Figure of Destiny (eve/multicolor.ts) is the reference shape;
// see its comment for the staged-respec design. This card differs in one
// instructive way: its type line genuinely REPLACES rather than accumulating
// (Scout → Soldier → Avatar, each dropping the previous), which is why the
// `setSubtype` (replace) Op is right for both and `addSubtype` is right for
// neither — under an additive Op this creature would stay a Scout forever and
// its second ability would remain re-activatable.
//
// The stub this replaces claimed the card needed a Level-Up-style engine
// primitive. It did not: it needed the INDEFINITE form of three Ops that
// already existed (issue #1746, CR 611.2b), the live-object `objectMatchesFilter`
// predicate (#1747), guild-hybrid pips payable with mana (#1738/#1739) and
// player-quality protection (#1748) — no card-shaped primitive at all.
export const figureOfFable: CardDefinition = {
    id: "e0ef33dd-5f6d-48fa-8ef6-a8092868d50f",
    name: "Figure of Fable",
    rarity: "rare",
    oracleText:
        "{G/W}: This creature becomes a Kithkin Scout with base power and toughness 2/3.\n{1}{G/W}{G/W}: If this creature is a Scout, it becomes a Kithkin Soldier with base power and toughness 4/5.\n{3}{G/W}{G/W}{G/W}: If this creature is a Soldier, it becomes a Kithkin Avatar with base power and toughness 7/8 and protection from each of your opponents.",
    manaCost: { hybrid: [["G", "W"]] },
    types: ["Creature"],
    subtypes: ["Kithkin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "figure-of-fable-scout",
            oracleText:
                "{G/W}: This creature becomes a Kithkin Scout with base power and toughness 2/3.",
            cost: { mana: { hybrid: [["G", "W"]] } },
            useStack: true,
            effects: [
                {
                    op: "setSubtype",
                    target: { ref: "$source" },
                    subtypes: ["Kithkin", "Scout"],
                },
                {
                    op: "setBasePT",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 3,
                },
            ],
        },
        {
            id: "figure-of-fable-soldier",
            oracleText:
                "{1}{G/W}{G/W}: If this creature is a Scout, it becomes a Kithkin Soldier with base power and toughness 4/5.",
            cost: {
                mana: {
                    generic: 1,
                    hybrid: [
                        ["G", "W"],
                        ["G", "W"],
                    ],
                },
            },
            useStack: true,
            effects: [
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$source" },
                        filter: { subtype: "Scout" },
                    },
                    then: [
                        {
                            op: "setSubtype",
                            target: { ref: "$source" },
                            subtypes: ["Kithkin", "Soldier"],
                        },
                        {
                            op: "setBasePT",
                            target: { ref: "$source" },
                            power: 4,
                            toughness: 5,
                        },
                    ],
                },
            ],
        },
        {
            id: "figure-of-fable-avatar",
            oracleText:
                "{3}{G/W}{G/W}{G/W}: If this creature is a Soldier, it becomes a Kithkin Avatar with base power and toughness 7/8 and protection from each of your opponents.",
            cost: {
                mana: {
                    generic: 3,
                    hybrid: [
                        ["G", "W"],
                        ["G", "W"],
                        ["G", "W"],
                    ],
                },
            },
            useStack: true,
            effects: [
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$source" },
                        filter: { subtype: "Soldier" },
                    },
                    then: [
                        {
                            op: "setSubtype",
                            target: { ref: "$source" },
                            subtypes: ["Kithkin", "Avatar"],
                        },
                        {
                            op: "setBasePT",
                            target: { ref: "$source" },
                            power: 7,
                            toughness: 8,
                        },
                        // CR 702.16j (issue #1748) — the PLAYER quality, whose
                        // opponent set is re-derived live from this permanent's
                        // own controller. Granted with no `duration` (CR
                        // 611.2b): it lasts as long as the permanent does.
                        {
                            op: "grantAbility",
                            target: { ref: "$source" },
                            ability: PROTECTION_FROM_EACH_OPPONENT,
                        },
                    ],
                },
            ],
        },
    ],
};

// The canonical Thoughtseize/Duress template (`reveal` + `choice
// (choose-hand-card)` with `zoneOwnerId`, lrw/black.ts), identical to Grief's
// (mh2/black.ts). "Target opponent" is deterministic in this engine's
// 2-player-only scope — no target selection needed, `player: "opponent"`
// resolves it directly (Grief/Archon of Cruelty precedent).
const opponentRevealsAndDiscardsNonland: EffectOp[] = [
    { op: "reveal", player: "opponent", zone: "hand" },
    {
        op: "choice",
        kind: "choose-hand-card",
        player: "controller",
        zoneOwnerId: "opponent",
        zone: "hand",
        filter: { excludeType: "Land" },
        count: 1,
        prompt: "Choose a nonland card from your opponent's hand.",
        bind: "$picked",
    },
    { op: "discard", player: "opponent", cards: { ref: "$picked" } },
];

// Deceit — {4}{U/B}{U/B} Creature — Elemental Incarnation, 5/5 (ECL 212,
// Vintage Cube edict/discard/hand disruption, issue #682). "When this
// creature enters, if {U}{U} was spent to cast it, return up to one other
// target nonland permanent to its owner's hand. When this creature enters, if
// {B}{B} was spent to cast it, target opponent reveals their hand. You choose
// a nonland card from it. That player discards that card. Evoke {U/B}{U/B}."
//
// The blue clause is a real CR 603.3d target chosen when the trigger goes on
// the stack: `[...PERMANENT_TYPES] + excludeTypes: "Land"` is "nonland
// permanent" (any controller's — no `controller` restriction), `excludeSource`
// drops Deceit itself ("other"), `count { min: 0, max: 1 }` is "up to one".
export const deceit: CardDefinition = {
    id: "bd82c9e4-9871-4e6d-b691-ee00b4b9a3c6",
    name: "Deceit",
    rarity: "mythic",
    oracleText:
        "When this creature enters, if {U}{U} was spent to cast it, return up to one other target nonland permanent to its owner's hand.\nWhen this creature enters, if {B}{B} was spent to cast it, target opponent reveals their hand. You choose a nonland card from it. That player discards that card.\nEvoke {U/B}{U/B}",
    manaCost: {
        generic: 4,
        hybrid: [
            ["U", "B"],
            ["U", "B"],
        ],
    },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 5,
    toughness: 5,
    noteManaSpent: true,
    evoke: {
        id: "evoke",
        description: "Evoke {U/B}{U/B}",
        mana: {
            hybrid: [
                ["U", "B"],
                ["U", "B"],
            ],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "deceit-etb-bounce",
            oracleText:
                "When this creature enters, if {U}{U} was spent to cast it, return up to one other target nonland permanent to its owner's hand.",
            scope: "self",
            condition: manaSpentOnCastAtLeast("U", 2),
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                excludeTypes: "Land",
                count: { min: 0, max: 1 },
                excludeSource: true,
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        }),
        enteredTrigger({
            id: "deceit-etb-discard",
            oracleText:
                "When this creature enters, if {B}{B} was spent to cast it, target opponent reveals their hand. You choose a nonland card from it. That player discards that card.",
            scope: "self",
            condition: manaSpentOnCastAtLeast("B", 2),
            effects: opponentRevealsAndDiscardsNonland,
        }),
        evokeTrigger("Deceit"),
    ],
};

// Wistfulness — {3}{G/U}{G/U} Creature — Elemental Incarnation, 6/5 (ECL
// 252, Vintage Cube, issue #684). "When this creature enters, if {G}{G} was
// spent to cast it, exile target artifact or enchantment an opponent
// controls. When this creature enters, if {U}{U} was spent to cast it, draw
// two cards, then discard a card. Evoke {G/U}{G/U}"
//
// HOME FILE (issue #1927): this card lived in `ecl/colorless.ts` only because
// the worklist importer's `parseManaCost` used to DROP hybrid `{G/U}` symbols
// (fixed by #1742/#1771), leaving it with an apparently colourless cost. With
// the pips declarable its colour identity is genuinely G/U (CR 202.2), so it
// belongs here alongside the rest of the cycle. `ecl/index.ts` re-exports
// both modules with `export *`, so the move needs no barrel edit.
export const wistfulness: CardDefinition = {
    id: "db9aa986-ac2a-44bb-a88b-04c5d0d502b2",
    name: "Wistfulness",
    rarity: "mythic",
    oracleText:
        "When this creature enters, if {G}{G} was spent to cast it, exile target artifact or enchantment an opponent controls.\nWhen this creature enters, if {U}{U} was spent to cast it, draw two cards, then discard a card.\nEvoke {G/U}{G/U}",
    manaCost: {
        generic: 3,
        hybrid: [
            ["G", "U"],
            ["G", "U"],
        ],
    },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 6,
    toughness: 5,
    noteManaSpent: true,
    evoke: {
        id: "evoke",
        description: "Evoke {G/U}{G/U}",
        mana: {
            hybrid: [
                ["G", "U"],
                ["G", "U"],
            ],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "wistfulness-etb-exile",
            oracleText:
                "When this creature enters, if {G}{G} was spent to cast it, exile target artifact or enchantment an opponent controls.",
            scope: "self",
            condition: manaSpentOnCastAtLeast("G", 2),
            // "an opponent controls" is a target RESTRICTION (CR 115.1c), not
            // a resolution-time filter — `controller: "opponent"` is relative
            // to the trigger's controller.
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
                controller: "opponent",
            },
            effects: [{ op: "exile", target: { target: 0 } }],
        }),
        enteredTrigger({
            id: "wistfulness-etb-loot",
            oracleText:
                "When this creature enters, if {U}{U} was spent to cast it, draw two cards, then discard a card.",
            scope: "self",
            condition: manaSpentOnCastAtLeast("U", 2),
            effects: [
                { op: "draw", player: "controller", count: 2 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Choose a card to discard.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        }),
        evokeTrigger("Wistfulness"),
    ],
};

export {};
