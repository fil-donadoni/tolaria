/**
 * `free-development`: a free mana source goes ahead of another outcome-equal
 * cast (issue #8296). A source that spends nothing and adds mana keeps every line
 * through the other cast open behind it, while its wider node dilutes its edge's
 * mean.
 * Run on the real `selectRootMove` with hand-set edge statistics.
 */

import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { enumerateMoves, type Move } from "../../moves";
import { describeMove } from "../../describeMove";
import { type Edge, type Node, selectRootMove } from "../../search";
import { buildPositionFromSpec } from "../blade/build";
import type { RootDecisionMechanism } from "../decisionTelemetry";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";

type SpecCard = ScenarioSpec["cards"][number];

const BEARS: SpecCard = { name: "Grizzly Bears", owner: "me", zone: "hand" };
const CRYPT: SpecCard = { name: "Mana Crypt", owner: "me", zone: "hand" };
const MOX: SpecCard = { name: "Mox Diamond", owner: "me", zone: "hand" };
const FORESTS: SpecCard = {
    name: "Forest",
    owner: "me",
    zone: "battlefield",
    count: 2,
};

function position(spec: Partial<ScenarioSpec>): GameState {
    return buildPositionFromSpec({
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 0,
        libraryCount: 20,
        cards: [],
        ...spec,
    } as ScenarioSpec);
}

function moveNamed(s: GameState, name: string): Move {
    const move = enumerateMoves(s, s.activePlayerId).find((m) =>
        describeMove(m, s).includes(name)
    );
    if (!move) throw new Error(`no move names ${name}`);
    return move;
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

/** What the root picks with `other` ahead of `source` on reward and margin. */
function pick(
    s: GameState,
    other: Move,
    source: Move,
    sourceRewardGap = 0.003,
    disabled: RootDecisionMechanism[] = []
): { label: string; mechanism: RootDecisionMechanism } {
    const out: { mechanism: RootDecisionMechanism } = {
        mechanism: "mean-reward",
    };
    const move = selectRootMove(
        rootOf([
            { move: other, meanReward: 0.73, meanMargin: 447 },
            {
                move: source,
                meanReward: 0.73 - sourceRewardGap,
                meanMargin: 440,
            },
        ]),
        [other, source],
        s,
        s.activePlayerId,
        undefined,
        DEFAULT_EVAL_WEIGHTS,
        undefined,
        out,
        undefined,
        new Set(disabled)
    );
    return { label: describeMove(move, s), mechanism: out.mechanism };
}

describe("a free mana source goes before another cast (issue #8296)", () => {
    const healthy = () => position({ cards: [CRYPT, BEARS, FORESTS] });

    it("outcome-equal: the source is cast first, and the rule says so", () => {
        const s = healthy();
        const got = pick(
            s,
            moveNamed(s, "Grizzly Bears"),
            moveNamed(s, "Mana Crypt")
        );
        expect(got.label).toContain("Mana Crypt");
        expect(got.mechanism).toBe("free-development");
    });

    it("the other cast wins by more than outcomeEps: the pick stands", () => {
        const s = healthy();
        const gap = DEFAULT_EVAL_WEIGHTS.outcomeEps + 0.01;
        const got = pick(
            s,
            moveNamed(s, "Grizzly Bears"),
            moveNamed(s, "Mana Crypt"),
            gap
        );
        expect(got.label).toContain("Grizzly Bears");
        expect(got.mechanism).not.toBe("free-development");
    });

    it("the rule disabled is a no-op, not a different rule", () => {
        const s = healthy();
        const got = pick(
            s,
            moveNamed(s, "Grizzly Bears"),
            moveNamed(s, "Mana Crypt"),
            0.003,
            ["free-development"]
        );
        expect(got.label).toContain("Grizzly Bears");
    });

    it("a source whose own trigger can kill its controller is not free", () => {
        const s = position({ cards: [CRYPT, BEARS, FORESTS], life: { me: 3 } });
        const got = pick(
            s,
            moveNamed(s, "Grizzly Bears"),
            moveNamed(s, "Mana Crypt")
        );
        expect(got.label).toContain("Grizzly Bears");
    });

    it("the life total decides that, one point above the damage", () => {
        const s = position({ cards: [CRYPT, BEARS, FORESTS], life: { me: 4 } });
        const got = pick(
            s,
            moveNamed(s, "Grizzly Bears"),
            moveNamed(s, "Mana Crypt")
        );
        expect(got.label).toContain("Mana Crypt");
    });

    it("a source with an as-enters price is not free, even against a pass", () => {
        const s = position({ cards: [MOX, FORESTS] });
        const got = pick(s, { kind: "pass" }, moveNamed(s, "Mox Diamond"));
        expect(got.label).toBe("pass");
    });

    it("a source whose mana waits on a later choice does not go first", () => {
        const s = position({
            cards: [
                { name: "Chrome Mox", owner: "me", zone: "hand" },
                BEARS,
                FORESTS,
            ],
        });
        const got = pick(
            s,
            moveNamed(s, "Grizzly Bears"),
            moveNamed(s, "Chrome Mox")
        );
        expect(got.label).toContain("Grizzly Bears");
    });

    it("a source that adds no mana yet does not go first", () => {
        const counterless = position({
            cards: [
                { name: "Everflowing Chalice", owner: "me", zone: "hand" },
                BEARS,
                FORESTS,
            ],
        });
        expect(
            pick(
                counterless,
                moveNamed(counterless, "Grizzly Bears"),
                moveNamed(counterless, "Everflowing Chalice")
            ).label
        ).toContain("Grizzly Bears");

        const legendRuled = position({
            cards: [
                { name: "Mox Opal", owner: "me", zone: "hand" },
                { name: "Mox Opal", owner: "me", zone: "battlefield" },
                BEARS,
                FORESTS,
            ],
        });
        expect(
            pick(
                legendRuled,
                moveNamed(legendRuled, "Grizzly Bears"),
                moveNamed(legendRuled, "Mox Opal")
            ).label
        ).toContain("Grizzly Bears");
    });

    it("a source that does add mana goes first whatever it is called", () => {
        const s = position({
            cards: [
                { name: "Mox Jet", owner: "me", zone: "hand" },
                BEARS,
                FORESTS,
            ],
        });
        const got = pick(
            s,
            moveNamed(s, "Grizzly Bears"),
            moveNamed(s, "Mox Jet")
        );
        expect(got.label).toContain("Mox Jet");
    });

    it("a taxed source spends mana, so it does not go first", () => {
        const s = healthy();
        const crypt = moveNamed(s, "Mana Crypt") as Extract<
            Move,
            { kind: "cast-spell" }
        >;
        const forest = s.players
            .find((p) => p.id === s.activePlayerId)!
            .battlefield.find((c) => c.types.includes("Land"))!;
        const taxed = {
            ...crypt,
            tapPlan: [{ cardInstanceId: forest.id, color: "G" }],
        } as unknown as Move;
        const got = pick(s, moveNamed(s, "Grizzly Bears"), taxed);
        expect(got.label).toContain("Grizzly Bears");
    });
});
