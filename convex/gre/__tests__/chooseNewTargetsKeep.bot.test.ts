// CR 115.7d / 707.10c — the Bot can answer a raised "choose new targets" that
// has to keep an illegal target: `enumerateRaisedTargetMoves` offers what the
// server accepts, and a selection no new target can fill does not freeze it.
import { describe, expect, it } from "vitest";
import type { TargetSelection } from "../../cards/types";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { applyOneTargetSelection } from "../../game";
import { requestCopyRetargetOn } from "../state";
import { enumerateRaisedTargetMoves } from "../moves";

const BEAR = "test-keep-bot-bear";
const ROCK = "test-keep-bot-rock";
const TWO = "test-keep-bot-two";
for (const [id, types] of [
    [BEAR, ["Creature"]],
    [ROCK, ["Artifact"]],
] as const) {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: [...types],
        ...(id === BEAR ? { power: 2, toughness: 2 } : {}),
    });
}
registerTokenDefinition({
    id: TWO,
    name: TWO,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    effects: [{ op: "draw", count: 1, player: "controller" }],
    targetRequirement: { type: "Creature", count: 2 },
});

const perm = (id: string): TargetSelection => ({ type: "permanent", id });

function offer(ids: string[], current: string[]) {
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: ids.map((id) =>
                    makeInstance(id.startsWith("rock") ? ROCK : BEAR, {
                        id,
                        controllerId: "p2",
                        ownerId: "p2",
                    })
                ),
            }),
        ],
    });
    const copy = pushSpell(state, TWO, "p1", current.map(perm));
    requestCopyRetargetOn(state, copy);
    return { state, copy };
}

describe("the Bot over a raised selection that may keep a target (CR 115.7d)", () => {
    it("enumerates the illegal current target beside the legal ones", () => {
        const { state } = offer(
            ["rock1", "bear1", "bear2"],
            ["rock1", "bear1"]
        );
        const tuples = enumerateRaisedTargetMoves(state, "p1").flatMap((m) =>
            m.kind === "submit-target"
                ? [
                      m.targets
                          .map((t) => t.id)
                          .sort()
                          .join("+"),
                  ]
                : []
        );
        expect(tuples).toContain("bear2+rock1");
        expect(tuples.join()).not.toContain("rock2");
    });

    it("every enumerated tuple is one the server accepts", () => {
        const { state, copy } = offer(
            ["rock1", "bear1", "bear2"],
            ["rock1", "bear1"]
        );
        for (const move of enumerateRaisedTargetMoves(state, "p1")) {
            if (move.kind !== "submit-target") continue;
            const trial = structuredClone(state);
            for (const t of move.targets) {
                applyOneTargetSelection(trial, "p1", {
                    targetType: t.type as "permanent",
                    targetId: t.id,
                });
            }
            expect(trial.pendingTarget).toBeUndefined();
            expect(trial.stack.find((s) => s.id === copy.id)?.targets).toEqual(
                move.targets
            );
        }
    });

    it("with nothing legal left, keeping both is still an answer: no freeze", () => {
        const { state } = offer(["rock1", "rock2"], ["rock1", "rock2"]);
        expect(enumerateRaisedTargetMoves(state, "p1")).toHaveLength(1);
    });
});
