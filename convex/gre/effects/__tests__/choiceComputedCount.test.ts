// `choice.count` as a COMPUTED exact count (issue #5559): any non-literal
// `EffectValue`, resolved once when the choice is raised. The shape it exists
// for is a keep-N edict's "the rest" — each player gives up the members above
// the fewest any player has, `difference` of the chooser's own `count` and
// the `smallestAcrossPlayers` one (Balance). Exercised through the real
// interpreter; a result at or below zero raises no choice (CR 107.1b).
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { forest } from "../../../cards/sets/lea/colorless.cards";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { getPlayer, resolveTopOfStack } from "../../state";
import { validateEffectScript } from "../validate";

const EXCESS_LANDS = {
    difference: {
        from: {
            count: {
                zone: "battlefield",
                controller: { ref: "$each" },
                filter: { type: "Land" },
            },
        },
        minus: {
            count: {
                zone: "battlefield",
                smallestAcrossPlayers: true,
                filter: { type: "Land" },
            },
        },
    },
} as const;

/** Each player sacrifices the lands above the fewest any player controls. */
const EQUALIZE_LANDS: EffectOp[] = [
    {
        op: "forEach",
        select: { set: "players" },
        simultaneous: true,
        effects: [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { ref: "$each" },
                zone: "battlefield",
                filter: { type: "Land" },
                count: EXCESS_LANDS,
                prompt: "Sacrifice the rest.",
                bind: "$rest",
            },
            { op: "sacrifice", permanents: { ref: "$rest" } },
        ],
    },
];

function withScript<T>(fn: (id: string) => T): T {
    const def: CardDefinition = {
        id: "t5559-equalize",
        name: "t5559-equalize",
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Sorcery"],
        effects: EQUALIZE_LANDS,
    };
    return withTemporaryDefinition(def, () => fn(def.id));
}

const lands = (owner: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(forest().id, {
            id: `${owner}-land-${i}`,
            controllerId: owner,
            ownerId: owner,
        })
    );

function resolveOn(id: string, p1Lands: number, p2Lands: number) {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: lands("p1", p1Lands) }),
            makePlayer("p2", { battlefield: lands("p2", p2Lands) }),
        ],
    });
    pushSpell(state, id, "p1");
    const done = resolveTopOfStack(state);
    return { state, done };
}

describe("choice.count — a computed exact count (issue #5559)", () => {
    it("the player above the fewest picks exactly the difference", () => {
        withScript((id) => {
            const { state, done } = resolveOn(id, 3, 1);
            expect(done).toBeNull();
            // p2 is at the fewest: a count of zero raises nothing for it.
            expect(state.pendingChoices).toHaveLength(1);
            const head = state.pendingChoices![0]!;
            expect(head.playerId).toBe("p1");
            expect(head.count).toBe(2);
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["p1-land-0", "p1-land-1"],
            });
            expect(getPlayer(state, "p1").battlefield.map((c) => c.id)).toEqual(
                ["p1-land-2"]
            );
            expect(getPlayer(state, "p2").battlefield).toHaveLength(1);
        });
    });

    it("an even board raises no choice at all", () => {
        withScript((id) => {
            const { state } = resolveOn(id, 2, 2);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(getPlayer(state, "p1").battlefield).toHaveLength(2);
            expect(getPlayer(state, "p2").battlefield).toHaveLength(2);
        });
    });

    it("validates a computed count and refuses a malformed one", () => {
        const validate = (effects: EffectOp[]) =>
            validateEffectScript({ id: "t5559-v", name: "t5559-v", effects });
        expect(validate(EQUALIZE_LANDS)).toEqual([]);
        const withCount = (count: unknown) =>
            validate([
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "opponent",
                    zone: "battlefield",
                    count,
                    prompt: "Sacrifice.",
                    bind: "$b",
                },
            ] as unknown as EffectOp[]);
        expect(
            withCount({ count: { zone: "hand", controller: "opponent" } })
        ).toEqual([]);
        expect(withCount({ min: 1 })).not.toEqual([]);
        expect(withCount({ bogus: 1 })).not.toEqual([]);
        expect(withCount(0)).not.toEqual([]);
    });
});
