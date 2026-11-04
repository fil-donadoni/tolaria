// Unleash (CR 702.98a): "You may have this permanent enter with an additional
// +1/+1 counter on it" and "This permanent can't block as long as it has a
// +1/+1 counter on it." One test per entry path of the first ability (spell,
// effect, token copy, copy-as-it-enters), then the block half and its surfaces.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { getDefinition, registerTokenDefinition } from "../../cards";
import { expandUnleash } from "../../cards/abilities/unleash";
import { withTemporaryDefinition } from "../../cards/registry";
import { clone } from "../../cards/sets/lea/blue.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { humility } from "../../cards/sets/tmp/white.cards";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { validateBlockerEligibility } from "../combat";
import { getEffectivePower } from "../layers";
import {
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const UNLEASHED: CardDefinition = {
    id: "unleash-test-creature",
    name: "Unleash Tester",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["unleash"],
};

function withUnleashed<T>(run: () => T): T {
    return withTemporaryDefinition(UNLEASHED, run);
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

const entered = (state: GameState) =>
    state.players[0].battlefield.find(
        (c) => (c.card as { id?: string }).id === UNLEASHED.id
    );

const permanent = (
    defId: string,
    id: string,
    extra: Partial<CardInstanceState> = {}
) =>
    makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        ...extra,
    });

const attacker = () =>
    makeInstance(grizzlyBears().id, {
        id: "attacker",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });

describe("expandUnleash (CR 702.98a)", () => {
    it("declares the entry clause after the card's own, and only once", () => {
        const own = { kind: "opponent" } as const;
        const once = expandUnleash({
            ...UNLEASHED,
            entersWith: { asEnters: [own] },
        });
        expect(once.entersWith?.asEnters).toEqual([
            own,
            { kind: "mayEnterWithCounters", counterType: "+1/+1", count: 1 },
        ]);
        expect(expandUnleash(once)).toBe(once);
    });

    it("leaves a definition without the keyword untouched", () => {
        const plain = grizzlyBears();
        expect(expandUnleash(plain)).toBe(plain);
    });

    it("reaches the definition every entry path reads", () => {
        withUnleashed(() => {
            expect(
                getDefinition(UNLEASHED.id).entersWith?.asEnters
            ).toHaveLength(1);
        });
    });
});

describe("Unleash, the entry replacement (CR 702.98a, CR 614.1c, CR 614.12a)", () => {
    it("cast: the choice comes before the permanent exists; accepting enters with the counter", () => {
        withUnleashed(() => {
            const state = board();
            pushSpell(state, UNLEASHED.id, "p1");
            resolveTopOfStack(state);

            expect(entered(state)).toBeUndefined();
            expect(head(state).kind).toBe("option-pick");
            expect(head(state).asEntersKind).toBe("mayEnterWithCounters");
            expect(head(state).playerId).toBe("p1");

            submitChoice(state, ["accept"]);

            const creature = entered(state)!;
            expect(creature.counters).toEqual({ "+1/+1": 1 });
            expect(creature.acceptedEntryCounters).toBeUndefined();
            expect(getEffectivePower(state, creature)).toBe(2);
        });
    });

    it("cast: declining enters with no counter, and the creature can block", () => {
        withUnleashed(() => {
            const state = board();
            pushSpell(state, UNLEASHED.id, "p1");
            resolveTopOfStack(state);

            submitChoice(state, ["decline"]);

            const creature = entered(state)!;
            expect(creature.counters?.["+1/+1"] ?? 0).toBe(0);
            expect(
                validateBlockerEligibility(
                    attacker(),
                    creature,
                    [creature],
                    state
                ).eligible
            ).toBe(true);
        });
    });

    it("refuses an answer that was not offered", () => {
        withUnleashed(() => {
            const state = board();
            pushSpell(state, UNLEASHED.id, "p1");
            resolveTopOfStack(state);

            expect(() => submitChoice(state, ["maybe"])).toThrow();
            expect(entered(state)).toBeUndefined();
        });
    });

    it("put onto the battlefield by an effect: the same choice, and the counter survives the entry reset", () => {
        withUnleashed(() => {
            const state = board();
            const card = makeInstance(UNLEASHED.id, {
                id: "reanimated",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            putReanimatedSetOnBattlefield(state, [
                { card, controllerId: "p1" },
            ]);

            expect(entered(state)).toBeUndefined();
            expect(head(state).asEntersKind).toBe("mayEnterWithCounters");

            submitChoice(state, ["accept"]);

            expect(entered(state)?.counters).toEqual({ "+1/+1": 1 });
        });
    });

    it("token copy: the copied keyword owes its controller the choice (CR 707.6)", () => {
        withUnleashed(() => {
            const copyScript = "unleash-test-copy-script";
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
            const source = permanent(UNLEASHED.id, "source");
            const state = board([source]);
            pushSpell(state, copyScript, "p1", [
                { type: "permanent", id: source.id },
            ]);
            resolveTopOfStack(state);

            expect(head(state).asEntersKind).toBe("mayEnterWithCounters");
            submitChoice(state, ["accept"]);

            const token = state.players[0].battlefield.find((c) => c.isToken)!;
            expect(token.counters).toEqual({ "+1/+1": 1 });
            expect(getEffectivePower(state, token)).toBe(2);
        });
    });

    it("Clone: discovers the copied keyword's choice after the copy is chosen (CR 707.6)", () => {
        withUnleashed(() => {
            const source = permanent(UNLEASHED.id, "source");
            const state = board([source]);
            pushSpell(state, clone().id, "p1");
            resolveTopOfStack(state);

            expect(head(state).asEntersKind).toBe("copy");
            submitChoice(state, [source.id]);
            expect(head(state).asEntersKind).toBe("mayEnterWithCounters");
            submitChoice(state, ["accept"]);

            const copy = state.players[0].battlefield.find(
                (c) => c.id !== source.id
            )!;
            expect(copy.counters).toEqual({ "+1/+1": 1 });
        });
    });

    it("under a loses-all-abilities effect there is no offer and no counter (CR 613.1f)", () => {
        withUnleashed(() => {
            const state = board([permanent(humility().id, "humility")]);
            pushSpell(state, UNLEASHED.id, "p1");
            resolveTopOfStack(state);

            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(entered(state)?.counters?.["+1/+1"] ?? 0).toBe(0);
        });
    });
});

describe("Unleash, the block restriction (CR 702.98a, CR 509.1b)", () => {
    const canBlock = (state: GameState, creature: CardInstanceState): boolean =>
        validateBlockerEligibility(attacker(), creature, [creature], state)
            .eligible;

    it("a +1/+1 counter from any source forbids the block; losing it frees the creature", () => {
        withUnleashed(() => {
            const creature = permanent(UNLEASHED.id, "c", {
                counters: { "+1/+1": 1 },
            });
            const state = board([creature]);
            expect(canBlock(state, creature)).toBe(false);

            creature.counters = {};
            expect(canBlock(state, creature)).toBe(true);
        });
    });

    it("losing unleash under a loses-all-abilities effect frees the creature (CR 613.1f)", () => {
        withUnleashed(() => {
            const creature = permanent(UNLEASHED.id, "c", {
                counters: { "+1/+1": 1 },
            });
            const state = board([creature]);
            expect(canBlock(state, creature)).toBe(false);

            pushSpell(state, humility().id, "p1");
            resolveTopOfStack(state);

            expect(canBlock(state, creature)).toBe(true);
        });
    });

    it("another counter type does not forbid the block", () => {
        withUnleashed(() => {
            const creature = permanent(UNLEASHED.id, "c", {
                counters: { charge: 1 },
            });
            expect(canBlock(board([creature]), creature)).toBe(true);
        });
    });

    it("a creature without unleash blocks with a +1/+1 counter", () => {
        const creature = permanent(grizzlyBears().id, "c", {
            counters: { "+1/+1": 1 },
        });
        expect(canBlock(board([creature]), creature)).toBe(true);
    });

    it("the restriction survives the wire projection", () => {
        withUnleashed(() => {
            const creature = permanent(UNLEASHED.id, "c", {
                counters: { "+1/+1": 1 },
            });
            const state = board([creature]);
            const projected = projectPublicState(state, 1, "p1");
            const wire = projected.players[0].battlefield.find(
                (c) => c.id === "c"
            ) as unknown as CardInstanceState;
            expect(
                validateBlockerEligibility(attacker(), wire, [wire]).eligible
            ).toBe(false);
        });
    });
});
