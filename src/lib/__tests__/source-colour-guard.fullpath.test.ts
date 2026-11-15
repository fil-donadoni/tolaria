// CR 202.2 full path (issue #2120) — a `permanent-guard` narrowed by the
// targeting SOURCE's colour, Raiding Party ("can't be the target of white
// spells or abilities from white sources"), across all three announcement
// sites for the SAME pending selection:
//   * OFFERED  — `getLegalTargets` fed `pendingTargetingSource`, exactly as
//                `legalActions.ts` builds it (what the Bot enumerates too);
//   * ACCEPTED — `applyOneTargetSelection`, the per-target function the
//                `selectTarget` mutation runs (`convex/game.ts`);
//   * CLIENT   — `isUntargetableByPending` read off the REAL wire projection
//                (`projectPublicState`), the way the battlefield hooks feed it.
// The rows assert the VALUE on every side, not only their agreement: a colour
// dropped from the shared projection breaks all three together and they would
// still agree.

import { describe, expect, it } from "vitest";
import { isUntargetableByPending } from "../targeting";
import type { Player, StackItem } from "~/types/game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import { applyOneTargetSelection } from "@convex/game";
import { getLegalTargets, pendingTargetingSource } from "@convex/gre/rules";
import type { GameState, PendingTarget } from "@convex/gre/state";

const RAIDING_PARTY = "907a3396-706b-4ca2-9973-bca758986032"; // the guard
const DISENCHANT = "2722d7e2-61c6-4934-9c21-875ee78fd06c"; // white Instant
const DESERT_TWISTER = "0d77c149-cca2-45c7-bc83-5ba1872ad5e0"; // green Sorcery
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // white creature
const RASPUTIN = "503256f8-3aab-49d0-b78b-6502aa29ce52"; // white-blue creature
const ORNITHOPTER = "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0"; // colourless

/** A pick from `sourceId`. `kind` ABSENT for a cast — the shape `announceCast`
 *  really produces; `"ability"` for an activated ability (CR 602.2b). Open
 *  `max` so a legal pick doesn't auto-finalize into a commit this fixture
 *  doesn't seed. */
function pending(sourceId: string, ability: boolean): PendingTarget {
    return {
        playerId: "p2",
        cardInstanceId: sourceId,
        targetType: ["Artifact", "Enchantment"],
        count: { min: 1, max: 3 },
        selected: [],
        ...(ability ? { kind: "ability" as const } : {}),
    };
}

function board(pendingTarget: PendingTarget): GameState {
    const own = (cardId: string, id: string, zone: "hand" | "battlefield") =>
        makeInstance(cardId, { id, controllerId: "p2", ownerId: "p2", zone });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(RAIDING_PARTY, {
                        id: "party",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                hand: [
                    own(DISENCHANT, "disenchant", "hand"),
                    own(DESERT_TWISTER, "twister", "hand"),
                    own(ORNITHOPTER, "orni", "hand"),
                ],
                battlefield: [
                    own(SAVANNAH_LIONS, "lions", "battlefield"),
                    own(RASPUTIN, "rasputin", "battlefield"),
                    own(ORNITHOPTER, "orni-bf", "battlefield"),
                ],
            }),
        ],
        pendingTarget,
    });
}

/** Each site's verdict: does it BAR Raiding Party for this pick? */
function verdicts(pendingTarget: PendingTarget) {
    const state = board(pendingTarget);
    const offeredBars = !getLegalTargets(
        state,
        { type: ["Artifact", "Enchantment"], count: 1 },
        pendingTargetingSource(
            state,
            pendingTarget.cardInstanceId,
            pendingTarget.kind
        ),
        "p2"
    ).some((t) => t.id === "party");

    let acceptedBars = false;
    try {
        applyOneTargetSelection(structuredClone(state), "p2", {
            targetType: "permanent",
            targetId: "party",
        });
    } catch (e) {
        acceptedBars = /can't be the target/i.test((e as Error).message);
    }

    const projected = projectPublicState(state, 1, "p2");
    const pt = projected.pendingTarget!;
    const players = projected.players as unknown as Player[];
    const clientBars = isUntargetableByPending(
        players,
        players[0].battlefield.find((c) => c.id === "party")!,
        pt.cardInstanceId,
        pt.kind,
        (projected.stack ?? []) as unknown as StackItem[],
        pt.playerId
    );
    return { offeredBars, acceptedBars, clientBars };
}

const BARRED = { offeredBars: true, acceptedBars: true, clientBars: true };
const ALLOWED = { offeredBars: false, acceptedBars: false, clientBars: false };

describe("CR 202.2 — Raiding Party's source-colour guard, offered = accepted = client", () => {
    it("bars a white spell (Disenchant) on all three sites", () => {
        expect(verdicts(pending("disenchant", false))).toEqual(BARRED);
    });

    it("bars an ability from a white source (CR 113.7) on all three sites", () => {
        expect(verdicts(pending("lions", true))).toEqual(BARRED);
    });

    it("bars a multicolour source that includes white", () => {
        expect(verdicts(pending("rasputin", true))).toEqual(BARRED);
    });

    it("must-NOT — a green spell (Desert Twister) targets it on all three sites", () => {
        expect(verdicts(pending("twister", false))).toEqual(ALLOWED);
    });

    it("must-NOT — a colourless source targets it (CR 105.2c)", () => {
        expect(verdicts(pending("orni", false))).toEqual(ALLOWED);
        expect(verdicts(pending("orni-bf", true))).toEqual(ALLOWED);
    });
});
