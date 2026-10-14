// Integration test for board-derived mana descriptors through the PRIORITY
// tap-for-mana mutation (`tapUntap`) — issue #5195, CR 107.1 / 109.2 / 605.1a.
//
// The GRE unit file (`gre/__tests__/boardDerivedManaDescriptors.test.ts`)
// pins the option list; this one pins what the REAL mutation adds to the
// pool, which is where the two `game.ts` obligations live:
//
//   - every tap site must hand the resolver EVERY player's battlefield
//     (`manaTapBattlefields`) — "for each Elf on the battlefield" (Priest of
//     Titania) counts the opponent's Elves, and a resolver fed only the
//     controller's battlefield has no answer for it;
//   - a source carrying a plain "{T}: Add {C}" AND a scaled "{3}, {T}: Add {B}
//     for each basic Swamp you control" (Cabal Stronghold) adds {C} for the
//     first and pays {3} for the second.
//
// Drives the registered mutation `_handler` through the stub `MutationCtx`
// (`gameMutationHarness.fixture.ts`), the `tapUntapManaAbilityManaCost.test.ts`
// discipline.

import { describe, expect, it } from "vitest";
import { tapUntap } from "../game";
import type { CardDefinition } from "../cards/types";
import { withTemporaryDefinitionAsync } from "../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { forest, swamp } from "../cards/sets/lea/colorless.cards";
import { llanowarElves } from "../cards/sets/lea/green.cards";
import type { CardInstanceState, GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

const runTapUntap = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<TapUntapArgs, "gameId" | "playerId">
) =>
    runMutation<TapUntapArgs, void>(
        tapUntap as unknown as Handler<TapUntapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

// The compiled shapes (pinned against the compiler by
// `oracle/__tests__/manaBoardDerived.test.ts`).
const PRIEST_OF_TITANIA: CardDefinition = {
    id: "test-5195-tap-priest-of-titania",
    name: "Priest of Titania",
    oracleText: "{T}: Add {G} for each Elf on the battlefield.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "priest-of-titania-mana",
            oracleText: "{T}: Add {G} for each Elf on the battlefield.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 },
            manaAmountSource: { filter: { subtypes: ["Elf"] } },
        },
    ],
};

const CABAL_STRONGHOLD: CardDefinition = {
    id: "test-5195-tap-cabal-stronghold",
    name: "Cabal Stronghold",
    oracleText:
        "{T}: Add {C}.\n{3}, {T}: Add {B} for each basic Swamp you control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "cabal-stronghold-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 },
        },
        {
            id: "cabal-stronghold-mana-2",
            oracleText: "{3}, {T}: Add {B} for each basic Swamp you control.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: false,
            manaProduced: { B: 1 },
            manaAmountSource: {
                filter: {
                    subtypes: ["Swamp"],
                    supertypes: ["Basic"],
                    controllerRelation: "you",
                },
            },
        },
    ],
};

let serial = 0;
function on(cardId: string, controllerId: "p1" | "p2", id?: string) {
    return makeInstance(cardId, {
        id: id ?? `perm-${serial++}`,
        controllerId,
        ownerId: controllerId,
    });
}

function stateOf(
    mine: CardInstanceState[],
    theirs: CardInstanceState[],
    pool: Partial<GameState["players"][0]["manaPool"]> = {}
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: mine,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...pool },
            }),
            makePlayer("p2", { battlefield: theirs }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("tapUntap — Priest of Titania counts every player's Elves (CR 109.2)", () => {
    it("adds {G} per Elf on the WHOLE battlefield, and the untap refunds exactly that", () =>
        withTemporaryDefinitionAsync(PRIEST_OF_TITANIA, async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(
                    stateOf(
                        [
                            on(PRIEST_OF_TITANIA.id, "p1", "priest"),
                            on(llanowarElves().id, "p1"),
                        ],
                        [
                            on(llanowarElves().id, "p2"),
                            on(llanowarElves().id, "p2"),
                        ]
                    )
                ),
            ]);
            await runTapUntap(stub.ctx, { cardInstanceId: "priest" });
            const tapped = stub.state().players[0];
            // Priest + one own Elf + the opponent's two: four Elves.
            expect(tapped.manaPool.G).toBe(4);
            expect(
                tapped.battlefield.find((c) => c.id === "priest")!.isTapped
            ).toBe(true);

            // CR 106.4 — untapping before the mana is spent reverses the
            // activation by the snapshotted amount.
            await runTapUntap(stub.ctx, { cardInstanceId: "priest" });
            expect(stub.state().players[0].manaPool.G ?? 0).toBe(0);
        }));
});

describe("tapUntap — Cabal Stronghold's two mana abilities (CR 605.1a)", () => {
    it("with no basic Swamp, the plain tap adds exactly one {C}", () =>
        withTemporaryDefinitionAsync(CABAL_STRONGHOLD, async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(
                    stateOf(
                        [
                            on(CABAL_STRONGHOLD.id, "p1", "stronghold"),
                            on(forest().id, "p1"),
                        ],
                        []
                    )
                ),
            ]);
            await runTapUntap(stub.ctx, { cardInstanceId: "stronghold" });
            const player = stub.state().players[0];
            expect(player.manaPool.C).toBe(1);
            expect(player.manaPool.B ?? 0).toBe(0);
        }));

    it("index 0 is the {C} tap even when the Swamp count is live", () =>
        withTemporaryDefinitionAsync(CABAL_STRONGHOLD, async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(
                    stateOf(
                        [
                            on(CABAL_STRONGHOLD.id, "p1", "stronghold"),
                            on(swamp().id, "p1"),
                            on(swamp().id, "p1"),
                        ],
                        []
                    )
                ),
            ]);
            await runTapUntap(stub.ctx, {
                cardInstanceId: "stronghold",
                manaChoiceIndex: 0,
            });
            const player = stub.state().players[0];
            expect(player.manaPool.C).toBe(1);
            expect(player.manaPool.B ?? 0).toBe(0);
        }));

    it("index 1 pays {3} and adds {B} per basic Swamp its controller controls", () =>
        withTemporaryDefinitionAsync(CABAL_STRONGHOLD, async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(
                    stateOf(
                        [
                            on(CABAL_STRONGHOLD.id, "p1", "stronghold"),
                            on(swamp().id, "p1"),
                            on(swamp().id, "p1"),
                        ],
                        // CR 109.5 — the opponent's Swamp is not "you control".
                        [on(swamp().id, "p2")],
                        { C: 3 }
                    )
                ),
            ]);
            await runTapUntap(stub.ctx, {
                cardInstanceId: "stronghold",
                manaChoiceIndex: 1,
            });
            const player = stub.state().players[0];
            expect(player.manaPool.B).toBe(2);
            expect(player.manaPool.C ?? 0).toBe(0);
        }));
});
