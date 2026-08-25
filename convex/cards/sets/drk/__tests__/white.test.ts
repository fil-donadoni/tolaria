// Per-card behavior tests for white cards in `convex/cards/sets/drk/white.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    angryMob,
    dustToDust,
    exorcist,
    fasting,
    fireAndBrimstone,
    holyLight,
    martyrsCry,
    miracleWorker,
    preacher,
    scarwoodGoblins,
    squire,
    tivadarsCrusade,
    witchHunter,
} from "..";
import {
    UPKEEP,
    answerChoice,
    resolveActivated,
    resolveTrigger,
} from "./helpers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { advancePhase } from "../../../../gre/phases";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import { dominate } from "../../nem/blue";
import {
    type CardInstanceState,
    type GameState,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getCardByName } from "../../../index";

// ---------------------------------------------------------------------------
// Vanilla creatures (CR 302 — Creature cards as pure data: types/subtypes +
// P/T only; values validated against MTGJSON data/json/DRK.json)
// ---------------------------------------------------------------------------

describe("Squire (vanilla creature, CR 302)", () => {
    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, squire.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Angry Mob — turn-conditional CDA P/T (CR 604.3, layer 7a)
// ---------------------------------------------------------------------------

describe("Angry Mob — CDA P/T (CR 604.3 / 102.1)", () => {
    function setup(activePlayerId: string, opponentSwamps: number) {
        const mob = makeInstance(angryMob.id, {
            id: "mob",
            controllerId: "p1",
            ownerId: "p1",
        });
        const swampId = getCardByName("Swamp").id;
        const swamps = Array.from({ length: opponentSwamps }, (_, i) =>
            makeInstance(swampId, {
                id: `swamp-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [mob] }),
                makePlayer("p2", { battlefield: swamps }),
            ],
        });
        return { state, mob };
    }

    it("is 2 + opponents' Swamps during the controller's turn", () => {
        const { state, mob } = setup("p1", 3);
        expect(getEffectivePower(state, mob)).toBe(5); // 2 + 3
        expect(getEffectiveToughness(state, mob)).toBe(5);
    });

    it("is a flat 2/2 during another player's turn", () => {
        const { state, mob } = setup("p2", 3);
        expect(getEffectivePower(state, mob)).toBe(2);
        expect(getEffectiveToughness(state, mob)).toBe(2);
    });

    it("only counts opponents' Swamps, not the controller's", () => {
        const { state, mob } = setup("p1", 0);
        const swampId = getCardByName("Swamp").id;
        state.players[0].battlefield.push(
            makeInstance(swampId, {
                id: "own-swamp",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(getEffectivePower(state, mob)).toBe(2); // own Swamp excluded
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const { state } = setup("p1", 2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "mob"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Exorcist — {1}{W},{T}: destroy target black creature (CR 605 / 701.7)
// ---------------------------------------------------------------------------

describe("Exorcist — destroy target black creature (CR 605 / 701.7)", () => {
    it("destroys the targeted black creature", () => {
        const ex = makeInstance(exorcist.id, { id: "ex", controllerId: "p1" });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ex] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        resolveActivated(state, ex, "exorcist-destroy-black", [
            { type: "permanent", id: "black" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "black")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "black")).toBe(
            true
        );
    });

    it("only lists black creatures as legal targets", () => {
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const white = makeInstance(getCardByName("White Knight").id, {
            id: "white",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [black, white] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            exorcist.activatedAbilities![0].targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("black");
        expect(ids).not.toContain("white");
    });
});

// ---------------------------------------------------------------------------
// Miracle Worker — {T}: destroy target Aura attached to a creature you control
// ---------------------------------------------------------------------------

describe("Miracle Worker — destroy your Aura (CR 605 / 701.8)", () => {
    it("destroys an Aura attached to a creature the controller controls", () => {
        const mw = makeInstance(miracleWorker.id, {
            id: "mw",
            controllerId: "p1",
        });
        const myCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A DRK Brainwash-style Aura would attach here; reuse any Aura in pool.
        const auraId = getCardByName("Holy Strength").id;
        const aura = makeInstance(auraId, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "mine",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mw, myCreature, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, mw, "miracle-worker-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
    });

    // CR 303.4b — the oracle text restricts the target to an Aura attached
    // to a creature the CONTROLLER controls. `attachedToFilter` (issue
    // #1853) enforces this at target SELECTION (getLegalTargets /
    // selectTarget), not resolution — CR 608.2b's resolution-time re-check
    // is deliberately zone-existence-only for permanent targets
    // (`isTargetStillLegal`, gre/state.ts), so an Aura on an opponent's
    // creature is illegal because it was never offered in the first place,
    // not because resolve() refuses it after the fact.
    it("does NOT offer an Aura on an opponent's creature as a legal target", () => {
        const theirCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const theirAura = makeInstance(getCardByName("Holy Strength").id, {
            id: "aura-theirs",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "theirs",
        });
        const myCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const myAura = makeInstance(getCardByName("Holy Strength").id, {
            id: "aura-mine",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "mine",
        });
        const mw = makeInstance(miracleWorker.id, {
            id: "mw",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mw, myCreature, myAura] }),
                makePlayer("p2", { battlefield: [theirCreature, theirAura] }),
            ],
        });
        const req = miracleWorker.activatedAbilities!.find(
            (a) => a.id === "miracle-worker-destroy-aura"
        )!.targetRequirement!;
        const ids = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1").map(
            (t) => t.id
        );
        expect(ids).toContain("aura-mine");
        expect(ids).not.toContain("aura-theirs");
    });

    // CR 608.2b (issue #1853 review) — defense-in-depth restoration. The
    // OFFERED-set test above proves a real player can never HAND-PICK this
    // target; this one proves that even a target placed on the stack by
    // some other means (a hostile mutation, a future bug in the offered-set
    // gate itself) still doesn't resolve, because `isTargetStillLegal`
    // re-checks the SAME `attachedToFilter` at resolution
    // (`permanentTargetStillMeetsRestrictions`, gre/state.ts) — the
    // resolution-time half of the single ADR 0068 authority, not a second
    // hand-written rule. Was deleted when the offered-set fix shipped on the
    // (wrong) premise that CR 608.2b's resolution recheck is permanently
    // zone-existence-only for permanents; restored now that it isn't.
    it("does NOT destroy an Aura on an opponent's creature, even pushed directly onto the stack", () => {
        const mw = makeInstance(miracleWorker.id, {
            id: "mw",
            controllerId: "p1",
        });
        const theirCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(getCardByName("Holy Strength").id, {
            id: "aura",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "theirs",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mw] }),
                makePlayer("p2", { battlefield: [theirCreature, aura] }),
            ],
        });
        resolveActivated(state, mw, "miracle-worker-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        // Host is an opponent's creature → the resolution-time filter
        // re-check refuses the illegal target; the ability fizzles.
        expect(
            state.players[1].battlefield.find((c) => c.id === "aura")
        ).toBeDefined();
    });

    // The reviewer's exact probe (issue #1853 review, finding 1): the target
    // is LEGAL when chosen (own Aura on own creature), then an intervening
    // effect at instant speed changes the host's controller before Miracle
    // Worker resolves (Dominate, NEM — "gain control of target creature").
    // CR 608.2b: "changes to the game state may cause a target to no longer
    // be legal... its characteristics may have changed" — the Aura's host is
    // no longer a creature ITS CONTROLLER controls, so the ability must
    // fizzle rather than destroy it.
    it("a legally-chosen target that becomes illegal mid-stack (Dominate on the host) survives (CR 608.2b)", () => {
        const mw = makeInstance(miracleWorker.id, {
            id: "mw",
            controllerId: "p1",
        });
        const myCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(getCardByName("Holy Strength").id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "mine",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mw, myCreature, aura] }),
                makePlayer("p2"),
            ],
        });
        // Miracle Worker activates first, targeting the (legal) own-Aura —
        // it sits on the stack waiting for both players to pass.
        state.stack.push({
            ...mw,
            zone: "stack",
            castById: "p1",
            abilityId: "miracle-worker-destroy-aura",
            targets: [{ type: "permanent", id: "aura" }],
        });
        // p2 responds with Dominate on the host creature — resolves FIRST
        // (LIFO), handing "mine" to p2 before Miracle Worker gets to.
        pushSpell(state, dominate.id, "p2", [
            { type: "permanent", id: "mine" },
        ]);
        resolveTopOfStack(state); // Dominate resolves — "mine" changes hands
        expect(
            state.players
                .find((p) => p.id === "p2")!
                .battlefield.find((c) => c.id === "mine")
        ).toBeDefined();
        resolveTopOfStack(state); // Miracle Worker resolves — target now illegal
        // The Aura survives: its host is a creature p1 (the controller) no
        // longer controls, so `attachedToFilter`'s `controlledBy: "you"`
        // fails at resolution and the ability fizzles.
        expect(
            state.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === "aura")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Witch Hunter — ping + bounce (CR 605 / 119 / 400.7)
// ---------------------------------------------------------------------------

describe("Witch Hunter — ping a player and bounce a creature", () => {
    it("deals 1 damage to the targeted player", () => {
        const wh = makeInstance(witchHunter.id, {
            id: "wh",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wh] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wh, "witch-hunter-ping", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });

    it("returns an opponent's creature to its owner's hand", () => {
        const wh = makeInstance(witchHunter.id, {
            id: "wh",
            controllerId: "p1",
        });
        const creature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wh] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        resolveActivated(state, wh, "witch-hunter-bounce", [
            { type: "permanent", id: "lion" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "lion")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "lion")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Preacher — control gain "for as long as this remains tapped" (CR 611.2b)
// ---------------------------------------------------------------------------

describe("Preacher — steal a creature while tapped (CR 611.2b)", () => {
    function setup() {
        const pr = makeInstance(preacher.id, {
            id: "preacher",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true, // {T} cost already paid
        });
        const victim = makeInstance(getCardByName("Savannah Lions").id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pr] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state };
    }

    it("the opponent chooses the creature, control moves to the activator", () => {
        const { state } = setup();
        // Target the opponent (player); the opponent then picks the creature.
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "preacher-steal",
            [{ type: "player", id: "p2" }]
        );
        // requestChoice suspended → opponent picks the victim.
        answerChoice(state, ["victim"]);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "victim")
                ?.controllerId
        ).toBe("p1");
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
    });

    it("control reverts the instant Preacher untaps (source-tapped lapses)", () => {
        const { state } = setup();
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "preacher-steal",
            [{ type: "player", id: "p2" }]
        );
        answerChoice(state, ["victim"]);
        checkStateBasedActions(state);
        // Untap Preacher → condition lapses → revert.
        const pr = state.players[0].battlefield.find(
            (c) => c.id === "preacher"
        )!;
        pr.isTapped = false;
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
                ?.controllerId
        ).toBe("p2");
    });
});

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

describe("Dust to Dust — exile two target artifacts (CR 701.13)", () => {
    it("exiles both targeted artifacts", () => {
        const art1 = makeInstance(getCardByName("Ornithopter").id, {
            id: "a1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const art2 = makeInstance(getCardByName("Ornithopter").id, {
            id: "a2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [art1, art2] }),
            ],
        });
        pushSpell(state, dustToDust.id, "p1", [
            { type: "permanent", id: "a1" },
            { type: "permanent", id: "a2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "a1",
            "a2",
        ]);
    });
});

describe("Tivadar's Crusade — destroy all Goblins (CR 701.8 / 205.3)", () => {
    it("destroys Goblins and leaves non-Goblins alone", () => {
        const goblin = makeInstance(scarwoodGoblins.id, {
            id: "gob",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [goblin, bear] }),
            ],
        });
        pushSpell(state, tivadarsCrusade.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "gob")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeDefined();
    });
});

describe("Holy Light — nonwhite creatures get -1/-1 (CR 611.2 / 202.2)", () => {
    it("weakens nonwhite creatures but spares white ones", () => {
        const white = makeInstance(getCardByName("White Knight").id, {
            id: "white",
            controllerId: "p1",
            ownerId: "p1",
        });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [white] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        const whiteP = getEffectivePower(state, white);
        const whiteT = getEffectiveToughness(state, white);
        pushSpell(state, holyLight.id, "p1");
        resolveTopOfStack(state);
        // White unchanged.
        expect(getEffectivePower(state, white)).toBe(whiteP);
        expect(getEffectiveToughness(state, white)).toBe(whiteT);
        // Black Knight (2/2) → 1/1.
        expect(getEffectivePower(state, black)).toBe(1);
        expect(getEffectiveToughness(state, black)).toBe(1);
    });
});

describe("Martyr's Cry — exile white creatures, draw per exiled (CR 701.13 / 121.1)", () => {
    it("exiles all white creatures and each controller draws one per exiled", () => {
        const w1 = makeInstance(getCardByName("White Knight").id, {
            id: "w1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const w2 = makeInstance(getCardByName("Savannah Lions").id, {
            id: "w2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const libCard = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "lib",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [w1] }),
                makePlayer("p2", {
                    battlefield: [w2, black],
                    library: [libCard],
                }),
            ],
        });
        pushSpell(state, martyrsCry.id, "p1");
        resolveTopOfStack(state);
        // White creatures exiled; black survives.
        expect(
            state.players[0].battlefield.find((c) => c.id === "w1")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "w2")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "black")
        ).toBeDefined();
        // p2 controlled one exiled white creature → drew one card.
        expect(state.players[1].hand.some((c) => c.id === "lib")).toBe(true);
    });
});

describe("Fire and Brimstone — 4 to a player who attacked + 4 to you (CR 506.2 / 119)", () => {
    function attackerState() {
        // p2 controls a creature flagged as having attacked this turn.
        const attacker = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            hasAttackedThisTurn: true,
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
    }

    it("only a player who attacked this turn is a legal target", () => {
        const state = attackerState();
        const legal = getLegalTargets(
            state,
            fireAndBrimstone.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("p2"); // attacked
        expect(ids).not.toContain("p1"); // did not attack
    });

    it("deals 4 to the attacker and 4 to the caster", () => {
        const state = attackerState();
        pushSpell(state, fireAndBrimstone.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16); // 20 - 4
        expect(state.players[0].life).toBe(16); // 20 - 4 to you
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Fasting — DRK C7. {W} Enchantment (#424). Three abilities (modern oracle,
// ADR 0004):
//   1. CR 603.6a upkeep — put a hunger counter, then destroy at five or more.
//   2. CR 504/614 — "you may skip your draw step; if you do, gain 2 life"
//      (Island Sanctuary `drawStepReplacement` precedent + DRAW phaseTrigger).
//   3. CR 121.1 — "when you draw a card, destroy this enchantment" (new
//      CARD_DRAWN event via the `drawTrigger` factory).
// ───────────────────────────────────────────────────────────────────────────
describe("Fasting (CR 504/614 skip-draw + CR 603.6a hunger counters)", () => {
    /** Answer the head pending choice (mirrors the Island Sanctuary harness). */
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const stackItem = state.stack.find((s) => s.id === head.stackItemId)!;
        stackItem.collectedChoices = {
            ...(stackItem.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    function makeFasting(counters?: Record<string, number>): CardInstanceState {
        return makeInstance(fasting.id, {
            id: "fast",
            controllerId: "p1",
            ownerId: "p1",
            ...(counters ? { counters } : {}),
        });
    }

    function libraryCard(id = "lib-top"): CardInstanceState {
        return makeInstance(getCardByName("Squire").id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
    }

    // (a) Skip-draw golden path: gain 2 life, no card drawn.
    it("on skip, gains 2 life and draws no card (CR 504/119.3)", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", {
            battlefield: [fast],
            library: [libraryCard()],
            life: 20,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });

        // UPKEEP → DRAW: the DRAW phase-begin draw-skip trigger lands on the
        // stack (the upkeep trigger already fired on entering UPKEEP, which we
        // skip past here by starting at UPKEEP).
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fasting-draw-skip"
            )
        ).toBe(true);
        resolveTopOfStack(state); // suspends at the may-skip choice
        expect(state.pendingChoices).toHaveLength(1);

        commitHead(state, ["yes"]);
        resolveTopOfStack(state);

        expect(p1.life).toBe(22);
        expect(p1.hand).toHaveLength(0);
        // Still on the battlefield — no draw happened, so the self-destruct
        // draw trigger never fired.
        expect(p1.battlefield.some((c) => c.id === "fast")).toBe(true);
    });

    // (c) Drawing a card (declining the skip) destroys Fasting.
    it("on decline, draws the card and destroys Fasting (CR 121.1)", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", {
            battlefield: [fast],
            library: [libraryCard()],
            life: 20,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });

        advancePhase(state); // → DRAW, draw-skip trigger on stack
        resolveTopOfStack(state); // draw-skip trigger suspends at choice
        commitHead(state, ["no"]);
        resolveTopOfStack(state); // declines → draws a card → emits CARD_DRAWN

        // The card was drawn.
        expect(p1.hand.some((c) => c.id === "lib-top")).toBe(true);
        expect(p1.life).toBe(20);
        // The CARD_DRAWN self-destruct trigger is now on the stack; resolve it.
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fasting-draw-destroy"
            )
        ).toBe(true);
        resolveTopOfStack(state);
        expect(p1.battlefield.some((c) => c.id === "fast")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "fast")).toBe(true);
    });

    it("any draw (effect-driven) destroys Fasting (CR 121.1)", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", {
            battlefield: [fast],
            library: [libraryCard()],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "PRECOMBAT_MAIN",
        });
        // An effect-driven draw (any source) emits CARD_DRAWN at the engine's
        // draw choke point; scan it as resolveTopOfStack does post-resolution.
        p1.hand.push(p1.library.shift()!);
        state.pendingEvents = [
            {
                type: "CARD_DRAWN",
                playerId: "p1",
                count: 1,
                isTurnBasedDrawStepDraw: false,
            },
        ];
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fasting-draw-destroy"
            )
        ).toBe(true);
        resolveTopOfStack(state);
        expect(p1.battlefield.some((c) => c.id === "fast")).toBe(false);
    });

    it('an opponent\'s draw does NOT destroy Fasting (CR 121 — "you draw")', () => {
        const fast = makeFasting();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fast] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            turn: 2,
        });
        state.pendingEvents = [
            {
                type: "CARD_DRAWN",
                playerId: "p2",
                count: 1,
                isTurnBasedDrawStepDraw: false,
            },
        ];
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fasting-draw-destroy"
            )
        ).toBe(false);
        expect(state.players[0].battlefield.some((c) => c.id === "fast")).toBe(
            true
        );
    });

    // (b) Hunger counter added each upkeep; destroyed at five or more.
    it("upkeep adds a hunger counter (CR 122.1)", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", { battlefield: [fast], library: [] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        resolveTrigger(state, fast, "fasting-upkeep-hunger", UPKEEP("p1"));
        const onBoard = p1.battlefield.find((c) => c.id === "fast")!;
        expect(onBoard.counters?.hunger).toBe(1);
    });

    it("destroyed when it reaches five hunger counters (CR 603)", () => {
        // Start with four; the fifth upkeep counter triggers destruction.
        const fast = makeFasting({ hunger: 4 });
        const p1 = makePlayer("p1", { battlefield: [fast] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        resolveTrigger(state, fast, "fasting-upkeep-hunger", UPKEEP("p1"));
        expect(p1.battlefield.some((c) => c.id === "fast")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "fast")).toBe(true);
    });

    it("not destroyed below five hunger counters", () => {
        const fast = makeFasting({ hunger: 3 });
        const p1 = makePlayer("p1", { battlefield: [fast] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        resolveTrigger(state, fast, "fasting-upkeep-hunger", UPKEEP("p1"));
        const onBoard = p1.battlefield.find((c) => c.id === "fast");
        expect(onBoard).toBeDefined();
        expect(onBoard!.counters?.hunger).toBe(4);
    });

    // Backend boundary: the may-skip choice resolves via applyMayPaySubmit
    // (the same path game.ts's submitMayPay mutation drives).
    it("backend may-pay path: accepting the skip gains 2 life", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", {
            battlefield: [fast],
            library: [libraryCard()],
            life: 20,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "DRAW",
                    activePlayerId: "p1",
                } as never,
            ]).filter((t) => t.triggeredAbilityId === "fasting-draw-skip")
        );
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(p1.life).toBe(22);
        expect(p1.hand).toHaveLength(0);
    });
});
