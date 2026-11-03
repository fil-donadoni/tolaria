// Saddle N (CR 702.171a/b) — the Brain's move enumerator. Saddling an
// already-saddled Mount is legal but changes nothing (the designation is held
// until end of turn), so `enumerateMoves` never offers it: paying the
// tap-other cost a second time is pure loss.

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { grizzlyBears } from "../../cards/sets/lea/index.cards";
import { causticBronco } from "../../cards/sets/otj/index.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const SADDLE_ABILITY_ID = "caustic-bronco-saddle";

function board(saddled: boolean) {
    const bronco = makeInstance(causticBronco().id, {
        id: "bronco",
        controllerId: "p1",
        ownerId: "p1",
        ...(saddled ? { saddled: true } : {}),
    });
    const bears = ["bear-a", "bear-b"].map((id) =>
        makeInstance(grizzlyBears().id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [bronco, ...bears] }),
            makePlayer("p2"),
        ],
    });
}

function saddleMoves(saddled: boolean) {
    return enumerateMoves(board(saddled), "p1").filter(
        (m) =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "bronco" &&
            m.abilityId === SADDLE_ABILITY_ID
    );
}

describe("Saddle N in enumerateMoves (CR 702.171a)", () => {
    it("an unsaddled Mount with enough power to tap offers Saddle", () => {
        expect(saddleMoves(false)).toHaveLength(1);
    });

    it("an already-saddled Mount does not offer Saddle again", () => {
        expect(saddleMoves(true)).toHaveLength(0);
    });
});
