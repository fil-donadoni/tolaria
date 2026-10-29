// CR 701.23b / 701.23d — the floor of a genuine Library Search (issue #3437).
//
// A search that states a quality may find fewer or none (CR 701.23b); a search
// for a bare quantity is mandatory (CR 701.23d). The floor is derived from the
// Op's `filter`, so a script that AUTHORS a fixed count still lets the searcher
// decline. Every case raises the choice by really resolving a spell and is
// asserted through `submit` and `projectPublicState`.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { resolveTopOfStack, type GameState } from "../state";

const FOREST = getCardByName("Forest").id;
const BEARS = getCardByName("Grizzly Bears").id;

function tutor(filter: Record<string, unknown> | undefined, count: unknown) {
    const id = `t3437-${filter ? "filtered" : "bare"}-${JSON.stringify(count)}`;
    const choice = {
        op: "choice",
        kind: "search-library",
        player: "controller",
        zone: "library",
        ...(filter ? { filter } : {}),
        count,
        prompt: "Search your library.",
        bind: "$found",
    };
    return {
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Sorcery"],
        effects: [choice] as unknown as readonly EffectOp[],
    } as unknown as CardDefinition;
}

function raise(def: CardDefinition, library: string[]): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: library.map((cardId, i) =>
                    makeInstance(cardId, {
                        id: `lib-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, def.id, "p1");
    resolveTopOfStack(state);
    return state;
}

function submit(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

describe("a search that states a quality may find fewer (CR 701.23b)", () => {
    it("accepts an empty submission with a match present, though the script authors count 1", () => {
        const def = tutor({ subtype: "Forest" }, 1);
        withTemporaryDefinition(def, () => {
            const state = raise(def, [BEARS, FOREST]);
            const head = state.pendingChoices![0];
            expect(head.count).toEqual({ min: 0, max: 1 });
            // Wire format: the view reducer keeps the floor.
            const wire = projectPublicState(state, 1, "p1").pendingChoices?.[0];
            expect(wire?.count).toEqual({ min: 0, max: 1 });

            submit(state, []);
            expect(state.pendingChoices ?? []).toEqual([]);
            for (const viewer of ["p1", "p2"]) {
                const notices = (
                    projectPublicState(state, 1, viewer).pendingReveals ?? []
                ).filter((r) => r.kind === "fail-to-find");
                expect(notices, `viewer ${viewer}`).toHaveLength(1);
            }
        });
    });

    it("still accepts finding the match", () => {
        const def = tutor({ subtype: "Forest" }, 1);
        withTemporaryDefinition(def, () => {
            const state = raise(def, [BEARS, FOREST]);
            expect(() => submit(state, ["lib-1"])).not.toThrow();
        });
    });

    it("lets an 'all cards with this quality' search find fewer than all of them", () => {
        const def = tutor({ subtype: "Forest" }, { min: 2, max: 2 });
        withTemporaryDefinition(def, () => {
            const state = raise(def, [FOREST, FOREST, BEARS]);
            expect(state.pendingChoices![0].count).toEqual({ min: 0, max: 2 });
            expect(() => submit(state, ["lib-0"])).not.toThrow();
        });
    });
});

describe("a search for a bare quantity stays mandatory (CR 701.23d)", () => {
    it("rejects an empty submission while the library holds enough cards", () => {
        const def = tutor(undefined, 2);
        withTemporaryDefinition(def, () => {
            const state = raise(def, [BEARS, FOREST, FOREST]);
            expect(state.pendingChoices![0].count).toBe(2);
            expect(() => submit(state, [])).toThrow();
        });
    });

    it("clamps to what exists when the library holds fewer", () => {
        const def = tutor(undefined, 3);
        withTemporaryDefinition(def, () => {
            const state = raise(def, [BEARS, FOREST]);
            expect(state.pendingChoices![0].count).toBe(2);
            expect(() => submit(state, [])).toThrow();
            expect(() => submit(state, ["lib-0", "lib-1"])).not.toThrow();
        });
    });
});
