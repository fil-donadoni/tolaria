// war — black card BOT-suite tests (issue #2398, Bolas's Citadel).
//
// The move ENUMERATOR (`convex/gre/moves`) is a bot-only module, so these
// assertions have to live in a `.bot.test.ts` file
// (`scripts/__tests__/bot-suite-boundary.test.ts`). Everything else about the
// card is covered in the app-suite sibling `black.test.ts`.
//
// The failure this guards is the one #2398's own recon named: `getLegalActions`
// can be perfectly right about a library-top cast while the bot never sees it,
// because the enumerator's candidate SET only ever contained the hand (plus,
// since #1190, graveyard/library LANDS). A shipped-inert engine is the exact
// shape a green server-side suite hides.

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../../../../gre/moves";
import { applyMoveForSearch } from "../../../../gre/applyMove";
import { getPlayer } from "../../../../gre/state";
import { makeInstance } from "../../../__tests__/setup";
import { citadelBoard } from "./citadelBoard";
import { grizzlyBears } from "../../lea/green";
import { forest } from "../../lea/colorless";
import { fireball } from "../../lea/red";

describe("Bolas's Citadel — bot move enumeration (CR 601.3)", () => {
    it("enumerates the library-top cast, priced in LIFE rather than mana", () => {
        const state = citadelBoard([grizzlyBears.id]);
        const moves = enumerateMoves(state, "p1");
        const cast = moves.find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "p1-lib-0"
        );
        expect(cast).toBeDefined();
        expect(cast!.kind === "cast-spell" && cast!.payLife).toBe(2);
        // No mana is owed, so no lands are tapped for it (CR 118.9-analog).
        expect(cast!.kind === "cast-spell" && cast!.tapPlan).toEqual([]);
    });

    it("CR 107.3b — an {X} spell off the top is enumerated at exactly X = 0, the one value announceCast accepts", () => {
        // The Move's `chosenX` is what the driver forwards to `announceCast`,
        // and the two derive `hasX` from DIFFERENT costs: the enumerator from
        // the REPLACED cost (`{}`, no X at all), the mutation from the PRINTED
        // one. Left as `undefined` that is a latent #2283/#2284-class
        // divergence — a Move the server can reject. Pinned to the single
        // legal value instead (issue #2398 review round 1, finding 5).
        const state = citadelBoard([fireball.id]);
        const moves = enumerateMoves(state, "p1");
        const casts = moves.filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "p1-lib-0"
        );
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.kind === "cast-spell" && cast.chosenX).toBe(0);
            // CR 202.3e — X is 0 off the stack, so {X}{R} costs 1 life.
            expect(cast.kind === "cast-spell" && cast.payLife).toBe(1);
        }
    });

    it("enumerates NO library cast without the permission — the top card is not a candidate at all", () => {
        // The regression this pins: `getLegalActions`' final "cast is for all
        // non-land cards" fallback is zone-BLIND (only its land branch scopes
        // itself to a zone), so an unpermissioned library card reports "cast"
        // for its printed mana cost. Feeding the library into the enumerator
        // without gating on the permission first therefore produced a move
        // `locateCastSource` refuses to resolve — surfacing as a self-play
        // `search-error`, not as an illegal cast.
        // The board deliberately CAN pay Grizzly Bears' printed {1}{G}: with
        // no untapped Forests the enumerator drops the cast for want of mana
        // and the case would pass vacuously, proving nothing about the gate.
        const state = citadelBoard([grizzlyBears.id], false, {
            battlefield: [
                makeInstance(forest.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                    id: "forest-0",
                }),
                makeInstance(forest.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                    id: "forest-1",
                }),
            ],
        });
        const moves = enumerateMoves(state, "p1");
        expect(
            moves.some(
                (m) =>
                    m.kind === "cast-spell" && m.cardInstanceId === "p1-lib-0"
            )
        ).toBe(false);
    });

    it("does NOT enumerate the cast when the life total can't cover it (CR 119.4)", () => {
        const state = citadelBoard([grizzlyBears.id], true, { life: 1 });
        const moves = enumerateMoves(state, "p1");
        expect(
            moves.some(
                (m) =>
                    m.kind === "cast-spell" && m.cardInstanceId === "p1-lib-0"
            )
        ).toBe(false);
    });

    it("does NOT enumerate a library CAST for a top LAND (CR 305.9 — that is a play-land move)", () => {
        const state = citadelBoard([forest.id]);
        const moves = enumerateMoves(state, "p1");
        expect(
            moves.some(
                (m) =>
                    m.kind === "cast-spell" && m.cardInstanceId === "p1-lib-0"
            )
        ).toBe(false);
        expect(
            moves.some(
                (m) => m.kind === "play-land" && m.cardInstanceId === "p1-lib-0"
            )
        ).toBe(true);
    });

    it("applyMoveForSearch executes the cast off the LIBRARY (never 'not found in hand'), life paid", () => {
        const state = citadelBoard([grizzlyBears.id]);
        const moves = enumerateMoves(state, "p1");
        const cast = moves.find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "p1-lib-0"
        )!;
        const next = applyMoveForSearch(state, "p1", cast);
        const p1 = getPlayer(next, "p1");
        // The search leaf pushes AND resolves in one step, so the Bears land
        // on the battlefield rather than sitting on the stack.
        expect(p1.library).toHaveLength(0);
        expect(p1.battlefield.some((c) => c.id === "p1-lib-0")).toBe(true);
        expect(p1.life).toBe(18);
    });
});
