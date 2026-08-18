// STH (Stronghold) — colorless card behavior tests (ADR 0043 colour split).
//
// Mox Diamond (#2389) is the first shipped card wired to the ADR 0100
// as-enters union, and the first member of it that can DECLINE: "If this
// artifact would enter, you may discard a land card instead. If you do, put
// this artifact onto the battlefield. If you don't, put it into its owner's
// graveyard."
//
// Covered here, one block per CR clause:
//  - CR 614.12a — the choice is offered BEFORE the permanent enters, on every
//    entry route the ADR 0100 D1 chokepoint serves (cast + non-cast), and only
//    LAND cards are legal payments;
//  - CR 614.1a — the decline branch: the "instead" is never applied, so the
//    Mox never touches the battlefield (no ETB, no LKI) and the card lands in
//    its owner's graveyard from the stack (CR 608.3), which is not a death;
//  - the auto-resolve: no land in hand means no legal payment, so no prompt is
//    ever raised (the engine must not park behind an unanswerable choice);
//  - CR 605.1a / 605.3a — the any-colour mana ability, driven through the REAL
//    registered `tapUntap` mutation handler;
//  - the wire format — both branches survive `projectPublicState`.
import { describe, it, expect } from "vitest";
import { moxDiamond } from "../colorless";
import { forest, mountain, grizzlyBears } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { computeExpectedInput } from "../../../../gre/expectedInput";
import { projectPublicState } from "../../../../gameProjections";
import { submitResolutionChoice, tapUntap } from "../../../../game";
import type { Id } from "../../../../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../../../__tests__/gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

/** A board where p1 is casting Mox Diamond with `hand` in hand. */
function castingMox(hand: CardInstanceState[]): GameState {
    const state = makeState({
        players: [makePlayer("p1", { hand }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const item = pushSpell(state, moxDiamond.id, "p1");
    item.id = "mox";
    return state;
}

function land(id: string, def = forest): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
}

function head(state: GameState) {
    return (state.pendingChoices ?? [])[0];
}

function answer(state: GameState, ids: string[]): void {
    const h = head(state);
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

const battlefieldIds = (state: GameState): string[] =>
    state.players.flatMap((p) => p.battlefield.map((c) => c.id));
const graveyardIds = (state: GameState): string[] =>
    state.players.flatMap((p) => p.graveyard.map((c) => c.id));
const handIds = (state: GameState): string[] =>
    state.players[0].hand.map((c) => c.id);

describe("Mox Diamond — as-enters discard (CR 614.1a / 614.12a, issue #2389)", () => {
    it("offers the optional discard BEFORE the Mox enters, restricted to LAND cards", () => {
        const state = castingMox([
            land("forest"),
            makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ]);

        resolveTopOfStack(state);

        // CR 614.12a — parked off EVERY zone while the choice is owed.
        expect(state.stagedEntries).toHaveLength(1);
        expect(battlefieldIds(state)).not.toContain("mox");
        expect(graveyardIds(state)).not.toContain("mox");

        const h = head(state);
        expect(h.kind).toBe("discard-hand");
        expect(h.asEntersCardId).toBe("mox");
        expect(h.asEntersKind).toBe("discard");
        expect(h.zone).toBe("hand");
        // Optional: the floor is 0, which is what makes the decline legal.
        expect(h.count).toEqual({ min: 0, max: 1 });
        // Only the land is a legal payment — the creature is not offered.
        expect(h.candidateIds).toEqual(["forest"]);
        // ADR 0047 — the window is reported as owed, so no bot can freeze on it.
        expect(computeExpectedInput(state)).toMatchObject({
            kind: "choice",
            playerId: "p1",
            stackItemId: "",
            choiceKind: "discard-hand",
        });
    });

    it("paying the discard puts the Mox onto the battlefield and the land in the graveyard (CR 701.9)", () => {
        const state = castingMox([land("forest")]);
        resolveTopOfStack(state);

        answer(state, ["forest"]);

        expect(battlefieldIds(state)).toContain("mox");
        expect(graveyardIds(state)).toContain("forest");
        expect(handIds(state)).toEqual([]);
        expect(state.stagedEntries).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // The ETB probe the decline test asserts the ABSENCE of — proving that
        // assertion is about a signal this path really does raise.
        expect(state.players[0].qualifyingActionThisTurn).toBe(true);

        // Wire format — the client sees the Mox on the battlefield.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield.map((c) => c.id)).toContain(
            "mox"
        );
        expect(projected.players[0].graveyard.map((c) => c.id)).toContain(
            "forest"
        );
    });

    it("declining puts the Mox into its owner's graveyard — it never touches the battlefield (CR 614.1a / 608.3)", () => {
        const state = castingMox([land("forest")]);
        resolveTopOfStack(state);

        answer(state, []);

        expect(battlefieldIds(state)).not.toContain("mox");
        expect(graveyardIds(state)).toContain("mox");
        // The land was NOT paid — a decline spends nothing.
        expect(handIds(state)).toEqual(["forest"]);
        expect(state.stagedEntries).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // It arrived from the STACK as a card, so nothing that watches the
        // battlefield ever saw it. `qualifyingActionThisTurn` is the probe:
        // `emitPermanentEntered` sets it for every nontoken permanent that
        // enters (CR 508.1c, Arboria), and the fixture pushes the spell
        // straight onto the stack without `emitSpellCastEvent`, so the flag can
        // only have come from an ETB. Still false ⇒ no ETB was ever emitted,
        // hence no ETB trigger, no LKI and no death event either.
        expect(state.players[0].qualifyingActionThisTurn).toBeFalsy();
        expect(state.stack).toHaveLength(0);
        // …and it took the ORDINARY stack → graveyard transition (CR 608.3,
        // `sendStackItemToGraveyard`), not a raw push: the stack-only transient
        // state is cleared, so the graveyard holds a CARD rather than a
        // half-resolved spell. That route is also what keeps a graveyard-bound
        // replacement (Yawgmoth's Will / Dauthi Voidwalker) in the loop.
        const binned = state.players[0].graveyard.find((c) => c.id === "mox")!;
        expect((binned as { castById?: string }).castById).toBeUndefined();
        expect((binned as { targets?: unknown }).targets).toBeUndefined();

        // Wire format — the client sees it in the graveyard, not in play.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].graveyard.map((c) => c.id)).toContain(
            "mox"
        );
        expect(projected.players[0].battlefield.map((c) => c.id)).not.toContain(
            "mox"
        );
    });

    it("no land in hand — the choice auto-resolves to the decline, with no prompt ever raised", () => {
        const state = castingMox([
            makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ]);

        resolveTopOfStack(state);

        // Never parked behind an unanswerable prompt.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
        expect(battlefieldIds(state)).not.toContain("mox");
        expect(graveyardIds(state)).toContain("mox");
        expect(handIds(state)).toEqual(["bears"]);
    });

    it("a submission that is not a legal payment is REJECTED, never silently a free entry", () => {
        const state = castingMox([
            land("forest"),
            makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ]);
        resolveTopOfStack(state);

        expect(() => answer(state, ["bears"])).toThrow(
            /not an eligible choice/i
        );
        // Still owed — nothing was spent and nothing entered.
        expect(head(state).asEntersCardId).toBe("mox");
        expect(handIds(state)).toEqual(["forest", "bears"]);
    });

    it("the SAME choice is offered on a non-cast entry route (put onto the battlefield, ADR 0100 D1 row B)", () => {
        const mox = makeInstance(moxDiamond.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [mox], hand: [land("forest")] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].graveyard = [];

        putReanimatedSetOnBattlefield(state, [
            { card: mox, controllerId: "p1" },
        ]);

        expect(head(state).asEntersKind).toBe("discard");
        expect(head(state).candidateIds).toEqual(["forest"]);

        answer(state, []);

        // CR 614.1a — declined on the non-cast route too: it goes to its
        // owner's graveyard rather than entering.
        expect(battlefieldIds(state)).not.toContain("mox");
        expect(graveyardIds(state)).toContain("mox");
        expect(handIds(state)).toEqual(["forest"]);
    });

    it("paying on the non-cast route lets it enter (ADR 0100 D1 row B)", () => {
        const mox = makeInstance(moxDiamond.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [land("forest")] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });

        putReanimatedSetOnBattlefield(state, [
            { card: mox, controllerId: "p1" },
        ]);
        answer(state, ["forest"]);

        expect(battlefieldIds(state)).toContain("mox");
        expect(graveyardIds(state)).toContain("forest");
    });
});

// Full-path coverage through the REAL registered mutation handlers — the
// discipline `gameMutationHarness.ts` demands: a reducer-only test stays green
// if `submitResolutionChoice`'s `assertExpectedInput` gate stops admitting a
// STACKLESS as-enters head, which would be a hard freeze in the deployed game.
describe("Mox Diamond — full path through convex/game.ts (issue #2389)", () => {
    type SubmitArgs = {
        gameId: Id<"games">;
        playerId: string;
        stackItemId: string;
        step: number;
        choiceId: string;
        cardInstanceIds: string[];
    };
    type TapArgs = {
        gameId: Id<"games">;
        playerId: string;
        cardInstanceId: string;
        manaChoiceIndex?: number;
    };

    it("submitResolutionChoice accepts the stackless as-enters discard and the Mox enters", async () => {
        const state = castingMox([land("forest")]);
        resolveTopOfStack(state);
        const h = head(state);

        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<SubmitArgs, void>(
            submitResolutionChoice as unknown as Handler<SubmitArgs, void>,
            stub.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                stackItemId: h.stackItemId,
                step: h.step,
                choiceId: h.choiceId,
                cardInstanceIds: ["forest"],
            }
        );

        const after = stub.state();
        expect(battlefieldIds(after)).toContain("mox");
        expect(graveyardIds(after)).toContain("forest");
    });

    it("{T}: Add one mana of any color — every colour is offered (CR 605.1a / 605.3a)", async () => {
        const mox = makeInstance(moxDiamond.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });

        // Index 3 of `manaChoices` is {R} — a colour the Mox has no printed
        // relation to, which is the whole point of "any color".
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<TapArgs, void>(
            tapUntap as unknown as Handler<TapArgs, void>,
            stub.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "mox",
                manaChoiceIndex: 3,
            }
        );

        const after = stub.state();
        expect(after.players[0].manaPool.R).toBe(1);
        expect(after.players[0].manaPool.W).toBe(0);
        expect(
            after.players[0].battlefield.find((c) => c.id === "mox")!.isTapped
        ).toBe(true);
        // CR 605.3a — a mana ability never uses the stack.
        expect(after.stack).toHaveLength(0);
    });
});

// Unused import guard: `mountain` documents that the filter is type-based, not
// name-based — a second, different basic land is just as legal a payment.
describe("Mox Diamond — the discard filter is CR 205.2 type-based (issue #2389)", () => {
    it("any land card in hand pays, not only the first-listed one", () => {
        const state = castingMox([land("mtn", mountain), land("forest")]);
        resolveTopOfStack(state);

        expect(head(state).candidateIds).toEqual(["mtn", "forest"]);
        answer(state, ["forest"]);

        expect(battlefieldIds(state)).toContain("mox");
        expect(graveyardIds(state)).toContain("forest");
        expect(handIds(state)).toEqual(["mtn"]);
    });
});
