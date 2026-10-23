// The `activation-restriction` static (CR 602.5 — "A player can't begin to
// activate an ability that's prohibited from being activated") as the Bot
// sees it: `enumerateMoves` must never offer an activation Cursed Totem
// forbids. The engine-side enforcement lives in `activationRestriction.test.ts`.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { enumerateMoves } from "../moves";
import type { GameState } from "../state";

/** p1 controls a Shivan Dragon (with {R} floating) and, when `totem`, a
 *  Cursed Totem; nothing is summoning sick. */
function board(totem: boolean): GameState {
    const perm = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
    const me = makePlayer("p1", {
        battlefield: [
            perm("Shivan Dragon", "dragon"),
            ...(totem ? [perm("Cursed Totem", "totem")] : []),
        ],
    });
    me.manaPool = { ...me.manaPool, R: 1 };
    return makeState({ players: [me, makePlayer("p2")] });
}

describe("activation-restriction: the Bot never enumerates a locked activation (CR 602.5)", () => {
    it("Shivan Dragon's pump is a move without the Totem and none with it", () => {
        const pumps = (s: GameState) =>
            enumerateMoves(s, "p1").filter(
                (m) =>
                    m.kind === "activate-ability" &&
                    m.abilityId === "shivan-dragon-pump"
            );
        expect(pumps(board(false)).length).toBeGreaterThan(0);
        expect(pumps(board(true))).toHaveLength(0);
    });
});
