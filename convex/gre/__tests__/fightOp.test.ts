// The `fight` Effect Op (CR 701.14, issue #2013, issue #4572).
//
// "Target creature you control fights target creature an opponent controls"
// (Triangle of War): two announced combatants, each dealing damage equal to
// its power to the other. The Op names BOTH sides, so the source is only a
// combatant when a script says `$source`. Rows:
//
//  - CR 701.14a — mutual, simultaneous damage between two announced slots;
//  - CR 701.14a — `$source` as a combatant (the "this creature fights" shape);
//  - CR 701.14b — one side gone, or no longer a creature: NEITHER deals
//    damage (never a half-applied fight);
//  - inside a `forEach` (`$each` as a combatant);
//  - wire format: the marked damage survives `projectPublicState`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import { crawWurm, grizzlyBears } from "../../cards/sets/lea/green.cards";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import type { CardInstanceState, GameState } from "../state";
import { checkStateBasedActions } from "../sba";

const SOURCE_ID = "fight-op-test-source";
const ABILITY_ID = "fight-op-test-ability";

/** An artifact whose one ability runs `effects` against two creature slots. */
function fightSource(
    effects: EffectOp[],
    types: CardDefinition["types"] = ["Artifact"]
): CardDefinition {
    return {
        id: SOURCE_ID,
        name: "Fight Op Test Source",
        rarity: "common",
        manaCost: { X: 1 },
        types,
        ...(types.includes("Creature") ? { power: 5, toughness: 5 } : {}),
        activatedAbilities: [
            {
                id: ABILITY_ID,
                oracleText: "{2}: fight.",
                cost: { mana: { X: 2 } },
                useStack: true,
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    controller: "you",
                },
                additionalTargetRequirements: [
                    { type: "Creature", count: 1, controller: "opponent" },
                ],
                effects,
            },
        ],
    };
}

const SLOT_FIGHT: EffectOp[] = [
    { op: "fight", creature: { target: 0 }, other: { target: 1 } },
];

function board(): {
    state: GameState;
    source: CardInstanceState;
    mine: CardInstanceState;
    theirs: CardInstanceState;
} {
    const source = makeInstance(SOURCE_ID, {
        id: "src",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    // Craw Wurm 6/4 (mine) fights Grizzly Bears 2/2 (theirs).
    const mine = makeInstance(crawWurm().id, {
        id: "mine",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const theirs = makeInstance(grizzlyBears().id, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    const state = makeState();
    state.players[0].battlefield.push(source, mine);
    state.players[1].battlefield.push(theirs);
    return { state, source, mine, theirs };
}

const onBattlefield = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
const inGraveyard = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.graveyard).some((c) => c.id === id);

const TARGETS = [
    { type: "permanent" as const, id: "mine" },
    { type: "permanent" as const, id: "theirs" },
];

describe("fight Op (CR 701.14)", () => {
    it("CR 701.14a — each announced creature deals damage equal to its power to the other", () => {
        withTemporaryDefinition(fightSource(SLOT_FIGHT), () => {
            const { state, source } = board();
            resolveActivated(state, source, ABILITY_ID, TARGETS);
            checkStateBasedActions(state);
            // The 6-power Wurm kills the 2/2 Bears; the Bears deal 2 back.
            expect(onBattlefield(state, "mine")?.damageMarked).toBe(2);
            expect(onBattlefield(state, "theirs")).toBeUndefined();
            expect(inGraveyard(state, "theirs")).toBe(true);
        });
    });

    it("CR 701.14a — `$source` fights when the script names it", () => {
        const effects: EffectOp[] = [
            { op: "fight", creature: { ref: "$source" }, other: { target: 1 } },
        ];
        withTemporaryDefinition(fightSource(effects, ["Creature"]), () => {
            const { state, source } = board();
            resolveActivated(state, source, ABILITY_ID, TARGETS);
            checkStateBasedActions(state);
            expect(onBattlefield(state, "src")?.damageMarked).toBe(2);
            expect(inGraveyard(state, "theirs")).toBe(true);
            // Slot 0 was announced but is no combatant in this script.
            expect(onBattlefield(state, "mine")?.damageMarked ?? 0).toBe(0);
        });
    });

    it("CR 701.14b — a combatant gone before resolution: neither deals damage", () => {
        withTemporaryDefinition(fightSource(SLOT_FIGHT), () => {
            const { state, source } = board();
            // The Bears leave before the ability resolves; slot 0 stays legal.
            state.players[1].battlefield = [];
            resolveActivated(state, source, ABILITY_ID, TARGETS);
            expect(onBattlefield(state, "mine")?.damageMarked ?? 0).toBe(0);
        });
    });

    it("CR 701.14b — a combatant no longer a creature: neither deals damage", () => {
        withTemporaryDefinition(fightSource(SLOT_FIGHT), () => {
            const { state, source, theirs } = board();
            // Still on the battlefield, but no longer a creature.
            theirs.types = ["Artifact"];
            resolveActivated(state, source, ABILITY_ID, TARGETS);
            expect(onBattlefield(state, "mine")?.damageMarked ?? 0).toBe(0);
            expect(onBattlefield(state, "theirs")?.damageMarked ?? 0).toBe(0);
        });
    });

    it("composes with forEach — `$each` as a combatant", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "fight",
                        creature: { target: 0 },
                        other: { ref: "$each" },
                    },
                ],
            },
        ];
        withTemporaryDefinition(fightSource(effects), () => {
            const { state, source } = board();
            resolveActivated(state, source, ABILITY_ID, TARGETS);
            checkStateBasedActions(state);
            expect(onBattlefield(state, "mine")?.damageMarked).toBe(2);
            expect(inGraveyard(state, "theirs")).toBe(true);
        });
    });

    it("wire format — the fight's marked damage survives projectPublicState", () => {
        withTemporaryDefinition(fightSource(SLOT_FIGHT), () => {
            const { state, source } = board();
            resolveActivated(state, source, ABILITY_ID, TARGETS);
            const projected = projectPublicState(state, 1, "p1");
            const mine = projected.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === "mine");
            expect(mine?.damageMarked).toBe(2);
        });
    });
});
