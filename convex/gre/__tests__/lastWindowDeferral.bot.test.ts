// `last-window-deferral` — keep mana open, act in the last window (issue
// #4757, PRD #4754). Direct `selectRootMove` unit tests over hand-built edges:
// the rule is a tie-break among OUTCOME-EQUAL root edges, so the edges' means
// are set inside / outside `OUTCOME_EPS` by hand and the state only has to
// carry what the deferral perimeter (`ai/deferral.ts`) reads.
//
// The positions the real search plays are the blade `keep mana open` pairs
// (`ai/blade/registry.ts`); this file names the mechanism and its gates.
import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import { selectRootMove, type Edge, type Node } from "../search";
import type { RootDecisionMechanism } from "../ai/decisionTelemetry";
import type { Move } from "../moves";
import type {
    ActivatedAbility,
    CardDefinition,
    TargetSelection,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../state";

const IMPULSE = getCardByName("Impulse").id; // {1}{U} instant, lasting draw
const GIANT_GROWTH = getCardByName("Giant Growth").id; // until-end-of-turn pump
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;
const ISLAND = getCardByName("Island").id;
const FOREST = getCardByName("Forest").id;

const PASS: Move = { kind: "pass" };

function cast(id: string, targets: TargetSelection[] = []): Move {
    return {
        kind: "cast-spell",
        cardInstanceId: id,
        targets,
        confirmTargets: false,
        tapPlan: [],
    };
}

function card(cardId: string, id: string, zone: "hand" | "battlefield") {
    return makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        zone,
        isSummoningSick: false,
    });
}

/** A library to draw from — with none, a draw instant's settled resolution
 *  reads as self-harm and `self-harm-removal` answers first. */
function library(): CardInstanceState[] {
    return [0, 1, 2, 3, 4].map((i) =>
        makeInstance(GRIZZLY_BEARS, { id: `lib${i}`, zone: "library" })
    );
}

/** Mana for the cast: the rule RESOLVES the action (`waitsUnchanged`,
 *  `ai/deferral.ts`), and an unpayable cast fails closed. */
function lands(): CardInstanceState[] {
    return ["isl0", "isl1", "for0"].map((id) =>
        card(id.startsWith("isl") ? ISLAND : FOREST, id, "battlefield")
    );
}

/** The bot is p1. `activePlayerId` decides whose turn it is. */
function at(
    phase: GameState["phase"],
    activePlayerId: "p1" | "p2",
    hand: CardInstanceState[],
    battlefield: CardInstanceState[] = []
): GameState {
    return makeState({
        phase,
        activePlayerId,
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand,
                battlefield: [...lands(), ...battlefield],
                library: library(),
            }),
            makePlayer("p2", { library: library() }),
        ],
    });
}

function rootOf(
    edges: { move: Move; meanReward: number; meanMargin: number }[]
): Node {
    const children = new Map<string, Edge>();
    edges.forEach((e, i) => {
        const visits = 100;
        children.set(`${e.move.kind}:${i}`, {
            move: e.move,
            key: `${e.move.kind}:${i}`,
            mover: "p1",
            node: { children: new Map() },
            visits,
            totalReward: e.meanReward * visits,
            totalMargin: e.meanMargin * visits,
            avail: visits,
        });
    });
    return { children };
}

function pick(
    root: Node,
    moves: Move[],
    state: GameState,
    disabled: RootDecisionMechanism[] = []
): { kind: Move["kind"]; mechanism: RootDecisionMechanism } {
    const out = { mechanism: "mean-reward" as RootDecisionMechanism };
    const move = selectRootMove(
        root,
        moves,
        state,
        "p1",
        undefined,
        undefined,
        undefined,
        out,
        undefined,
        new Set(disabled)
    );
    return { kind: move.kind, mechanism: out.mechanism };
}

describe("last-window-deferral — HOLD half: an earlier window waits (issue #4757)", () => {
    const IMP = cast("imp");

    it("holds an outcome-equal draw instant in the bot's own main phase", () => {
        // The cast wins the raw material tie-break on noise.
        const root = rootOf([
            { move: IMP, meanReward: 0.6635, meanMargin: 330 },
            { move: PASS, meanReward: 0.6631, meanMargin: 327 },
        ]);
        const state = at("PRECOMBAT_MAIN", "p1", [
            card(IMPULSE, "imp", "hand"),
        ]);
        expect(pick(root, [IMP, PASS], state)).toEqual({
            kind: "pass",
            mechanism: "last-window-deferral",
        });
    });

    it("holds it in an earlier window of the OPPONENT's turn too", () => {
        const root = rootOf([
            { move: IMP, meanReward: 0.6635, meanMargin: 330 },
            { move: PASS, meanReward: 0.6631, meanMargin: 327 },
        ]);
        const state = at("PRECOMBAT_MAIN", "p2", [
            card(IMPULSE, "imp", "hand"),
        ]);
        expect(pick(root, [IMP, PASS], state).kind).toBe("pass");
    });

    it("NO-HOLD: a cast with REAL value still wins on mean reward", () => {
        const root = rootOf([
            { move: IMP, meanReward: 0.92, meanMargin: 330 },
            { move: PASS, meanReward: 0.6, meanMargin: 400 },
        ]);
        const state = at("PRECOMBAT_MAIN", "p1", [
            card(IMPULSE, "imp", "hand"),
        ]);
        expect(pick(root, [IMP, PASS], state).kind).toBe("cast-spell");
    });

    it("NO-HOLD: disabled, the pick falls through to the material tie-break", () => {
        const root = rootOf([
            { move: IMP, meanReward: 0.6635, meanMargin: 330 },
            { move: PASS, meanReward: 0.6631, meanMargin: 327 },
        ]);
        const state = at("PRECOMBAT_MAIN", "p1", [
            card(IMPULSE, "imp", "hand"),
        ]);
        expect(
            pick(root, [IMP, PASS], state, ["last-window-deferral"]).kind
        ).toBe("cast-spell");
    });
});

describe("last-window-deferral — FIRE half: the opponent's end step acts (issue #4757, CR 513.1)", () => {
    const IMP = cast("imp");

    it("replaces an outcome-equal pass with the deferrable action", () => {
        const root = rootOf([
            { move: PASS, meanReward: 0.6635, meanMargin: 330 },
            { move: IMP, meanReward: 0.6631, meanMargin: 327 },
        ]);
        const state = at("END_STEP", "p2", [card(IMPULSE, "imp", "hand")]);
        expect(pick(root, [PASS, IMP], state)).toEqual({
            kind: "cast-spell",
            mechanism: "last-window-deferral",
        });
    });

    it("NO-FIRE: the bot's OWN end step is not the last window", () => {
        const root = rootOf([
            { move: PASS, meanReward: 0.6635, meanMargin: 330 },
            { move: IMP, meanReward: 0.6631, meanMargin: 327 },
        ]);
        const state = at("END_STEP", "p1", [card(IMPULSE, "imp", "hand")]);
        expect(pick(root, [PASS, IMP], state).kind).toBe("pass");
    });

    it("NO-FIRE: an action outside the outcome band stays unplayed", () => {
        const root = rootOf([
            { move: PASS, meanReward: 0.8, meanMargin: 330 },
            { move: IMP, meanReward: 0.6, meanMargin: 500 },
        ]);
        const state = at("END_STEP", "p2", [card(IMPULSE, "imp", "hand")]);
        expect(pick(root, [PASS, IMP], state).kind).toBe("pass");
    });

    it("NO-FIRE: an effect that expires this turn buys nothing at the end step (CR 514.2)", () => {
        // Giant Growth on the bot's own Bears is inside the perimeter (own
        // side, instant) — held earlier like any deferrable action — but its
        // whole payoff ends at this turn's cleanup.
        const pump = cast("gg", [{ type: "permanent", id: "bears" }]);
        const root = rootOf([
            { move: PASS, meanReward: 0.6635, meanMargin: 330 },
            { move: pump, meanReward: 0.6631, meanMargin: 327 },
        ]);
        const state = at(
            "END_STEP",
            "p2",
            [card(GIANT_GROWTH, "gg", "hand")],
            [card(GRIZZLY_BEARS, "bears", "battlefield")]
        );
        expect(pick(root, [PASS, pump], state).kind).toBe("pass");
    });

    it("NO-FIRE: disabled, pass stands", () => {
        const root = rootOf([
            { move: PASS, meanReward: 0.6635, meanMargin: 330 },
            { move: IMP, meanReward: 0.6631, meanMargin: 327 },
        ]);
        const state = at("END_STEP", "p2", [card(IMPULSE, "imp", "hand")]);
        expect(
            pick(root, [PASS, IMP], state, ["last-window-deferral"]).kind
        ).toBe("pass");
    });
});

describe("last-window-deferral — its floors (issue #4757 review)", () => {
    // A repeatable, lasting, own-side activation with no tap and no sacrifice
    // — the shape the once-per-turn floor exists for.
    const DRAW: ActivatedAbility = {
        id: "issue-4757-draw",
        oracleText: "{1}: Draw a card.",
        cost: { mana: { generic: 1 } },
        useStack: true,
        effects: [{ op: "draw", player: "controller", count: 1 }],
    };
    const ENGINE: CardDefinition = {
        id: "issue-4757:engine",
        name: "Issue 4757 draw engine",
        rarity: "common",
        manaCost: { generic: 3 },
        types: ["Artifact"],
        activatedAbilities: [DRAW],
    };
    const ACT: Move = {
        kind: "activate-ability",
        cardInstanceId: "eng",
        abilityId: DRAW.id,
        targets: [],
        confirmTargets: false,
        tapPlan: [],
    };
    const endStepWith = (used: number) => {
        const engine = {
            ...card(ENGINE.id, "eng", "battlefield"),
            activationsThisTurn: used ? { [DRAW.id]: used } : undefined,
        };
        return at("END_STEP", "p2", [], [engine]);
    };
    const root = () =>
        rootOf([
            { move: PASS, meanReward: 0.6635, meanMargin: 330 },
            { move: ACT, meanReward: 0.6631, meanMargin: 327 },
        ]);

    it("FIRE takes the first activation of an ability this turn", () => {
        withTemporaryDefinition(ENGINE, () => {
            expect(pick(root(), [PASS, ACT], endStepWith(0)).kind).toBe(
                "activate-ability"
            );
        });
    });

    it("NO-FIRE: a second activation this turn earns itself on mean reward", () => {
        withTemporaryDefinition(ENGINE, () => {
            expect(pick(root(), [PASS, ACT], endStepWith(1)).kind).toBe("pass");
        });
    });

    it("NO-HOLD: mana already floating empties as the step ends (CR 106.4 / 500.5)", () => {
        const IMP = cast("imp");
        const root2 = rootOf([
            { move: IMP, meanReward: 0.6635, meanMargin: 330 },
            { move: PASS, meanReward: 0.6631, meanMargin: 327 },
        ]);
        const state = at("PRECOMBAT_MAIN", "p1", [
            card(IMPULSE, "imp", "hand"),
        ]);
        state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };
        expect(pick(root2, [IMP, PASS], state).kind).toBe("cast-spell");
    });
});
