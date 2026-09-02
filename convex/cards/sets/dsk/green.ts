// dsk — green cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/P-T are from Scryfall (id = DSK paper printing).

import type { CardDefinition } from "../../types";
import { enduringReturnTrigger } from "../../abilities/enduringReturn";

// Enduring Vitality — {1}{G}{G} Enchantment Creature — Elk Glimmer, 3/3
// (issue #2085, the DSK "Enduring" cycle; the shared dies-trigger and its
// CR 205.1a / 613.1d derivation live in `abilities/enduringReturn.ts`).
//
// "Vigilance" — CR 702.20a, a `staticAbilities` keyword; the registry row is
// `implemented`, so no allowlist entry is owed (Guard A).
//
// "Creatures you control have '{T}: Add one mana of any color.'" — CR 611.2a /
// 613.1f layer 6 ability GRANT. The granted ability lives on
// `grantTemplates[]` and an `activated-grant` static effect pushes it onto
// every matching permanent, the exact Earthlore / Mystic Might shape
// (`sets/ice/green.ts`, `sets/ice/blue.ts`) — with one axis widened: those are
// auras and use `AURA_AFFECTS_HOST`, while this is the catalogue's first GROUP
// activated-grant, so `applies` is a board predicate over creatures the
// source's controller controls rather than a single `attachedTo` id. The layer
// walk is already generic over `applies` (`gre/layer6.ts`) — the grant is
// recomputed continuously, so a creature that enters later gets the ability
// and loses it the moment Enduring Vitality leaves (CR 611.2b).
//
// Enduring Vitality is itself a creature you control, so it grants the mana
// ability to ITSELF too (the Oracle says "creatures you control", not "other
// creatures"). Once it has returned as an enchantment it is no longer a
// creature and drops out of its own grant, keeping the ability only for the
// rest of the board — which is the printed behaviour, not a special case.
//
// CR 605.1a — the granted ability IS a mana ability: no target, it could add
// mana on resolution, not a loyalty ability, and it moves no card to or from a
// library. So `useStack: false` (CR 605.3a — it never uses the stack and no
// player may respond). `manaChoices` enumerates the five colours, the same
// "add one mana of any color" shape Birds of Paradise ships
// (`sets/lea/green.ts`); the tap-mana path reads GRANTED abilities through
// `getEffectiveActivatedAbilities` (issue #1880, Urza's Saga), so the auto-tap
// solver, the castability probe and the client menu all see it.
//
// CR 302.6 — the {T} in the granted cost means a summoning-sick creature
// cannot use it the turn it arrives. That falls out of the shared tap gate
// (`isTapLockedBySummoningSickness`); nothing here opts out of it.
//
// Guard C (issue #2701) — the Oracle compiler's grammar has no slot for
// either half of this card yet, so the fragments are named here for the
// corpus backlog PRD #2693 ranks the next grammar rule by. The shared
// dies-trigger line is the cycle's; Enduring Innocence carries it in the
// one-time baseline instead, which only ever shrinks.
// compiler-gap: Creatures you control have "{T}: Add one mana of any color." (#2693)
// compiler-gap: When {self} dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (#2693)
export const enduringVitality: CardDefinition = {
    id: "9d76a30c-0431-4334-892a-9822dda9671a",
    name: "Enduring Vitality",
    rarity: "rare",
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Elk", "Glimmer"],
    power: 3,
    toughness: 3,
    oracleText:
        "Vigilance\nCreatures you control have \"{T}: Add one mana of any color.\"\nWhen Enduring Vitality dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)",
    staticAbilities: ["vigilance"],
    staticEffects: [
        {
            kind: "activated-grant",
            applies: (target, source) =>
                target.types.includes("Creature") &&
                target.controllerId === source.controllerId,
            abilityId: "enduring-vitality-any-color",
        },
    ],
    grantTemplates: [
        {
            id: "enduring-vitality-any-color",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
    triggeredAbilities: [
        // The cycle's shared dies-trigger (CR 700.4 / 603.4 intervening-if,
        // CR 205.1a / 613.1d type-line SET) — `abilities/enduringReturn.ts`.
        enduringReturnTrigger({
            id: "enduring-vitality-return",
            cardName: "Enduring Vitality",
        }),
    ],
};
