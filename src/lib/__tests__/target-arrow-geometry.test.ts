// Slice #257 (PRD #249) — pure geometry for the spatial board's SVG target
// arrows. Endpoints derive from shared layout placements (surfaced as anchor
// points), so arrows recompute from the single source of truth as cards move.
import { describe, it, expect } from "vitest";
import {
    buildTargetArrows,
    buildCombatArrows,
    resolveArrowHighlight,
    arrowPath,
    emptyAnchorMap,
    type AnchorMap,
} from "../target-arrow-geometry";
import type { Combat, StackItem } from "~/types/game";

/** Minimal StackItem stub — only the fields the geometry reads. */
function stackItem(id: string, targets?: StackItem["targets"]): StackItem {
    return {
        id,
        card: { id: "card-def" },
        castById: "p1",
        targets,
    } as unknown as StackItem;
}

function anchors(partial: Partial<AnchorMap>): AnchorMap {
    return { ...emptyAnchorMap(), ...partial };
}

describe("buildTargetArrows — endpoint mapping", () => {
    it("returns no arrows for an empty stack", () => {
        expect(buildTargetArrows([], emptyAnchorMap())).toEqual([]);
    });

    it("returns no arrows for a stack item with no targets", () => {
        const stack = [stackItem("s1")];
        const map = anchors({ stack: { s1: { x: 10, y: 10 } } });
        expect(buildTargetArrows(stack, map)).toEqual([]);
    });

    it("maps a permanent target to the source/target anchor points", () => {
        const stack = [stackItem("s1", [{ type: "permanent", id: "perm-a" }])];
        const map = anchors({
            stack: { s1: { x: 100, y: 50 } },
            permanent: { "perm-a": { x: 400, y: 300 } },
        });
        const arrows = buildTargetArrows(stack, map);
        expect(arrows).toHaveLength(1);
        expect(arrows[0].from).toEqual({ x: 100, y: 50 });
        expect(arrows[0].to).toEqual({ x: 400, y: 300 });
        expect(arrows[0].key).toBe("s1->permanent:perm-a:");
    });

    it("maps player, spell, and graveyard-card targets to the right buckets", () => {
        const stack = [
            stackItem("s1", [
                { type: "player", id: "p2" },
                { type: "spell", id: "s0" },
                { type: "graveyard-card", id: "gc1", playerId: "p2" },
            ]),
        ];
        const map = anchors({
            stack: { s1: { x: 0, y: 0 }, s0: { x: 5, y: 5 } },
            player: { p2: { x: 20, y: 20 } },
            graveyard: { p2: { x: 30, y: 30 } },
        });
        const arrows = buildTargetArrows(stack, map);
        expect(arrows.map((a) => a.to)).toEqual([
            { x: 20, y: 20 }, // player
            { x: 5, y: 5 }, // spell (stack bucket)
            { x: 30, y: 30 }, // graveyard (by owner playerId)
        ]);
    });

    it("skips a target whose anchor isn't published yet (no arrow into origin)", () => {
        const stack = [stackItem("s1", [{ type: "permanent", id: "missing" }])];
        const map = anchors({ stack: { s1: { x: 1, y: 1 } } });
        expect(buildTargetArrows(stack, map)).toEqual([]);
    });

    it("skips an arrow whose source stack anchor isn't published", () => {
        const stack = [stackItem("s1", [{ type: "permanent", id: "perm-a" }])];
        const map = anchors({ permanent: { "perm-a": { x: 4, y: 4 } } });
        expect(buildTargetArrows(stack, map)).toEqual([]);
    });

    it("emits one arrow per target for a multi-target item", () => {
        const stack = [
            stackItem("s1", [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
            ]),
        ];
        const map = anchors({
            stack: { s1: { x: 0, y: 0 } },
            permanent: { a: { x: 10, y: 0 }, b: { x: 20, y: 0 } },
        });
        expect(buildTargetArrows(stack, map)).toHaveLength(2);
    });

    it("recomputes endpoints when the target placement moves", () => {
        const stack = [stackItem("s1", [{ type: "permanent", id: "perm-a" }])];
        const before = buildTargetArrows(
            stack,
            anchors({
                stack: { s1: { x: 0, y: 0 } },
                permanent: { "perm-a": { x: 100, y: 100 } },
            })
        );
        const after = buildTargetArrows(
            stack,
            anchors({
                stack: { s1: { x: 0, y: 0 } },
                permanent: { "perm-a": { x: 250, y: 180 } },
            })
        );
        // Same logical arrow (stable key) but a new endpoint — proving the
        // geometry tracks the moving placement frame-to-frame.
        expect(after[0].key).toBe(before[0].key);
        expect(before[0].to).toEqual({ x: 100, y: 100 });
        expect(after[0].to).toEqual({ x: 250, y: 180 });
        expect(after[0].path).not.toBe(before[0].path);
    });
});

describe("arrowPath — curved bezier between endpoints", () => {
    it("starts at `from` and ends at `to`", () => {
        const d = arrowPath({ x: 10, y: 20 }, { x: 110, y: 220 });
        expect(d.startsWith("M 10 20")).toBe(true);
        expect(d.endsWith("110 220")).toBe(true);
    });

    it("emits a quadratic control point bowed off the chord", () => {
        const d = arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 });
        // Horizontal chord → control point offset purely in Y (perpendicular).
        const match = d.match(/Q (-?[\d.]+) (-?[\d.]+)/);
        expect(match).toBeTruthy();
        const [, cx, cy] = match!;
        expect(Number(cx)).toBeCloseTo(50, 5); // midpoint X
        expect(Math.abs(Number(cy))).toBeGreaterThan(0); // bowed
    });

    it("degenerates to a straight line for coincident endpoints", () => {
        expect(arrowPath({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe("M 5 5 L 5 5");
    });
});

// ---------------------------------------------------------------------------
// Combat arrows + hover highlight (combat-read). Encodes the agreed semantics:
//   • combat   = transitive cluster (banding-aware)
//   • stack    = peer-to-peer: arrow-hover lights only that arrow; node-hover
//                lights the node's 1-hop neighbourhood (NOT transitive).
// ---------------------------------------------------------------------------

function combat(partial: Partial<Combat>): Combat {
    return {
        attackerIds: [],
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: true,
        ...partial,
    } as Combat;
}

describe("buildCombatArrows — blocker → attacker", () => {
    it("draws one arrow per blocker, from blocker to the attacker it blocks", () => {
        const c = combat({ blockerAssignments: { att: ["b1", "b2"] } });
        const map = anchors({
            permanent: {
                att: { x: 500, y: 100 },
                b1: { x: 300, y: 400 },
                b2: { x: 700, y: 400 },
            },
        });
        const arrows = buildCombatArrows(c, map);
        expect(arrows).toHaveLength(2);
        for (const a of arrows) {
            expect(a.kind).toBe("combat");
            expect(a.toId).toBe("att");
            expect(a.to).toEqual({ x: 500, y: 100 });
        }
        // Same combat knot ⇒ same clusterId.
        expect(arrows[0].clusterId).toBe(arrows[1].clusterId);
    });

    it("unions a band sharing blockers into one cluster", () => {
        const c = combat({
            blockerAssignments: { att1: ["b1"], att2: ["b2"] },
            bands: [{ bandId: "band", memberIds: ["att1", "att2"] }],
        });
        const map = anchors({
            permanent: {
                att1: { x: 0, y: 0 },
                att2: { x: 0, y: 0 },
                b1: { x: 0, y: 0 },
                b2: { x: 0, y: 0 },
            },
        });
        const arrows = buildCombatArrows(c, map);
        expect(arrows).toHaveLength(2);
        expect(arrows[0].clusterId).toBe(arrows[1].clusterId);
    });
});

describe("resolveArrowHighlight — combat is transitive", () => {
    const c = combat({ blockerAssignments: { att: ["b1", "b2"] } });
    const map = anchors({
        permanent: {
            att: { x: 5, y: 1 },
            b1: { x: 3, y: 4 },
            b2: { x: 7, y: 4 },
        },
    });
    const arrows = buildCombatArrows(c, map);
    const k1 = arrows[0].key;

    it("lights the whole cluster from any arrow", () => {
        const hl = resolveArrowHighlight(arrows, { key: k1 })!;
        expect(hl.keys.size).toBe(2);
        expect([...hl.nodes].sort()).toEqual(["att", "b1", "b2"]);
    });

    it("lights the whole cluster from any creature", () => {
        const hl = resolveArrowHighlight(arrows, { nodeId: "b1" })!;
        expect(hl.keys.size).toBe(2);
        expect([...hl.nodes].sort()).toEqual(["att", "b1", "b2"]);
    });
});

describe("resolveArrowHighlight — stack is peer-to-peer (A=bolt, B=bears, C=counter)", () => {
    // Bolt A → Bears B (target); Counterspell C → Bolt A (spell).
    const stack = [
        stackItem("A", [{ type: "permanent", id: "B" }]),
        stackItem("C", [{ type: "spell", id: "A" }]),
    ];
    const map = anchors({
        stack: { A: { x: 1, y: 1 }, C: { x: 9, y: 1 } },
        permanent: { B: { x: 1, y: 9 } },
    });
    const arrows = buildTargetArrows(stack, map);
    const AB = "A->permanent:B:";
    const CA = "C->spell:A:";

    it("hover node B ⇒ {A, B, AB}", () => {
        const hl = resolveArrowHighlight(arrows, { nodeId: "B" })!;
        expect([...hl.keys]).toEqual([AB]);
        expect([...hl.nodes].sort()).toEqual(["A", "B"]);
    });

    it("hover arrow AB ⇒ only {A, B, AB} (does NOT chain to CA via shared A)", () => {
        const hl = resolveArrowHighlight(arrows, { key: AB })!;
        expect([...hl.keys]).toEqual([AB]);
        expect([...hl.nodes].sort()).toEqual(["A", "B"]);
    });

    it("hover node C ⇒ {A, C, CA}", () => {
        const hl = resolveArrowHighlight(arrows, { nodeId: "C" })!;
        expect([...hl.keys]).toEqual([CA]);
        expect([...hl.nodes].sort()).toEqual(["A", "C"]);
    });

    it("hover arrow CA ⇒ only {A, C, CA}", () => {
        const hl = resolveArrowHighlight(arrows, { key: CA })!;
        expect([...hl.keys]).toEqual([CA]);
        expect([...hl.nodes].sort()).toEqual(["A", "C"]);
    });

    it("hover node A (a source in two arrows) ⇒ only its OUTGOING {A, B, AB} — counter CA stays dim", () => {
        const hl = resolveArrowHighlight(arrows, { nodeId: "A" })!;
        expect([...hl.keys]).toEqual([AB]);
        expect([...hl.nodes].sort()).toEqual(["A", "B"]);
    });

    it("returns null for an unrelated node with no arrow", () => {
        expect(resolveArrowHighlight(arrows, { nodeId: "Z" })).toBeNull();
    });
});
