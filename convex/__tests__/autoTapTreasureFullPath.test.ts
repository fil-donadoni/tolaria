// Full-path integration for Auto-Tap spending Treasure tokens (CR 111.10a,
// CR 601.2g / 605.3a, issue #8317): the REGISTERED `autoTapForPayment` /
// `autoTapForAttackTax` handlers over the stub `MutationCtx`, against real
// Treasure tokens created through the engine's own token path.
//
//   111.10a  A Treasure token is a colorless Treasure artifact token with
//            "{T}, Sacrifice this token: Add one mana of any color."
//   605.3a   A player may activate an activated mana ability ... whenever
//            they are casting a spell or activating an ability that requires
//            a mana payment ...
//
// The trigger case runs the manual `tapForPayment` on a twin state and
// compares: an Auto-Tap sacrifice must be the same activation, not a
// lookalike that skips the departure's triggers.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { registerTokenDefinition } from "../cards";
import { TREASURE_TOKEN } from "../cards/sharedTokens";
import {
    leftTrigger,
    wasSacrificed,
} from "../cards/abilities/triggers/leftTrigger";
import { autoTapForAttackTax, autoTapForPayment, tapForPayment } from "../game";
import type { Id } from "../_generated/dataModel";
import {
    createTokenPermanents,
    type CardInstanceState,
    type GameState,
} from "../gre/state";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
    type MutationStub,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const BASE = { gameId: GAME_ID, playerId: "p1" };
const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // {T}: W
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // {T}: G

/** "Whenever you sacrifice an artifact, you gain 1 life." — a watcher that
 *  makes the sacrifice's departure trigger observable. */
const WATCHER_ID = "test-autotap-treasure-sacrifice-watcher";
registerTokenDefinition({
    id: WATCHER_ID,
    name: WATCHER_ID,
    rarity: "common",
    manaCost: {},
    types: ["Enchantment"],
    triggeredAbilities: [
        leftTrigger({
            id: "test-autotap-treasure-watcher-trigger",
            oracleText: "Whenever you sacrifice an artifact, you gain 1 life.",
            scope: "yours",
            toZone: "graveyard",
            filter: { types: "Artifact" },
            condition: (event) => wasSacrificed(event),
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ],
});

const stub = (state: GameState) =>
    makeMutationCtx("p1", [gameStateSeed(state, 1)]);

const run = <A>(mutation: unknown, h: MutationStub, args: A) =>
    runMutation<typeof BASE & A, unknown>(
        mutation as unknown as Handler<never, never>,
        h.ctx,
        { ...BASE, ...args }
    );

/** p1 casting Grizzly Bears ({1}{G}) with `lands` and `treasures` real
 *  Treasure tokens (renamed t1, t2, …) on the battlefield. */
function casting(
    lands: CardInstanceState[],
    treasures: number,
    extra: CardInstanceState[] = []
): GameState {
    const bears = makeInstance(grizzlyBears().id, {
        id: "bears",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [bears],
                battlefield: [...lands, ...extra],
            }),
            makePlayer("p2"),
        ],
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "bears",
            manaCost: { G: 1, X: 1 },
            tappedLandIds: [],
        },
    });
    createTokenPermanents(state, TREASURE_TOKEN, "p1", treasures);
    let n = 0;
    for (const card of state.players[0].battlefield) {
        if (card.isToken) card.id = `t${++n}`;
    }
    return state;
}

const land = (def: string, id: string) =>
    makeInstance(def, { id, controllerId: "p1", ownerId: "p1" });

/** Every zone of p1 that could still hold the instance. */
function zonesHolding(state: GameState, id: string): string[] {
    const p1 = state.players[0];
    const zones: [string, CardInstanceState[]][] = [
        ["battlefield", p1.battlefield],
        ["graveyard", p1.graveyard],
        ["exile", p1.exile],
        ["hand", p1.hand],
    ];
    return zones
        .filter(([, cards]) => cards.some((c) => c.id === id))
        .map(([zone]) => zone);
}

describe("autoTapForPayment spends a Treasure only when needed (CR 111.10a, issue #8317)", () => {
    it("pays {1}{G} with a Plains and ONE of two Treasures, and the spell commits", async () => {
        const h = stub(casting([land(PLAINS, "plains")], 2));
        await run(autoTapForPayment, h, {});
        const after = h.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((item) => item.id)).toContain("bears");
        const onBattlefield = ["t1", "t2"].filter((id) =>
            zonesHolding(after, id).includes("battlefield")
        );
        expect(onBattlefield).toHaveLength(1);
    });

    it("sacrifices nothing when lands alone cover the cost", async () => {
        const h = stub(
            casting([land(PLAINS, "plains"), land(FOREST, "forest")], 2)
        );
        await run(autoTapForPayment, h, {});
        const after = h.state();
        expect(after.pendingCast).toBeUndefined();
        expect(zonesHolding(after, "t1")).toEqual(["battlefield"]);
        expect(zonesHolding(after, "t2")).toEqual(["battlefield"]);
    });

    it("sacrifices nothing and keeps the banner up when every Treasure still falls short", async () => {
        const state = casting([], 1);
        state.pendingCast!.manaCost = { G: 1, X: 2 };
        const h = stub(state);
        await run(autoTapForPayment, h, {});
        const after = h.state();
        expect(after.pendingCast).toBeDefined();
        expect(zonesHolding(after, "t1")).toEqual(["battlefield"]);
    });

    it("never plans a Treasure an open cost pick may still name", async () => {
        const state = casting([land(PLAINS, "plains")], 1);
        state.pendingCast!.sacrificeSelection = {
            playerId: "p1",
            reason: "test",
            requirements: [{ count: 1, filter: { types: ["Artifact"] } }],
            picked: [],
        } as never;
        const h = stub(state);
        await run(autoTapForPayment, h, {});
        expect(zonesHolding(h.state(), "t1")).toEqual(["battlefield"]);
    });

    it("fires the same triggers as sacrificing the Treasure by hand", async () => {
        const watcher = makeInstance(WATCHER_ID, {
            id: "watcher",
            controllerId: "p1",
            ownerId: "p1",
        });
        const board = () => casting([land(PLAINS, "plains")], 1, [watcher]);

        const auto = stub(board());
        await run(autoTapForPayment, auto, {});

        const manual = stub(board());
        await run(tapForPayment, manual, {
            payments: [
                { cardInstanceId: "plains" },
                { cardInstanceId: "t1", manaChoiceIndex: 4 },
            ],
        });

        // Spell plus every trigger, by what put it there and why.
        const triggersOf = (s: GameState) =>
            s.stack
                .map((item) =>
                    [
                        item.triggerSourceId ?? item.id,
                        item.triggeredAbilityId ?? "",
                        item.triggerEvent?.type ?? "",
                    ].join("|")
                )
                .sort();
        const autoState = auto.state();
        expect(triggersOf(autoState)).toContain(
            "watcher|test-autotap-treasure-watcher-trigger|PERMANENT_LEFT"
        );
        expect(triggersOf(autoState)).toEqual(triggersOf(manual.state()));
    });
});

describe("autoTapForAttackTax spends a Treasure on the same terms (CR 508.1h / 111.10a)", () => {
    function taxed(cost: Record<string, number>, lands: CardInstanceState[]) {
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: lands }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
                pendingAttackManaTax: {
                    playerId: "p1",
                    cost,
                    tappedLandIds: [],
                } as never,
            },
        });
        createTokenPermanents(state, TREASURE_TOKEN, "p1", 1);
        state.players[0].battlefield.find((c) => c.isToken)!.id = "t1";
        return state;
    }

    it("sacrifices the Treasure when it completes the tax", async () => {
        const h = stub(taxed({ G: 1, generic: 1 }, [land(PLAINS, "plains")]));
        await run(autoTapForAttackTax, h, {});
        const after = h.state();
        expect(after.combat?.pendingAttackManaTax).toBeUndefined();
        expect(zonesHolding(after, "t1")).not.toContain("battlefield");
    });

    it("keeps the Treasure when it cannot complete the tax", async () => {
        const h = stub(taxed({ G: 1, generic: 2 }, [land(PLAINS, "plains")]));
        await run(autoTapForAttackTax, h, {});
        const after = h.state();
        expect(after.combat?.pendingAttackManaTax).toBeDefined();
        expect(zonesHolding(after, "t1")).toEqual(["battlefield"]);
    });
});
