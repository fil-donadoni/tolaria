// Cycling (CR 702.29) — the engine/cost capability shared by every cycling
// card (issue #689). Built once here, reused by all the per-card tests
// (iko/snc Triomes, Miscalculation, Unearth, Marauding Mako).
//
// CR 702.29a: "Cycling [cost]" means "[cost], Discard this card: Draw a card."
//   This activated ability functions only while this card is in your hand.
// CR 702.29b: A card may be cycled any time its owner could cast an instant.
//
// The project has no convex-test harness (ADR 0001), so this drives the REAL
// exported cost-commit primitives (`buildPendingActivation` +
// `tryAutoCommitPendingActivation` from game.ts — the same functions the
// `activateAbility` mutation calls) and the REAL `resolveTopOfStack`. A
// regression in the hand-zone locator, the discard-this cost, or the draw
// resolution fails here.

import { describe, it, expect } from "vitest";
import {
    buildPendingActivation,
    tryAutoCommitPendingActivation,
} from "../../game";
import { normalizeManaCost, resolveTopOfStack, type GameState } from "../state";
import { getAllCards, getCardByName, getDefinition } from "../../cards";
import { raugrinTriome } from "../../cards/sets/iko/colorless";
import { grizzlyBears } from "../../cards/sets/lea";
import { trollOfKhazadDum } from "../../cards/sets/ltr/black";
import { lorienRevealed } from "../../cards/sets/ltr/blue";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const CYCLING_ID = "cycling";

/** The Cycling ability declared on a card definition. */
function cyclingAbilityOf(cardId: string) {
    const ability = getDefinition(cardId).activatedAbilities?.find(
        (a) => a.id === CYCLING_ID
    );
    if (!ability) throw new Error("card has no cycling ability");
    return ability;
}

/** Replicates the `activateAbility` mutation's Cycling path over real GRE
 *  primitives: build the pendingActivation descriptor for a hand source with a
 *  discard-this cost, then auto-commit (mana already in pool). Returns the
 *  commit result (null if nothing committed). */
function cycleFromHand(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    cardId: string
) {
    const ability = cyclingAbilityOf(cardId);
    state.pendingActivation = buildPendingActivation({
        playerId,
        cardInstanceId,
        abilityId: CYCLING_ID,
        ability,
        // The real `activateAbility` mutation normalizes the printed cost via
        // `resolveAbilityManaCost` before deferring it; mirror that here so
        // `{ generic: N }` folds into the generic total the solver reads.
        manaCost: ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : undefined,
        fromHand: true,
    });
    return tryAutoCommitPendingActivation(state, playerId);
}

describe("cycling (CR 702.29)", () => {
    it("the ability is usable from hand at instant speed (no phase restriction)", () => {
        const ability = cyclingAbilityOf(raugrinTriome.id);
        expect(ability.activateFromHand).toBe(true);
        expect(ability.cost.discardThis).toBe(true);
        expect(ability.useStack).toBe(true);
        // CR 702.29b — instant speed: no phase gate.
        expect(ability.activationPhaseRestriction).toBeUndefined();
        // The effect is a plain draw Op (the cost is the cycling-specific part).
        expect(ability.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
    });

    it("pays the cost, discards this card, and draws a card", () => {
        const triome = makeInstance(raugrinTriome.id, {
            id: "triome-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const topOfLibrary = makeInstance(grizzlyBears.id, {
            id: "lib-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [triome],
                    library: [topOfLibrary],
                    // {3} already floating so the commit fires immediately.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
                }),
                makePlayer("p2"),
            ],
        });

        const result = cycleFromHand(state, "p1", "triome-1", raugrinTriome.id);
        expect(result).not.toBeNull();

        const p1 = state.players[0];
        // CR 702.29a — the card left the hand to the graveyard as a cost.
        expect(p1.hand.some((c) => c.id === "triome-1")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "triome-1")).toBe(true);
        // The {3} cost was paid from the pool.
        expect(p1.manaPool.C).toBe(0);
        // CR 701.8 — the discard routes through the shared choke point and
        // emits CARD_DISCARDED (consumed by the trigger scan at commit — see the
        // Marauding Mako test, which asserts the resulting counter). The cycling
        // uses the stack; it can be responded to).
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].abilityId).toBe(CYCLING_ID);
        // The card is NOT yet drawn (draw happens on resolution).
        expect(p1.hand.some((c) => c.id === "lib-1")).toBe(false);

        // CR 702.29a — resolve "Draw a card".
        resolveTopOfStack(state);
        expect(state.stack.length).toBe(0);
        expect(p1.hand.some((c) => c.id === "lib-1")).toBe(true);
        expect(p1.library.length).toBe(0);
    });

    it("defers the discard until commit — an uncovered cost leaves the card in hand", () => {
        const triome = makeInstance(raugrinTriome.id, {
            id: "triome-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [triome],
                    // No mana — the cost is uncovered, so commit does not fire.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });

        const result = cycleFromHand(state, "p1", "triome-2", raugrinTriome.id);
        // CR 118 — deferred payment: nothing committed while mana is unpaid.
        expect(result).toBeNull();
        const p1 = state.players[0];
        // The card is still in hand (the discard is deferred to commit).
        expect(p1.hand.some((c) => c.id === "triome-2")).toBe(true);
        expect(p1.graveyard.length).toBe(0);
        expect(state.stack.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Typecycling — CR 702.29e/f (issue #1839). The permanent test for the
// `typecyclingAbility` factory: the shared activation shell (CR 702.29f) plus
// the tutor body the variant adds. The generated smoke sweep SKIPS this
// ability ("Op 'choice' suspends for player input"), which is exactly the
// signal to hand-write the suspension/resume coverage here.
// ---------------------------------------------------------------------------
describe("typecycling (CR 702.29e/f)", () => {
    const SWAMP = getCardByName("Swamp").id;
    const ISLAND = getCardByName("Island").id;

    /** A Troll of Khazad-dûm in hand, a library holding `libraryIds` worth of
     *  cards, and {1} floating so the typecycling cost auto-commits. */
    function boardWithTroll(
        library: { id: string; cardId: string }[],
        extraHand: { id: string; cardId: string }[] = []
    ) {
        const troll = makeInstance(trollOfKhazadDum.id, {
            id: "troll-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const inZone = (
            cards: { id: string; cardId: string }[],
            zone: "hand" | "library"
        ) =>
            cards.map((c) =>
                makeInstance(c.cardId, {
                    id: c.id,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone,
                })
            );
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [troll, ...inZone(extraHand, "hand")],
                    library: inZone(library, "library"),
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("CR 702.29f — it IS a cycling ability: same id, same discard-this cost, same from-hand shell", () => {
        // Asserted through `cyclingAbilityOf`, the SAME lookup the plain
        // Cycling tests above use (`a.id === "cycling"`): a typecycling card
        // must be findable by anything that looks for cycling.
        const ability = cyclingAbilityOf(trollOfKhazadDum.id);
        expect(ability.cost.discardThis).toBe(true);
        expect(ability.activateFromHand).toBe(true);
        expect(ability.useStack).toBe(true);
        // CR 702.29b — instant speed: no phase gate, exactly like plain
        // Cycling (`cyclingAbilityOf(raugrinTriome.id)` above).
        expect(ability.activationPhaseRestriction).toBeUndefined();
        expect(ability.oracleText).toContain("Swampcycling {1}");
    });

    it("pays the cost, discards this card, then searches library → hand and shuffles (CR 702.29e)", () => {
        const state = boardWithTroll([
            { id: "swamp-1", cardId: SWAMP },
            { id: "bear-1", cardId: grizzlyBears.id },
        ]);

        const result = cycleFromHand(
            state,
            "p1",
            "troll-hand",
            trollOfKhazadDum.id
        );
        expect(result).not.toBeNull();

        const p1 = state.players[0];
        // CR 702.29a/f — the discard is a COST, paid on the way to the stack.
        expect(p1.hand.some((c) => c.id === "troll-hand")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "troll-hand")).toBe(true);
        expect(p1.manaPool.C).toBe(0);
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].abilityId).toBe(CYCLING_ID);

        // CR 401.4 / 701.19a — resolution suspends on a genuine library search.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.isSearch).toBe(true);
        // Only the Swamp matches `filter: { subtype: "Swamp" }`.
        expect(head.candidateIds).toEqual(["swamp-1"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["swamp-1"],
        });

        // CR 702.29e — "…put it into your hand. Then shuffle your library."
        expect(p1.hand.map((c) => c.id)).toEqual(["swamp-1"]);
        expect(p1.library.map((c) => c.id)).toEqual(["bear-1"]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("CR 701.19c — the searcher may fail to find: the library is still looked at and shuffled", () => {
        const state = boardWithTroll([
            { id: "bear-a", cardId: grizzlyBears.id },
            { id: "bear-b", cardId: grizzlyBears.id },
        ]);
        cycleFromHand(state, "p1", "troll-hand", trollOfKhazadDum.id);
        expect(resolveTopOfStack(state)).toBeNull();

        const head = state.pendingChoices![0];
        // CR 401.4 — a no-hit library search STILL raises the choice (the
        // player is entitled to look), with an empty allow-list.
        expect(head.kind).toBe("search-library");
        expect(head.candidateIds).toEqual([]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });

        const p1 = state.players[0];
        expect(p1.hand).toHaveLength(0);
        expect([...p1.library.map((c) => c.id)].sort()).toEqual([
            "bear-a",
            "bear-b",
        ]);
        expect(state.stack).toHaveLength(0);
    });

    it("a typecycling ability on a NONPERMANENT card works the same (Lórien Revealed, a sorcery)", () => {
        const lorien = makeInstance(lorienRevealed.id, {
            id: "lorien-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const island = makeInstance(ISLAND, {
            id: "island-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [lorien],
                    library: [island],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });

        cycleFromHand(state, "p1", "lorien-hand", lorienRevealed.id);
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["island-1"],
        });

        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["island-1"]);
        expect(p1.graveyard.some((c) => c.id === "lorien-hand")).toBe(true);
        expect(p1.library).toHaveLength(0);
    });

    // Wire format (mandatory — the outcome is client-visible: the tutored card
    // appears in the searcher's hand and their library count drops, while the
    // opponent must learn neither the card's identity nor anything beyond the
    // counts). Asserted through the REAL projection, not a hand-built view.
    it("the tutored card survives projection: real in the searcher's hand, count-only to the opponent", () => {
        const state = boardWithTroll(
            [
                { id: "swamp-1", cardId: SWAMP },
                { id: "bear-1", cardId: grizzlyBears.id },
            ],
            // A hand card that was NEVER revealed — the contrast that proves
            // the projection is still hiding what it should.
            [{ id: "hidden-1", cardId: grizzlyBears.id }]
        );
        cycleFromHand(state, "p1", "troll-hand", trollOfKhazadDum.id);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["swamp-1"],
        });

        // The searcher's own view: both hand cards are real, the library
        // shrank by the tutored card.
        const mine = projectPublicState(state, 1, "p1");
        expect(mine.players[0].hand.map((c) => c?.id).sort()).toEqual([
            "hidden-1",
            "swamp-1",
        ]);
        expect(mine.players[0].library.count).toBe(1);
        // The typecycled source is publicly in the graveyard (CR 400.2).
        expect(mine.players[0].graveyard.map((c) => c.id)).toEqual([
            "troll-hand",
        ]);

        // The opponent's view: CR 702.29e says "REVEAL it", so the tutored
        // card's identity IS public and must survive the projection — while
        // the never-revealed hand card stays a null placeholder. Dropping the
        // `reveal` Op from the factory would silently make both null here.
        const theirs = projectPublicState(state, 1, "p2");
        const theirView = theirs.players[0].hand;
        expect(theirView).toHaveLength(2);
        expect(theirView.filter((c) => c !== null).map((c) => c!.id)).toEqual([
            "swamp-1",
        ]);
        expect(theirView.filter((c) => c === null)).toHaveLength(1);
        expect(theirs.players[0].library.count).toBe(1);
        expect(theirs.players[0].graveyard.map((c) => c.id)).toEqual([
            "troll-hand",
        ]);
    });
});

// CR 702.29c/f (issue #2442) — the "this discard pays a cycling cost" marker.
// `cyclingActivationShell` is the ONLY place it is declared, so both public
// factories carry it structurally; this sweep is what fails if a future cycling
// card is hand-authored around the shell (it would ship a silently inert "when
// you cycle this card" interaction) or if the marker is pinned on an ability
// that is not a cycling ability.
describe("cycling cost marker (CR 702.29c/f)", () => {
    /** A printed cycling / typecycling ability, recognised by the reminder text
     *  BOTH factories render ("Cycling {2} (…)", "Mountaincycling {2} (…)") —
     *  deliberately NOT by the ability id, which is exactly the fail-open
     *  string match the marker exists to avoid in production code. */
    const isPrintedCyclingAbility = (oracleText: string) =>
        /^[A-Za-z]*[Cc]ycling \{/.test(oracleText);

    const abilities = getAllCards().flatMap((card) =>
        (card.activatedAbilities ?? []).map((ability) => ({
            card: card.name,
            ability,
        }))
    );

    it("every catalogue cycling/typecycling ability declares cost.cyclingCost", () => {
        const printed = abilities.filter((a) =>
            isPrintedCyclingAbility(a.ability.oracleText)
        );
        // Guard the guard: the catalogue really does ship cycling cards.
        expect(printed.length).toBeGreaterThan(0);
        const unmarked = printed
            .filter((a) => a.ability.cost.cyclingCost !== true)
            .map((a) => `${a.card} / ${a.ability.id}`);
        expect(unmarked).toEqual([]);
        // CR 702.29a — a cycling cost always includes discarding this card.
        expect(
            printed.filter((a) => a.ability.cost.discardThis !== true)
        ).toEqual([]);
    });

    it("nothing else declares cost.cyclingCost", () => {
        const marked = abilities.filter(
            (a) => a.ability.cost.cyclingCost === true
        );
        const notCycling = marked
            .filter((a) => !isPrintedCyclingAbility(a.ability.oracleText))
            .map((a) => `${a.card} / ${a.ability.id}`);
        expect(notCycling).toEqual([]);
    });
});
