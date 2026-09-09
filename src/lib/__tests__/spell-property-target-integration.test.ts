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
import { teferisResponse } from "@convex/cards/sets/inv/blue";
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
    // CR 702.175a / ADR 0085 (issue #2078) — a spell that PAID an additional
    // cost under a keyword that is not a kick. It carries the sibling record
    // and no `kickerPayments` at all, which is exactly what the split at the
    // write produces; the client sees a slim stack item with no card definition
    // and must still read it as unkicked without one.
    const unkicked = pushSpell(state, urzasRage.id, "p2", [
        { type: "permanent", id: "bear" },
    ]);
    unkicked.unkickedCostPayments = { offspring: 1 };
    return {
        state,
        ids: {
            targetsCreature: targetsCreature.id,
            targetsPlayer: targetsPlayer.id,
            targetsLand: targetsLand.id,
            kicked: kicked.id,
            unkicked: unkicked.id,
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
        // …and is not vacuous: exactly the three creature-targeting spells
        // (`unkicked` is the ADR 0085 probe below — same targets, different
        // additional-cost keyword).
        expect(clientClickable(state, req).sort()).toEqual(
            [ids.targetsCreature, ids.kicked, ids.unkicked].sort()
        );
    });

    it("spellWasKicked: the projected client verdict matches getLegalTargets exactly", () => {
        const { state, ids } = scenario();
        expect(clientClickable(state, KICKED_REQ)).toEqual(
            serverOffered(state, KICKED_REQ)
        );
        expect(clientClickable(state, KICKED_REQ)).toEqual([ids.kicked]);
    });

    // ADR 0085 (issue #2078) — the payment record is partitioned by keyword at
    // the WRITE, so this reader needed no change at all: a spell whose
    // OFFSPRING cost was paid (CR 702.175a) carries its payments in the sibling
    // record and is therefore not kicked (CR 702.33d), on the client exactly as
    // on the server. This is the reader that could not have been narrowed —
    // `slimCard` gives it `{ id }` in place of the card definition.
    it("spellWasKicked: a non-kicker additional cost is NOT clickable, client and server agree", () => {
        const { state, ids } = scenario();
        const clickable = clientClickable(state, KICKED_REQ);
        expect(clickable).toEqual(serverOffered(state, KICKED_REQ));
        expect(clickable).toEqual([ids.kicked]);
        expect(clickable).not.toContain(ids.unkicked);
        // …and the sibling record really did survive the projection, so the
        // verdict above is a decision, not a dropped field.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            (
                projected.stack.find((i) => i.id === ids.unkicked) as {
                    unkickedCostPayments?: Record<string, number>;
                }
            ).unkickedCostPayments
        ).toEqual({ offspring: 1 });
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
                pt({ spellTargetsPermanentFilter: { types: ["Creature"] } }),
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
                pt({ spellTargetsPermanentFilter: { types: ["Creature"] } }),
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

// ─────────────────────────────────────────────────────────────────────────────
// Teferi's Response — the CONJUNCTIVE targeted-permanent clause (issue #2708).
//
// The clause is `{ types: "Land", controller: "you" }`, and the client mirror
// has to enforce BOTH halves against the same witness. Its half of the state is
// the PROJECTION, so the assertion that matters is not "the mirror agrees on a
// legal item" but "the mirror agrees on the two items that satisfy exactly ONE
// clause each" — a land an opponent controls, and a non-land you control.
// Those are precisely the items two independent filter keys would have let
// through, and precisely the ones a projection that dropped `controllerId`
// would misjudge.
// ─────────────────────────────────────────────────────────────────────────────

describe("Teferi's Response — conjunctive targeted-permanent clause (issue #2708)", () => {
    const REQ = teferisResponse.targetRequirement!;

    function board(): { state: GameState; ids: Record<string, string> } {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [
                        makeInstance(island.id, {
                            id: "myLand",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "myBear",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    life: 20,
                    battlefield: [
                        makeInstance(island.id, {
                            id: "theirLand",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        const onMyLand = pushSpell(state, stoneRain.id, "p2", [
            { type: "permanent", id: "myLand" },
        ]);
        const onTheirLand = pushSpell(state, stoneRain.id, "p2", [
            { type: "permanent", id: "theirLand" },
        ]);
        const onMyBear = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "myBear" },
        ]);
        const mineOnMyLand = pushSpell(state, stoneRain.id, "p1", [
            { type: "permanent", id: "myLand" },
        ]);
        return {
            state,
            ids: {
                onMyLand: onMyLand.id,
                onTheirLand: onTheirLand.id,
                onMyBear: onMyBear.id,
                mineOnMyLand: mineOnMyLand.id,
            },
        };
    }

    it("client clickability EQUALS the server's offered set, item for item", () => {
        const { state, ids } = board();
        const clickable = clientClickable(state, REQ);
        expect(clickable).toEqual(serverOffered(state, REQ));
        expect(clickable).toEqual([ids.onMyLand]);
    });

    it("the two ONE-CLAUSE items are rejected on the client too (what two independent keys would have admitted)", () => {
        const { state, ids } = board();
        const clickable = clientClickable(state, REQ);
        // Satisfies `types: "Land"` but not `controller: "you"`.
        expect(clickable).not.toContain(ids.onTheirLand);
        // Satisfies `controller: "you"` but not `types: "Land"`.
        expect(clickable).not.toContain(ids.onMyBear);
        // …and the top-level `controller: "opponent"` still bites: your own
        // spell, targeting your own land, is never a legal target (CR 109.4).
        expect(clickable).not.toContain(ids.mineOnMyLand);
    });

    it("the projected battlefield really carries the controller the clause reads", () => {
        const { state } = board();
        const projected = projectPublicState(state, 1, "p1");
        const land = projected.players[0].battlefield.find(
            (c) => c.id === "myLand"
        )!;
        expect(land.controllerId).toBe("p1");
    });

    it("stack-spell selection is enabled and the prompt names an ability too (spellStackKind: any)", () => {
        expect(wantsSpellTarget(REQ.type)).toBe(true);
        expect(
            pendingTargetFiltersFromRequirement(REQ, undefined).spellStackKind
        ).toBe("any");
    });
});
