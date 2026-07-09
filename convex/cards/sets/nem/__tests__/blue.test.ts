// NEM — blue card behavior tests (ADR 0043 per-colour split). One describe per
// non-trivial card. Dominate exercises the gainControl Op in a new
// combination (indefinite control change on a spell target) plus the
// X-dependent `mvFilter` target-legality path, so it earns hand-written GRE +
// wire coverage per § Card testing convention.

import { describe, it, expect } from "vitest";
import { accumulatedKnowledge, dominate } from "..";
import { grizzlyBears, serraAngel } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { getLegalTargets } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

// Accumulated Knowledge exercises the `count` construct's NEW dynamic-count
// path (name filter + acrossAllPlayers scope, issue #985), which the canned-
// scenario smoke generator skips-with-reason (an exact-name, all-graveyards
// count isn't faithfully sizable). Per that contract it earns a hand-written
// per-card test tying the shipped definition to the CR 122 / 201.2 outcome.
describe("Accumulated Knowledge ({1}{U}: draw 1 + 1 per copy in all graveyards)", () => {
    const bearLibrary = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `ak-lib-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    const akInGraveyard = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(accumulatedKnowledge.id, {
                id: `ak-gy-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "graveyard",
            })
        );

    it("draws exactly 1 with no copies in any graveyard (CR 121.1)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: bearLibrary("p1", 5) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, accumulatedKnowledge.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(1);
    });

    it("draws 1 + 1 per copy across BOTH graveyards, surviving projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: bearLibrary("p1", 6),
                    graveyard: akInGraveyard("p1", 1),
                }),
                makePlayer("p2", { graveyard: akInGraveyard("p2", 2) }),
            ],
        });
        pushSpell(state, accumulatedKnowledge.id, "p1");
        resolveTopOfStack(state);
        // draw 1 + (1 in p1's + 2 in p2's graveyard) = 4 (CR 122).
        expect(state.players[0].hand.length).toBe(4);
        // Wire format: the drawn hand survives the client projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(4);
    });
});

describe("Dominate ({X}{1}{U}{U}: gain control of target creature with MV <= X)", () => {
    // CR 202.3 — legal targets are creatures whose mana value is X or less.
    it("only creatures with mana value <= X are legal targets", () => {
        const small = makeInstance(grizzlyBears.id, {
            id: "small",
            controllerId: "p2",
            ownerId: "p2",
        }); // MV 2
        const big = makeInstance(serraAngel.id, {
            id: "big",
            controllerId: "p2",
            ownerId: "p2",
        }); // MV 5
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [small, big] }),
            ],
        });
        // X = 3: MV-2 Bears legal, MV-5 Serra Angel not.
        const legal = getLegalTargets(
            state,
            dominate.targetRequirement!,
            [],
            "p1",
            3
        ).map((t) => t.id);
        expect(legal).toContain("small");
        expect(legal).not.toContain("big");

        // X = 5 widens the ceiling: both become legal.
        const legalWide = getLegalTargets(
            state,
            dominate.targetRequirement!,
            [],
            "p1",
            5
        ).map((t) => t.id);
        expect(legalWide).toContain("small");
        expect(legalWide).toContain("big");
    });

    // CR 613.1b — resolving moves control to the caster (layer 2), indefinitely.
    it("moves control of the target creature to the caster, surviving the wire projection", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Before: p2 controls the bear.
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p2");

        const item = pushSpell(state, dominate.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);

        // After: the bear moves to p1's battlefield under p1's control, still
        // owned by p2 (a control change only, CR 613.1b / 108.4).
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(stolen?.controllerId).toBe("p1");
        expect(stolen?.ownerId).toBe("p2");

        // Wire format: the control change survives projection to the client
        // (the projection reads controllerId, not the fat definition).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slim?.controllerId).toBe("p1");
    });
});
