/**
 * Floating turn-scoped spell-cost reduction — "spells you cast this turn cost
 * {N} less to cast" (CR 601.2f / 514.2, issue #3340).
 *
 * The `reduceSpellCostThisTurn` Op's permanent test. Five things it has to
 * prove, because nothing else in the suite can:
 *
 *   1. The reduction actually applies — and THROUGH the single 601.2f
 *      collector `getCostModifiers`, never by a test reading
 *      `state.spellCostReductionsThisTurn` and doing its own arithmetic. That
 *      is the whole claim: every cast path, `canAffordCard` and the Bot's
 *      move enumeration inherit it because they all call that one function.
 *   2. It expires at CLEANUP (CR 514.2), which is what makes it "this turn"
 *      rather than a permanent's static ability.
 *   3. It does NOT touch the opponent's spells — "spells YOU cast" (CR 601.2a:
 *      the caster is the player announcing the spell).
 *   4. It cannot reduce a cost below {0} (CR 601.2f: "It can't be reduced to
 *      less than {0}"), and never touches coloured pips.
 *   5. It is FILTER-shaped, not type-hard-coded — the same `SpellFilter` a
 *      cast trigger matches against selects it, so a non-matching spell is
 *      left alone and an omitted filter reduces everything.
 *
 * Plus a SERIALIZATION round-trip (`compactState`/`expandState`, not the wire
 * projection): the reduction has to survive the DB hop because the cast it
 * discounts may be announced at any later stable point in the SAME turn.
 *
 * No `projectPublicState` assertion is owed, and for a specific reason rather
 * than an omission: the field rides `PublicGameState`'s `...state` spread
 * un-projected, so there is no reducer between the engine and the client that
 * could drop it. Nothing renders it either — every per-card cost in the UI is
 * the printed `manaCost`, and the only place a post-modifier total is shown is
 * the payment banner, which reads `pendingCast.manaCost` that `announceCast`
 * had already folded these modifiers into.
 */

import { describe, expect, it } from "vitest";
import type { ActivatedAbility, EffectOp } from "../../cards/types";
import { registerTokenDefinition } from "../../cards";
import {
    getCostModifiers,
    resolveTopOfStack,
    applyCostModifiers,
    normalizeManaCost,
    type CardInstanceState,
    type GameState,
} from "../state";
import { finalizeCleanup } from "../phases";
import { validateEffectScript } from "../effects/validate";
import { compactState, expandState } from "../serialize";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";

/** An artifact in hand costing {3} — the shape Urza's +2 discounts. */
const ARTIFACT_ID = "test-cost-reduction-artifact";
registerTokenDefinition({
    id: ARTIFACT_ID,
    name: ARTIFACT_ID,
    rarity: "common",
    manaCost: { X: 3 },
    types: ["Artifact"],
});

/** A CREATURE in hand costing {2}{G} — outside Urza's artifact/instant/sorcery
 *  filter, and carrying a coloured pip so "generic only" stays observable. */
const CREATURE_ID = "test-cost-reduction-creature";
registerTokenDefinition({
    id: CREATURE_ID,
    name: CREATURE_ID,
    rarity: "common",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

/** A {1}{U} instant — inside the filter AND coloured, so the {0} floor and the
 *  "coloured pips are immovable" clause can be asserted on the same card. */
const INSTANT_ID = "test-cost-reduction-instant";
registerTokenDefinition({
    id: INSTANT_ID,
    name: INSTANT_ID,
    rarity: "common",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
});

/** Registers a synthetic DSL-only sorcery carrying `effects`, using the
 *  registry injection seam so `pushSpell`/`resolveTopOfStack` hydrate it
 *  exactly like a real card — the Op is therefore exercised through the REAL
 *  resolution path, not by calling the interpreter leg directly. */
function registerScript(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    });
    return id;
}

/** Urza, Planeswalker's +2 clause as an Effect Script (issue #3340):
 *  "Artifact, instant, and sorcery spells you cast this turn cost {2} less to
 *  cast." */
const URZA_PLUS_TWO: EffectOp[] = [
    {
        op: "reduceSpellCostThisTurn",
        player: "controller",
        amount: { X: 2 },
        filter: { types: ["Artifact", "Instant", "Sorcery"] },
    },
];

/** Puts `cardId` in `playerId`'s hand and returns the instance. */
function addToHand(
    state: GameState,
    playerId: string,
    cardId: string,
    instanceId: string
): CardInstanceState {
    const player = state.players.find((p) => p.id === playerId)!;
    const card = makeInstance(cardId, {
        id: instanceId,
        controllerId: playerId,
        ownerId: playerId,
        zone: "hand",
    });
    player.hand.push(card);
    return card;
}

/** The cost `card` would actually be charged, through the SAME
 *  `getCostModifiers` + `applyCostModifiers` pair every real cast path uses. */
function chargedCost(
    state: GameState,
    card: CardInstanceState,
    cardId: string
): Record<string, number> {
    const cost = normalizeManaCost(
        cardId === ARTIFACT_ID
            ? { X: 3 }
            : cardId === CREATURE_ID
              ? { X: 2, G: 1 }
              : { X: 1, U: 1 }
    );
    applyCostModifiers(cost, getCostModifiers(state, card, "spell"));
    return cost;
}

/** Resolves one copy of the Urza +2 script for `castById`. */
function resolveUrzaPlusTwo(
    state: GameState,
    scriptId: string,
    castById: string
): void {
    pushSpell(state, scriptId, castById);
    resolveTopOfStack(state);
}

describe("Effect Script Op: reduceSpellCostThisTurn (CR 601.2f / 514.2)", () => {
    it("reduces a matching spell's generic cost through getCostModifiers", () => {
        const id = registerScript("test-op-reduce-applies", URZA_PLUS_TWO);
        const state = makeState();
        const artifact = addToHand(state, "p1", ARTIFACT_ID, "art1");

        // Baseline: nothing installed yet, so the announced cost is printed.
        expect(
            getCostModifiers(state, artifact, "spell").reductionGeneric
        ).toBe(0);

        resolveUrzaPlusTwo(state, id, "p1");

        // CR 601.2f — the reduction reaches the single collector, so every cast
        // path and affordability probe sees {3} become {1}.
        expect(
            getCostModifiers(state, artifact, "spell").reductionGeneric
        ).toBe(2);
        expect(chargedCost(state, artifact, ARTIFACT_ID)).toEqual({ X: 1 });
    });

    it("expires at CLEANUP — the same spell costs full price next turn (CR 514.2)", () => {
        const id = registerScript("test-op-reduce-cleanup", URZA_PLUS_TWO);
        const state = makeState();
        const artifact = addToHand(state, "p1", ARTIFACT_ID, "art1");
        resolveUrzaPlusTwo(state, id, "p1");
        expect(chargedCost(state, artifact, ARTIFACT_ID)).toEqual({ X: 1 });

        // The global-flag clear is gated on the CLEANUP step itself
        // (`finalizeCleanup` reads the phase), so an END_STEP call must not
        // wipe a reduction a spell cast in that window still owns.
        state.phase = "CLEANUP";
        finalizeCleanup(state);

        // CR 514.2 — "all 'until end of turn' and 'this turn' effects end".
        expect(state.spellCostReductionsThisTurn).toBeUndefined();
        expect(
            getCostModifiers(state, artifact, "spell").reductionGeneric
        ).toBe(0);
        expect(chargedCost(state, artifact, ARTIFACT_ID)).toEqual({ X: 3 });
    });

    it('does not reduce the OPPONENT\'s spells — "spells YOU cast" (CR 601.2a)', () => {
        const id = registerScript("test-op-reduce-scoped", URZA_PLUS_TWO);
        const state = makeState();
        const mine = addToHand(state, "p1", ARTIFACT_ID, "art-mine");
        const theirs = addToHand(state, "p2", ARTIFACT_ID, "art-theirs");
        resolveUrzaPlusTwo(state, id, "p1");

        expect(chargedCost(state, mine, ARTIFACT_ID)).toEqual({ X: 1 });
        // The opponent announces their own copy: the caster is the player
        // announcing the spell, and they hold no reduction.
        expect(getCostModifiers(state, theirs, "spell").reductionGeneric).toBe(
            0
        );
        expect(chargedCost(state, theirs, ARTIFACT_ID)).toEqual({ X: 3 });
    });

    it("never reduces below {0} and never touches coloured pips (CR 601.2f)", () => {
        // A {4} reduction against a {1}{U} instant: the generic {1} goes to
        // zero and the {U} is immovable — 601.2f reduces only the generic
        // portion, and "it can't be reduced to less than {0}".
        const id = registerScript("test-op-reduce-floor", [
            {
                op: "reduceSpellCostThisTurn",
                player: "controller",
                amount: { X: 4 },
                filter: { types: ["Artifact", "Instant", "Sorcery"] },
            },
        ]);
        const state = makeState();
        const instant = addToHand(state, "p1", INSTANT_ID, "ins1");
        resolveUrzaPlusTwo(state, id, "p1");

        expect(chargedCost(state, instant, INSTANT_ID)).toEqual({ U: 1 });
    });

    it("is filter-shaped — a non-matching spell is untouched, an omitted filter reduces everything", () => {
        const filtered = registerScript(
            "test-op-reduce-filtered",
            URZA_PLUS_TWO
        );
        const state = makeState();
        const creature = addToHand(state, "p1", CREATURE_ID, "cre1");
        const artifact = addToHand(state, "p1", ARTIFACT_ID, "art1");
        resolveUrzaPlusTwo(state, filtered, "p1");

        // The creature is outside `{ types: [Artifact, Instant, Sorcery] }`.
        expect(chargedCost(state, creature, CREATURE_ID)).toEqual({
            X: 2,
            G: 1,
        });
        expect(chargedCost(state, artifact, ARTIFACT_ID)).toEqual({ X: 1 });

        // An UNFILTERED reduction on a fresh board reduces the same creature —
        // proving the exemption above came from the filter, not from some
        // property of the creature.
        const unfiltered = registerScript("test-op-reduce-unfiltered", [
            {
                op: "reduceSpellCostThisTurn",
                player: "controller",
                amount: { X: 2 },
            },
        ]);
        const open = makeState();
        const openCreature = addToHand(open, "p1", CREATURE_ID, "cre1");
        resolveUrzaPlusTwo(open, unfiltered, "p1");
        expect(chargedCost(open, openCreature, CREATURE_ID)).toEqual({ G: 1 });
    });

    it('is ADDITIVE — two resolutions stack to {4} (CR 601.2f "minus all cost reductions")', () => {
        const id = registerScript("test-op-reduce-additive", URZA_PLUS_TWO);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const artifact = addToHand(state, "p1", ARTIFACT_ID, "art1");
        resolveUrzaPlusTwo(state, id, "p1");
        resolveUrzaPlusTwo(state, id, "p1");

        expect(state.spellCostReductionsThisTurn).toHaveLength(2);
        expect(
            getCostModifiers(state, artifact, "spell").reductionGeneric
        ).toBe(4);
        expect(chargedCost(state, artifact, ARTIFACT_ID)).toEqual({});
    });

    it("survives a DB round-trip — a cast announced at a later stable point in the same turn is still discounted", () => {
        const id = registerScript("test-op-reduce-roundtrip", URZA_PLUS_TWO);
        const state = makeState();
        addToHand(state, "p1", ARTIFACT_ID, "art1");
        resolveUrzaPlusTwo(state, id, "p1");

        const restored = expandState(compactState(state));
        expect(restored.spellCostReductionsThisTurn).toEqual([
            {
                playerId: "p1",
                costReduction: { X: 2 },
                filter: { types: ["Artifact", "Instant", "Sorcery"] },
            },
        ]);
        const card = restored.players[0].hand.find((c) => c.id === "art1")!;
        expect(chargedCost(restored, card, ARTIFACT_ID)).toEqual({ X: 1 });
    });

    it("matches colours through getEffectiveColors, so layer 5 counts (CR 105.2 / 613.1e)", () => {
        // A colour filter must read the card's CURRENT colours, not the
        // registry definition's printed ones: `getEffectiveColors` is the ONE
        // declared derivation and folds in layer 5. `colorOverride` REPLACES
        // every other derivation, so a {1}{U} instant laced red is red — a
        // red-filtered reduction must catch it, and a blue-filtered one must
        // not.
        const id = registerScript("test-op-reduce-colour-layer", [
            {
                op: "reduceSpellCostThisTurn",
                player: "controller",
                amount: { X: 1 },
                filter: { colors: ["R"] },
            },
        ]);
        const state = makeState();
        const laced = addToHand(state, "p1", INSTANT_ID, "ins-laced");
        // Printed {1}{U}: without the override the red filter matches nothing.
        expect(getCostModifiers(state, laced, "spell").reductionGeneric).toBe(
            0
        );
        resolveUrzaPlusTwo(state, id, "p1");
        expect(getCostModifiers(state, laced, "spell").reductionGeneric).toBe(
            0
        );

        (laced as unknown as { colorOverride?: string[] }).colorOverride = [
            "R",
        ];
        expect(getCostModifiers(state, laced, "spell").reductionGeneric).toBe(
            1
        );
        expect(chargedCost(state, laced, INSTANT_ID)).toEqual({ U: 1 });
    });

    it("actually reduces by the `generic` spelling at runtime, not just at validation", () => {
        // The validator ACCEPTS `{ generic: 2 }`; its whole justification is
        // "reject amounts that reduce nothing", so the accepted spelling owes
        // a runtime assertion of its own.
        const id = registerScript("test-op-reduce-generic-runtime", [
            {
                op: "reduceSpellCostThisTurn",
                player: "controller",
                amount: { generic: 2 },
            },
        ]);
        const state = makeState();
        const artifact = addToHand(state, "p1", ARTIFACT_ID, "art1");
        resolveUrzaPlusTwo(state, id, "p1");

        expect(
            getCostModifiers(state, artifact, "spell").reductionGeneric
        ).toBe(2);
        expect(chargedCost(state, artifact, ARTIFACT_ID)).toEqual({ X: 1 });
    });

    // ── "You cast" is the ANNOUNCER, which is not always the zone owner ──
    //
    // CR 601.2a: the player who moves the card to the stack "becomes its
    // controller". For a CROSS-PLAYER exile cast (Robber of the Rich, Dauthi
    // Voidwalker) the card stays in the DEFENDER's exile with their
    // `controllerId`, and `castSubjectView` never rewrites it — `castZoneOwner`
    // (`gre/activation.ts`) exists precisely because "the player whose zone
    // holds a card being cast may differ from the CASTER". So reading
    // `card.controllerId` as the caster is wrong in BOTH directions, and both
    // are asserted here.

    /** A card sitting in `ownerId`'s exile under a cast grant to `grantedTo` —
     *  the Robber of the Rich shape: the instance keeps the DEFENDER's
     *  `controllerId`, the caster is somebody else. */
    function exiledUnderGrant(
        state: GameState,
        zoneOwnerId: string,
        grantedTo: string
    ): CardInstanceState {
        const owner = state.players.find((p) => p.id === zoneOwnerId)!;
        const card = makeInstance(ARTIFACT_ID, {
            id: "stolen1",
            controllerId: zoneOwnerId,
            ownerId: zoneOwnerId,
            zone: "exile",
        });
        card.castableFromExileBy = grantedTo;
        owner.exile.push(card);
        return card;
    }

    it("reduces the ANNOUNCER's cast of a card exiled from the opponent's zone", () => {
        const id = registerScript("test-op-reduce-announcer", URZA_PLUS_TWO);
        const state = makeState();
        // p1 holds the reduction and is the caster; the card sits in p2's exile.
        const stolen = exiledUnderGrant(state, "p2", "p1");
        resolveUrzaPlusTwo(state, id, "p1");

        expect(
            getCostModifiers(state, stolen, "spell", undefined, "p1")
                .reductionGeneric
        ).toBe(2);
    });

    it("does NOT reduce when the reduction belongs to the zone owner rather than the announcer", () => {
        const id = registerScript("test-op-reduce-zone-owner", URZA_PLUS_TWO);
        const state = makeState();
        // p2 holds the reduction; p1 is the caster of p2's exiled card. p2's
        // effect must not pay for p1's spell.
        const stolen = exiledUnderGrant(state, "p2", "p1");
        resolveUrzaPlusTwo(state, id, "p2");

        expect(
            getCostModifiers(state, stolen, "spell", undefined, "p1")
                .reductionGeneric
        ).toBe(0);
    });

    // `FixedGenericReduction` makes each of these a COMPILE error at a card's
    // object literal, which is the point of the type. The validator is the
    // authority for a value that reaches the DSL any other way (a compiler
    // emission, a JSON fixture), and that is what these cases exercise — so
    // they cast past the type deliberately.
    const malformed = (amount: unknown, filter?: unknown): EffectOp =>
        ({
            op: "reduceSpellCostThisTurn",
            player: "controller",
            amount,
            ...(filter === undefined ? {} : { filter }),
        }) as unknown as EffectOp;

    // ── Validator: the two amounts that would reduce NOTHING at runtime ──
    //
    // Both of these pass `isManaCost` and would validate cleanly under a naive
    // shape check, then silently do nothing once resolved — which is the
    // failure mode a DSL card author would never see. The validator is what
    // turns each into a filing error.

    it("rejects a VARIABLE {X} amount — a floating reduction has no chosen X to read", () => {
        const errors = validateEffectScript({
            id: "test-host-reduce-x-marker",
            name: "Test Host",
            effects: [malformed({ X: "X" })],
        });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/reduceSpellCostThisTurn/);
        expect(errors[0]).toMatch(/amount/);
    });

    it("rejects a COLOURED-only amount — CR 601.2f reductions never touch coloured pips", () => {
        const errors = validateEffectScript({
            id: "test-host-reduce-coloured",
            name: "Test Host",
            effects: [malformed({ U: 1 })],
        });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/amount/);
    });

    it("rejects a MIXED amount — a coloured pip beside generic would be silently dropped", () => {
        const errors = validateEffectScript({
            id: "test-host-reduce-mixed",
            name: "Test Host",
            effects: [malformed({ generic: 1, U: 1 })],
        });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/amount/);
    });

    it('rejects `colors: ["C"]` — colourless is the absence of colour, so the filter could only match nothing (CR 202.2b)', () => {
        const errors = validateEffectScript({
            id: "test-host-reduce-colourless-filter",
            name: "Test Host",
            effects: [
                {
                    op: "reduceSpellCostThisTurn",
                    player: "controller",
                    amount: { X: 1 },
                    filter: { colors: ["C"] },
                },
            ],
        });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/filter/);
    });

    it("accepts generic carried by the `generic` field, which normalizeManaCost folds into the same total", () => {
        const errors = validateEffectScript({
            id: "test-host-reduce-generic-field",
            name: "Test Host",
            effects: [
                {
                    op: "reduceSpellCostThisTurn",
                    player: "controller",
                    amount: { generic: 2 },
                },
            ],
        });
        expect(errors).toEqual([]);
    });

    it("is SPELL-scoped — an activated ability's cost never sees it (CR 602.2b)", () => {
        const id = registerScript("test-op-reduce-spell-only", [
            {
                op: "reduceSpellCostThisTurn",
                player: "controller",
                amount: { X: 2 },
            },
        ]);
        const state = makeState();
        const onBoard = makeInstance(ARTIFACT_ID, {
            id: "board1",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(onBoard);
        resolveUrzaPlusTwo(state, id, "p1");

        // The Oracle says "spells you cast"; an ability activation is a
        // separate 602.2b cost determination and takes no discount. Asserted
        // with a REAL `ActivatedAbility` handed in, not a bare `undefined`, so
        // the ability arm is genuinely walked: `getCostModifiers` reaches its
        // `kind === "ability"` self-reduction branch and the floating fold is
        // still skipped.
        const ability: ActivatedAbility = {
            id: "test-reduce-ability",
            oracleText: "{3}: Draw a card.",
            // CR 605.1a — NOT a mana ability, so this is the arm a cost
            // reduction could plausibly reach if it were ability-scoped.
            useStack: true,
            cost: { mana: { X: 3 } },
            effects: [{ op: "draw", player: "controller", count: 1 }],
        };
        expect(
            getCostModifiers(state, onBoard, "ability", ability, "p1")
                .reductionGeneric
        ).toBe(0);
        // …and the same board, same ability, priced as a SPELL does take it —
        // so the zero above is the spell/ability boundary and not an inert
        // fixture.
        expect(
            getCostModifiers(state, onBoard, "spell", undefined, "p1")
                .reductionGeneric
        ).toBe(2);
    });
});
