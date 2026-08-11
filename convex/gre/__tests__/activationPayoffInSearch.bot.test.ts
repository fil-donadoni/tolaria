// The search can SEE an activated ability's payoff (issue #1920).
//
// `applyMoveInSearch` used to apply an `activate-ability` move by paying its
// costs only: the ability never reached the stack, so `policyValue`'s
// one-resolution lookahead had nothing to resolve and NO depth of search ever
// saw what the activation bought. Every activation therefore evaluated at best
// equal to `pass`, and strictly worse the moment any term could see the spent
// cost. Mother of Runes tapped a 1/1 and granted nothing; a Prodigal Sorcerer
// ping cost a tap and dealt no damage.
//
// This file pins the fix at the three levels it has to hold at, plus the
// evaluator term the fix unblocked:
//
//   1. The PUSH — the item that reaches the search's stack is the SAME shape
//      the authoritative mutation commits, field for field, because both are
//      built by `gre/activationCommit.ts`. A divergent shape means the tree
//      optimises a fiction: `resolveTopOfStack` reads these fields.
//   2. The LOOKAHEAD — `policyValue` resolves an activated ability one ply
//      deep, exactly as it already did for a cast spell.
//   3. The BOARD FLEXIBILITY term (issue #1890 item 3), deliberately dropped
//      from PR #1919 *because* of the payoff gap, and its negative control at
//      the CHOICE level.
//
// The cards are FIXTURES, never special cases: nothing under test reads a card
// name. Prodigal Sorcerer supplies a `{T}` ability whose payoff resolves
// outright, Mother of Runes one whose payoff hides behind a mid-resolution
// choice, Mishra's Factory a mana ability and an `animatesSelf` ability.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { activateAbilityOnState, finalizeTargetSelection } from "../../game";
import { applyMoveInSearch, policyValue, selectRolloutMove } from "../search";
import { enumerateMoves, type Move } from "../moves";
import { evaluateBreakdown } from "../evaluate";
import { buildActivatedAbilityStackItem } from "../activationCommit";
import { cloneGameState } from "../clone";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState, StackItem } from "../state";

const MOTHER = getCardByName("Mother of Runes").id;
const SORCERER = getCardByName("Prodigal Sorcerer").id;
const FACTORY = getCardByName("Mishra's Factory").id;
const BOLT = getCardByName("Lightning Bolt").id;
const GOBLIN = getCardByName("Mons's Goblin Raiders").id;
const FOREST = getCardByName("Forest").id;
const VANGUARD = getCardByName("Llanowar Vanguard").id;
const SAFEKEEPER = getCardByName("Sylvan Safekeeper").id;
const CLERGY = getCardByName("Clergy of the Holy Nimbus").id;

const SORCERER_ZAP = "prodigal-sorcerer-zap";
const MOTHER_ABILITY = "mother-of-runes-protect";
const FACTORY_MANA = "mishras-factory-mana";
const VANGUARD_PUMP = "llanowar-vanguard-pump";

function mine(cardId: string, id: string, extra = {}): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        isSummoningSick: false,
        ...extra,
    });
}

function theirs(cardId: string, id: string, extra = {}): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: "p2",
        ownerId: "p2",
        id,
        isSummoningSick: false,
        ...extra,
    });
}

/** p1 holds priority at `phase` with `battlefield`; p2 owns `oppBattlefield`. */
function board(
    phase: GameState["phase"],
    battlefield: CardInstanceState[],
    oppBattlefield: CardInstanceState[] = [],
    extra: Partial<GameState> = {}
): GameState {
    return makeState({
        phase,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield }),
            makePlayer("p2", { battlefield: oppBattlefield }),
        ],
        ...extra,
    });
}

/** The `activate-ability` move the REAL enumerator produces for `instanceId`,
 *  optionally narrowed to one target. Hand-built moves are how a test ends up
 *  asserting against a move shape the engine never emits — a move with no
 *  targets for a targeted ability suspends on a `pendingTarget` instead of
 *  resolving, which reads exactly like "the payoff is invisible". */
function activationFor(
    state: GameState,
    instanceId: string,
    targetId?: string
): Extract<Move, { kind: "activate-ability" }> {
    const found = enumerateMoves(state, "p1").find(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === instanceId &&
            (targetId === undefined || m.targets.some((t) => t.id === targetId))
    );
    expect(found, `no enumerated activation for ${instanceId}`).toBeDefined();
    return found!;
}

// ---------------------------------------------------------------------------
// 1. The push: the ability reaches the stack, in the server's shape
// ---------------------------------------------------------------------------
describe("applyMoveInSearch puts an activated ability on the stack (CR 602.2a)", () => {
    it("pushes exactly one item, carrying the announcement data", () => {
        const state = board(
            "BEGINNING_OF_COMBAT",
            [mine(SORCERER, "tim")],
            [theirs(GOBLIN, "gob")]
        );
        const move = activationFor(state, "tim", "gob");

        applyMoveInSearch(state, "p1", move);

        expect(state.stack).toHaveLength(1);
        const item = state.stack[0];
        expect(item.abilityId).toBe(SORCERER_ZAP);
        expect(item.castById).toBe("p1");
        expect(item.zone).toBe("stack");
        expect(item.targets).toEqual(move.targets);
        // CR 602.1 — the {T} cost is paid, and the SOURCE stays on the
        // battlefield: the stack item is a snapshot of it, not the permanent.
        const source = state.players[0].battlefield.find((c) => c.id === "tim");
        expect(source?.isTapped).toBe(true);
        expect(item.id).toBe("tim");
    });

    it("SHAPE PARITY — the same fields the authoritative mutation commits", () => {
        // The core claim of issue #1920. `resolveTopOfStack` builds the
        // ability's `SpellContext` out of these fields, so a search-side item
        // of a different shape makes the tree optimise a position live play
        // will not reproduce. Both paths build through
        // `buildActivatedAbilityStackItem`; this asserts they AGREE, on the
        // real mutation entry point rather than on a re-derivation of it.
        //
        // A free, UNTARGETED `{T}` ability is the fixture on purpose: it is the
        // one shape both paths commit in a single step. A targeted or
        // mana-costed ability makes the mutation park a `pendingTarget` /
        // `pendingActivation` first, so comparing there would compare a commit
        // against a payment phase rather than two commits.
        const searchState = board("BEGINNING_OF_COMBAT", [
            mine(VANGUARD, "vg"),
        ]);
        const serverState = cloneGameState(searchState);
        const move = activationFor(searchState, "vg");

        applyMoveInSearch(searchState, "p1", move);
        activateAbilityOnState(serverState, {
            playerId: "p1",
            cardInstanceId: "vg",
            abilityId: VANGUARD_PUMP,
        });

        const searchItem = searchState.stack.find(
            (i) => i.abilityId === VANGUARD_PUMP
        );
        const serverItem = serverState.stack.find(
            (i) => i.abilityId === VANGUARD_PUMP
        );
        expect(searchItem).toBeDefined();
        expect(serverItem).toBeDefined();

        // Compare the ACTIVATION fields — the ones `activationCommit.ts` owns.
        // `targets` is excluded from this fixture only because the ability is
        // untargeted; the search's target tuple is asserted in the test above.
        const activationFields = (item: StackItem) => ({
            zone: item.zone,
            castById: item.castById,
            abilityId: item.abilityId,
            chosenModeId: item.chosenModeId,
            chosenX: item.chosenX,
            grantedSourceCardId: item.grantedSourceCardId,
            additionalSacrificeSnapshot: item.additionalSacrificeSnapshot,
            notedManaSpent: item.notedManaSpent,
            // The snapshot half: the item IS the source permanent.
            id: item.id,
            controllerId: item.controllerId,
            ownerId: item.ownerId,
            types: item.types,
        });
        expect(activationFields(searchItem!)).toEqual(
            activationFields(serverItem!)
        );
    });

    it("SHAPE PARITY — the TARGETED commit site, with targets on both sides", () => {
        // Review finding 3: the untargeted fixture above leaves seven of the
        // compared fields `undefined` on BOTH sides, so it cannot observe a
        // divergence in any CONDITIONAL field. This drives the OTHER server
        // commit site — `finalizeTargetSelection`, where the ability reaches the
        // stack after target selection — so `targets` is non-undefined on both
        // sides and is compared as data rather than as two absences.
        const searchState = board(
            "BEGINNING_OF_COMBAT",
            [mine(SORCERER, "tim")],
            [theirs(GOBLIN, "gob")]
        );
        const serverState = cloneGameState(searchState);
        const move = activationFor(searchState, "tim", "gob");

        applyMoveInSearch(searchState, "p1", move);

        activateAbilityOnState(serverState, {
            playerId: "p1",
            cardInstanceId: "tim",
            abilityId: SORCERER_ZAP,
        });
        const pt = serverState.pendingTarget!;
        expect(
            pt,
            "the server parks a pendingTarget for a targeted ability"
        ).toBeDefined();
        pt.selected = [{ type: "permanent", id: "gob" }];
        finalizeTargetSelection(serverState, pt, "p1");

        const searchItem = searchState.stack.find(
            (i) => i.abilityId === SORCERER_ZAP
        )!;
        const serverItem = serverState.stack.find(
            (i) => i.abilityId === SORCERER_ZAP
        )!;
        expect(searchItem.targets).toBeDefined();
        expect(searchItem.targets).toEqual(serverItem.targets);
        expect(searchItem.castById).toBe(serverItem.castById);
        expect(searchItem.abilityId).toBe(serverItem.abilityId);
        expect(searchItem.zone).toBe(serverItem.zone);
    });

    it("BUILDER CONTRACT — every conditional field is carried, and omitted when absent", () => {
        // Review finding 3, the structural half. Two fields the search
        // deliberately never produces (`additionalSacrificeSnapshot`,
        // `notedManaSpent`) cannot be covered by a parity test at all, so
        // deleting either spread from `buildActivatedAbilityStackItem` was
        // invisible to this file. This tests the builder's own contract
        // directly: each conditional field appears when supplied, and the KEY is
        // absent when not — the presence/absence distinction is what the
        // conditional-spread pattern exists for, and what a plain `=== undefined`
        // comparison cannot see.
        const source = mine(SORCERER, "tim");
        const snapshot = { cardInstanceId: "victim", mv: 3, power: 2 };

        const full = buildActivatedAbilityStackItem(source, {
            castById: "p1",
            abilityId: SORCERER_ZAP,
            targets: [{ type: "permanent", id: "gob" }],
            targetAmounts: { "permanent:gob": 2 },
            chosenModeId: "mode-a",
            chosenX: 3,
            grantedSourceCardId: "granting-card",
            additionalSacrificeSnapshot: snapshot,
            notedManaSpent: { R: 1 },
        });
        expect(full.targets).toEqual([{ type: "permanent", id: "gob" }]);
        expect(full.targetAmounts).toEqual({ "permanent:gob": 2 });
        expect(full.chosenModeId).toBe("mode-a");
        expect(full.chosenX).toBe(3);
        expect(full.grantedSourceCardId).toBe("granting-card");
        expect(full.additionalSacrificeSnapshot).toEqual(snapshot);
        expect(full.notedManaSpent).toEqual({ R: 1 });

        const bare = buildActivatedAbilityStackItem(source, {
            castById: "p1",
            abilityId: SORCERER_ZAP,
        });
        // `in`, not `=== undefined`: the builder must OMIT the key, because a
        // present-but-undefined key survives `structuredClone` into persisted
        // state and reads differently from the server's item.
        for (const key of [
            "targets",
            "targetAmounts",
            "chosenModeId",
            "chosenX",
            "grantedSourceCardId",
            "additionalSacrificeSnapshot",
            "notedManaSpent",
        ]) {
            expect(key in bare, `${key} must be omitted when absent`).toBe(
                false
            );
        }
        // An explicitly EMPTY target tuple is still carried — the targeted
        // commit site relies on it (`finalizeTargetSelection` passes `targets`
        // unconditionally), so "empty" and "absent" are not the same input.
        const emptyTargets = buildActivatedAbilityStackItem(source, {
            castById: "p1",
            abilityId: SORCERER_ZAP,
            targets: [],
        });
        expect("targets" in emptyTargets).toBe(true);
        expect(emptyTargets.targets).toEqual([]);
    });

    it("does NOT push a mana ability — it never uses the stack (CR 605.3c)", () => {
        // Trap 1. A mana ability resolves immediately and is payment plumbing
        // the search models through the tap plan; pushing one would park an
        // item nothing ever resolves. `enumerateMoves` refuses to emit one as a
        // macro-move, so this is asserted on the hand-built move that
        // `applyMoveInSearch` (an exported function) also accepts.
        const state = board("PRECOMBAT_MAIN", [mine(FACTORY, "fac")]);
        const manaMove: Move = {
            kind: "activate-ability",
            cardInstanceId: "fac",
            abilityId: FACTORY_MANA,
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };

        applyMoveInSearch(state, "p1", manaMove);

        expect(state.stack).toHaveLength(0);
    });

    it("records the activation, so a once-per-turn ability is spent (CR 602.5)", () => {
        // Trap 4. The tally is read by the enumerator's once-per-turn gate and
        // by card-declared `canActivate` predicates; a search that pushed
        // without recording would let a rollout re-activate without limit.
        const state = board(
            "BEGINNING_OF_COMBAT",
            [mine(SORCERER, "tim")],
            [theirs(GOBLIN, "gob")]
        );
        applyMoveInSearch(state, "p1", activationFor(state, "tim", "gob"));

        const source = state.players[0].battlefield.find((c) => c.id === "tim");
        expect(source?.activationsThisTurn?.[SORCERER_ZAP]).toBe(1);
    });

    it("pays a NON-IDEMPOTENT cost leg exactly once alongside the push", () => {
        // Trap 2. The push is purely additive over the cost payment that
        // already happened (`applyActivationCostsForSearch`, issue #2155); a
        // shared server helper reached for carelessly would pay a second time.
        //
        // The cost leg has to be one that COUNTS. A `{T}` cost cannot catch a
        // double payment — tapping an already-tapped source is a no-op — so
        // this uses a sacrifice: paying twice eats two lands, and the assertion
        // is on how many are left, not on a flag. (Verified: with the cost
        // helper called twice this goes red, while the `{T}` version of the
        // same test stayed green.)
        const state = board("BEGINNING_OF_COMBAT", [
            mine(SAFEKEEPER, "keeper"),
            mine(FOREST, "f1"),
            mine(FOREST, "f2"),
        ]);
        const landsBefore = state.players[0].battlefield.filter((c) =>
            c.id.startsWith("f")
        ).length;

        applyMoveInSearch(state, "p1", activationFor(state, "keeper"));

        const landsAfter = state.players[0].battlefield.filter((c) =>
            c.id.startsWith("f")
        ).length;
        expect(landsAfter).toBe(landsBefore - 1);
        // ...and the ability still reached the stack: the push and the payment
        // are both present, which is what "additive" means here.
        expect(
            state.stack.filter((i) => i.abilityId !== undefined)
        ).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// 2. The one-ply lookahead (`policyValue`)
// ---------------------------------------------------------------------------
describe("policyValue resolves an activated ability one ply deep (issue #1920)", () => {
    /** The bot's own combat step, an opposing 1/1 the ping kills outright. */
    function pingPosition(): GameState {
        return board(
            "BEGINNING_OF_COMBAT",
            [mine(SORCERER, "tim")],
            [theirs(GOBLIN, "gob")]
        );
    }

    function valueOf(state: GameState, move: Move): number {
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, "p1", move);
        return policyValue(probe, "p1", move);
    }

    it("the ping's damage is visible, so the kill beats passing", () => {
        const state = pingPosition();
        const kill = activationFor(state, "tim", "gob");

        expect(valueOf(state, kill)).toBeGreaterThan(
            valueOf(state, { kind: "pass" })
        );
    });

    it("the creature is actually dead in the probed leaf", () => {
        // The mechanism, not just the number: without the lookahead the
        // ability sits unresolved and the Goblin is alive at the leaf.
        const state = pingPosition();
        const probe = cloneGameState(state);
        const kill = activationFor(state, "tim", "gob");
        applyMoveInSearch(probe, "p1", kill);
        policyValue(probe, "p1", kill);

        expect(probe.players[1].battlefield.map((c) => c.id)).not.toContain(
            "gob"
        );
    });

    it("the default policy CHOOSES the kill over passing", () => {
        const state = pingPosition();
        const moves = enumerateMoves(state, "p1");
        const chosen = selectRolloutMove(state, "p1", "p1", moves, () => 0);

        expect(chosen.kind).toBe("activate-ability");
    });

    it("a resolution suspended on a choice does not freeze the rollout", () => {
        // Trap 3. Mother's colour pick is a mid-resolution choice (CR 601.2b /
        // 608.2): `resolveTopOfStack` leaves the item on the stack and queues
        // the choice, which the deeper tree answers as an in-tree decision
        // node. The lookahead simply sees no payoff — it never stalls, and
        // needs no bail-out of its own. Inherited behaviour, asserted rather
        // than assumed.
        const state = board("PRECOMBAT_MAIN", [mine(MOTHER, "mom")]);
        const move = activationFor(state, "mom", "mom");
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, "p1", move);

        expect(() => policyValue(probe, "p1", move)).not.toThrow();
        expect(probe.stack.some((i) => i.abilityId === MOTHER_ABILITY)).toBe(
            true
        );
        expect(probe.pendingChoices?.length ?? 0).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 3. The board-side flexibility term (issue #1890 item 3) + its negative control
// ---------------------------------------------------------------------------
describe("board flexibility — a live instant-speed activated option (issue #1890 item 3)", () => {
    /** The `flexibility` term p1 scores in `state`. */
    function flex(state: GameState): number {
        return evaluateBreakdown(state, "p1").self.flexibility;
    }

    /** W_FLEX, derived rather than imported: one flexible permanent and an
     *  empty hand is exactly one unit of the term. Deriving it keeps the margin
     *  assertion below honest if the weight is ever retuned. */
    const ONE_OPTION = flex(board("PRECOMBAT_MAIN", [mine(MOTHER, "mom")]));

    it("credits an untapped permanent with an instant-speed option", () => {
        expect(ONE_OPTION).toBeGreaterThan(0);
    });

    it("credits nothing once the option is tapped out (CR 302.1)", () => {
        const tapped = board("PRECOMBAT_MAIN", [
            mine(MOTHER, "mom", { isTapped: true }),
        ]);
        expect(flex(tapped)).toBe(0);
    });

    it("credits nothing for a summoning-sick {T} option (CR 302.1)", () => {
        const sick = board("PRECOMBAT_MAIN", [
            mine(MOTHER, "mom", { isSummoningSick: true }),
        ]);
        expect(flex(sick)).toBe(0);
    });

    it("credits nothing for an ability only OPPONENTS may activate (CR 602.1)", () => {
        // Review finding 1: the one gate this term did not mirror from
        // `moves.ts`, and a fail-OPEN one — the controller of Clergy of the Holy
        // Nimbus was credited for an option only their opponent can use.
        //
        // The Forest is load-bearing: it makes the {1} affordable, so a zero
        // here cannot be the affordability gate passing for the wrong reason.
        const state = board("PRECOMBAT_MAIN", [
            mine(CLERGY, "clergy"),
            mine(FOREST, "f1"),
        ]);

        expect(flex(state)).toBe(0);
        // Tied to the enumerator rather than asserted in isolation: the claim is
        // that the term agrees with what the bot may actually DO.
        const activations = enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "activate-ability" && m.cardInstanceId === "clergy"
        );
        expect(activations).toHaveLength(0);
    });

    it("credits nothing for a pure mana source (CR 605.1a)", () => {
        // The gate is `hasNonManaActivatedAbility` — the same predicate the
        // auto-tapper uses, never a parallel one. A land that only taps for
        // mana offers no reactive option; its worth is already the `mana` term.
        expect(flex(board("PRECOMBAT_MAIN", [mine(FOREST, "f1")]))).toBe(0);
    });

    it("keeps the credit while the option is IN FLIGHT on the stack", () => {
        // The clause that makes the term safe over a 1-ply horizon. An ability
        // that has been announced is neither still held nor yet realized into
        // the position; dropping the credit there charges for the spend twice —
        // once by tapping the source, once by not-yet-resolving — and that
        // second charge is an artefact of the horizon, not of the position.
        const state = board("PRECOMBAT_MAIN", [mine(MOTHER, "mom")]);
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, "p1", activationFor(state, "mom", "mom"));

        expect(probe.stack.some((i) => i.abilityId === MOTHER_ABILITY)).toBe(
            true
        );
        // Asserted as a POSITIVE magnitude as well as an equality: with the
        // board half of the term switched off both sides would read 0 and the
        // equality alone would pass vacuously.
        expect(flex(probe)).toBeGreaterThan(0);
        expect(flex(probe)).toBe(ONE_OPTION);
    });

    // -----------------------------------------------------------------------
    // The NEGATIVE CONTROL the term was blocked on (issue #1920 ↔ #1890).
    // -----------------------------------------------------------------------
    it("MARGIN — activating under removal beats pass by MORE than one option's credit", () => {
        // The credit is symmetric: it pays for holding the option in every
        // window, the REACTIVE one included, where the option should be SPENT.
        // While the payoff was invisible that converted an exact tie into a
        // deterministic W_FLEX-sized loss for the activation, and
        // `selectRolloutMove`'s argmax is exact-equality, so the activation
        // dropped out of the bucket entirely and no rng value could return it.
        //
        // Re-establishing the TIE would not prove the term safe. What must hold
        // is that spending the option genuinely pays: an activation whose
        // payoff resolves must beat `pass` by more than the credit it forfeits.
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [mine(SORCERER, "tim")] }),
                makePlayer("p2", { battlefield: [theirs(GOBLIN, "gob")] }),
            ],
        });
        pushSpell(state, BOLT, "p2", [{ type: "permanent", id: "tim" }]);

        const kill = activationFor(state, "tim", "gob");
        const probeKill = cloneGameState(state);
        applyMoveInSearch(probeKill, "p1", kill);
        const probePass = cloneGameState(state);
        const pass: Move = { kind: "pass" };
        applyMoveInSearch(probePass, "p1", pass);

        const margin =
            policyValue(probeKill, "p1", kill) -
            policyValue(probePass, "p1", pass);
        expect(margin).toBeGreaterThan(ONE_OPTION);
    });

    it("CHOICE — the default policy takes the activation in that window", () => {
        // The same position at the level the regression would actually show:
        // the bot's CHOICE, not a score. `() => 0` returns the first candidate
        // of the tied bucket, so a term that ranked `pass` strictly above the
        // activation would make this unreachable at any rng value.
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [mine(SORCERER, "tim")] }),
                makePlayer("p2", { battlefield: [theirs(GOBLIN, "gob")] }),
            ],
        });
        pushSpell(state, BOLT, "p2", [{ type: "permanent", id: "tim" }]);

        const chosen = selectRolloutMove(
            state,
            "p1",
            "p1",
            enumerateMoves(state, "p1"),
            () => 0
        );
        expect(chosen.kind).toBe("activate-ability");
    });
});
