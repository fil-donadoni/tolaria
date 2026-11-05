// Issue #8167 — CR 707.9b "except he's legendary in addition to his other types"
// must survive the wire AND reach the client's readers of a permanent's
// supertypes, none of which can find it on the presented definition: the copy
// shows the copied card's definition, whose supertypes are the printed ones.
//
// The engine half is `convex/gre/__tests__/copyExceptSupertype.test.ts`. Every
// assertion here reads the output of `projectPublicState`, driven through the
// real activation path: a hand-built instance would mask a field the wire drops.

import { describe, expect, it } from "vitest";
import { matchesPermanentFilter, toMatchablePermanent } from "../card-utils";
import { canFormBand } from "../banding";
import { buildPreviewBody } from "../preview-body";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName, withTemporaryDefinition } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import { activateAbilityOnState, applyOneTargetSelection } from "@convex/game";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

const PROBE_ID = "client-8167-supertype-copy";
const COPY_ABILITY = "client-8167-become-copy";
const COPY_TEXT =
    "{T}: Until your next turn, this creature becomes a copy of target artifact, except it's legendary in addition to its other types.";
const LOTUS = getCardByName("Black Lotus").id;
const BEARS = getCardByName("Grizzly Bears");

const PROBE: CardDefinition = {
    ...BEARS,
    id: PROBE_ID,
    name: "Client Test Absorber",
    oracleText: COPY_TEXT,
    activatedAbilities: [
        {
            id: COPY_ABILITY,
            oracleText: COPY_TEXT,
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [
                {
                    op: "becomeCopy",
                    target: { ref: "$source" },
                    source: { target: 0 },
                    duration: { phase: "untap", player: "controller" },
                    except: {
                        name: "Client Test Absorber",
                        additionalSupertypes: ["Legendary"],
                    },
                },
            ],
        },
    ],
};

function copied(): CardInstance {
    const probe = makeInstance(BEARS.id, {
        id: "probe",
        ownerId: "p1",
        controllerId: "p1",
        isSummoningSick: false,
    });
    probe.card = { id: PROBE_ID };
    const state: GameState = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [probe] }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(LOTUS, {
                        id: "lotus",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "probe",
        abilityId: COPY_ABILITY,
    });
    applyOneTargetSelection(state, "p1", {
        targetType: "permanent",
        targetId: "lotus",
    });
    resolveTopOfStack(state);
    return projectPublicState(state, 1, "p1")
        .players.flatMap((p) => p.battlefield)
        .find((c) => c.id === "probe") as unknown as CardInstance;
}

describe("copy exception supertype on the client (CR 707.9b, issue #8167)", () => {
    it("crosses the wire", () => {
        withTemporaryDefinition(PROBE, () => {
            const card = copied();
            expect(card.card.id).toBe(LOTUS);
            expect(card.copyExcept?.additionalSupertypes).toEqual([
                "Legendary",
            ]);
        });
    });

    it("shows on the preview's type line", () => {
        withTemporaryDefinition(PROBE, () => {
            const card = copied();
            expect(buildPreviewBody(LOTUS, card).typeLine).toContain(
                "Legendary"
            );
        });
    });

    it("makes the copy a member of a legendary band (CR 702.22c)", () => {
        withTemporaryDefinition(PROBE, () => {
            const card = copied();
            const bander: CardInstance = {
                ...card,
                id: "bander",
                staticAbilities: ["bands with other:legendary"],
            };
            expect(canFormBand([bander, card])).toBe(true);
        });
    });

    it("drives the client's nonlegendary filter, like the server's", () => {
        withTemporaryDefinition(PROBE, () => {
            const card = copied();
            expect(
                matchesPermanentFilter(card, {
                    excludeSupertypes: "Legendary",
                })
            ).toBe(false);
            expect(toMatchablePermanent(card).supertypes).toContain(
                "Legendary"
            );
        });
    });
});
