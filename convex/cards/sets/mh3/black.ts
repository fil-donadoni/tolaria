// MH3 — black cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";
import { adaptAbility } from "../../abilities/adapt";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { counterAddedTrigger } from "../../abilities/triggers/counterAddedTrigger";

// Nethergoyf — {B} Creature — Lhurgoyf, printed */1+*.
// "Nethergoyf's power is equal to the number of card types among cards in your
//  graveyard and its toughness is equal to that number plus 1." (CR 604.3 /
//  613.4c CDA P/T, layer 7a — a `pt-cda` whose `compute` counts DISTINCT card
//  types among the controller's graveyard, printed 0/0 base as the CDA target.)
// "Escape—{2}{B}, Exile any number of other cards from your graveyard with four
//  or more card types among them." (CR 702.138 — the escape capability, engine
//  infra; the variable "any number … with N+ card types" exile cost is the
//  `minCardTypes` picker mode. No on-resolution DSL effect — the card simply
//  enters as a creature.)
export const nethergoyf: CardDefinition = {
    id: "3ee3945e-5089-4751-b7b3-5961c39d2a33",
    name: "Nethergoyf",
    rarity: "mythic",
    oracleText:
        "Nethergoyf's power is equal to the number of card types among cards in your graveyard and its toughness is equal to that number plus 1.\nEscape—{2}{B}, Exile any number of other cards from your graveyard with four or more card types among them. (You may cast this card from your graveyard for its escape cost.)",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Lhurgoyf"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            // CR 604.3 — power = distinct card types among cards in the
            // controller's OWN graveyard; toughness = that + 1.
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                // "your graveyard" — the graveyard of Nethergoyf's controller,
                // identified as the player whose battlefield holds the source
                // (the state view's players carry no id).
                const types = new Set<string>();
                const controller = state.players.find((p) =>
                    p.battlefield.some((b) => b.id === source.id)
                );
                if (controller) {
                    for (const c of controller.graveyard) {
                        for (const t of c.types) types.add(t);
                    }
                }
                const n = types.size;
                return { power: n, toughness: n + 1 };
            },
        },
    ],
    // CR 702.138 — Escape. Variable exile cost: any number of OTHER graveyard
    // cards with 4+ card types among them (the `minCardTypes` picker mode).
    escape: { mana: { X: 2, B: 1 }, exile: { minCardTypes: 4 } },
};

// Emperor of Bones — {1}{B} Creature — Skeleton Noble, 2/2 (MH3 90, issue
// #1323, parent #917). "At the beginning of combat on your turn, exile up to
// one target card from a graveyard. {1}{B}: Adapt 2. Whenever one or more
// +1/+1 counters are put on this creature, put a creature card exiled with
// this creature onto the battlefield under your control with a finality
// counter on it. It gains haste. Sacrifice it at the beginning of the next
// end step."
//
// Composes three previously-shipped foundations, each its own tracked issue:
//   - Adapt N (CR 701.46, issue #1316) — `adaptAbility()` factory, unchanged.
//   - Linked-exile tracking (CR 607, issue #1319) — `SpellContext
//     .linkExileToSource` / `getCardsExiledWith`, GENERALIZED here from
//     `castDuringResolution`-only into the `moveZone` Op's own object-
//     selecting grammar: a `linkToSource` flag on the announced-target shape
//     (mirrors the `cards`-shape's existing #1947 flag) for the exile clause,
//     and a SIXTH `moveZone` shape accepting `target: { exiledWithSource:
//     true }` (the existing `EffectExiledWithSourceSelector`) for the
//     reanimation clause — see the Op's doc comment in `cards/types.ts` and
//     its registry note for the full shape.
//   - Counter-placement meta-trigger (CR 122.1, issue #1319) —
//     `counterAddedTrigger()` factory; Emperor is its FIRST real consumer.
//
// Finality counter (MH3 keyword counter, CR 122.1h: "One or more finality
// counters on a permanent create a single replacement effect that stops the
// permanent from going to the graveyard. That effect is 'If this permanent
// would be put into a graveyard from the battlefield, exile it instead.'")
// is a genuinely NEW small primitive this ticket adds: an
// INTRINSIC, per-instance-counter check in `removePermanentTo`
// (`gre/state.ts`) — any creature Emperor reanimates can carry the counter,
// not just a card that declares the rule itself, so it cannot be a per-card
// `replacementEffects[]` entry the way Dauthi Voidwalker's void counter is.
// The counter itself is placed by a plain `counters` Op (`counter:
// "finality"`) — no new Op, no card-specific closure.
//
// Multi-candidate note (documented simplification, see the SIXTH `moveZone` (tracked-by: #2785)
// shape's own doc comment): if 2+ creature cards are exiled with Emperor at
// once, the reanimation deterministically picks the FIRST in stable order
// rather than prompting a choice — mirrors Shallow Grave's own "deliberately
// NOT a player choice" precedent for its positional graveyard pick, extended
// here to the (CR-unordered) exile zone as a documented scope decision for
// this ticket. A `docs/findings/` entry flags this as a candidate follow-up.
export const emperorOfBones: CardDefinition = {
    id: "df9d9075-2d1e-4848-b661-816d539e05eb", // MH3 90
    name: "Emperor of Bones",
    rarity: "rare",
    oracleText:
        "At the beginning of combat on your turn, exile up to one target card from a graveyard.\n{1}{B}: Adapt 2.\nWhenever one or more +1/+1 counters are put on this creature, put a creature card exiled with this creature onto the battlefield under your control with a finality counter on it. It gains haste. Sacrifice it at the beginning of the next end step.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Skeleton", "Noble"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        // CR 603.6a — "at the beginning of combat on your turn". "up to one"
        // = an OPTIONAL target (`count: { min: 0, max: 1 }`, CR 601.2c);
        // "a graveyard" = either player's (`controller: "any"`), the exact
        // Soul-Guide Lantern (`thb/colorless.ts`) shape plus the new
        // `linkToSource` flag so the exiled card stays findable by the
        // reanimation trigger below.
        phaseTrigger({
            id: "emperor-of-bones-exile",
            oracleText:
                "At the beginning of combat on your turn, exile up to one target card from a graveyard.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            targetRequirement: {
                type: "card",
                count: { min: 0, max: 1 },
                zone: "graveyard",
                controller: "any",
            },
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "exile",
                    linkToSource: true,
                },
            ],
        }),
        // CR 122.1 counter-placement meta-trigger. `counterType: "+1/+1"`
        // narrows to the Adapt-fired case (`scope: "self"`, the same shape
        // the factory's own test suite exercises). The reanimation body: the
        // SIXTH `moveZone` shape locates a linked creature card (CR 608.2b
        // no-op if none), puts it onto the battlefield under the ability's
        // OWN controller (the linked card may be owned by either player,
        // "under your control" per the Oracle), stamps a finality counter,
        // grants haste (no duration — indefinite, matching the printed "It
        // gains haste" with no "until end of turn", the Sneak Attack idiom
        // per `mir/black.ts`'s Shallow Grave), and schedules the delayed
        // sacrifice at the next end step (same idiom, `sacrifice` swapped
        // for Shallow Grave's `exile`).
        counterAddedTrigger({
            id: "emperor-of-bones-reanimate",
            oracleText:
                "Whenever one or more +1/+1 counters are put on this creature, put a creature card exiled with this creature onto the battlefield under your control with a finality counter on it. It gains haste. Sacrifice it at the beginning of the next end step.",
            scope: "self",
            counterType: "+1/+1",
            effects: [
                {
                    op: "moveZone",
                    target: { exiledWithSource: true },
                    filter: { type: "Creature" },
                    to: "battlefield",
                    controller: "controller",
                    bind: "$reanimated",
                },
                {
                    op: "counters",
                    action: "add",
                    counter: "finality",
                    target: { ref: "$reanimated" },
                    count: 1,
                },
                {
                    op: "grantAbility",
                    ability: "haste",
                    target: { ref: "$reanimated" },
                },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Sacrifice it at the beginning of the next end step.",
                    capture: { $captured: { ref: "$reanimated" } },
                    effects: [
                        { op: "sacrifice", target: { ref: "$captured" } },
                    ],
                },
            ],
        }),
    ],
    activatedAbilities: [
        adaptAbility({
            id: "emperor-of-bones-adapt",
            n: 2,
            cost: { X: 1, B: 1 },
            costLabel: "{1}{B}",
        }),
    ],
};
