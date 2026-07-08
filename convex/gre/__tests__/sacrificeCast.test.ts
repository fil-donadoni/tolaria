import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards/index";
import { getStaticAdditionalSacrifices, normalizeManaCost } from "../state";
import { tryAutoCommitPendingCast } from "../../game";
import {
    autoResolveFungible,
    isSacrificeSelectionComplete,
    type SacrificeSelection,
} from "../sacrificeChoice";
import { projectPublicState } from "../../gameProjections";
import type { GameState, CardInstanceState } from "../state";

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
