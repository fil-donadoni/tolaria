// JUD (Judgment) — blue behavior tests (ADR 0043 colour split).
//
// Flash of Insight ({X}{1}{U} Instant) uses the already-censused `digToHand` Op
// (CR 401.4, issue #984) with `look: { X: true }` for its main effect — the Op
// itself is exercised by the interpreter suite, so these tests focus on what is
// NEW: the FLASHBACK-only additional cost "Exile X blue cards from your
// graveyard" (CR 702.34a / 118.5), a cast-path cost-system capability. Covered
// here across the whole GRE → game.ts → wire path:
//   - the card definition (manaCost, flashback cost, effect script, cost spec)
//   - `look: { X: true }` drives the look count off chosenX (main effect)
//   - the cast-commit seam (`tryAutoCommitPendingCast`): the picked blue cards
//     move graveyard → exile, the spell lands on the stack with chosenX + the
//     flashback flags, and commit is BLOCKED until the picks are in
//   - the pick validator (`recordCastExileCostPick`): count / colour / own-
//     graveyard / exclude-self / duplicate rules (CR 702.34e)
//   - a full flashback resolve: `resolveTopOfStack` drives the look-top keep and
//     `exileOnResolve` sends Flash of Insight to exile, not the graveyard
//   - the frontend wiring SURFACE: `projectPublicState` carries the picker +
//     its candidate blue cards to the viewer (the dialog reads them)
//   - a serialization round-trip of the new `pendingCast.exileFromGraveyardChoice`
import { describe, it, expect } from "vitest";
import { flashOfInsight } from "../blue";
import { snapcasterMage } from "../../isd/blue";
import { grizzlyBears } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    getPlayer,
    type GameState,
    type CardInstanceState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    tryAutoCommitPendingCast,
    recordCastExileCostPick,
} from "../../../../game";
import { compactState, expandState } from "../../../../gre/serialize";
import { projectPublicState } from "../../../../gameProjections";

const FOI = flashOfInsight.id;
const BLUE = snapcasterMage.id; // {1}{U} — a blue card (CR 105.2)
const GREEN = grizzlyBears.id; // {1}{G} — a non-blue card

// A blue card sitting in p1's graveyard, eligible to pay the exile cost.
const blueGy = (id: string): CardInstanceState =>
    makeInstance(BLUE, {
        id,
        zone: "graveyard",
        controllerId: "p1",
        ownerId: "p1",
    });

/** State with Flash of Insight in p1's graveyard ready to flash back, three
 *  blue cards to pay the exile cost, one green (ineligible) card, a library to
 *  dig into, and a pool that covers {1}{U}. `pick` seeds the picked exile cards
 *  (undefined = picker still open). */
function flashbackState(pick?: string[]): {
    state: GameState;
    foiId: string;
} {
    const foi = makeInstance(FOI, {
        id: "foi",
        zone: "graveyard",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                graveyard: [
                    foi,
                    blueGy("blue1"),
                    blueGy("blue2"),
                    blueGy("blue3"),
                    makeInstance(GREEN, {
                        id: "green1",
                        zone: "graveyard",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                library: ["lib1", "lib2", "lib3"].map((id) =>
                    makeInstance(GREEN, {
                        id,
                        zone: "library",
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
                manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 },
            }),
            makePlayer("p2"),
        ],
        priorityPlayerId: "p1",
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "foi",
            // {1}{U} normalized: generic 1 folds into the "X" key.
            manaCost: { U: 1, X: 1 },
            tappedLandIds: [],
            chosenX: 2,
            exileFromGraveyardChoice: {
                count: 2,
                color: "U",
                excludeInstanceId: "foi",
                ...(pick ? { pickedCardIds: pick } : {}),
            },
        },
    });
    return { state, foiId: "foi" };
}

describe("Flash of Insight (JUD 40) — dig + flashback exile cost", () => {
    it("is an {X}{1}{U} Instant with a {1}{U} flashback + blue-exile cost", () => {
        expect(flashOfInsight.manaCost).toEqual({ X: "X", generic: 1, U: 1 });
        expect(flashOfInsight.types).toEqual(["Instant"]);
        expect(flashOfInsight.flashback).toEqual({ U: 1, generic: 1 });
        expect(
            flashOfInsight.additionalCosts?.flashbackExileFromGraveyard
        ).toEqual({ color: "U" });
        // The main effect is the shared digToHand Op with an X-driven look.
        expect(flashOfInsight.effects).toEqual([
            {
                op: "digToHand",
                player: "controller",
                look: { X: true },
                take: 1,
            },
        ]);
    });

    it("main effect: look: { X: true } looks at chosenX cards (CR 401.4 / 107.3)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: ["a", "b", "c", "d"].map((id) =>
                        makeInstance(GREEN, {
                            id,
                            zone: "library",
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                }),
                makePlayer("p2"),
            ],
        });
        const item = {
            ...makeInstance(FOI, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
            castById: "p1",
            targets: [],
            chosenX: 2,
        };
        state.stack.push(item);

        // Suspends on a look-top pick over exactly the top X (= 2) cards.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-top");
        expect(head.candidateIds).toEqual(["a", "b"]);

        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a"],
        });
        // "a" to hand; "b" bottomed under the untouched c, d.
        expect(getPlayer(state, "p1").hand.map((c) => c.id)).toContain("a");
        expect(getPlayer(state, "p1").library.map((c) => c.id)).toEqual([
            "c",
            "d",
            "b",
        ]);
    });

    describe("flashback exile cost (CR 702.34a / 118.5)", () => {
        it("commit exiles the picked blue cards and casts Flash of Insight from the graveyard", () => {
            const { state } = flashbackState(["blue1", "blue2"]);
            const result = tryAutoCommitPendingCast(state, "p1");
            expect(result).not.toBeNull();

            const p1 = getPlayer(state, "p1");
            // The two picked blue cards moved graveyard → exile.
            expect(p1.exile.map((c) => c.id).sort()).toEqual([
                "blue1",
                "blue2",
            ]);
            expect(p1.graveyard.map((c) => c.id)).not.toContain("blue1");
            // Untouched blue3 + the green card stay in the graveyard.
            expect(p1.graveyard.map((c) => c.id)).toEqual(
                expect.arrayContaining(["blue3", "green1"])
            );
            // Flash of Insight is now on the stack, flagged as a flashback cast.
            const top = state.stack[state.stack.length - 1];
            expect((top.card as { id: string }).id).toBe(FOI);
            expect(top.chosenX).toBe(2);
            expect(top.castFromGraveyard).toBe(true);
            expect(top.exileOnResolve).toBe(true);
            expect(p1.graveyard.map((c) => c.id)).not.toContain("foi");
        });

        it("commit is BLOCKED until the exile picks are in (CR 601.2f)", () => {
            const { state } = flashbackState(); // picker still open
            expect(tryAutoCommitPendingCast(state, "p1")).toBeNull();
            const p1 = getPlayer(state, "p1");
            // Nothing paid, nothing cast.
            expect(p1.exile).toHaveLength(0);
            expect(p1.graveyard.map((c) => c.id)).toContain("foi");
            expect(state.stack).toHaveLength(0);
            expect(state.pendingCast).toBeDefined();
        });

        it("full flashback resolve: one card to hand, rest bottomed, Flash of Insight exiled", () => {
            const { state } = flashbackState(["blue1", "blue2"]);
            tryAutoCommitPendingCast(state, "p1");

            // Resolve the flashback cast: digToHand suspends on the look-top pick.
            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("look-top");
            expect(head.candidateIds).toEqual(["lib1", "lib2"]); // top X = 2
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["lib1"],
            });

            const p1 = getPlayer(state, "p1");
            expect(p1.hand.map((c) => c.id)).toContain("lib1");
            // lib2 bottomed under the untouched lib3.
            expect(p1.library.map((c) => c.id)).toEqual(["lib3", "lib2"]);
            // CR 702.34a — the flashback card is exiled on resolution, not
            // returned to the graveyard.
            expect(p1.exile.map((c) => c.id)).toContain("foi");
            expect(p1.graveyard.map((c) => c.id)).not.toContain("foi");
        });
    });

    describe("recordCastExileCostPick validation (CR 702.34e / 118.5)", () => {
        it("records a legal pick of blue cards from your own graveyard", () => {
            const { state } = flashbackState();
            recordCastExileCostPick(state, "p1", ["blue1", "blue3"]);
            expect(
                state.pendingCast!.exileFromGraveyardChoice!.pickedCardIds
            ).toEqual(["blue1", "blue3"]);
        });

        it("rejects the wrong number of cards", () => {
            const { state } = flashbackState();
            expect(() =>
                recordCastExileCostPick(state, "p1", ["blue1"])
            ).toThrow(/exactly 2/);
        });

        it("rejects exiling Flash of Insight to pay for its own cost (CR 702.34e)", () => {
            const { state } = flashbackState();
            expect(() =>
                recordCastExileCostPick(state, "p1", ["foi", "blue1"])
            ).toThrow(/flashback card itself/);
        });

        it("rejects a non-blue card (CR 105.2 colour filter)", () => {
            const { state } = flashbackState();
            expect(() =>
                recordCastExileCostPick(state, "p1", ["blue1", "green1"])
            ).toThrow(/does not match/);
        });

        it("rejects a card not in your graveyard", () => {
            const { state } = flashbackState();
            expect(() =>
                recordCastExileCostPick(state, "p1", ["blue1", "ghost"])
            ).toThrow(/not in your graveyard/);
        });

        it("rejects duplicate picks", () => {
            const { state } = flashbackState();
            expect(() =>
                recordCastExileCostPick(state, "p1", ["blue1", "blue1"])
            ).toThrow(/[Dd]uplicate/);
        });
    });

    describe("frontend wiring + persistence", () => {
        it("projectPublicState carries the picker + candidate blue cards to the viewer", () => {
            const { state } = flashbackState();
            const projected = projectPublicState(state, 1, "p1");
            const pc = projected.pendingCast;
            expect(pc?.exileFromGraveyardChoice).toEqual({
                count: 2,
                color: "U",
                excludeInstanceId: "foi",
            });
            // The blue candidates are visible in the viewer's own graveyard so
            // the dialog can render them.
            const gyIds = projected.players[0].graveyard.map((c) => c.id);
            expect(gyIds).toEqual(
                expect.arrayContaining(["blue1", "blue2", "blue3"])
            );
        });

        it("survives a serialization round-trip (schema drift guard)", () => {
            const { state } = flashbackState(["blue1", "blue2"]);
            const round = expandState(compactState(state));
            expect(round.pendingCast?.exileFromGraveyardChoice).toEqual({
                count: 2,
                color: "U",
                excludeInstanceId: "foi",
                pickedCardIds: ["blue1", "blue2"],
            });
        });
    });
});
