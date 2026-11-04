// CR 702.151a — Reconfigure's two abilities as data are moves the Bot can take
// (issue #5185). As closures (`getTargetRequirement`) they were skipped by
// `enumerateAbilityMoves`, so the search could never reconfigure.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves } from "../moves";
import type { GameState } from "../state";

const ATTACH = "lion-sash-reconfigure-attach";
const UNATTACH = "lion-sash-reconfigure-unattach";

function board(attachedTo?: string): GameState {
    const inst = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
    const sash = inst("Lion Sash", "sash");
    if (attachedTo !== undefined) sash.attachedTo = attachedTo;
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    sash,
                    inst("Grizzly Bears", "host"),
                    inst("Grizzly Bears", "other"),
                ],
                manaPool: { C: 5 },
            }),
            makePlayer("p2"),
        ],
    });
}

function targetsOf(state: GameState, abilityId: string): string[][] {
    return enumerateMoves(state, "p1")
        .filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === "sash" &&
                m.abilityId === abilityId
        )
        .map((m) =>
            ((m as { targets?: { id: string }[] }).targets ?? []).map(
                (t) => t.id
            )
        );
}

describe("Reconfigure move enumeration (CR 702.151a, issue #5185)", () => {
    it("offers the attach half on another creature, never on the source (CR 301.5c)", () => {
        const picks = targetsOf(board(), ATTACH).flat();
        expect(picks).toContain("host");
        expect(picks).not.toContain("sash");
    });

    it("offers the unattach half only while attached", () => {
        expect(targetsOf(board(), UNATTACH)).toHaveLength(0);
        expect(targetsOf(board("host"), UNATTACH)).toHaveLength(1);
    });
});
