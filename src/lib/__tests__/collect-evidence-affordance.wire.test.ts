// CR 701.59b — the client's affordability hints for collect evidence (issue
// #7723), over the projected view and the real state-view reducer: a reducer
// dropping the graveyard's card ids would price every graveyard at 0 and hide the
// ability for good, which no GRE test could see.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import { matchesGraveyardTarget } from "../graveyard-targets";
import {
    affordableKickersForCard,
    buildTriggerStateView,
    getStackAbilities,
} from "../card-utils";

function projected(
    hostName: string,
    fodder: string[],
    zone: "battlefield" | "hand"
) {
    const host = makeInstance(getCardByName(hostName).id, {
        id: "host",
        controllerId: "p1",
        ownerId: "p1",
        zone,
        isSummoningSick: false,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                [zone]: [host],
                graveyard: fodder.map((name, i) =>
                    makeInstance(getCardByName(name).id, {
                        id: `gy-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
                    })
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(getCardByName("Grizzly Bears").id, {
                        id: "opp-bears",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const view = projectPublicState(state, 1, "p1");
    const players = view.players as unknown as Player[];
    return {
        players,
        card: players[0]![zone]!.find((c) => c?.id === "host") as CardInstance,
    };
}

describe("collect evidence affordability on the client (CR 701.59b)", () => {
    function researcherAbilities(fodder: string[]) {
        const { players, card } = projected(
            "Forensic Researcher",
            fodder,
            "battlefield"
        );
        return getStackAbilities(
            card,
            "PRECOMBAT_MAIN",
            true,
            buildTriggerStateView(players as never, "p1")
        ).map((a) => a.oracleText);
    }
    const EVIDENCE = /Collect evidence 3/;

    it("shows the activation only once the graveyard reaches the threshold", () => {
        expect(
            researcherAbilities(["Hill Giant"]).some((t) =>
                EVIDENCE.test(t ?? "")
            )
        ).toBe(true);
        expect(
            researcherAbilities(["Lightning Bolt"]).some((t) =>
                EVIDENCE.test(t ?? "")
            )
        ).toBe(false);
    });

    it("offers the optional additional cost only once the graveyard reaches it", () => {
        const offered = (fodder: string[]) => {
            const { players, card } = projected(
                "Crimestopper Sprite",
                fodder,
                "hand"
            );
            return affordableKickersForCard(card, "p1", players, "p1").map(
                (k) => k.id
            );
        };
        expect(offered(["Hill Giant", "Grizzly Bears"])).toEqual([
            "collect-evidence",
        ]);
        expect(offered(["Hill Giant"])).toEqual([]);
    });
});

describe('"another target" from a graveyard source on the client', () => {
    it("does not highlight the source: the projected exclusion reaches the card filter", () => {
        const { players } = projected(
            "Grizzly Bears",
            ["Bonebind Orator", "Hill Giant"],
            "battlefield"
        );
        const [source, other] = players[0]!.graveyard as CardInstance[];
        const pending = {
            playerId: "p1",
            cardInstanceId: source!.id,
            kind: "ability",
            targetType: "Creature",
            zone: "graveyard",
            controller: "you",
            count: 1,
            selected: [],
            excludeInstanceIds: [source!.id],
        } as unknown as PendingTarget;
        expect(matchesGraveyardTarget(source!, "p1", pending, "p1", "p1")).toBe(
            false
        );
        expect(matchesGraveyardTarget(other!, "p1", pending, "p1", "p1")).toBe(
            true
        );
    });
});
