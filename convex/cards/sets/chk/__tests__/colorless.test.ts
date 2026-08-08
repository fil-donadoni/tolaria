// CHK (Champions of Kamigawa) — colorless behavior tests (ADR 0043 colour
// split).
//
// Sensei's Divining Top's two activated abilities both use already-exercised
// Ops (`scryReorder`, `draw`, `moveZone`), so this is a DSL-first card that
// would normally ride the per-Op regime for free (gre-development.md §
// DSL-first authoring). But the auto-generated canned-scenario smoke test
// (`effectScriptSmoke.test.ts`) explicitly SKIPS both abilities — it cannot
// scenario-ize a suspending `scryReorder` choice, nor a `moveZone` that
// changes zones on the object the script is executing from — which is the
// documented signal to add a hand-written test here.

import { describe, it, expect } from "vitest";
import { senseisDiviningTop } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

const lib = (ids: string[]) =>
    ids.map((id) =>
        makeInstance(senseisDiviningTop.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Sensei's Divining Top (CR 401.4 look/reorder, CR 121.1 draw, issue #1726 top-of-library)", () => {
    it("{1}: looks at the top three and reorders them, keeping all three on top (destination: none)", () => {
        const top = makeInstance(senseisDiviningTop.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [top],
                    library: lib(["a", "b", "c", "d"]),
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...top,
            zone: "stack",
            castById: "p1",
            abilityId: "senseis-divining-top-scry",
            targets: [],
        });
        // scryReorder suspends: resolving raises the order-top PendingChoice.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        expect(head.destination).toBe("none");
        expect(head.candidateIds).toEqual(["a", "b", "c"]);
        const reordered = [...head.candidateIds!].reverse(); // c, b, a
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: reordered,
        });
        // Order-only: all four library cards remain, top three reordered,
        // "d" (never looked at) stays fourth.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "c",
            "b",
            "a",
            "d",
        ]);
        // The Top itself never left the battlefield for this ability.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("top");
    });

    it("{T}: draws a card, then puts the Top on top of its owner's library (issue #1726)", () => {
        const top = makeInstance(senseisDiviningTop.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true, // the {T} cost has already been paid at activation.
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [top],
                    library: lib(["a", "b"]),
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...top,
            zone: "stack",
            castById: "p1",
            abilityId: "senseis-divining-top-draw",
            targets: [],
        });
        resolveTopOfStack(state);

        // Drew "a" (the pre-existing library top) into hand.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["a"]);
        // The Top left the battlefield and is now on top of the library.
        expect(state.players[0].battlefield.some((c) => c.id === "top")).toBe(
            false
        );
        expect(state.players[0].library.map((c) => c.id)).toEqual(["top", "b"]);
    });

    it("wire format: the drawn hand and the Top's move to library top both survive projectPublicState", () => {
        const top = makeInstance(senseisDiviningTop.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [top],
                    library: lib(["a", "b"]),
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...top,
            zone: "stack",
            castById: "p1",
            abilityId: "senseis-divining-top-draw",
            targets: [],
        });
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        expect(me.hand).toHaveLength(1);
        expect(me.battlefield.some((c) => c.id === "top")).toBe(false);
        // The projection slims the library to a count — the Top's presence on
        // top isn't independently visible, but the count still reflects the
        // permanent-turned-library-card.
        expect(me.library.count).toBe(2);
    });
});
