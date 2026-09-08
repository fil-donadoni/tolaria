// Shared fixture: the activation-scoped `mana-substitution` static of issue
// #2944 (CR 609.4b / 602.1) — Agatha's Soul Cauldron's second clause, "you may
// spend mana as though it were mana of any color to activate abilities of
// creatures you control".
//
// The card itself is still blocked on ability-copy (`cards/sets/woe/colorless.ts`),
// so the scope is exercised on probe definitions. They live in a fixture module
// rather than inline in one suite because the ENGINE guards and the BOT guards
// run in different vitest projects (`bot-suite-boundary.test.ts`): both must
// drive the SAME definitions or the two halves can drift apart silently.

import { preloadDefinitions } from "../../../cards";
import type { CardDefinition, ManaCost } from "../../../cards/types";
import { getPlayer, type CardInstanceState, type GameState } from "../../state";
import { makeInstance, makeState } from "../../../cards/__tests__/setup";

export const CAULDRON_ID = "00000000-0000-4000-8000-000029440001";
export const CREATURE_ID = "00000000-0000-4000-8000-000029440002";
export const ARTIFACT_ID = "00000000-0000-4000-8000-000029440003";
export const MANA_CREATURE_ID = "00000000-0000-4000-8000-000029440004";

/** Agatha's Soul Cauldron's second clause, and nothing else — the card itself
 *  is still blocked on ability-copy (`cards/sets/woe/colorless.ts`), so the
 *  scope is exercised on a fixture exactly as issue #2944 scoped it. */
const CAULDRON_SCOPE = {
    kind: "activated-ability",
    applies: (
        target: { controllerId: string },
        source: { controllerId: string },
        ctx: { isCreature: (c: never) => boolean }
    ) =>
        ctx.isCreature(target as never) &&
        target.controllerId === source.controllerId,
} as const;

preloadDefinitions([
    {
        id: CAULDRON_ID,
        name: "Synthetic Soul Cauldron",
        rarity: "mythic",
        manaCost: { X: 2 },
        types: ["Artifact"],
        oracleText:
            "You may spend mana as though it were mana of any color to activate abilities of creatures you control.",
        staticEffects: [
            {
                kind: "mana-substitution",
                breadth: "any-color",
                scope: CAULDRON_SCOPE,
            },
        ],
    } as CardDefinition,
    {
        // A creature whose ability costs a colour the fixture pool never holds
        // and a `{C}` pip, so "any-color" is distinguishable from "any-type"
        // on this very card (CR 107.4c — `{C}` is payable only with colorless).
        id: CREATURE_ID,
        name: "Synthetic Cauldron Creature",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Creature"],
        subtypes: ["Human"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "red-gain",
                oracleText: "{R}: You gain 1 life.",
                cost: { mana: { R: 1 } as ManaCost },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ],
    } as CardDefinition,
    {
        // Same ability, NOT a creature — the predicate's other half.
        id: ARTIFACT_ID,
        name: "Synthetic Cauldron Artifact",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "red-gain",
                oracleText: "{R}: You gain 1 life.",
                cost: { mana: { R: 1 } as ManaCost },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ],
    } as CardDefinition,
    {
        // Fire Sprites' shape (`leg/green.ts`, "{G}, {T}: Add {R}") — a CREATURE
        // whose MANA ability carries a COLOURED cost. It is the only shape that
        // reaches `applyManaAbilityManaCost`, a payment site with its own
        // affordability throw and no stack item.
        id: MANA_CREATURE_ID,
        name: "Synthetic Cauldron Sprites",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Creature"],
        subtypes: ["Faerie"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "red-for-white",
                oracleText: "{R}, {T}: Add {W}.",
                cost: { mana: { R: 1 } as ManaCost, tap: true },
                useStack: false,
                manaProduced: { W: 1 } as ManaCost,
            },
        ],
    } as CardDefinition,
]);

export interface Board {
    state: GameState;
    cauldron: CardInstanceState;
    creature: CardInstanceState;
    artifact: CardInstanceState;
    /** A creature with the same ability, controlled by the OPPONENT. */
    theirCreature: CardInstanceState;
}

/** p1 controls the Cauldron, a creature and an artifact; p2 controls a creature
 *  of the same fixture. `pool` is p1's floating mana. */
export function board(pool: Record<string, number> = {}): Board {
    const state = makeState();
    const cauldron = makeInstance(CAULDRON_ID, { id: "cauldron-1" });
    const creature = makeInstance(CREATURE_ID, { id: "creature-1" });
    const artifact = makeInstance(ARTIFACT_ID, { id: "artifact-1" });
    const theirCreature = makeInstance(CREATURE_ID, {
        id: "creature-2",
        controllerId: "p2",
        ownerId: "p2",
    });
    state.players[0].battlefield.push(cauldron, creature, artifact);
    state.players[1].battlefield.push(theirCreature);
    getPlayer(state, "p1").manaPool = { ...pool };
    return { state, cauldron, creature, artifact, theirCreature };
}
