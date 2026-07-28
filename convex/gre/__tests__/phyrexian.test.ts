// Phyrexian mana cost system (CR 107.4f) — the engine capability that backs the
// New Phyrexia cube cluster (issue #696). A `{C/P}` pip is paid with either one
// mana of the colour OR 2 life, the caster's per-pip choice. These tests cover
// the shared cost-system pieces (representation, colour identity, mana value,
// affordability solver, and the `getLegalActions` cast gate) once; the per-card
// behaviour (Dismember, Gitaxian Probe, Phyrexian Metamorph) lives in the nph
// per-colour test files.
import { describe, it, expect } from "vitest";
import { manaValue } from "../constants";
import { getColorsFromCost } from "../../cards/colors";
import {
    PHYREXIAN_LIFE_PER_PIP,
    phyrexianManaAdditions,
    phyrexianPipColors,
    phyrexianPipCount,
} from "../phyrexian";
import {
    getLegalActions,
    phyrexianLifePipOptions,
    solvePhyrexianSplit,
} from "../rules";
import { dismember } from "../../cards/sets/nph/black";
import { gitaxianProbe, phyrexianMetamorph } from "../../cards/sets/nph/blue";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { ankhOfMishra, mountain } from "../../cards/sets/lea";
import { moxOpal } from "../../cards/sets/som";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { finalizeTargetSelection } from "../../game";
import type { PendingTarget } from "../state";

describe("Phyrexian mana — representation (CR 107.4f / 202.3f)", () => {
    it("counts each Phyrexian pip as 1 toward mana value (CR 202.3f)", () => {
        // Dismember {1}{B/P}{B/P} = 3, Gitaxian Probe {U/P} = 1,
        // Phyrexian Metamorph {3}{U/P} = 4.
        expect(manaValue(dismember.manaCost)).toBe(3);
        expect(manaValue(gitaxianProbe.manaCost)).toBe(1);
        expect(manaValue(phyrexianMetamorph.manaCost)).toBe(4);
    });

    it("derives colour identity from Phyrexian pips (CR 105.2)", () => {
        // A card is the colour of its Phyrexian symbol even when castable for
        // life: Dismember is black, the two blue cards are blue.
        expect(getColorsFromCost(dismember.manaCost)).toEqual(["B"]);
        expect(getColorsFromCost(gitaxianProbe.manaCost)).toEqual(["U"]);
        expect(getColorsFromCost(phyrexianMetamorph.manaCost)).toEqual(["U"]);
    });

    it("expands pips and splits mana-paid additions", () => {
        expect(phyrexianPipCount(dismember.manaCost)).toBe(2);
        expect(phyrexianPipColors(dismember.manaCost)).toEqual(["B", "B"]);
        // Paying 1 of the 2 {B/P} with life leaves one {B} to fold into mana.
        expect(phyrexianManaAdditions(dismember.manaCost, 1)).toEqual({ B: 1 });
        // Paying both with life folds no mana.
        expect(phyrexianManaAdditions(dismember.manaCost, 2)).toEqual({});
        // Paying zero with life folds both pips into mana.
        expect(phyrexianManaAdditions(dismember.manaCost, 0)).toEqual({ B: 2 });
        expect(PHYREXIAN_LIFE_PER_PIP).toBe(2);
    });
});

describe("Phyrexian mana — affordability split (CR 107.4f / 119.4)", () => {
    it("prefers the most-life split when the colour of mana is unavailable", () => {
        // Gitaxian Probe {U/P}, 20 life, no blue mana → pay the pip with 2 life.
        const card = makeInstance(gitaxianProbe.id, { zone: "hand" });
        const player = makePlayer("p1", { life: 20 });
        const split = solvePhyrexianSplit(
            player,
            card,
            gitaxianProbe.manaCost!
        );
        expect(split).toEqual({ lifePips: 1, manaAdditions: {} });
    });

    it("falls back to mana when life can't cover the pip (CR 119.4)", () => {
        // Gitaxian Probe {U/P}, 1 life (can't pay 2), but {U} in the pool → the
        // pip is paid with mana, 0 life.
        const card = makeInstance(gitaxianProbe.id, { zone: "hand" });
        const player = makePlayer("p1", {
            life: 1,
            manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
        });
        const split = solvePhyrexianSplit(
            player,
            card,
            gitaxianProbe.manaCost!
        );
        expect(split).toEqual({ lifePips: 0, manaAdditions: { U: 1 } });
    });

    it("returns null when neither life nor mana can pay a pip", () => {
        // Gitaxian Probe {U/P}, 1 life, no blue mana → uncastable.
        const card = makeInstance(gitaxianProbe.id, { zone: "hand" });
        const player = makePlayer("p1", { life: 1 });
        expect(
            solvePhyrexianSplit(player, card, gitaxianProbe.manaCost!)
        ).toBeNull();
    });

    it("still requires mana for the non-Phyrexian portion of the cost", () => {
        // Dismember {1}{B/P}{B/P}, 20 life, but NO mana at all → the {1} generic
        // can't be paid, so no split is affordable.
        const card = makeInstance(dismember.id, { zone: "hand" });
        const player = makePlayer("p1", { life: 20 });
        expect(
            solvePhyrexianSplit(player, card, dismember.manaCost!)
        ).toBeNull();
    });

    it("mixes mana and life when neither pure split is affordable", () => {
        // Dismember {1}{B/P}{B/P}, 2 life (covers one pip), pool {C}{B}: pay {1}
        // with {C}, one {B/P} with {B}, the other {B/P} with 2 life.
        const card = makeInstance(dismember.id, { zone: "hand" });
        const player = makePlayer("p1", {
            life: 2,
            manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 1 },
        });
        const split = solvePhyrexianSplit(player, card, dismember.manaCost!);
        expect(split).toEqual({ lifePips: 1, manaAdditions: { B: 1 } });
    });
});

describe("Phyrexian mana — getLegalActions cast gate (CR 107.4f)", () => {
    function handState(cardId: string, life: number, manaPool = {}) {
        const card = makeInstance(cardId, { zone: "hand", controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life,
                    hand: [card],
                    manaPool: {
                        W: 0,
                        U: 0,
                        B: 0,
                        R: 0,
                        G: 0,
                        C: 0,
                        ...manaPool,
                    },
                }),
                makePlayer("p2"),
            ],
        });
        return { state, card };
    }

    it("offers 'cast' for a pure-Phyrexian cost when life covers it", () => {
        const { state, card } = handState(gitaxianProbe.id, 20);
        expect(getLegalActions(state, state.players[0], card)).toContain(
            "cast"
        );
    });

    it("hides 'cast' when neither life nor the colour of mana can pay", () => {
        const { state, card } = handState(gitaxianProbe.id, 1);
        expect(getLegalActions(state, state.players[0], card)).not.toContain(
            "cast"
        );
    });

    it("offers 'cast' at low life when the colour of mana is available", () => {
        const { state, card } = handState(gitaxianProbe.id, 1, { U: 1 });
        expect(getLegalActions(state, state.players[0], card)).toContain(
            "cast"
        );
    });
});

// Issue #1751 finding 1 (blocking, live-probed): `canPotentiallyPayCost`'s
// Phyrexian branch (`phyrexianPipCount(rawCost) > 0`) called `solvePhyrexianSplit`
// with NO `state` at all, so every downstream `coloredCostLeftover` /
// `getProducibleManaUnits` probe it ran saw an empty board — a board-dependent
// mana ability (Mox Opal's Metalcraft) could never pay a Phyrexian pip,
// regardless of the real board. Reviewer's exact repro: Phyrexian Metamorph
// {3}{U/P}, life 1 (too little to pay the {U/P} pip's 2 life — `maxLifePips`
// = floor(1/2) = 0), board = Mox Opal + 2 Ankh of Mishra (Metalcraft
// satisfied: 3 artifacts) + 3 Mountains (cover the {3} generic, no {U}
// anywhere else). The {U/P} pip can ONLY be paid by Mox Opal's Metalcraft-
// gated any-colour ability, making this sensitive to a revert of the
// `state` threading fixed in `solvePhyrexianSplit(player, card, rawCost,
// undefined, state)`.
describe("Phyrexian mana — board threading into the Phyrexian branch (issue #1751 finding 1)", () => {
    function onBattlefield(defId: string, id: string) {
        return makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
    }

    it("Phyrexian Metamorph ({3}{U/P}) is castable at 1 life when only Mox Opal's Metalcraft ability can pay the {U/P} pip with mana", () => {
        const card = makeInstance(phyrexianMetamorph.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            life: 1,
            hand: [card],
            battlefield: [
                onBattlefield(moxOpal.id, "mox"),
                onBattlefield(ankhOfMishra.id, "ank1"),
                onBattlefield(ankhOfMishra.id, "ank2"),
                onBattlefield(mountain.id, "m1"),
                onBattlefield(mountain.id, "m2"),
                onBattlefield(mountain.id, "m3"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = makeState({ players: [player, makePlayer("p2")] });

        expect(getLegalActions(state, player, card)).toContain("cast");
    });

    it("is NOT castable at 1 life when Metalcraft is unsatisfied (only 1 artifact) — no other {U} source", () => {
        const card = makeInstance(phyrexianMetamorph.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            life: 1,
            hand: [card],
            battlefield: [
                onBattlefield(moxOpal.id, "mox"),
                onBattlefield(mountain.id, "m1"),
                onBattlefield(mountain.id, "m2"),
                onBattlefield(mountain.id, "m3"),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = makeState({ players: [player, makePlayer("p2")] });

        expect(getLegalActions(state, player, card)).not.toContain("cast");
    });
});

// Issue #1757 finding 2 — the SAME board-blind gap as finding 1 above, but on
// the REAL SERVER CAST PATH: `resolvePhyrexianCastPayment` (game.ts) called
// `solvePhyrexianSplit(player, card, rawCost, chosenX)` with NO `state` at
// all (the function didn't even have a `state` param). Board-blind, so a
// Mox-Opal-funded split comes back `null` from `solvePhyrexianSplit`, and
// `resolvePhyrexianCastPayment` falls into its `else` branch (`lifePips =
// totalPips`) — defaulting to an ALL-LIFE payment the caster's life total
// (CR 119.4) can't cover. The gate (`getLegalActions`, board-aware since
// #1751 finding 1) had legally offered "cast" — so the cast the gate offered
// would THROW ("Cannot pay more life than you have") at commit, through the
// exact real entry point `announceCast`'s targeted branch uses
// (`finalizeTargetSelection`, mirrors `storm-cast-count-repro.test.ts`'s and
// `delveCastCost.test.ts`'s targeted-cast precedents).
describe("Phyrexian mana — board threading into the REAL cast-commit path (issue #1757 finding 2)", () => {
    it("Gitaxian Probe ({U/P}) at 1 life, Mox Opal (Metalcraft satisfied): finalizeTargetSelection completes the cast instead of throwing the CR 119.4 life check", () => {
        const card = makeInstance(gitaxianProbe.id, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            life: 1,
            hand: [card],
            battlefield: [
                makeInstance(moxOpal.id, {
                    id: "mox",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
                makeInstance(ankhOfMishra.id, {
                    id: "ank1",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
                makeInstance(ankhOfMishra.id, {
                    id: "ank2",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        // Mimic announceCast having entered target selection for the cast
        // (Gitaxian Probe targets a player) — no `phyrexianLifePips` chosen,
        // so `resolvePhyrexianCastPayment` takes the auto-resolve branch this
        // fix targets.
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "probe",
            targetType: "player",
            count: 1,
            selected: [{ type: "player", id: "p2" }],
        };
        state.pendingTarget = pt;

        expect(() => finalizeTargetSelection(state, pt, "p1")).not.toThrow();

        // Board-blind, `resolvePhyrexianCastPayment` would have thrown
        // "Cannot pay more life than you have" INSIDE this call (payLife = 2
        // > life = 1) before ever reaching the mana-payment code below — so
        // the `not.toThrow()` above is already the fix's core assertion.
        // Board-aware, the split resolves to the MANA leg (Mox Opal pays the
        // {U/P} pip): the parked cast owes `{ U: 1 }` mana and NO life at
        // all — `payLife` is entirely absent from `pendingCast` (folded in
        // only when > 0) — and the caster's life is untouched. Mox Opal
        // itself isn't pre-tapped into the pool, so the cast parks on
        // `pendingCast` here rather than reaching the stack immediately
        // (mirrors every other un-autotapped board-mana cast in this suite);
        // the life-safety property this fix protects is fully proven by the
        // no-throw + zero-life-cost assertions.
        expect(state.pendingCast).toBeDefined();
        expect(state.pendingCast?.manaCost).toEqual({ U: 1 });
        expect(state.pendingCast?.payLife).toBeUndefined();
        expect(player.life).toBe(1);
    });
});

describe("Phyrexian mana — split OPTIONS for the picker (CR 107.4f)", () => {
    it("returns every affordable lifePips value (a real branch)", () => {
        // Gitaxian Probe {U/P}, {U} in pool + 20 life → pay {U} (0) OR 2 life (1).
        const probe = makeInstance(gitaxianProbe.id, { zone: "hand" });
        const withU = makePlayer("p1", {
            life: 20,
            manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
        });
        expect(
            phyrexianLifePipOptions(withU, probe, gitaxianProbe.manaCost!)
        ).toEqual([0, 1]);
        // Dismember {1}{B/P}{B/P}, {B}{B}{B} in pool + 20 life → 0, 1, or 2 pips
        // with life.
        const dis = makeInstance(dismember.id, { zone: "hand" });
        const withBBB = makePlayer("p1", {
            life: 20,
            manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
        });
        expect(
            phyrexianLifePipOptions(withBBB, dis, dismember.manaCost!)
        ).toEqual([0, 1, 2]);
    });

    it("collapses to a single option in a degenerate (zero-branch) case", () => {
        // Gitaxian Probe {U/P}, no blue mana, 20 life → only "pay 2 life" (1).
        const probe = makeInstance(gitaxianProbe.id, { zone: "hand" });
        const noU = makePlayer("p1", { life: 20 });
        expect(
            phyrexianLifePipOptions(noU, probe, gitaxianProbe.manaCost!)
        ).toEqual([1]);
    });
});

describe("Phyrexian mana — split picker surfaces through projection (CR 107.4f)", () => {
    // The picker decision is server-authoritative and reaches the client ONLY
    // through `projectPublicState` (the reducer). A hand-built view would mask a
    // dropped field, so these SURFACE assertions run through the projection.
    function handState(
        cardId: string,
        manaPool: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>>
    ) {
        const card = makeInstance(cardId, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A creature so Dismember (target creature) is castable.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    hand: [card],
                    manaPool: {
                        W: 0,
                        U: 0,
                        B: 0,
                        R: 0,
                        G: 0,
                        C: 0,
                        ...manaPool,
                    },
                }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, cardId: card.id };
    }

    it("exposes phyrexianOptions when both mana and life are affordable", () => {
        const { state, cardId } = handState(dismember.id, { B: 3 });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand.find((c) => c?.id === cardId);
        expect(slim?.phyrexianOptions).toEqual([0, 1, 2]);
    });

    it("omits phyrexianOptions in a degenerate (life-only) case — no prompt", () => {
        // Gitaxian Probe with no blue mana: only "pay 2 life" is viable, so the
        // client must NOT prompt (the engine auto-resolves).
        const { state, cardId } = handState(gitaxianProbe.id, {});
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand.find((c) => c?.id === cardId);
        expect(slim?.phyrexianOptions).toBeUndefined();
    });

    // Additional board-blind holdout found while verifying issue #1757
    // finding 3 (not one of the reviewer's 5 named findings, same bug class):
    // `projectPublicState` called `phyrexianLifePipOptions(player, card,
    // rawCost)` with NO `state` — the picker's affordability probe couldn't
    // see a board-dependent mana source, so a real mana-vs-life branch could
    // silently collapse to a single (life-only) option and the picker would
    // never surface to the client, even though the mana leg was genuinely
    // choosable.
    it("exposes BOTH branches when a board-dependent mana source (Mox Opal, Metalcraft) funds the mana leg (issue #1757)", () => {
        const card = makeInstance(gitaxianProbe.id, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 4, // affords the life leg (2 life) with room to spare
                    hand: [card],
                    battlefield: [
                        makeInstance(moxOpal.id, {
                            id: "mox",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(ankhOfMishra.id, {
                            id: "ank1",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(ankhOfMishra.id, {
                            id: "ank2",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });

        // Board-aware: Mox Opal (Metalcraft satisfied) funds the mana leg
        // (lifePips 0) AND life covers the life leg (lifePips 1) — a REAL
        // two-branch choice the client must prompt for.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand.find((c) => c?.id === card.id);
        expect(slim?.phyrexianOptions).toEqual([0, 1]);
    });
});
