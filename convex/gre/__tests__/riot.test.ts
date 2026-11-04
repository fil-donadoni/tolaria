// Riot (CR 702.136a): "You may have this permanent enter with an additional +1/+1
// counter on it. If you don't, it gains haste." One test per entry path, then the
// haste's lifetime (CR 613.7, CR 400.7, CR 707.2) and CR 702.136b's instances.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { getDefinition, registerTokenDefinition } from "../../cards";
import { expandRiot } from "../../cards/abilities/riot";
import { withTemporaryDefinition } from "../../cards/registry";
import { clone } from "../../cards/sets/lea/blue.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { humility } from "../../cards/sets/tmp/white.cards";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { validateAttackerEligibility } from "../combat";
import { getEffectivePower } from "../layers";
import { syncLayer6 } from "../layer6";
import {
    pushContinuousEffect,
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const RIOTER: CardDefinition = {
    id: "riot-test-creature",
    name: "Riot Tester",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["riot"],
};

const DOUBLE_RIOTER: CardDefinition = {
    ...RIOTER,
    id: "double-riot-test-creature",
    name: "Double Riot Tester",
    staticAbilities: ["riot", "riot"],
};

const RIOT_CLAUSE = {
    kind: "mayEnterWithCounters",
    counterType: "+1/+1",
    count: 1,
    declinedKeyword: "haste",
};

function withRioter<T>(run: () => T): T {
    return withTemporaryDefinition(RIOTER, run);
}

function board(p1Battlefield: CardInstanceState[] = []): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: p1Battlefield }),
            makePlayer("p2"),
        ],
    });
}

const head = (state: GameState) => (state.pendingChoices ?? [])[0];

const enteredAs = (state: GameState, defId: string) =>
    state.players[0].battlefield.find(
        (c) => (c.card as { id?: string }).id === defId
    );

const entered = (state: GameState) => enteredAs(state, RIOTER.id);

const permanent = (defId: string, id: string) =>
    makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });

const cast = (state: GameState, defId: string = RIOTER.id) => {
    pushSpell(state, defId, "p1");
    resolveTopOfStack(state);
};

const canAttack = (state: GameState, creature: CardInstanceState): boolean =>
    validateAttackerEligibility(creature, state.players[1].battlefield, state)
        .eligible;

describe("expandRiot (CR 702.136a)", () => {
    it("declares the entry clause after the card's own, and only once", () => {
        const own = { kind: "opponent" } as const;
        const once = expandRiot({
            ...RIOTER,
            entersWith: { asEnters: [own] },
        });
        expect(once.entersWith?.asEnters).toEqual([own, RIOT_CLAUSE]);
        expect(expandRiot(once)).toBe(once);
    });

    it("declares one clause per instance (CR 702.136b)", () => {
        const twice = expandRiot(DOUBLE_RIOTER);
        expect(twice.entersWith?.asEnters).toEqual([RIOT_CLAUSE, RIOT_CLAUSE]);
        expect(expandRiot(twice)).toBe(twice);
    });

    it("leaves a definition without the keyword untouched", () => {
        const plain = grizzlyBears();
        expect(expandRiot(plain)).toBe(plain);
    });

    it("reaches the definition every entry path reads", () => {
        withRioter(() => {
            expect(getDefinition(RIOTER.id).entersWith?.asEnters).toEqual([
                RIOT_CLAUSE,
            ]);
        });
    });
});

describe("Riot, the entry replacement (CR 702.136a, CR 614.1c, CR 614.12a)", () => {
    it("cast: the choice comes before the permanent exists and says what declining gives", () => {
        withRioter(() => {
            const state = board();
            cast(state);

            expect(entered(state)).toBeUndefined();
            expect(head(state).kind).toBe("option-pick");
            expect(head(state).asEntersKind).toBe("mayEnterWithCounters");
            expect(head(state).playerId).toBe("p1");
            expect(head(state).prompt).toContain(
                "If you don't, it gains haste."
            );
            expect(head(state).options?.map((o) => o.label)).toEqual([
                "Enter with a +1/+1 counter",
                "Enter with haste",
            ]);
        });
    });

    it("cast: accepting enters with the counter and no haste, so it cannot attack", () => {
        withRioter(() => {
            const state = board();
            cast(state);

            submitChoice(state, ["accept"]);

            const creature = entered(state)!;
            expect(creature.counters).toEqual({ "+1/+1": 1 });
            expect(getEffectivePower(state, creature)).toBe(2);
            expect(creature.staticAbilities).not.toContain("haste");
            creature.isSummoningSick = true;
            expect(canAttack(state, creature)).toBe(false);
        });
    });

    it("cast: declining enters with haste and no counter, so it can attack", () => {
        withRioter(() => {
            const state = board();
            cast(state);

            submitChoice(state, ["decline"]);

            const creature = entered(state)!;
            expect(creature.counters?.["+1/+1"] ?? 0).toBe(0);
            expect(creature.staticAbilities).toContain("haste");
            expect(creature.declinedEntryKeywords).toBeUndefined();
            creature.isSummoningSick = true;
            expect(canAttack(state, creature)).toBe(true);
        });
    });

    it("refuses an answer that was not offered", () => {
        withRioter(() => {
            const state = board();
            cast(state);

            expect(() => submitChoice(state, ["maybe"])).toThrow();
            expect(entered(state)).toBeUndefined();
        });
    });

    it("put onto the battlefield by an effect: the haste survives the entry reset", () => {
        withRioter(() => {
            const state = board();
            const card = makeInstance(RIOTER.id, {
                id: "reanimated",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            putReanimatedSetOnBattlefield(state, [
                { card, controllerId: "p1" },
            ]);

            expect(entered(state)).toBeUndefined();
            submitChoice(state, ["decline"]);

            expect(entered(state)?.staticAbilities).toContain("haste");
        });
    });

    it("token copy: the copied keyword owes the choice, and declining gives the token haste (CR 707.6)", () => {
        withRioter(() => {
            const copyScript = "riot-test-copy-script";
            registerTokenDefinition({
                id: copyScript,
                name: copyScript,
                rarity: "common",
                manaCost: { U: 2 },
                types: ["Sorcery"],
                targetRequirement: { type: ["Creature"], count: 1 },
                effects: [
                    {
                        op: "createTokenCopy",
                        source: { target: 0 },
                        controller: "controller",
                    },
                ],
            });
            const source = permanent(RIOTER.id, "source");
            const state = board([source]);
            pushSpell(state, copyScript, "p1", [
                { type: "permanent", id: source.id },
            ]);
            resolveTopOfStack(state);

            expect(head(state).asEntersKind).toBe("mayEnterWithCounters");
            submitChoice(state, ["decline"]);

            const token = state.players[0].battlefield.find((c) => c.isToken)!;
            expect(token.staticAbilities).toContain("haste");
            expect(token.counters?.["+1/+1"] ?? 0).toBe(0);
        });
    });

    it("Clone: owes the copied keyword's choice, and does not copy the source's haste (CR 707.2)", () => {
        withRioter(() => {
            const state = board();
            cast(state);
            submitChoice(state, ["decline"]);
            const source = entered(state)!;
            expect(source.staticAbilities).toContain("haste");

            cast(state, clone().id);
            expect(head(state).asEntersKind).toBe("copy");
            submitChoice(state, [source.id]);
            expect(head(state).asEntersKind).toBe("mayEnterWithCounters");
            submitChoice(state, ["accept"]);

            const copy = state.players[0].battlefield.find(
                (c) => c.id !== source.id
            )!;
            expect(copy.counters).toEqual({ "+1/+1": 1 });
            expect(copy.staticAbilities).not.toContain("haste");
            expect(source.staticAbilities).toContain("haste");
        });
    });

    it("Clone: declining the copied riot grants the copy haste over its copied characteristics", () => {
        withRioter(() => {
            const source = permanent(RIOTER.id, "source");
            const state = board([source]);
            cast(state, clone().id);
            submitChoice(state, [source.id]);
            submitChoice(state, ["decline"]);

            const copy = state.players[0].battlefield.find(
                (c) => c.id !== source.id
            )!;
            expect(copy.staticAbilities).toEqual(
                expect.arrayContaining(["riot", "haste"])
            );
            expect(source.staticAbilities).not.toContain("haste");
        });
    });

    it("under a loses-all-abilities effect there is no offer, no counter and no haste (CR 613.1f)", () => {
        withRioter(() => {
            const state = board([permanent(humility().id, "humility")]);
            cast(state);

            expect(state.pendingChoices ?? []).toHaveLength(0);
            const creature = entered(state)!;
            expect(creature.counters?.["+1/+1"] ?? 0).toBe(0);
            expect(creature.staticAbilities).not.toContain("haste");
            expect(creature.declinedEntryKeywords).toBeUndefined();
        });
    });
});

describe("Riot, the haste it gave (CR 702.136a)", () => {
    const hasty = () => {
        const state = board();
        cast(state);
        submitChoice(state, ["decline"]);
        return { state, creature: entered(state)! };
    };

    it("lasts past the turn: no duration is printed", () => {
        withRioter(() => {
            const { state, creature } = hasty();
            const grant = (state.continuousEffects ?? []).find(
                (e) =>
                    e.payload.kind === "keyword-grant" &&
                    e.payload.keyword === "haste"
            );
            expect(grant?.expiry.kind).toBe("indefinite");
            expect(grant?.affected).toEqual({
                kind: "instances",
                instanceIds: [creature.id],
            });
        });
    });

    it("outlives riot: losing the keyword does not take the haste back", () => {
        withRioter(() => {
            const { state, creature } = hasty();
            pushContinuousEffect(state, {
                layer: 6,
                affected: { kind: "instances", instanceIds: [creature.id] },
                expiry: { kind: "indefinite", controllerId: "p2" },
                payload: { kind: "keyword-remove", keyword: "riot" },
                characteristicDefining: false,
            });
            syncLayer6(state);

            expect(creature.staticAbilities).not.toContain("riot");
            expect(creature.staticAbilities).toContain("haste");
        });
    });

    it("yields to a later loses-all-abilities effect (CR 613.7)", () => {
        withRioter(() => {
            const { state, creature } = hasty();
            expect(creature.staticAbilities).toContain("haste");

            cast(state, humility().id);

            expect(creature.staticAbilities).not.toContain("haste");
        });
    });

    it("ends with the object: re-entering owes a new choice, not the old haste (CR 400.7)", () => {
        withRioter(() => {
            const { state, creature } = hasty();
            removePermanentTo(state, creature.id, "graveyard");
            const card = state.players[0].graveyard.find(
                (c) => c.id === creature.id
            )!;
            state.players[0].graveyard = [];
            putReanimatedSetOnBattlefield(state, [
                { card, controllerId: "p1" },
            ]);
            submitChoice(state, ["accept"]);

            const back = entered(state)!;
            expect(back.counters).toEqual({ "+1/+1": 1 });
            expect(back.staticAbilities).not.toContain("haste");
        });
    });

    it("survives the wire projection, so the client lets it attack", () => {
        withRioter(() => {
            const { state, creature } = hasty();
            creature.isSummoningSick = true;
            const wire = projectPublicState(
                state,
                1,
                "p1"
            ).players[0].battlefield.find((c) => c.id === creature.id);
            expect(wire?.staticAbilities).toContain("haste");
        });
    });
});

describe("Riot, multiple instances (CR 702.136b)", () => {
    const withDouble = <T>(run: () => T): T =>
        withTemporaryDefinition(DOUBLE_RIOTER, run);
    const doubled = (state: GameState) => enteredAs(state, DOUBLE_RIOTER.id)!;

    it("each instance works separately: one counter and haste", () => {
        withDouble(() => {
            const state = board();
            cast(state, DOUBLE_RIOTER.id);
            submitChoice(state, ["accept"]);
            submitChoice(state, ["decline"]);

            expect(doubled(state).counters).toEqual({ "+1/+1": 1 });
            expect(doubled(state).staticAbilities).toContain("haste");
        });
    });

    it("accepting both enters with two counters", () => {
        withDouble(() => {
            const state = board();
            cast(state, DOUBLE_RIOTER.id);
            submitChoice(state, ["accept"]);
            submitChoice(state, ["accept"]);

            expect(doubled(state).counters).toEqual({ "+1/+1": 2 });
            expect(doubled(state).staticAbilities).not.toContain("haste");
        });
    });

    it("declining both grants one haste record", () => {
        withDouble(() => {
            const state = board();
            cast(state, DOUBLE_RIOTER.id);
            submitChoice(state, ["decline"]);
            submitChoice(state, ["decline"]);

            const grants = (state.continuousEffects ?? []).filter(
                (e) =>
                    e.payload.kind === "keyword-grant" &&
                    e.payload.keyword === "haste"
            );
            expect(grants).toHaveLength(1);
            expect(doubled(state).counters?.["+1/+1"] ?? 0).toBe(0);
        });
    });
});
