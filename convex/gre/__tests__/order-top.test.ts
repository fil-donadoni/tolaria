// Ordered top-of-library primitive (`SpellContext.orderTop`) — the reusable
// engine behind the scry/surveil/ponder drag picker (CR 701.22 Scry, CR 701.44
// Surveil, CR 401.4 look / 401 reorder). Exercises the apply branch of each
// `destination` directly through `buildSpellContext`, plus the submit-path
// partition validation and the ADR 0026 known-top persistence that keeps the
// kept cards face-up to the controller after the choice.

import { describe, it, expect } from "vitest";
import { ponder } from "../../cards/sets/lrw/blue";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { buildSpellContext } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import type { StackItem } from "../state";

const lib = (ids: string[]) =>
    ids.map((id) =>
        makeInstance(ponder.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

/** A bare resolving stack item to hang an `order-top` choice on (its card
 *  identity is irrelevant — `orderTop` reads only the library + collectedChoices). */
function pushItem(state: ReturnType<typeof makeState>): StackItem {
    const item: StackItem = {
        ...makeInstance(ponder.id, { controllerId: "p1", ownerId: "p1" }),
        id: "s1",
        castById: "p1",
        targets: [],
        resolutionStep: 0,
    };
    state.stack.push(item);
    return item;
}

const CHOICE = "0:order-top-s1";

describe("orderTop primitive (CR 701.22 / 701.44 / 401.4)", () => {
    it("suspends on first call, raising an order-top choice over the top N", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);

        expect(ctx.orderTop("p1", 3, { destination: "library-bottom" })).toBe(
            false
        );
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        expect(head.destination).toBe("library-bottom");
        expect(head.candidateIds).toEqual(["a", "b", "c"]);
        expect(head.count).toEqual({ min: 0, max: 3 });
    });

    it("scry (library-bottom): keeps ordered cards on top, sends the rest to the TRUE bottom", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d", "e"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        buildSpellContext(state, item).orderTop("p1", 3, {
            destination: "library-bottom",
        });
        // Keep b then a on top; send c to the bottom.
        item.collectedChoices = {
            [CHOICE]: ["b", "a"],
            [`${CHOICE}:second`]: ["c"],
        };
        expect(
            buildSpellContext(state, item).orderTop("p1", 3, {
                destination: "library-bottom",
            })
        ).toBe(true);

        // Top = chosen order b,a; then the untouched d,e; c bottomed last.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "b",
            "a",
            "d",
            "e",
            "c",
        ]);
    });

    it("surveil (graveyard): kept cards on top, the rest to the graveyard in order", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        buildSpellContext(state, item).orderTop("p1", 3, {
            destination: "graveyard",
        });
        // Keep a on top; surveil b and c into the graveyard.
        item.collectedChoices = {
            [CHOICE]: ["a"],
            [`${CHOICE}:second`]: ["b", "c"],
        };
        expect(
            buildSpellContext(state, item).orderTop("p1", 3, {
                destination: "graveyard",
            })
        ).toBe(true);

        expect(state.players[0].library.map((c) => c.id)).toEqual(["a", "d"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["b", "c"]);
    });

    it("order-only (none / Ponder): every card stays on top, only the order changes", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        buildSpellContext(state, item).orderTop("p1", 3, {
            destination: "none",
        });
        item.collectedChoices = { [CHOICE]: ["c", "a", "b"] };
        expect(
            buildSpellContext(state, item).orderTop("p1", 3, {
                destination: "none",
            })
        ).toBe(true);
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "c",
            "a",
            "b",
            "d",
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("marks the kept top cards known to the controller — they stay face-up to them after the scry (ADR 0026)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        buildSpellContext(state, item).orderTop("p1", 3, {
            destination: "library-bottom",
        });
        item.collectedChoices = {
            [CHOICE]: ["a", "b"],
            [`${CHOICE}:second`]: ["c"],
        };
        buildSpellContext(state, item).orderTop("p1", 3, {
            destination: "library-bottom",
        });

        // Controller's projected library exposes the kept cards face-up at their
        // top indices — persistent knowledge, not the transient choice peek.
        const mine = projectPublicState(state, 1, "p1").players[0];
        expect(mine.library.known.map((k) => k.card.id)).toEqual(["a", "b"]);
        // The bottomed card is NOT known.
        expect(mine.library.known.some((k) => k.card.id === "c")).toBe(false);
        // Opponent sees nothing.
        const opp = projectPublicState(state, 1, "p2").players[0];
        expect(opp.library.known).toEqual([]);
    });

    it("hides a known card once a later reorder pushes it below the top (ADR 0026)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        // A prior scry left "a" (and "b") known on top.
        buildSpellContext(state, item).orderTop("p1", 2, {
            destination: "none",
        });
        item.collectedChoices = { [`0:order-top-s1`]: ["a", "b"] };
        buildSpellContext(state, item).orderTop("p1", 2, {
            destination: "none",
        });
        expect(
            projectPublicState(state, 1, "p1").players[0].library.known.map(
                (k) => k.card.id
            )
        ).toEqual(["a", "b"]);

        // A later reorder (Stock Up: bottom the scried cards under the rest)
        // pushes the still-known "a","b" below the now-top unknown "c","d". They
        // are no longer on top, so the projection exposes NONE — the flag
        // disappears in the UI even though `knownTo` survives on the instance.
        buildSpellContext(state, item).reorderLibraryTop("p1", [
            "c",
            "d",
            "a",
            "b",
        ]);
        expect(
            projectPublicState(state, 1, "p1").players[0].library.known
        ).toEqual([]);
    });

    it("keeps known cards visible when a reorder leaves them on top (Diabolic Vision, ADR 0026)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        // Look at + keep a,b,c known on top.
        buildSpellContext(state, item).orderTop("p1", 3, {
            destination: "none",
        });
        item.collectedChoices = { [`0:order-top-s1`]: ["a", "b", "c"] };
        buildSpellContext(state, item).orderTop("p1", 3, {
            destination: "none",
        });
        // Reorder the known top run among itself — every card stays on top.
        buildSpellContext(state, item).reorderLibraryTop("p1", ["c", "a", "b"]);
        expect(
            projectPublicState(state, 1, "p1").players[0].library.known.map(
                (k) => k.card.id
            )
        ).toEqual(["c", "a", "b"]);
    });

    it("hides a card a prior scry left known once a new scry bottoms it (ADR 0026)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        // "a" is known to the controller from an earlier look.
        buildSpellContext(state, item).markKnown("p1", ["a"], "p1");
        // A new scry looks at the top 2 and sends "a" to the bottom.
        buildSpellContext(state, item).orderTop("p1", 2, {
            destination: "library-bottom",
        });
        item.collectedChoices = {
            [`0:order-top-s1`]: ["b"],
            [`0:order-top-s1:second`]: ["a"],
        };
        buildSpellContext(state, item).orderTop("p1", 2, {
            destination: "library-bottom",
        });
        // "a" is now at the bottom and no longer known; only kept "b" is known.
        const known = projectPublicState(state, 1, "p1").players[0].library
            .known;
        expect(known.map((k) => k.card.id)).toEqual(["b"]);
    });

    it("rejects a submission that does not partition the looked-at cards", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        buildSpellContext(state, item).orderTop("p1", 3, {
            destination: "library-bottom",
        });
        const head = state.pendingChoices![0];
        // "c" is looked-at but placed nowhere → the two lists don't cover a,b,c.
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["a"],
                secondZoneIds: ["b"],
            })
        ).toThrow(/place every looked-at card/);
    });
});
