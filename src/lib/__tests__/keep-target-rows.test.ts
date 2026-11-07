// CR 115.7d — full path: the GRE raises a "choose new targets", the projection
// carries what may stay, the banner's rows name it, and the row's own arguments
// are what `applyOneTargetSelection` (the `selectTarget` mutation's core) accepts.
import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { requestCopyRetargetOn } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import { applyOneTargetSelection } from "@convex/game";
import type { PendingTarget, Player, StackItem } from "~/types/game";
import { keepTargetRows } from "~/lib/keep-target-rows";

registerTokenDefinition({
    id: "test-keep-row-bear",
    name: "Row Bear",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});
registerTokenDefinition({
    id: "test-keep-row-rock",
    name: "Row Rock",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Artifact"],
});
registerTokenDefinition({
    id: "test-keep-row-two",
    name: "Row Two",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 2 },
    effects: [{ op: "draw", count: 1, player: "controller" }],
});

function raised() {
    const on = (id: string, card: string) =>
        makeInstance(card, { id, controllerId: "p2", ownerId: "p2" });
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [
                    on("rock1", "test-keep-row-rock"),
                    on("bear1", "test-keep-row-bear"),
                ],
            }),
        ],
    });
    const copy = pushSpell(state, "test-keep-row-two", "p1", [
        { type: "permanent", id: "rock1" },
        { type: "permanent", id: "gone" },
    ]);
    requestCopyRetargetOn(state, copy);
    return { state, copy };
}

function rowsOf(state: ReturnType<typeof raised>["state"]) {
    const view = projectPublicState(state, 1, "p1");
    return keepTargetRows(
        view.pendingTarget as unknown as PendingTarget,
        view.players as unknown as Player[],
        view.stack as unknown as StackItem[]
    );
}

describe("keepTargetRows (CR 115.7d)", () => {
    it("names each current target through the projection, a gone one generically", () => {
        const { state } = raised();
        expect(rowsOf(state).map((r) => r.label)).toEqual([
            "Keep Row Rock",
            "Keep departed target",
        ]);
    });

    it("a row submits, and drops out once picked", () => {
        const { state, copy } = raised();
        const [rock] = rowsOf(state);
        applyOneTargetSelection(state, "p1", {
            targetType: rock!.targetType,
            targetId: rock!.targetId,
        });
        expect(rowsOf(state).map((r) => r.targetId)).toEqual(["gone"]);

        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "bear1",
        });
        expect(copy.targets).toEqual([
            { type: "permanent", id: "rock1" },
            { type: "permanent", id: "bear1" },
        ]);
    });

    it("an ordinary selection has no rows", () => {
        expect(keepTargetRows({ selected: [] }, [], [])).toEqual([]);
    });
});
