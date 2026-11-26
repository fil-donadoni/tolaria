// sth (Stronghold) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import {
    defineCard,
    type ActivatedAbilityContext,
    type PermanentView,
    type StaticEffectStateView,
} from "../../types";
import { readEffectivePT } from "../../effectivePT";

// Volrath's Stronghold — Legendary Land. "{T}: Add {C}." plus "{1}{B}, {T}:
// Put target creature card from your graveyard on top of your library."
// (CR 605.1a the mana ability — `useStack: false`; CR 602.1 the second,
// ordinary activated ability; CR 601.2c its announced graveyard-card target.)
//
// The recursion leg is the `moveZone` announced-target shape with
// `to: "library-top"` (issue #2713). That destination exists precisely
// because the plain `"library"` zone cannot name an ORDER: the generic
// `moveCardById` library leg pushes, i.e. BOTTOMS the card, which would turn
// a one-card-a-turn engine into a card you never see again. The interpreter
// follows the move with a reorder that brings the card to the top, leaving it a
// public placement, here as one declarative Op.
//
// compiler-gap: {1}{B}, {T}: Put target creature card from your graveyard on top of your library. (#10351)
export const volrathsStronghold = defineCard(() => ({
    id: "43bf015b-152e-4d67-b773-e75fb2487a32", // STH 143
    rarity: "rare",
    name: "Volrath's Stronghold",
    oracleText:
        "{T}: Add {C}.\n{1}{B}, {T}: Put target creature card from your graveyard on top of your library.",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "volraths-stronghold-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "volraths-stronghold-recur",
            oracleText:
                "{1}{B}, {T}: Put target creature card from your graveyard on top of your library.",
            cost: { mana: { X: 1, B: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "library-top" },
            ],
        },
    ],
}));

// Ensnaring Bridge — {3} Artifact. "Creatures with power greater than the
// number of cards in your hand can't attack." (CR 508.1c — a restriction on
// declaring attackers, checked for every creature on the battlefield, either
// side's.) A battlefield-scanned `global-attack-restriction` (the Moat shape):
// the source forbids any OTHER permanent's attack, so the predicate is read
// at every declaration against the board as it stands then — the hand count
// and the power both move between declarations.
//
// CR 613.4 — "power" is the attacker's EFFECTIVE power, read through the
// layer-7 pipeline (`readEffectivePT`, counters and anthems included), never
// its printed characteristic. "Your hand" is the Bridge's controller's. A
// view with no hand data (`hand` absent, `StaticEffectStateView` § hand)
// cannot verify the count, so the restriction does not bind there — the
// server's `GameState` always carries it.
//
// hand-tail: Creatures with power greater than the number of cards in your hand can't attack. (#10553)
export const ensnaringBridge = defineCard(() => ({
    id: "27d838a1-2739-45f7-a856-6202334fa76a", // STH 133
    rarity: "rare",
    name: "Ensnaring Bridge",
    oracleText:
        "Creatures with power greater than the number of cards in your hand can't attack.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "global-attack-restriction",
            id: "ensnaring-bridge-power-over-hand-cant-attack",
            forbids: (
                attacker: PermanentView,
                source: PermanentView,
                state: StaticEffectStateView
            ) => {
                const handSize = state.players.find(
                    (p) => p.id === source.controllerId
                )?.hand?.length;
                if (handSize === undefined) return false;
                return (
                    readEffectivePT(attacker, state as never).power > handSize
                );
            },
            oracleText:
                "Creatures with power greater than the number of cards in your hand can't attack (Ensnaring Bridge).",
        },
    ],
}));
