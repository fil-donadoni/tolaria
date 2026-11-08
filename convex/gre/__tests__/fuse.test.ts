// CR 702.102 — Fuse: the fused split spell (`cards/fusedSplit.ts`), its cast
// option (`gre/splitCast.ts`) and its resolution.
//
// The full mutation path is `convex/__tests__/fusedSplitCastPath.test.ts`;
// this suite pins each subrule against the engine entry points.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    FUSED_RIGHT_BINDING_PREFIX,
    fusedSplitDefinitionId,
    fusedSplitShapeRefusal,
    fusedSplitTwinDefinition,
} from "../../cards/fusedSplit";
import { defineSplitCard } from "../../cards/splitCard";
import type { CardDefinition, SplitHalf } from "../../cards/types";
import {
    castAsSplitHalf,
    revertSplitIdentity,
    splitCastAltCostId,
    splitCastOptionsFor,
} from "../splitCast";
import { castSubjectDefinition } from "../castMode";
import { resolveTopOfStack } from "../state";
import type { GameState } from "../state";
import {
    FUSED_SPLIT_PROBE_ID,
    fusedSplitProbe,
} from "./fixtures/fusedSplitProbe.fixture";

const FUSED_ID = fusedSplitDefinitionId(FUSED_SPLIT_PROBE_ID);

function half(overrides: Partial<SplitHalf>): SplitHalf {
    return {
        name: "Half",
        manaCost: { R: 1 },
        types: ["Instant"],
        oracleText: "",
        effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        targetRequirement: { type: "Creature", count: 1 },
        ...overrides,
    };
}

function fuseCard(left: SplitHalf, right: SplitHalf): CardDefinition {
    return defineSplitCard({
        id: "test:fuse-shape",
        rarity: "common",
        oracleText: "",
        staticAbilities: ["fuse"],
        halves: [left, right],
    });
}

describe("CR 702.102b–d — the fused split spell", () => {
    const twin = fusedSplitTwinDefinition(fusedSplitProbe)!;

    it("has the combined characteristics and the summed cost (CR 702.102b/c)", () => {
        expect(twin.id).toBe(FUSED_ID);
        expect(twin.name).toBe("Probe Spark // Probe Blaze");
        expect(twin.types).toEqual(["Instant"]);
        // {R} + {1}{R}
        expect(twin.manaCost).toEqual({ R: 2, X: 1 });
        expect(twin.oracleText).not.toMatch(/Fuse/);
    });

    it("announces the left half's target group, then the right half's", () => {
        expect(twin.targetRequirement).toEqual({ type: "Creature", count: 1 });
        expect(twin.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1 },
        ]);
    });

    it("runs the left half's script, then the right half's on its OWN slot (CR 702.102d)", () => {
        expect(twin.effects).toEqual([
            { op: "dealDamage", amount: 1, to: { target: 0 } },
            { op: "dealDamage", amount: 2, to: { target: 1 } },
        ]);
    });

    it("renames the right half's own bindings so it never reads the left half's answer", () => {
        const binding = (name: string) => ({
            op: "choice" as const,
            kind: "discard-hand" as const,
            player: "controller" as const,
            zone: "hand" as const,
            count: 1,
            prompt: "Discard a card.",
            bind: name,
        });
        const card = fuseCard(
            half({
                effects: [binding("$picked")],
                targetRequirement: undefined,
            }),
            half({
                effects: [binding("$picked")],
                targetRequirement: undefined,
            })
        );
        const effects = fusedSplitTwinDefinition(card)!.effects!;
        expect((effects[0] as { bind: string }).bind).toBe("$picked");
        expect((effects[1] as { bind: string }).bind).toBe(
            `${FUSED_RIGHT_BINDING_PREFIX}picked`
        );
    });

    it("a split card WITHOUT fuse has no fused spell", () => {
        const plain = { ...fusedSplitProbe, staticAbilities: [] };
        expect(fusedSplitTwinDefinition(plain)).toBeUndefined();
    });
});

describe("CR 702.102d — halves that cannot be fused positionally are refused", () => {
    it("a variable left target count before a targeting right half", () => {
        const left = half({
            targetRequirement: { type: "Creature", count: { min: 0 } },
        });
        expect(fusedSplitShapeRefusal([left, half({})])).toMatch(/variable/);
        expect(
            fusedSplitTwinDefinition(fuseCard(left, half({})))
        ).toBeUndefined();
        // …but fine when the right half targets nothing after it.
        expect(
            fusedSplitShapeRefusal([
                left,
                half({
                    targetRequirement: undefined,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                }),
            ])
        ).toBeUndefined();
    });

    it("a whole-target-set sweep beside the other half's targets", () => {
        const sweep = half({
            targetRequirement: undefined,
            effects: [
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        });
        expect(fusedSplitShapeRefusal([half({}), sweep])).toMatch(
            /every announced target/
        );
    });

    it("a reserved `$target<N>` read on the right half", () => {
        const named = half({
            effects: [
                {
                    op: "destroy",
                    target: { target: 0 },
                },
                {
                    op: "draw",
                    player: "controller",
                    count: { ref: "$target0.name" },
                } as never,
            ],
        });
        expect(fusedSplitShapeRefusal([half({}), named])).toMatch(
            /cannot be moved/
        );
    });

    it("a half with no Effect Script", () => {
        expect(
            fusedSplitShapeRefusal([half({ effects: undefined }), half({})])
        ).toMatch(/Effect Scripts/);
    });
});

/** p1 holds the probe in `zone`; p2 has a Hill Giant and Grizzly Bears. */
function position(zone: "hand" | "graveyard" = "hand"): GameState {
    const probe = makeInstance(FUSED_SPLIT_PROBE_ID, {
        id: "split",
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
    return makeState({
        players: [
            makePlayer("p1", {
                ...(zone === "hand"
                    ? { hand: [probe] }
                    : { graveyard: [probe] }),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(getCardByName("Hill Giant").id, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(getCardByName("Grizzly Bears").id, {
                        id: "bears",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

describe("CR 702.102a — the fused cast is offered only from a hand", () => {
    it("from the hand: left, right, and both halves fused", () => {
        const card = position("hand").players[0].hand[0];
        expect(splitCastOptionsFor(card).map((o) => o.id)).toEqual([
            splitCastAltCostId(fusedSplitProbe, "left"),
            splitCastAltCostId(fusedSplitProbe, "right"),
            splitCastAltCostId(fusedSplitProbe, "fused"),
        ]);
        const fused = splitCastOptionsFor(card)[2];
        expect(fused.mana).toEqual({ R: 2, X: 1 });
        expect(fused.description).toMatch(/^Fuse/);
    });

    it("from any other zone: the halves only", () => {
        const card = position("graveyard").players[0].graveyard[0];
        expect(splitCastOptionsFor(card).map((o) => o.id)).toEqual([
            splitCastAltCostId(fusedSplitProbe, "left"),
            splitCastAltCostId(fusedSplitProbe, "right"),
        ]);
    });

    it("a split card without fuse never offers it", () => {
        const card = makeInstance(getCardByName("Stand // Deliver").id, {
            zone: "hand",
        });
        expect(splitCastOptionsFor(card)).toHaveLength(2);
    });

    it("the fused announcement's subject is the fused spell (CR 702.102b)", () => {
        expect(
            castSubjectDefinition(
                fusedSplitProbe,
                splitCastAltCostId(fusedSplitProbe, "fused")
            )?.id
        ).toBe(FUSED_ID);
    });
});

describe("CR 702.102d / 608.2b — resolving a fused split spell", () => {
    function castFused(state: GameState, targets: string[]) {
        const item = pushSpell(
            state,
            FUSED_SPLIT_PROBE_ID,
            "p1",
            targets.map((id) => ({ type: "permanent" as const, id }))
        );
        item.id = "split";
        item.zone = "stack";
        castAsSplitHalf(item, "fused");
        state.players[0].hand = [];
        return item;
    }

    it("each half acts on its own target, left then right", () => {
        const state = position();
        const item = castFused(state, ["giant", "bears"]);
        expect((item.card as { id: string }).id).toBe(FUSED_ID);
        resolveTopOfStack(state);
        const giant = state.players[1].battlefield.find(
            (c) => c.id === "giant"
        );
        expect(giant?.damageMarked).toBe(1);
        const bears = state.players[1].battlefield.find(
            (c) => c.id === "bears"
        );
        expect(bears?.damageMarked).toBe(2);
        // CR 709.4 — off the stack it is the split card again.
        const card = state.players[0].graveyard.find((c) => c.id === "split");
        expect((card?.card as { id: string }).id).toBe(FUSED_SPLIT_PROBE_ID);
        expect(card?.splitHalfOf).toBeUndefined();
    });

    it("one half's target gone, the other half still resolves (CR 608.2b)", () => {
        const state = position();
        castFused(state, ["giant", "bears"]);
        // The left half's target leaves before resolution.
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "giant"
        );
        resolveTopOfStack(state);
        const bears = state.players[1].battlefield.find(
            (c) => c.id === "bears"
        );
        expect(bears?.damageMarked).toBe(2);
    });

    it("the identity revert restores the parent", () => {
        const state = position();
        const item = castFused(state, ["giant", "bears"]);
        revertSplitIdentity(item);
        expect((item.card as { id: string }).id).toBe(FUSED_SPLIT_PROBE_ID);
    });
});
