// Zero-output mana sources are not payment sources (CR 605.1a / 106.1, issue
// #1889).
//
// A mana ability whose CURRENT output is zero — Everflowing Chalice with no
// charge counters, an empty Gaea's Cradle, the Urza trio one piece short — used
// to be offered as a payable mana source to both the auto-tap solver and the
// human UI. The bot tapped the 0-counter Chalice, gained nothing, failed to pay,
// and abandoned the cast, over and over.
//
// Two levels are pinned here, in the idiom of the two already-fixed siblings:
//   - the OPTION list (`getManaTapOptionsDetailed`) drops a zero-output option,
//     which is what the auto-tap solver (`buildAutoTapSources`) and the tap
//     mutations read — the #947 (Chrome Mox `canActivate`) level;
//   - the coarse mana PROXY (`hasManaAbility` / `isUntappedManaSource`) becomes
//     board-aware, with a delta of EXACTLY ZERO for any source with no
//     board-conditional `manaAmount` hook — the #1499 (fetchland) discipline.

import { describe, it, expect } from "vitest";
import {
    getEffectiveManaChoices,
    getManaTapOptions,
    getManaTapOptionsDetailed,
    hasManaAbility,
    isUntappedManaSource,
} from "../constants";
import { buildAutoTapSources, solveSmartAutoTap } from "../autoTap";
import { tapSourceIntoPayment, tryAutoCommitPendingCast } from "../../game";
import { getManaSubstitutions, type PendingCast } from "../state";
import { projectPublicState } from "../../gameProjections";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { everflowingChalice } from "../../cards/sets/wwk";
import { icatianStore } from "../../cards/sets/fem";
import { mountain, forest } from "../../cards/sets/lea";
import { solRing } from "../../cards/sets/lea";

const FIREBALL = "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece"; // {X}{R}

/** Everflowing Chalice with `charge` counters on the battlefield. */
function chalice(charge: number): CardInstanceState {
    return makeInstance(everflowingChalice.id, {
        id: `chalice-${charge}`,
        controllerId: "p1",
        counters: charge > 0 ? { charge } : {},
    });
}

const bf = (state: GameState) =>
    state.players.map((p) => ({ playerId: p.id, battlefield: p.battlefield }));

describe("getManaTapOptionsDetailed drops a zero-output option (CR 605.1a, issue #1889)", () => {
    it("a 0-counter Everflowing Chalice exposes NO mana-tap option", () => {
        const c = chalice(0);
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [c] }), makePlayer("p2")],
        });
        expect(getManaTapOptionsDetailed(c, "p1", bf(state))).toEqual([]);
        expect(getManaTapOptions(c, "p1", bf(state))).toEqual([]);
    });

    it("a 2-counter Everflowing Chalice exposes exactly one option, {C}{C}", () => {
        const c = chalice(2);
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [c] }), makePlayer("p2")],
        });
        const options = getManaTapOptionsDetailed(c, "p1", bf(state));
        expect(options).toHaveLength(1);
        expect(options[0].mana).toEqual({ C: 2 });
    });

    it("board-blind callers (no battlefields) keep the static snapshot — delta zero", () => {
        // With no board, the static `manaProduced` ({C}1) is the only answer
        // available; the pre-#1889 behaviour is preserved exactly.
        expect(getManaTapOptions(chalice(0))).toEqual([{ C: 1 }]);
    });

    it("ordinary sources are untouched (delta zero)", () => {
        const m = makeInstance(mountain.id, { controllerId: "p1" });
        const ring = makeInstance(solRing.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [m, ring] }),
                makePlayer("p2"),
            ],
        });
        expect(getManaTapOptions(m, "p1", bf(state))).toEqual([{ R: 1 }]);
        expect(getManaTapOptions(ring, "p1", bf(state))).toEqual([{ C: 2 }]);
    });
});

// REGRESSION GUARD for the index shift the first cut of #1889 introduced: the
// zero-output drop was applied to the CHOICE branch too, which silently deleted
// a storage land's index-0 "remove 0 counters" entry and shifted every later
// index by one — `tapSourceIntoPayment(…, 3)` then removed 4 counters, and the
// unified list stopped agreeing with `getEffectiveManaChoices` (which keeps the
// entry), giving one tap ability two index spaces. The drop is confined to the
// FIXED-output branch; a chooser keeps every entry.
describe("a choice list keeps its zero-output entry — index space is load-bearing (CR 605.1a, issue #1889)", () => {
    /** Icatian Store with `storage` counters: "{T}, Remove any number of
     *  storage counters: Add {W} for each counter removed" → choices [0..N]. */
    function store(storage: number): CardInstanceState {
        return makeInstance(icatianStore.id, {
            id: "store",
            controllerId: "p1",
            counters: { storage },
        });
    }

    it("exposes the full 0..N ladder, index 0 = 'remove 0 counters'", () => {
        const land = store(3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        expect(getManaTapOptions(land, "p1", bf(state))).toEqual([
            { W: 0 },
            { W: 1 },
            { W: 2 },
            { W: 3 },
        ]);
    });

    it("getManaTapOptions and getEffectiveManaChoices are INDEX-IDENTICAL", () => {
        for (const storage of [0, 1, 2, 4]) {
            const land = store(storage);
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land] }),
                    makePlayer("p2"),
                ],
            });
            const unified = getManaTapOptions(land, "p1", bf(state));
            const effective = getEffectiveManaChoices(land, "p1", bf(state));
            expect(effective).toEqual(unified);
            expect(unified).toHaveLength(storage + 1);
        }
    });

    it("each option's ability-local choiceIndex equals its unified index", () => {
        const land = store(3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        const detailed = getManaTapOptionsDetailed(land, "p1", bf(state));
        detailed.forEach((opt, i) => {
            expect(opt.source).toEqual({
                kind: "activated",
                abilityId: expect.any(String),
                choiceIndex: i,
            });
        });
    });

    it("full path — picking unified index 3 removes exactly 3 counters", () => {
        const land = store(4);
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, land, 3, []);
        expect(player.manaPool.W).toBe(3);
        expect(land.counters?.storage).toBe(1);
    });

    it("full path — picking unified index 0 removes nothing and adds nothing", () => {
        const land = store(2);
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, land, 0, []);
        expect(player.manaPool.W ?? 0).toBe(0);
        expect(land.counters?.storage).toBe(2);
    });
});

describe("isUntappedManaSource / hasManaAbility are board-aware (CR 106.1, issue #1889)", () => {
    it("a 0-counter Chalice is NOT an untapped mana source when the board is supplied", () => {
        const c = chalice(0);
        const battlefield = [c];
        expect(isUntappedManaSource(c, battlefield)).toBe(false);
        expect(hasManaAbility(c, undefined, battlefield)).toBe(false);
    });

    it("a 2-counter Chalice IS an untapped mana source", () => {
        const c = chalice(2);
        const battlefield = [c];
        expect(isUntappedManaSource(c, battlefield)).toBe(true);
        expect(hasManaAbility(c, undefined, battlefield)).toBe(true);
    });

    it("omitting the board leaves the predicate exactly as before", () => {
        expect(isUntappedManaSource(chalice(0))).toBe(true);
    });

    it("delta is EXACTLY ZERO for sources with no manaAmount hook", () => {
        const sources = [
            makeInstance(mountain.id, { controllerId: "p1" }),
            makeInstance(forest.id, { controllerId: "p1" }),
            makeInstance(solRing.id, { controllerId: "p1" }),
        ];
        for (const s of sources) {
            expect(isUntappedManaSource(s, sources)).toBe(
                isUntappedManaSource(s)
            );
            expect(isUntappedManaSource(s, sources)).toBe(true);
        }
    });

    it("a tapped 2-counter Chalice is still not an available source", () => {
        const c = chalice(2);
        c.isTapped = true;
        expect(isUntappedManaSource(c, [c])).toBe(false);
    });
});

/** Replicates the `autoTapForPayment` mutation body over real GRE primitives. */
function runAutoTap(state: GameState, player: PlayerState): boolean {
    const pending = state.pendingCast!;
    const substitutions = getManaSubstitutions(state, player.id);
    const sources = buildAutoTapSources(player.battlefield);
    const plan =
        solveSmartAutoTap(
            player.manaPool,
            pending.manaCost,
            substitutions,
            sources
        ) ?? [];
    for (const step of plan) {
        const card = player.battlefield.find((c) => c.id === step.cardId);
        if (!card) continue;
        tapSourceIntoPayment(
            state,
            player,
            card,
            step.manaChoiceIndex,
            pending.tappedLandIds
        );
    }
    return tryAutoCommitPendingCast(state, player.id) !== null;
}

describe("auto-tap never taps a zero-output source (issue #1889)", () => {
    it("pays {1}{R} with the two Mountains and leaves the 0-counter Chalice untapped", () => {
        const cast = makeInstance(FIREBALL, {
            id: "fb",
            controllerId: "p1",
            zone: "hand",
        });
        const c = chalice(0);
        const lands = [
            makeInstance(mountain.id, { id: "m1", controllerId: "p1" }),
            makeInstance(mountain.id, { id: "m2", controllerId: "p1" }),
        ];
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "fb",
            // Fireball with X=1 → {1}{R}: two mana total.
            manaCost: { R: 1, X: 1 },
            tappedLandIds: [],
            chosenX: 1,
        };
        const p1 = makePlayer("p1", {
            hand: [cast],
            battlefield: [c, ...lands],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            pendingCast,
        });

        const committed = runAutoTap(state, state.players[0]);

        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();
        expect(lands.every((l) => l.isTapped)).toBe(true);
        // The Chalice adds nothing, so the solver must never have picked it.
        expect(c.isTapped).toBeFalsy();
    });

    it("buildAutoTapSources skips the 0-counter Chalice entirely", () => {
        const c = chalice(0);
        const m = makeInstance(mountain.id, { id: "m1", controllerId: "p1" });
        const sources = buildAutoTapSources([c, m]);
        expect(sources.map((s) => s.cardId)).toEqual(["m1"]);
    });
});

describe("wire format — the same answer survives projectPublicState (issue #1889)", () => {
    it("a 0-counter Chalice offers no tap option and is no mana source after projection", () => {
        const zero = chalice(0);
        const two = chalice(2);
        two.id = "chalice-two";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [zero, two] }),
                makePlayer("p2"),
            ],
        });

        // Fat state.
        expect(getManaTapOptionsDetailed(zero, "p1", bf(state))).toEqual([]);
        expect(isUntappedManaSource(zero, state.players[0].battlefield)).toBe(
            false
        );
        expect(isUntappedManaSource(two, state.players[0].battlefield)).toBe(
            true
        );

        // Projected (wire) state — the projection strips `card.card` to `{ id }`
        // and reshapes zones; the charge counters the `manaAmount` hook reads
        // must survive it or the client answers differently from the server.
        const projected = projectPublicState(state, 1, "p1");
        const pBattlefield = projected.players[0]
            .battlefield as unknown as CardInstanceState[];
        const pZero = pBattlefield.find((c) => c.id === zero.id)!;
        const pTwo = pBattlefield.find((c) => c.id === two.id)!;

        expect(pZero.counters?.charge ?? 0).toBe(0);
        expect(pTwo.counters?.charge).toBe(2);
        expect(
            getManaTapOptionsDetailed(pZero, "p1", [
                { playerId: "p1", battlefield: pBattlefield },
            ])
        ).toEqual([]);
        expect(isUntappedManaSource(pZero, pBattlefield)).toBe(false);
        expect(isUntappedManaSource(pTwo, pBattlefield)).toBe(true);
    });
});
