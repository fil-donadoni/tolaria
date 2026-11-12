// Phase Stops drain server-side (ADR 0077): a seat's stored "do not stop me
// here" preferences let `drainAutoPasses` take its pass, so a run of skipped
// steps costs one `passPriority` mutation. The arm is STRICT — an empty-stack
// priority window with nothing else owed (CR 117.3 / 117.4) — and a seat with
// no hydrated preferences is never skipped.
import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Row,
} from "../../__tests__/gameMutationHarness.fixture";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { passPriority } from "../../game";
import { setSkipPrefs } from "../../gamePrefs";
import { saveGameState } from "../../gameStateStore";
import {
    DEFAULT_SKIP_PREFS,
    autoPassBlocked,
    phaseStopSkips,
    sanitizeSkipPrefs,
    type PhaseSkipPrefs,
} from "../autoPass";
import { passPriorityOnState } from "../owedInputDeclines";
import type { GameState } from "../state";

const GAME_ID = "game-1" as Id<"games">;
const FOREST = getCardByName("Forest").id;
const BOLT = getCardByName("Lightning Bolt").id;

function libraryOf(owner: string) {
    return [0, 1, 2, 3].map((n) =>
        makeInstance(FOREST, {
            id: `${owner}-lib-${n}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

/** p1's upkeep on turn 2, p1 holding priority on an empty stack. */
function upkeep(prefs?: Record<string, PhaseSkipPrefs>): GameState {
    return makeState({
        players: [
            makePlayer("p1", { library: libraryOf("p1") }),
            makePlayer("p2", { library: libraryOf("p2") }),
        ],
        turn: 2,
        phase: "UPKEEP",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        ...(prefs ? { seatSkipPrefs: prefs } : {}),
    });
}

const BOTH_DEFAULT = { p1: DEFAULT_SKIP_PREFS, p2: DEFAULT_SKIP_PREFS };

describe("autoPassBlocked — the strict Phase Stop predicate (ADR 0077, CR 117.3)", () => {
    it("is open for the priority holder on an empty stack", () => {
        expect(autoPassBlocked(upkeep(), "p1")).toBe(false);
    });

    it("blocks the seat that does not hold priority", () => {
        expect(autoPassBlocked(upkeep(), "p2")).toBe(true);
    });

    it("blocks a non-empty stack: a response window is never skipped", () => {
        const state = upkeep();
        pushSpell(state, BOLT, "p2");
        expect(autoPassBlocked(state, "p1")).toBe(true);
    });

    it("blocks while a choice is owed (ADR 0047)", () => {
        const state = upkeep();
        state.pendingChoices = [
            {
                stackItemId: "s1",
                step: 0,
                choiceId: "c1",
                playerId: "p1",
                kind: "discard-hand",
                zone: "hand",
                count: 1,
                prompt: "Discard a card.",
            },
        ] as GameState["pendingChoices"];
        expect(autoPassBlocked(state, "p1")).toBe(true);
    });

    it("blocks undeclared attackers (CR 508.1)", () => {
        const state = upkeep();
        state.phase = "DECLARE_ATTACKERS";
        state.combat = {
            attackerIds: [],
            confirmed: false,
        } as unknown as GameState["combat"];
        expect(autoPassBlocked(state, "p1")).toBe(true);
    });
});

describe("phaseStopSkips — stored sense, per side (ADR 0077)", () => {
    it("skips a phase the seat marked skipped, on the right side", () => {
        const state = upkeep(BOTH_DEFAULT);
        expect(phaseStopSkips(state, "p1")).toBe(true);
        state.phase = "PRECOMBAT_MAIN";
        // self: false — the active player keeps their own main phase.
        expect(phaseStopSkips(state, "p1")).toBe(false);
    });

    it("never skips a seat with no hydrated preferences", () => {
        expect(phaseStopSkips(upkeep(), "p1")).toBe(false);
        expect(phaseStopSkips(upkeep({ p2: DEFAULT_SKIP_PREFS }), "p1")).toBe(
            false
        );
    });

    it("sanitizeSkipPrefs keeps literal booleans of skippable phases only", () => {
        expect(
            sanitizeSkipPrefs({
                UPKEEP: { self: true, opponent: "yes" },
                CLEANUP: { self: true, opponent: true },
                DRAW: "all",
            })
        ).toEqual({ UPKEEP: { self: true, opponent: false } });
        expect(sanitizeSkipPrefs(null)).toEqual({});
    });
});

describe("drainAutoPasses takes Phase Stop skips (ADR 0077)", () => {
    it("one pass carries the turn from upkeep to the active player's main", () => {
        const state = upkeep(BOTH_DEFAULT);
        passPriorityOnState(state, "p1");
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(state.priorityPlayerId).toBe("p1");
        expect(state.turn).toBe(2);
        // The draw step ran on the way (CR 504.1).
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("without preferences the same pass only hands priority over", () => {
        const state = upkeep();
        passPriorityOnState(state, "p1");
        expect(state.phase).toBe("UPKEEP");
        expect(state.priorityPlayerId).toBe("p2");
    });

    it("stops at a seat that stored no preferences", () => {
        const state = upkeep({ p1: DEFAULT_SKIP_PREFS });
        passPriorityOnState(state, "p1");
        expect(state.phase).toBe("UPKEEP");
        expect(state.priorityPlayerId).toBe("p2");
    });

    it("stops where a seat asked to stop: the opponent's end step", () => {
        const state = upkeep(BOTH_DEFAULT);
        state.phase = "END_STEP";
        passPriorityOnState(state, "p1");
        // END_STEP — self: true, opponent: false. p2 keeps the window.
        expect(state.phase).toBe("END_STEP");
        expect(state.priorityPlayerId).toBe("p2");
    });

    it("never passes a response window: a spell on the stack stops the drain", () => {
        const state = upkeep(BOTH_DEFAULT);
        pushSpell(state, BOLT, "p1", [{ kind: "player", playerId: "p2" }]);
        passPriorityOnState(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(state.priorityPlayerId).toBe("p2");
    });
});

function gameRow(overrides: Partial<Row> = {}): Row {
    return {
        _id: GAME_ID,
        __table: "games",
        name: "Game",
        status: "playing",
        solo: false,
        vsAi: false,
        players: [{ id: "p1" }, { id: "p2" }],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

function prefsRow(playerId: string, skipPrefs: unknown): Row {
    return {
        _id: `prefs-${playerId}`,
        __table: "gamePrefs",
        gameId: GAME_ID,
        playerId,
        skipPrefs,
    };
}

describe("passPriority hydrates Phase Stops from gamePrefs (ADR 0077)", () => {
    it("drains the run in ONE persisted version, and persists no preferences", async () => {
        const stub = makeMutationCtx("p1", [
            gameRow(),
            gameStateSeed(upkeep()),
            prefsRow("p1", DEFAULT_SKIP_PREFS),
            prefsRow("p2", DEFAULT_SKIP_PREFS),
        ]);
        await runMutation(passPriority, stub.ctx, {
            gameId: GAME_ID,
            playerId: "p1",
        });
        expect(stub.state().phase).toBe("PRECOMBAT_MAIN");
        expect(stub.writes.filter((w) => w.id === "gs-1")).toHaveLength(1);
        expect(JSON.stringify(stub.doc("gs-1").state)).not.toContain(
            "seatSkipPrefs"
        );
    });

    it("with no rows the pass is a plain pass", async () => {
        const stub = makeMutationCtx("p1", [
            gameRow(),
            gameStateSeed(upkeep()),
        ]);
        await runMutation(passPriority, stub.ctx, {
            gameId: GAME_ID,
            playerId: "p1",
        });
        expect(stub.state().phase).toBe("UPKEEP");
        expect(stub.state().priorityPlayerId).toBe("p2");
    });
});

describe("setSkipPrefs — seat-addressed, sanitised (ADR 0077)", () => {
    const call = (
        stub: ReturnType<typeof makeMutationCtx>,
        playerIds: string[],
        skipPrefs: unknown = DEFAULT_SKIP_PREFS
    ) =>
        runMutation(setSkipPrefs, stub.ctx, {
            gameId: GAME_ID,
            playerIds,
            skipPrefs,
        });
    const rows = (stub: ReturnType<typeof makeMutationCtx>) =>
        stub.writes
            .filter((w) => w.table === "gamePrefs")
            .map((w) => stub.doc(w.id));

    it("stores the caller's own seat and touches no gameStates row", async () => {
        const stub = makeMutationCtx("p1", [
            gameRow(),
            gameStateSeed(upkeep()),
        ]);
        await call(stub, ["p1"], { UPKEEP: { self: true, opponent: 1 } });
        expect(rows(stub)).toMatchObject([
            {
                playerId: "p1",
                skipPrefs: { UPKEEP: { self: true, opponent: false } },
            },
        ]);
        expect(stub.writes.some((w) => w.id === "gs-1")).toBe(false);
    });

    it("refuses a seat the caller does not own", async () => {
        const stub = makeMutationCtx("p1", [gameRow()]);
        await expect(call(stub, ["p2"])).rejects.toThrow();
        expect(rows(stub)).toHaveLength(0);
    });

    it("refuses an owned handle that is not a seat of this game", async () => {
        const stub = makeMutationCtx("p1", [
            gameRow({ players: [{ id: "p1-p1" }, { id: "p1-p2" }] }),
        ]);
        await expect(call(stub, ["p1"])).rejects.toThrow(/Not a seat/);
    });

    it("an unchanged resend writes nothing", async () => {
        const stub = makeMutationCtx("p1", [gameRow()]);
        await call(stub, ["p1"]);
        stub.writes.length = 0;
        await call(stub, ["p1"]);
        expect(stub.writes).toHaveLength(0);
    });
});

describe("a vs-AI Game seeds the Bot seat's Phase Stops (ADR 0077 §4)", () => {
    it("the first save writes the default preferences for the Bot seat only", async () => {
        const stub = makeMutationCtx("u1", [
            gameRow({
                solo: true,
                vsAi: true,
                players: [{ id: "u1-p1" }, { id: "u1-p2" }],
            }),
        ]);
        const state = upkeep();
        state.players[0].id = "u1-p1";
        state.players[1].id = "u1-p2";
        state.activePlayerId = "u1-p1";
        state.priorityPlayerId = "u1-p1";
        await saveGameState(stub.ctx, GAME_ID, 0, state, null);
        const seeded = stub.writes
            .filter((w) => w.table === "gamePrefs")
            .map((w) => stub.doc(w.id));
        expect(seeded).toMatchObject([
            { playerId: "u1-p2", skipPrefs: DEFAULT_SKIP_PREFS },
        ]);
    });

    it("a game without a Bot seeds nothing", async () => {
        const stub = makeMutationCtx("u1", [gameRow()]);
        await saveGameState(stub.ctx, GAME_ID, 0, upkeep(), null);
        expect(stub.writes.some((w) => w.table === "gamePrefs")).toBe(false);
    });
});
