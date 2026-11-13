// Slice #257 (PRD #249) — pure geometry for the spatial board's SVG target
// arrows. Endpoints derive from shared layout placements (surfaced as anchor
// points), so arrows recompute from the single source of truth as cards move.
import { describe, it, expect } from "vitest";
import {
    buildTargetArrows,
    buildCombatArrows,
    buildManualArrows,
    resolveArrowHighlight,
    pickHoverSeed,
    arrowPath,
    hitTestArrows,
    distanceToArrow,
    ARROW_HOVER_RADIUS,
    emptyAnchorMap,
    zonePileNodeId,
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
            stackTarget: { "s1|graveyard-card:gc1": { x: 2, y: 2 } },
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

describe("buildCombatArrows — attacker → attack target (QA / CR 508.1a)", () => {
    it("draws one arrow per declared attacker to the defending player's nameplate anchor", () => {
        const c = combat({ attackerIds: ["a1", "a2"] });
        const map = anchors({
            permanent: {
                a1: { x: 100, y: 400 },
                a2: { x: 200, y: 400 },
            },
            player: { p2: { x: 500, y: 40 } },
        });
        const arrows = buildCombatArrows(c, map, "p2");
        expect(arrows).toHaveLength(2);
        for (const a of arrows) {
            expect(a.kind).toBe("combat");
            expect(a.toId).toBe("p2");
            expect(a.to).toEqual({ x: 500, y: 40 });
        }
        expect(arrows[0].key).toBe("attack:a1->p2");
        expect(arrows[1].key).toBe("attack:a2->p2");
    });

    it("draws the arrow to the chosen planeswalker instead when attackTargets names one", () => {
        const c = combat({
            attackerIds: ["a1"],
            attackTargets: { a1: "pw1" },
        });
        const map = anchors({
            permanent: {
                a1: { x: 100, y: 400 },
                pw1: { x: 300, y: 200 },
            },
            player: { p2: { x: 500, y: 40 } },
        });
        const arrows = buildCombatArrows(c, map, "p2");
        expect(arrows).toHaveLength(1);
        expect(arrows[0].key).toBe("attack:a1->pw1");
        expect(arrows[0].toId).toBe("pw1");
        expect(arrows[0].to).toEqual({ x: 300, y: 200 });
    });

    it("skips the player arrow when no defenderId is known, and any arrow whose anchor is unpublished", () => {
        const c = combat({ attackerIds: ["a1", "a2"] });
        const map = anchors({
            permanent: { a1: { x: 100, y: 400 } },
            player: { p2: { x: 500, y: 40 } },
        });
        // no defenderId
        expect(buildCombatArrows(c, map)).toEqual([]);
        // a2 has no published permanent anchor
        expect(buildCombatArrows(c, map, "p2")).toHaveLength(1);
    });

    it("the attack arrow joins its attacker's combat cluster (hover lights blocker + attacker + target)", () => {
        const c = combat({
            attackerIds: ["att"],
            blockerAssignments: { att: ["b1"] },
        });
        const map = anchors({
            permanent: {
                att: { x: 500, y: 100 },
                b1: { x: 300, y: 400 },
            },
            player: { p2: { x: 500, y: 40 } },
        });
        const arrows = buildCombatArrows(c, map, "p2");
        expect(arrows).toHaveLength(2);
        expect(arrows[0].clusterId).toBe(arrows[1].clusterId);
        const hl = resolveArrowHighlight(arrows, {
            key: "attack:att->p2",
        })!;
        expect(hl.keys.size).toBe(2);
        expect([...hl.nodes].sort()).toEqual(["att", "b1", "p2"]);
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

// An ability is not the object on the stack — its SOURCE PERMANENT still sits
// on the battlefield, and that is where the player reads the effect as coming
// from (Arc Mage shooting its two targets). Arrows therefore leave the source
// permanent, not the stack row.
describe("buildTargetArrows — ability arrows leave their source permanent", () => {
    it("anchors an activated ability at its source permanent (Arc Mage)", () => {
        // An activated ability's stack item is a clone of the source instance,
        // so it carries the source's own id.
        const item = {
            ...stackItem("arc-mage", [
                { type: "permanent", id: "bears" },
                { type: "player", id: "p2" },
            ]),
            abilityId: "arc-mage-damage",
        } as StackItem;
        const map = anchors({
            stack: { "arc-mage": { x: 900, y: 40 } },
            permanent: {
                "arc-mage": { x: 200, y: 400 },
                bears: { x: 500, y: 100 },
            },
            player: { p2: { x: 600, y: 20 } },
        });
        const arrows = buildTargetArrows([item], map);
        expect(arrows).toHaveLength(2);
        for (const a of arrows) {
            expect(a.from).toEqual({ x: 200, y: 400 });
            expect(a.fromId).toBe("arc-mage");
        }
        expect(arrows.map((a) => a.toId).sort()).toEqual(["bears", "p2"]);
    });

    it("anchors a triggered ability at `triggerSourceId`", () => {
        const item = {
            ...stackItem("trig-1", [{ type: "player", id: "p2" }]),
            triggeredAbilityId: "t0",
            triggerSourceId: "src-perm",
        } as StackItem;
        const map = anchors({
            stack: { "trig-1": { x: 900, y: 40 } },
            permanent: { "src-perm": { x: 120, y: 380 } },
            player: { p2: { x: 600, y: 20 } },
        });
        const [arrow] = buildTargetArrows([item], map);
        expect(arrow.from).toEqual({ x: 120, y: 380 });
        expect(arrow.fromId).toBe("src-perm");
    });

    it("falls back to the stack row when the source has left the battlefield", () => {
        const item = {
            ...stackItem("trig-1", [{ type: "player", id: "p2" }]),
            triggeredAbilityId: "t0",
            triggerSourceId: "gone",
        } as StackItem;
        const map = anchors({
            stack: { "trig-1": { x: 900, y: 40 } },
            player: { p2: { x: 600, y: 20 } },
        });
        const [arrow] = buildTargetArrows([item], map);
        expect(arrow.from).toEqual({ x: 900, y: 40 });
        expect(arrow.fromId).toBe("trig-1");
    });

    it("keeps a spell anchored at its stack row", () => {
        const item = stackItem("arc-lightning", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
            { type: "player", id: "p2" },
        ]);
        const map = anchors({
            stack: { "arc-lightning": { x: 900, y: 40 } },
            permanent: { a: { x: 10, y: 10 }, b: { x: 20, y: 20 } },
            player: { p2: { x: 30, y: 30 } },
        });
        const arrows = buildTargetArrows([item], map);
        expect(arrows).toHaveLength(3);
        for (const a of arrows) expect(a.from).toEqual({ x: 900, y: 40 });
    });
});

// Issue #2171 — Manual Mode's player-declared arrows: a flat permanent →
// permanent pair list, resolved through the SAME anchor registry every other
// arrow builder reads. No stack, no combat — this is `BoardArrows`' one
// non-GRE-shaped input.
describe("buildManualArrows — permanent → permanent pairs (#2171)", () => {
    it("returns no arrows for an empty pair list", () => {
        expect(buildManualArrows([], emptyAnchorMap())).toEqual([]);
    });

    it("resolves both endpoints from the permanent anchor bucket", () => {
        const map = anchors({
            permanent: {
                bear: { x: 10, y: 10 },
                opp: { x: 400, y: 300 },
            },
        });
        const arrows = buildManualArrows(
            [{ key: "manual:bear->opp", fromId: "bear", toId: "opp" }],
            map
        );
        expect(arrows).toHaveLength(1);
        expect(arrows[0]).toMatchObject({
            key: "manual:bear->opp",
            kind: "target",
            fromId: "bear",
            toId: "opp",
            from: { x: 10, y: 10 },
            to: { x: 400, y: 300 },
        });
    });

    it("drops a pair whose source anchor has not been published (host left the board)", () => {
        const map = anchors({ permanent: { opp: { x: 400, y: 300 } } });
        const arrows = buildManualArrows(
            [{ key: "manual:gone->opp", fromId: "gone", toId: "opp" }],
            map
        );
        expect(arrows).toEqual([]);
    });

    it("drops a pair whose target anchor has not been published", () => {
        const map = anchors({ permanent: { bear: { x: 10, y: 10 } } });
        const arrows = buildManualArrows(
            [{ key: "manual:bear->gone", fromId: "bear", toId: "gone" }],
            map
        );
        expect(arrows).toEqual([]);
    });
});

describe("hitTestArrows — passive hover proximity (issue #5853)", () => {
    // (0,0) → (200,0) bows to y = +36 at its control point: curve midpoint
    // (100, 18), i.e. NOT on the chord.
    const arrows = buildManualArrows(
        [
            { key: "ab", fromId: "a", toId: "b" },
            { key: "cd", fromId: "c", toId: "d" },
        ],
        anchors({
            permanent: {
                a: { x: 0, y: 0 },
                b: { x: 200, y: 0 },
                c: { x: 0, y: 100 },
                d: { x: 200, y: 100 },
            },
        })
    );

    it("measures distance to the bowed curve, not the chord", () => {
        expect(distanceToArrow(arrows[0], { x: 100, y: 18 })).toBeLessThan(0.5);
        expect(distanceToArrow(arrows[0], { x: 100, y: 0 })).toBeCloseTo(18, 0);
    });

    it("hits the arrow within the hover radius and nothing beyond it", () => {
        expect(
            hitTestArrows(arrows, { x: 100, y: 18 + ARROW_HOVER_RADIUS - 1 })
        ).toBe(arrows[0].key);
        expect(
            hitTestArrows(arrows, { x: 100, y: 18 + ARROW_HOVER_RADIUS + 2 })
        ).toBeNull();
    });

    it("picks the nearest arrow when two are in reach", () => {
        expect(hitTestArrows(arrows, { x: 100, y: 118 }, 200)).toBe(
            arrows[1].key
        );
    });

    it("handles a zero-length arrow as a point", () => {
        const [dot] = buildManualArrows(
            [{ key: "ab", fromId: "a", toId: "b" }],
            anchors({ permanent: { a: { x: 5, y: 5 }, b: { x: 5, y: 5 } } })
        );
        expect(distanceToArrow(dot, { x: 8, y: 9 })).toBe(5);
    });
});

describe("buildCombatArrows — attackers still choosing a target (CR 508.1b)", () => {
    it("draws no attack arrow for an undecided attacker, one for a decided one", () => {
        const c = combat({ attackerIds: ["a1", "a2"], confirmed: false });
        const map = anchors({
            permanent: { a1: { x: 1, y: 1 }, a2: { x: 2, y: 2 } },
            player: { opp: { x: 9, y: 9 } },
        });
        const all = buildCombatArrows(c, map, "opp");
        expect(all.map((a) => a.fromId)).toEqual(["a1", "a2"]);
        const some = buildCombatArrows(c, map, "opp", ["a1"]);
        expect(some.map((a) => a.fromId)).toEqual(["a2"]);
    });
});

describe("buildTargetArrows — a zone-card target's arrow leaves its target line (issue #9326)", () => {
    const reanimate = stackItem("s1", [
        { type: "graveyard-card", id: "elf-2", playerId: "p2" },
        { type: "player", id: "p2" },
    ]);
    const base = {
        stack: { s1: { x: 0, y: 0 } },
        player: { p2: { x: 20, y: 20 } },
        graveyard: { p2: { x: 300, y: 30 } },
    };

    it("starts at the line's anchor and ends on the pile, which is its target node", () => {
        const map = anchors({
            ...base,
            stackTarget: {
                "s1|graveyard-card:elf-2": { x: 7, y: 9 },
                "s1|header": { x: 7, y: 3 },
            },
        });
        const [zone, player] = buildTargetArrows([reanimate], map);
        expect(zone.from).toEqual({ x: 7, y: 9 });
        expect(zone.to).toEqual({ x: 300, y: 30 });
        expect(zone.toId).toBe(zonePileNodeId("graveyard", "p2"));
        expect(zone.stackItemId).toBe("s1");
        // A player target keeps the row as its source.
        expect(player.from).toEqual({ x: 0, y: 0 });
    });

    it("starts at the block header while the block is collapsed", () => {
        const map = anchors({
            ...base,
            stackTarget: { "s1|header": { x: 7, y: 3 } },
        });
        expect(buildTargetArrows([reanimate], map)[0].from).toEqual({
            x: 7,
            y: 3,
        });
    });

    it("draws no zone-card arrow when the line is not on screen (row scrolled out) — never from the row or the permanent instead", () => {
        const ability = {
            ...reanimate,
            abilityId: "a1",
            triggerSourceId: "perm-src",
        } as StackItem;
        const map = anchors({
            ...base,
            permanent: { "perm-src": { x: 50, y: 50 } },
        });
        const arrows = buildTargetArrows([ability], map);
        expect(arrows.map((a) => a.key)).toEqual(["s1->player:p2:"]);
    });
});

describe("resolveArrowHighlight — the focus of a zone-card relationship (issue #9326)", () => {
    const ability = {
        ...stackItem("s1", [
            { type: "graveyard-card", id: "elf-2", playerId: "p2" },
        ]),
        abilityId: "a1",
        triggerSourceId: "perm-src",
    } as StackItem;
    const spell = stackItem("s2", [
        { type: "graveyard-card", id: "elf-1", playerId: "p2" },
    ]);
    const map = anchors({
        stack: { s1: { x: 0, y: 0 }, s2: { x: 0, y: 40 } },
        permanent: { "perm-src": { x: 50, y: 50 } },
        graveyard: { p2: { x: 300, y: 30 } },
        stackTarget: {
            "s1|graveyard-card:elf-2": { x: 7, y: 9 },
            "s2|graveyard-card:elf-1": { x: 7, y: 49 },
        },
    });
    const arrows = buildTargetArrows([ability, spell], map);
    const pile = zonePileNodeId("graveyard", "p2");

    it("hovering the ability's SOURCE PERMANENT lights the arrow leaving its row's line, the row and the pile", () => {
        const h = resolveArrowHighlight(arrows, { nodeId: "perm-src" })!;
        expect(h.focus).toBe("target");
        expect([...h.keys]).toEqual(["s1->graveyard-card:elf-2:p2"]);
        expect(h.nodes).toEqual(new Set(["perm-src", "s1", pile]));
    });

    it("hovering the stack ROW lights the same relationship", () => {
        const h = resolveArrowHighlight(arrows, { nodeId: "s1" })!;
        expect([...h.keys]).toEqual(["s1->graveyard-card:elf-2:p2"]);
        expect(h.nodes.has("perm-src")).toBe(true);
    });

    it("hovering the PILE lights every relationship pointing into it", () => {
        const h = resolveArrowHighlight(arrows, { nodeId: pile })!;
        expect(h.keys.size).toBe(2);
        expect(h.nodes).toEqual(new Set([pile, "s1", "perm-src", "s2"]));
    });

    it("hovering the ARROW lights its source nodes and the pile", () => {
        const h = resolveArrowHighlight(arrows, {
            key: "s2->graveyard-card:elf-1:p2",
        })!;
        expect(h.focus).toBe("target");
        expect(h.nodes).toEqual(new Set(["s2", pile]));
    });
});

// Issue #9500 — the attack graph is many-to-one (CR 508.1b: each attacker
// picks one player or planeswalker), so hover is cumulative on the TARGET
// side: pointing at a planeswalker or a player lights every creature
// attacking it; pointing at one attacker lights only it and its target.
describe("resolveArrowHighlight — attack targets fan in (issue #9500)", () => {
    const c = combat({
        attackerIds: ["a1", "a2", "a3"],
        attackTargets: { a1: "pw1", a2: "pw1" },
    });
    const map = anchors({
        permanent: {
            a1: { x: 100, y: 400 },
            a2: { x: 200, y: 400 },
            a3: { x: 300, y: 400 },
            pw1: { x: 300, y: 200 },
        },
        player: { p2: { x: 500, y: 40 } },
    });
    const arrows = buildCombatArrows(c, map, "p2");

    it("hovering a planeswalker lights every attacker on it, and only those", () => {
        const h = resolveArrowHighlight(arrows, { nodeId: "pw1" });
        expect([...(h?.keys ?? [])].sort()).toEqual([
            "attack:a1->pw1",
            "attack:a2->pw1",
        ]);
        expect([...(h?.nodes ?? [])].sort()).toEqual(["a1", "a2", "pw1"]);
    });

    it("hovering the player lights the attacker on the player", () => {
        const h = resolveArrowHighlight(arrows, { nodeId: "p2" });
        expect([...(h?.keys ?? [])]).toEqual(["attack:a3->p2"]);
    });

    it("hovering one attacker (or its arrow) lights only it and its target", () => {
        for (const seed of [{ nodeId: "a1" }, { key: "attack:a1->pw1" }]) {
            const h = resolveArrowHighlight(arrows, seed);
            expect([...(h?.keys ?? [])]).toEqual(["attack:a1->pw1"]);
            expect([...(h?.nodes ?? [])].sort()).toEqual(["a1", "pw1"]);
        }
    });
});

// Issue #9500 — every arrow into a target converges on its centre, so the
// pointer on a planeswalker is always within reach of ONE incoming arrow. On
// the arrow's own endpoint the node seed must win, or the cumulative
// highlight above is unreachable from the board.
describe("pickHoverSeed — a node beats its own arrow (issue #9500)", () => {
    const c = combat({
        attackerIds: ["a1", "a2"],
        attackTargets: { a1: "pw1", a2: "pw1" },
    });
    const map = anchors({
        permanent: {
            a1: { x: 100, y: 400 },
            a2: { x: 200, y: 400 },
            pw1: { x: 300, y: 200 },
            other: { x: 150, y: 300 },
        },
    });
    const arrows = buildCombatArrows(c, map, "p2");

    it("pointer on the target card: the node wins over the arrow it ends on", () => {
        const seed = pickHoverSeed(arrows, "attack:a1->pw1", { nodeId: "pw1" });
        expect(seed).toEqual({ nodeId: "pw1" });
        const h = resolveArrowHighlight(arrows, seed);
        expect(h?.keys.size).toBe(2);
    });

    it("pointer on an attacker crossed by a neighbour's arrow: the attacker wins", () => {
        expect(
            pickHoverSeed(arrows, "attack:a1->pw1", { nodeId: "a2" })
        ).toEqual({ nodeId: "a2" });
    });

    it("pointer on an unrelated card an arrow crosses: the arrow wins", () => {
        expect(
            pickHoverSeed(arrows, "attack:a1->pw1", { nodeId: "other" })
        ).toEqual({ key: "attack:a1->pw1" });
    });
});
