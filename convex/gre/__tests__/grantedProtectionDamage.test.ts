// CR 702.16e — protection GRANTED to a permanent INSTANCE (an Aura, an
// Equipment, a resolved pump spell: it lands on the instance's
// `staticAbilities`, never on the card definition) prevents damage on the two
// noncombat damage paths (issue #2116):
//
//  - `markDamageFromPermanentSource` — reached here through the `fight` Op;
//  - the Effect Script `dealDamage` Op's spell/ability path in
//    `buildSpellContext` — reached here through Pyroclasm.
//
// Both consult `isProtectedFromSource(target, …)`; the target must be the
// INSTANCE, because a `CardDefinition` carries only the printed abilities.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import { crawWurm, grizzlyBears } from "../../cards/sets/lea/green.cards";
import type { CardDefinition } from "../../cards/types";
import { checkStateBasedActions } from "../sba";
import { resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";

const PYROCLASM = "88040748-ad76-4b9a-bd4e-87e5980e9816"; // red Sorcery, untargeted sweep
const SOURCE_ID = "granted-protection-fight-source";
const ABILITY_ID = "granted-protection-fight-ability";

const fightSource: CardDefinition = {
    id: SOURCE_ID,
    name: "Granted Protection Fight Source",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
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
            effects: [
                { op: "fight", creature: { target: 0 }, other: { target: 1 } },
            ],
        },
    ],
};

/** Grant protection to the INSTANCE only — the definition stays untouched. */
function grantProtection(card: CardInstanceState, quality: string): void {
    card.staticAbilities = [...(card.staticAbilities ?? []), quality];
}

const damageOn = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)
        ?.damageMarked ?? 0;

describe("granted protection prevents noncombat damage (CR 702.16e, issue #2116)", () => {
    function fightBoard() {
        const source = makeInstance(SOURCE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // Craw Wurm (green 6/4, mine) fights Grizzly Bears (theirs).
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
        return { state, source, theirs };
    }

    const TARGETS = [
        { type: "permanent" as const, id: "mine" },
        { type: "permanent" as const, id: "theirs" },
    ];

    it("markDamageFromPermanentSource — a fight deals no damage to a creature granted protection from green", () => {
        withTemporaryDefinition(fightSource, () => {
            const { state, source, theirs } = fightBoard();
            grantProtection(theirs, "protection from green");
            resolveActivated(state, source, ABILITY_ID, TARGETS);
            expect(damageOn(state, "theirs")).toBe(0);
            // The protected creature still deals its own damage back.
            expect(damageOn(state, "mine")).toBe(2);
        });
    });

    it("markDamageFromPermanentSource — must-NOT: without the grant the same fight lands", () => {
        withTemporaryDefinition(fightSource, () => {
            const { state, source } = fightBoard();
            resolveActivated(state, source, ABILITY_ID, TARGETS);
            checkStateBasedActions(state);
            // 6 damage kills the 2/2: gone from the battlefield, nothing marked.
            expect(
                state.players[1].battlefield.some((c) => c.id === "theirs")
            ).toBe(false);
        });
    });

    function pyroclasmBoard(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(grizzlyBears().id, {
                            id: "granted",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(crawWurm().id, {
                            id: "plain",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {}),
            ],
        });
    }

    it("DSL dealDamage — Pyroclasm deals no damage to a creature granted protection from red", () => {
        const state = pyroclasmBoard();
        // Craw Wurm survives 2 damage (6/4) so its marked damage is readable.
        grantProtection(
            state.players[0].battlefield.find((c) => c.id === "granted")!,
            "protection from red"
        );
        pushSpell(state, PYROCLASM, "p2");
        resolveTopOfStack(state);
        expect(damageOn(state, "granted")).toBe(0);
        expect(damageOn(state, "plain")).toBeGreaterThan(0);
    });

    it("DSL dealDamage — must-NOT: the same creature without the grant is hit", () => {
        const state = pyroclasmBoard();
        pushSpell(state, PYROCLASM, "p2");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        // Grizzly Bears 2/2 dies to Pyroclasm's 2 damage.
        expect(
            state.players[0].battlefield.some((c) => c.id === "granted")
        ).toBe(false);
    });
});
