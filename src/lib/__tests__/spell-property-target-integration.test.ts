// Integration: SPELL-PROPERTY target filters (Confound, issue #1956) from the
// server's offered set all the way to client clickability — asserted THROUGH
// the real view reducer, never against a hand-built view.
//
// `spellWasKicked` is covered through a SYNTHETIC requirement rather than a
// card: Ertai's Trickery, which motivated the filter, ships as a tracked stub
// because "counter target spell if it was kicked" is a CR 608.2a intervening
// condition, not a targeting restriction (tracked-by: #2044). The client
// mirror still needs its proof, so the filter keeps one.
//
// Why this file exists. The server half of the target-filter registry cannot
// drift: `getLegalTargets` and `selectTarget` share one descriptor (ADR 0068).
// The CLIENT half can and did — `<GameStack>` never calls that registry (it
// works on the wire projection, not a `GameState`), so a filter added
// server-side reaches the UI as a silent fail-open: the stack tile stays
// clickable and the mutation rejects the click. The assertion below is
// therefore not "the mirror returns true for this item" but "the mirror's
// verdict over the PROJECTED state equals `getLegalTargets`' verdict over the
// fat state, for every item on the stack".
//
// The project has no convex-test harness (ADR 0001), so the server side is
// driven through the SAME exported builder `announceCast` uses
// (`pendingTargetFiltersFromRequirement`) — the established shape of
// `stifle-target-integration.test.ts`.

import { describe, it, expect } from "vitest";
import {
    getLegalTargets,
    pendingTargetFiltersFromRequirement,
    NO_TARGETING_SOURCE,
} from "@convex/gre/rules";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { grizzlyBears, island, lightningBolt } from "@convex/cards/sets/lea";
import { stoneRain } from "@convex/cards/sets/lea/red";
import { confound } from "@convex/cards/sets/pls/blue";
import { urzasRage } from "@convex/cards/sets/inv/red";
import type { TargetRequirement } from "@convex/cards/types";
import type { GameState } from "@convex/gre/state";
import type { CardInstance, PendingTarget } from "~/types/game";
import { matchesSpellPendingTarget, wantsSpellTarget } from "~/lib/card-utils";

/** Minimal `PendingTarget` carrying only the SPELL filter dimensions under
 *  test (issue #1734) — `matchesSpellPendingTarget`'s single-filter twin of
 *  the deleted `matchesSpellTargetsTypeFilter` / `matchesSpellWasKicked`
 *  mirrors. */
function pt(filters: Record<string, unknown>): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "src",
        targetType: "spell",
        count: 1,
        selected: [],
        spellStackKind: "any",
        ...filters,
    } as unknown as PendingTarget;
}

function scenario(): {
    state: GameState;
    ids: Record<string, string>;
} {
    const state = makeState({
        players: [
            makePlayer("p1", { life: 20 }),
            makePlayer("p2", {
                life: 20,
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "bear",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(island.id, {
                        id: "isle",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
    const targetsCreature = pushSpell(state, lightningBolt.id, "p2", [
        { type: "permanent", id: "bear" },
    ]);
    const targetsPlayer = pushSpell(state, lightningBolt.id, "p2", [
        { type: "player", id: "p1" },
    ]);
    const targetsLand = pushSpell(state, stoneRain.id, "p2", [
        { type: "permanent", id: "isle" },
    ]);
    const kicked = pushSpell(state, urzasRage.id, "p2", [
        { type: "permanent", id: "bear" },
    ]);
    kicked.kickerPayments = { kicker: 1 };
    return {
        state,
        ids: {
            targetsCreature: targetsCreature.id,
            targetsPlayer: targetsPlayer.id,
            targetsLand: targetsLand.id,
            kicked: kicked.id,
        },
    };
}

/** The client verdict for every stack item, computed off the PROJECTED state
 *  (the only thing the browser ever sees) with the pending target the server
 *  actually builds. */
function clientClickable(
    state: GameState,
    requirement: NonNullable<typeof confound.targetRequirement>
): string[] {
    const projected = projectPublicState(state, 1, "p1");
    const pendingTarget = {
        playerId: "p1",
        cardInstanceId: "src",
        targetType: requirement.type,
        count: 1,
        selected: [],
        ...pendingTargetFiltersFromRequirement(requirement, undefined),
    } as unknown as PendingTarget;
    const players = projected.players.map((p) => ({
        id: p.id,
        battlefield: p.battlefield as unknown as CardInstance[],
    }));
    return projected.stack
        .filter((item) =>
            matchesSpellPendingTarget(item, pendingTarget, {
                playerId: "p1",
                activePlayerId: projected.activePlayerId,
                players,
            })
        )
        .map((item) => item.id);
}

const serverOffered = (
    state: GameState,
    requirement: NonNullable<typeof confound.targetRequirement>
) =>
    getLegalTargets(state, requirement, NO_TARGETING_SOURCE, "p1").map(
        (t) => t.id
    );

/** Synthetic — no shipped card declares `spellWasKicked` (see the header note,
 *  tracked-by: #2044). Keeps the filter's client mirror proven. */
const KICKED_REQ: TargetRequirement = {
    type: "spell",
    count: 1,
    spellWasKicked: true,
};

describe("spell-property target filters — server offered set == client clickable set (issue #1956)", () => {
    it("Confound: the projected client verdict matches getLegalTargets exactly", () => {
        const { state, ids } = scenario();
        const req = confound.targetRequirement!;
        expect(clientClickable(state, req).sort()).toEqual(
            serverOffered(state, req).sort()
        );
        // …and is not vacuous: exactly the two creature-targeting spells.
        expect(clientClickable(state, req).sort()).toEqual(
            [ids.targetsCreature, ids.kicked].sort()
        );
    });

    it("spellWasKicked: the projected client verdict matches getLegalTargets exactly", () => {
        const { state, ids } = scenario();
        expect(clientClickable(state, KICKED_REQ)).toEqual(
            serverOffered(state, KICKED_REQ)
        );
        expect(clientClickable(state, KICKED_REQ)).toEqual([ids.kicked]);
    });

    it("both requirements enable stack-spell selection (wantsSpellTarget)", () => {
        expect(wantsSpellTarget(confound.targetRequirement!.type)).toBe(true);
        expect(wantsSpellTarget(KICKED_REQ.type)).toBe(true);
    });

    it("the target prompt resolves to a real label, not a raw fallback", () => {
        // Neither requirement introduces a new `TargetRequirement.type`: both
        // are `"spell"`, which `TARGET_LABEL` already spells "a spell on the
        // stack", and neither narrows `spellStackKind` away from the default
        // (which is what would reword the prompt to an ability).
        for (const req of [confound.targetRequirement!, KICKED_REQ]) {
            expect(req.type).toBe("spell");
            expect(
                pendingTargetFiltersFromRequirement(req, undefined)
                    .spellStackKind
            ).toBe("spell");
        }
    });

    it("the client predicate fails CLOSED on the projected shape (no targets / no kicker record)", () => {
        const { state } = scenario();
        const projected = projectPublicState(state, 1, "p1");
        const players = projected.players.map((p) => ({
            id: p.id,
            battlefield: p.battlefield as unknown as CardInstance[],
        }));
        const ctx = { playerId: "p1", activePlayerId: "p1", players };
        expect(
            matchesSpellPendingTarget(
                { id: "s1", card: { id: "x" } },
                pt({ spellTargetsTypeFilter: ["Creature"] }),
                ctx
            )
        ).toBe(false);
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s2",
                    card: { id: "x" },
                    targets: [{ type: "player", id: "p1" }],
                },
                pt({ spellTargetsTypeFilter: ["Creature"] }),
                ctx
            )
        ).toBe(false);
        expect(
            matchesSpellPendingTarget(
                { id: "s3", card: { id: "x" } },
                pt({ spellWasKicked: true }),
                ctx
            )
        ).toBe(false);
        expect(
            matchesSpellPendingTarget(
                { id: "s4", card: { id: "x" }, kickerPayments: {} },
                pt({ spellWasKicked: true }),
                ctx
            )
        ).toBe(false);
        // …and stay inert when the requirement doesn't declare them.
        expect(
            matchesSpellPendingTarget(
                { id: "s5", card: { id: "x" } },
                pt({}),
                ctx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                { id: "s6", card: { id: "x" } },
                pt({}),
                ctx
            )
        ).toBe(true);
    });
});
