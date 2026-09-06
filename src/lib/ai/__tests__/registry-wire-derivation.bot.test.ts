// PRD #2064 S5 (#3094) — the client-side engine run reproduces the server's CR
// 613 answer from the wire alone.
//
// ADR 0074: the frontend shares the engine's pure modules but never its
// authority, so the Brain runs the REAL derivation over a `GameState` it
// rebuilds from `projectPublicState` (`state-adapter.ts`). Every CR 613 layer
// now derives from the Continuous Effects Registry (PRD #2064 S2-S4), which
// means a rebuild that loses `state.continuousEffects` derives over an EMPTY
// registry: every granted keyword, every removed keyword and every stored P/T
// modification silently disappears, the bot enumerates moves for a board that
// does not exist, and no suite goes red — there is no gate below this test.
//
// The three cases are the three PRD #2064 S5 names, and each is a STORED entry
// (`SpellContext.addContinuousEffect`, `gre/state.ts`): a source-provenance
// effect would be re-derived from the board on either side of the wire and
// would prove nothing about the registry crossing it.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import type { ContinuousEffect } from "@convex/gre/continuousEffects";
import { deriveLayer6 } from "@convex/gre/layer6";
import { getEffectivePower, getEffectiveToughness } from "@convex/gre/layers";
import type { LayerStateView } from "@convex/gre/layers";
import type { GameState } from "@convex/gre/state";
import type { PermanentView } from "@convex/cards/types";
import { projectedToGameState } from "../state-adapter";

const WAR_MAMMOTH = getCardByName("War Mammoth")!.id;

function entry(
    id: string,
    timestamp: number,
    slot: Pick<ContinuousEffect, "layer" | "sublayer">,
    payload: Extract<
        ContinuousEffect,
        { affected: { kind: "instances" } }
    >["payload"]
): ContinuousEffect {
    return {
        ...slot,
        id,
        timestamp,
        characteristicDefining: false,
        expiry: { kind: "indefinite", controllerId: "bot" },
        affected: { kind: "instances", instanceIds: ["m1"] },
        payload,
    } as ContinuousEffect;
}

/** War Mammoth (3/3, printed trample) under all three effects at once: a
 *  granted keyword, a removed keyword and a stored +2/+2 (CR 613.4c). */
function serverState(): GameState {
    return makeState({
        players: [
            makePlayer("bot", {
                battlefield: [
                    makeInstance(WAR_MAMMOTH, {
                        id: "m1",
                        controllerId: "bot",
                        ownerId: "bot",
                    }),
                ],
            }),
            makePlayer("human"),
        ],
        activePlayerId: "bot",
        priorityPlayerId: "bot",
        continuousEffects: [
            entry(
                "ce-1",
                10,
                { layer: 6 },
                {
                    kind: "keyword-grant",
                    keyword: "flying",
                }
            ),
            entry(
                "ce-2",
                11,
                { layer: 6 },
                {
                    kind: "keyword-remove",
                    keyword: "trample",
                }
            ),
            entry(
                "ce-3",
                12,
                { layer: 7, sublayer: "7c" },
                {
                    kind: "pt-modify",
                    power: 2,
                    toughness: 2,
                }
            ),
        ],
    });
}

function permanent(state: GameState | LayerStateView): PermanentView {
    const players = (state as GameState).players;
    return players.find((p) => p.id === "bot")!
        .battlefield[0] as unknown as PermanentView;
}

describe("the registry reaches the client-side engine run (ADR 0074)", () => {
    it("rebuilds `continuousEffects` onto the Brain's GameState", () => {
        const server = serverState();
        const client = projectedToGameState(
            projectPublicState(server, 1, "bot")
        );
        expect(client.continuousEffects).toEqual(server.continuousEffects);
    });

    it("reproduces the server's layer-6 answer for a granted and a removed keyword", () => {
        const server = serverState();
        const client = projectedToGameState(
            projectPublicState(server, 1, "bot")
        );

        const serverAnswer = deriveLayer6(
            server as unknown as LayerStateView,
            permanent(server)
        ).staticAbilities;
        const clientAnswer = deriveLayer6(
            client as unknown as LayerStateView,
            permanent(client)
        ).staticAbilities;

        // The effects themselves, so a mutual agreement on the WRONG answer
        // (both sides deriving over an empty registry) cannot pass.
        expect(serverAnswer).toEqual(["flying"]);
        expect(clientAnswer).toEqual(serverAnswer);
    });

    it("reproduces the server's layer-7 answer for a stored P/T modification", () => {
        const server = serverState();
        const client = projectedToGameState(
            projectPublicState(server, 1, "bot")
        );

        const serverView = server as unknown as LayerStateView;
        const clientView = client as unknown as LayerStateView;
        expect(getEffectivePower(serverView, permanent(server))).toBe(5);
        expect(getEffectiveToughness(serverView, permanent(server))).toBe(5);
        expect(getEffectivePower(clientView, permanent(client))).toBe(
            getEffectivePower(serverView, permanent(server))
        );
        expect(getEffectiveToughness(clientView, permanent(client))).toBe(
            getEffectiveToughness(serverView, permanent(server))
        );
    });

    it("carries the derived keyword multiset on the wire card itself", () => {
        // The 53 client call sites that read `card.staticAbilities` directly
        // (rather than re-deriving) see the same answer, so their provenance
        // changed and their shape did not.
        const projected = projectPublicState(serverState(), 1, "bot");
        const card = projected.players.find((p) => p.id === "bot")!
            .battlefield[0];
        expect(card.staticAbilities).toEqual(["flying"]);
    });
});
