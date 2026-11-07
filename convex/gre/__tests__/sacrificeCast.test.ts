import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards/index";
import { getStaticAdditionalSacrifices, normalizeManaCost } from "../state";
import {
    announceCast,
    selectSacrifice,
    tryAutoCommitPendingCast,
} from "../../game";
import {
    autoResolveFungible,
    isSacrificeSelectionComplete,
    nextUnmetRequirement,
    type SacrificeSelection,
} from "../sacrificeChoice";
import { projectPublicState } from "../../gameProjections";
import type { GameState, CardInstanceState } from "../state";
import type { Id } from "../../_generated/dataModel";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";

// CR 601.2f / 601.2h — the total cost holds both the spell's own "sacrifice a
// creature" and Drought's Swamp, and all of it is paid. The selection allocates
// picks to them in that order, so the Swamp cannot be pre-filled while the
// creature is still the caster's to choose.
describe("own sacrifice with a real choice ahead of Drought's tax, through the real mutations (CR 601.2h)", () => {
    const creatures = [
        { cardId: getCardByName("Grizzly Bears").id, id: "bear" },
        { cardId: getCardByName("Hill Giant").id, id: "giant" },
    ];

    function board(swampIds: string[], creatureCount = 2): GameState {
        const permanent = (cardId: string, id: string) =>
            makeInstance(cardId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(getCardByName("Altar's Reap").id, {
                            id: "reap",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        ...creatures
                            .slice(0, creatureCount)
                            .map((c) => permanent(c.cardId, c.id)),
                        ...swampIds.map((id) =>
                            permanent(getCardByName("Swamp").id, id)
                        ),
                    ],
                    manaPool: { W: 0, U: 0, B: 2, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(getCardByName("Drought").id, {
                            id: "drought",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "battlefield",
                        }),
                    ],
                }),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
    }

    const announce = (harness: ReturnType<typeof makeMutationCtx>) =>
        runMutation(
            announceCast as unknown as Handler<
                {
                    gameId: Id<"games">;
                    playerId: string;
                    cardInstanceId: string;
                },
                void
            >,
            harness.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId: "reap",
            }
        );

    const pick = (
        harness: ReturnType<typeof makeMutationCtx>,
        cardInstanceId: string
    ) =>
        runMutation(
            selectSacrifice as unknown as Handler<
                {
                    gameId: Id<"games">;
                    playerId: string;
                    cardInstanceId: string;
                },
                void
            >,
            harness.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId,
            }
        );

    const parked = (harness: ReturnType<typeof makeMutationCtx>) =>
        harness.state().pendingCast!.sacrificeSelection!;

    it("one Swamp: asks for the creature, then the Swamp, and the cast completes", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(["swamp"])),
        ]);
        await announce(harness);

        expect(parked(harness).picked).toEqual([]);
        expect(nextUnmetRequirement(parked(harness))?.filter).toEqual({
            types: ["Creature"],
        });

        await pick(harness, "giant");
        expect(nextUnmetRequirement(parked(harness))?.filter).toEqual({
            subtypes: ["Swamp"],
        });
        await pick(harness, "swamp");

        const state = harness.state();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack.map((item) => item.id)).toEqual(["reap"]);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "giant",
            "swamp",
        ]);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["bear"]);
    });

    it("two identical Swamps: the creature cost is paid with a creature, never a Swamp", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(["swampA", "swampB"])),
        ]);
        await announce(harness);

        await expect(pick(harness, "swampA")).rejects.toThrow(
            /not a legal sacrifice/
        );
        await pick(harness, "bear");
        await pick(harness, "swampA");

        const state = harness.state();
        expect(state.stack.map((item) => item.id)).toEqual(["reap"]);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "bear",
            "swampA",
        ]);
    });

    it("nothing to choose: both forced legs still commit without a prompt", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(["swamp"], 1)),
        ]);
        await announce(harness);

        const state = harness.state();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack.map((item) => item.id)).toEqual(["reap"]);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "bear",
            "swamp",
        ]);
    });
});

// CR 601.2f / 118.5 / 701.21a — Drought's board-wide "sacrifice a Swamp per
// black pip" additional cost is a choice made by the casting player. The cast
// commit gate blocks until the choice is complete, and never auto-picks when a
// real choice remains.
describe("Drought additional sacrifice at commit (CR 701.21a)", () => {
    const drought = getCardByName("Drought");
    const zombies = getCardByName("Scathe Zombies"); // {2}{B} — one black pip
    const swampId = getCardByName("Swamp").id;

    const makeSwamp = (id: string, overrides = {}): CardInstanceState =>
        makeInstance(swampId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            ...overrides,
        });

    function scenario(swamps: CardInstanceState[]): GameState {
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const zInst = makeInstance(zombies.id, {
            id: "z1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [zInst],
                    battlefield: swamps,
                    manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [droughtInst] }),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
    }

    function droughtSelection(state: GameState): SacrificeSelection {
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Drought",
            requirements: getStaticAdditionalSacrifices(
                state,
                zombies.manaCost,
                state.players[0].hand[0],
                "spell"
            ).map((r) => ({ filter: r.filter, count: r.count })),
            picked: [],
        };
        autoResolveFungible(state, sel);
        return sel;
    }

    it("does not auto-pick and blocks commit when Swamps are non-fungible", () => {
        // Two Swamps, one tapped → a real choice remains.
        const state = scenario([
            makeSwamp("swU"),
            makeSwamp("swT", { isTapped: true }),
        ]);
        const sel = droughtSelection(state);
        expect(isSacrificeSelectionComplete(sel)).toBe(false);
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "z1",
            manaCost: normalizeManaCost(zombies.manaCost ?? {}),
            tappedLandIds: [],
            sacrificeSelection: sel,
        };
        const committed = tryAutoCommitPendingCast(state, "p1");
        // Commit is gated on the incomplete choice.
        expect(committed).toBeNull();
        expect(state.stack).toHaveLength(0);
        // Neither Swamp was sacrificed.
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "swT",
            "swU",
        ]);
    });

    it("auto-resolves and commits when Swamps are fungible", () => {
        const state = scenario([makeSwamp("swA"), makeSwamp("swB")]);
        const sel = droughtSelection(state);
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "z1",
            manaCost: normalizeManaCost(zombies.manaCost ?? {}),
            tappedLandIds: [],
            sacrificeSelection: sel,
        };
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        expect(state.stack).toHaveLength(1);
        // Exactly one Swamp left the battlefield.
        const swampsLeft = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Swamp")
        );
        expect(swampsLeft).toHaveLength(1);
        expect(
            state.players[0].graveyard.filter((c) =>
                c.subtypes?.includes("Swamp")
            )
        ).toHaveLength(1);
    });

    it("the parked sacrificeSelection survives the wire projection intact", () => {
        const state = scenario([
            makeSwamp("swU"),
            makeSwamp("swT", { isTapped: true }),
        ]);
        const sel = droughtSelection(state);
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "z1",
            manaCost: normalizeManaCost(zombies.manaCost ?? {}),
            tappedLandIds: [],
            sacrificeSelection: sel,
        };
        // The client reads pendingCast.sacrificeSelection to light up the
        // picker; the projection must carry filter + picked verbatim.
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as GameState;
        expect(projected.pendingCast?.sacrificeSelection?.requirements).toEqual(
            [{ filter: { subtypes: ["Swamp"] }, count: 1 }]
        );
        expect(projected.pendingCast?.sacrificeSelection?.picked).toEqual([]);
    });
});
