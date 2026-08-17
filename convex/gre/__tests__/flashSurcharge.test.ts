// Conditional-flash SURCHARGE (CR 601.3c) — the cost/timing capability built
// once for the Invasion cycle (issue #2146): Rout, Breaking Wave, Twilight's
// Call, Ghitu Fire and Saproling Symbiosis all print "You may cast this spell
// as though it had flash if you pay {2} more to cast it."
//
// The mechanic is two halves that must NOT be collapsed into one predicate,
// and this file pins both independently:
//
//   1. `castTimingBaseLegal` — legal to ANNOUNCE. CR 601.3c: "that player may
//      begin to cast that spell as though it had flash", unconditionally, at
//      any priority. The payment is not known yet.
//   2. `flashSurchargeRequired` — what is OWED. Mandatory when the cast relies
//      on that permission, and impossible when it doesn't (never a payable
//      {2} for nothing).
//
// The cost/commit half is driven the same way `buyback.test.ts` drives its
// own: the project has no convex-test harness for game.ts mutations (ADR
// 0001), so the REAL exported pieces `announceCast` uses —
// `assertFlashSurchargeDeclaration` (validation) and `finalizeTargetSelection`
// (the fold) — run over real GRE state, in the order the mutation would.

import { describe, it, expect } from "vitest";
import {
    castTimingBaseLegal,
    flashSurchargeRequired,
    getLegalActions,
} from "../rules";
import {
    assertFlashSurchargeDeclaration,
    finalizeTargetSelection,
} from "../../game";
import { getPlayer, type PendingTarget } from "../state";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { rout } from "../../cards/sets/inv/white";
import { ghituFire } from "../../cards/sets/inv/red";
import { twilightsCall } from "../../cards/sets/inv/black";
import { saprolingSymbiosis } from "../../cards/sets/inv/green";
import { braingeyser } from "../../cards/sets/lea/blue";
import { lightningBolt } from "../../cards/sets/lea/red";
import { plains } from "../../cards/sets/lea/colorless";
import { teferiTimeRaveler } from "../../cards/sets/war/multicolor";
import type { GameState } from "../state";

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

/** p1 holds Rout (surcharge rider), a plain Sorcery and an Instant. */
function frame(overrides: Partial<GameState> = {}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    handCard(rout.id, "rout1"),
                    handCard(braingeyser.id, "sorcery1"),
                    handCard(lightningBolt.id, "instant1"),
                ],
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    });
}

const routOf = (s: GameState) => s.players[0].hand[0];
const plainSorcery = (s: GameState) => s.players[0].hand[1];
const anInstant = (s: GameState) => s.players[0].hand[2];

/** p1's own sorcery-speed window. */
const ownWindow = () => frame({ activePlayerId: "p1", priorityPlayerId: "p1" });
/** p2's turn, p1 holding priority — outside p1's sorcery window. */
const offWindow = () => frame({ activePlayerId: "p2", priorityPlayerId: "p1" });

describe("the whole cycle declares the rider (CR 601.3c, issue #2146)", () => {
    it("every shipped Invasion card carrying the printed rider is announceable off-window and owes exactly {2}", () => {
        for (const def of [
            rout,
            ghituFire,
            twilightsCall,
            saprolingSymbiosis,
        ]) {
            expect(def.oracleText).toContain("as though it had flash");
            // Not a definition snapshot: each card is driven through the real
            // timing authority and the real surcharge predicate, on a board
            // where a plain Sorcery of the same colour is NOT castable.
            const off = makeState({
                players: [
                    makePlayer("p1", { hand: [handCard(def.id, "probe")] }),
                    makePlayer("p2"),
                ],
                phase: "PRECOMBAT_MAIN",
                activePlayerId: "p2",
                priorityPlayerId: "p1",
            });
            const card = off.players[0].hand[0];
            expect(castTimingBaseLegal(off, "p1", card)).toBe(true);
            expect(flashSurchargeRequired(off, "p1", card)).toBe(true);
            expect(def.flashSurcharge).toEqual({ X: 2 });
        }
    });
});

describe("castTimingBaseLegal — legal to ANNOUNCE (CR 601.3c)", () => {
    it("a rider card may BEGIN casting outside its controller's sorcery window; a plain Sorcery may not", () => {
        const off = offWindow();
        expect(castTimingBaseLegal(off, "p1", plainSorcery(off))).toBe(false);
        expect(castTimingBaseLegal(off, "p1", routOf(off))).toBe(true);
    });

    it("the permission is per-CARD, not per-player: it never widens the opponent's window or a sibling card's", () => {
        // p1's turn, p2 holding priority — p2 is outside their own window.
        const s = frame({ activePlayerId: "p1", priorityPlayerId: "p2" });
        expect(castTimingBaseLegal(s, "p2", routOf(s))).toBe(true);
        expect(castTimingBaseLegal(s, "p2", plainSorcery(s))).toBe(false);
    });

    it("a sorcery-speed LOCK beats the permission (CR 101.2 — a restriction overrides a permission)", () => {
        const off = offWindow();
        // Teferi, Time Raveler under p2: "Each opponent can cast spells only
        // any time they could cast a sorcery."
        off.players[1].battlefield.push(
            makeInstance(teferiTimeRaveler.id, {
                id: "teferi1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        expect(castTimingBaseLegal(off, "p1", routOf(off))).toBe(false);
        expect(castTimingBaseLegal(off, "p1", anInstant(off))).toBe(false);
    });
});

describe("flashSurchargeRequired — what is OWED (CR 601.3c)", () => {
    it("is owed outside the caster's sorcery window and NOT inside it (never a payable {2} for nothing)", () => {
        const off = offWindow();
        expect(flashSurchargeRequired(off, "p1", routOf(off))).toBe(true);
        const own = ownWindow();
        expect(flashSurchargeRequired(own, "p1", routOf(own))).toBe(false);
    });

    it("is never owed by a card that declares no surcharge, whatever the timing", () => {
        const off = offWindow();
        expect(flashSurchargeRequired(off, "p1", plainSorcery(off))).toBe(
            false
        );
        expect(flashSurchargeRequired(off, "p1", anInstant(off))).toBe(false);
    });

    it("is not owed when a live flash GRANT already opens the window — the permission is redundant", () => {
        const off = offWindow();
        expect(flashSurchargeRequired(off, "p1", routOf(off))).toBe(true);
        const granted: GameState = {
            ...off,
            castTimingFlashGrants: [{ playerId: "p1", cardTypes: ["Sorcery"] }],
        };
        expect(flashSurchargeRequired(granted, "p1", routOf(granted))).toBe(
            false
        );
        // The grant is per-player: p2 holds none, so p2 would still owe it.
        expect(flashSurchargeRequired(granted, "p2", routOf(granted))).toBe(
            true
        );
    });

    it("is not owed under a sorcery-speed lock — the surcharge cannot buy a window CR 101.2 has closed", () => {
        const off = offWindow();
        off.players[1].battlefield.push(
            makeInstance(teferiTimeRaveler.id, {
                id: "teferi1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        expect(castTimingBaseLegal(off, "p1", routOf(off))).toBe(false);
        expect(flashSurchargeRequired(off, "p1", routOf(off))).toBe(false);
    });
});

describe("announceCast declaration guard (CR 601.3c)", () => {
    it("rejects a client claiming the surcharge on a card that declares none", () => {
        expect(() =>
            assertFlashSurchargeDeclaration(braingeyser, true, false)
        ).toThrow();
        expect(() =>
            assertFlashSurchargeDeclaration(braingeyser, false, false)
        ).toThrow();
    });

    it("rejects an explicit DECLINE of a surcharge this cast actually owes", () => {
        expect(() =>
            assertFlashSurchargeDeclaration(rout, false, true)
        ).toThrow();
    });

    it("accepts an acknowledgement, and accepts an OMITTED flag either way (a non-UI caller still pays)", () => {
        expect(() =>
            assertFlashSurchargeDeclaration(rout, true, true)
        ).not.toThrow();
        expect(() =>
            assertFlashSurchargeDeclaration(rout, undefined, true)
        ).not.toThrow();
        expect(() =>
            assertFlashSurchargeDeclaration(rout, undefined, false)
        ).not.toThrow();
        // Claiming it when nothing is owed is benign, not an error: the client
        // read a projection taken before it clicked. Nothing is charged.
        expect(() =>
            assertFlashSurchargeDeclaration(rout, true, false)
        ).not.toThrow();
    });
});

/** p1 with `mana` white in pool and Rout in hand, at a board frame. */
function castFrame(mana: number, overrides: Partial<GameState> = {}) {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [handCard(rout.id, "rout1")],
                manaPool: { W: mana, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    });
}

const noTargetPt = (extra: Partial<PendingTarget> = {}): PendingTarget => ({
    playerId: "p1",
    cardInstanceId: "rout1",
    targetType: "any",
    count: 0,
    selected: [],
    ...extra,
});

describe("cost fold (CR 601.3c / 601.2f)", () => {
    it("folds the surcharge on top of the printed cost when the cast owes it", () => {
        // Rout {3}{W}{W} = 5, + the {2} surcharge = 7. White pays generic too.
        const state = castFrame(7, {
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        finalizeTargetSelection(
            state,
            noTargetPt({ flashSurchargePaid: true }),
            "p1"
        );
        expect(getPlayer(state, "p1").manaPool.W).toBe(0);
        expect(state.stack.find((s) => s.id === "rout1")).toBeDefined();
    });

    it("pays only the printed cost when the cast does not owe it", () => {
        const state = castFrame(7, {
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        finalizeTargetSelection(state, noTargetPt(), "p1");
        // {3}{W}{W} only → 2 white left over.
        expect(getPlayer(state, "p1").manaPool.W).toBe(2);
        expect(state.stack.find((s) => s.id === "rout1")).toBeDefined();
    });

    it("adds to an {X} cost rather than replacing it (Ghitu Fire, the shape an AlternativeCost cannot express)", () => {
        // Ghitu Fire {X}{R} with X = 3 is 4 mana; the surcharge makes it 6.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard(ghituFire.id, "ghitu1")],
                    manaPool: { W: 0, U: 0, B: 0, R: 6, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "ghitu1",
                targetType: "player",
                count: 1,
                selected: [{ type: "player", id: "p2" }],
                chosenX: 3,
                flashSurchargePaid: true,
            } as PendingTarget,
            "p1"
        );
        expect(getPlayer(state, "p1").manaPool.R).toBe(0);
    });
});

describe("CR 601.6a — a cast BEGUN under the permission finishes at the announced price", () => {
    // "Once a player has begun casting a spell that ... could be cast as though
    // it had flash because certain conditions were met, they may continue to
    // cast that spell as though it had flash even if those conditions stop
    // being met."
    it("the surcharge stays owed when the timing condition lapses between announcement and commit", () => {
        // Announced on the opponent's turn (surcharge owed, locked onto the
        // pendingTarget). By the time target selection finalizes, the board has
        // moved into p1's own sorcery window — a commit-time RE-DERIVATION
        // would decide nothing is owed and silently re-price the cast.
        const state = castFrame(7, {
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        const pt = noTargetPt({ flashSurchargePaid: true });
        expect(flashSurchargeRequired(state, "p1", routOf(state))).toBe(true);
        state.activePlayerId = "p1";
        expect(flashSurchargeRequired(state, "p1", routOf(state))).toBe(false);

        finalizeTargetSelection(state, pt, "p1");
        expect(getPlayer(state, "p1").manaPool.W).toBe(0);
    });

    it("and the converse: a cast begun at sorcery speed is never surcharged, even if the board reads off-timing at commit", () => {
        // Issue #2473's hazard, applied to the cost: activating a mana ability
        // is part of casting (CR 601.2g) and can leave a suspended triggered
        // mana ability on the stack, which makes `isSorceryTimingFor` false
        // mid-cast. The verdict was taken at announcement, so nothing changes.
        const state = castFrame(7, {
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const pt = noTargetPt();
        state.stack.push({
            ...handCard(lightningBolt.id, "onstack"),
            zone: "stack",
            castById: "p2",
        } as (typeof state.stack)[number]);
        expect(flashSurchargeRequired(state, "p1", routOf(state))).toBe(true);

        finalizeTargetSelection(state, pt, "p1");
        expect(getPlayer(state, "p1").manaPool.W).toBe(2);
    });
});

describe("affordability gate (CR 601.2f) — the cast is offered only at the surcharged price", () => {
    // A MANDATORY additional cost has to reach `getLegalActions`, unlike the
    // OPTIONAL Kicker/Buyback: with exactly the printed cost on board and no
    // way to make the {2}, an offered cast would park unpayable at the mana
    // step with no unsurcharged variant to fall back on.
    const withLands = (count: number, overrides: Partial<GameState>) => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [handCard(rout.id, "rout1")] }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
            ...overrides,
        });
        for (let i = 0; i < count; i++) {
            state.players[0].battlefield.push(
                makeInstance(plains.id, {
                    id: `plains${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                })
            );
        }
        return state;
    };

    it("five Plains cast Rout in the caster's own window but NOT off-window, where the {2} is owed", () => {
        const own = withLands(5, {
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(getLegalActions(own, own.players[0], routOf(own))).toContain(
            "cast"
        );

        const off = withLands(5, {
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        expect(getLegalActions(off, off.players[0], routOf(off))).not.toContain(
            "cast"
        );
    });

    it("seven Plains cast it off-window", () => {
        const off = withLands(7, {
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        expect(getLegalActions(off, off.players[0], routOf(off))).toContain(
            "cast"
        );
    });
});

describe("wire projection — the client's only view of the surcharge", () => {
    it("attaches flashSurchargeRequired to the caster's own hand card outside their sorcery window", () => {
        const state = castFrame(7, {
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand[0]!;
        expect(slim.legalActions).toContain("cast");
        expect(slim.flashSurchargeRequired).toBe(true);
    });

    it("omits it inside the caster's sorcery window, so the client never offers a pointless {2}", () => {
        const state = castFrame(7, {
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand[0]!;
        expect(slim.legalActions).toContain("cast");
        expect(slim.flashSurchargeRequired).toBeUndefined();
    });
});
