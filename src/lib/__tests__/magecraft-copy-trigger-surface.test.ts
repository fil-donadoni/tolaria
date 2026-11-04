// Full path for a Magecraft trigger fired by a COPY (CR 707.10 / 603.2): a real
// cast through `finalizeTargetSelection` (`convex/game.ts`), the GRE resolving
// Fork, then the two reducers `<StackRow>` depends on — `projectPublicState`
// (server → wire) and `getStackAbilityOracleText` — never a hand-built stack
// item, which would mask exactly the drop this exists to catch.
import { describe, expect, it } from "vitest";
import {
    getStackAbilityOracleText,
    stackAbilityKindOf,
} from "~/lib/card-utils";
import { projectPublicState } from "@convex/gameProjections";
import { finalizeTargetSelection } from "@convex/game";
import { resolveTopOfStack } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { fork, lightningBolt } from "@convex/cards/sets/lea/index.cards";
import { witherbloomApprentice } from "@convex/cards/sets/stx/multicolor.cards";

describe("Witherbloom Apprentice's copy trigger on the stack (CR 707.10)", () => {
    it("crosses GRE → game.ts → wire with its ability id, Oracle text and copy event", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(witherbloomApprentice().id, {
                            id: "apprentice",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                    hand: [
                        makeInstance(fork().id, {
                            id: "fork",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const bolt = pushSpell(state, lightningBolt().id, "p2", [
            { type: "player", id: "p1" },
        ]);
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "fork",
                targetType: "spell",
                count: 1,
                selected: [{ type: "spell", id: bolt.id }],
            },
            "p1"
        );
        resolveTopOfStack(state); // Fork's own cast trigger
        resolveTopOfStack(state); // Fork resolves: the copy

        const projected = projectPublicState(state, 1, "p1");
        const row = projected.stack.find(
            (s) =>
                s.triggeredAbilityId === "witherbloom-apprentice-magecraft" &&
                s.triggerEvent?.type === "SPELL_COPIED"
        );
        expect(row).toBeDefined();
        expect(stackAbilityKindOf(row!)).toBe("triggered");
        expect(getStackAbilityOracleText(row!)).toBe(
            "Magecraft — Whenever you cast or copy an instant or sorcery spell, each opponent loses 1 life and you gain 1 life."
        );
    });
});
