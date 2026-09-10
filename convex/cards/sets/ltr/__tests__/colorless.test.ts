// LTR — colorless card tests (ADR 0043 split). Mirrors sets/ltr/colorless.ts.
//
// The One Ring (issue #674) is a DSL card whose {T} draw and upkeep drain reuse
// already-exercised Ops (`counters` / `draw` / `loseLife` + the `counters`
// EffectValue), so the catalogue sweeps cover those. What earns hand-written
// tests here is the card's genuinely NEW capability: PLAYER-scoped protection
// from everything (CR 702.16b/e/i via CR 115.4). Its two clauses — untargetable
// and all damage prevented — plus the "until your next turn" boundary only
// manifest against a LATER spell / damage event / turn change, which is exactly
// what the canned scenario generator cannot model (hence the Op's explicit
// skip there).

import { describe, it, expect } from "vitest";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    applyPlayerDamagePrevention,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    getLegalTargets,
    playerHasProtectionFromEverything,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { advancePhase } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import type { CardType, TargetRequirement } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getDefinition } from "../../../index";

const theOneRing = getDefinition("d5806e68-1054-458e-866d-1f2470f682b2");
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

/** Per-set shim (mirrors `resolveActivated` in this set's multicolor tests):
 *  pushes an already-paid activated ability onto the stack and resolves it,
 *  bypassing the cost/targeting choreography tested elsewhere. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Per-set shim (mirrors `fireTrigger`, atq/__tests__/helpers.ts): pushes a
 *  triggered ability with the same shape `collectTriggers` builds, then
 *  resolves it. */
function fireTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        id: `trig-${triggeredAbilityId}`,
        castById: source.controllerId,
        zone: "stack",
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    });
    resolveTopOfStack(state);
}

function makeRing(
    controllerId = "p1",
    counters?: Record<string, number>
): CardInstanceState {
    return makeInstance(theOneRing.id, {
        id: "ring1",
        controllerId,
        ownerId: controllerId,
        ...(counters ? { counters } : {}),
    });
}

describe("The One Ring — ETB protection from everything (CR 603.4 'if you cast it', CR 702.16b/e/i)", () => {
    it("grants its controller protection from everything when CAST", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, theOneRing.id, "p1");
        // CR 601.2i — resolving the cast stamps `wasCast: true` on the
        // PERMANENT_ENTERED event, so the CR 603.4 condition passes and the
        // trigger goes on the stack.
        resolveTopOfStack(state);
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "the-one-ring-etb-protection"
        );
        expect(trigger).toBeDefined();
        resolveTopOfStack(state);

        expect(playerHasProtectionFromEverything(state, "p1")).toBe(true);
        expect(playerHasProtectionFromEverything(state, "p2")).toBe(false);

        // Wire format — the client's nameplate target gate reads this off the
        // projection (`usePlayerInteraction`), so a stripped field would leave
        // a protected player looking clickable.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.playerProtectionFromEverything).toEqual(["p1"]);
    });

    it("grants NOTHING when The One Ring enters without being cast (CR 603.4)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // A reanimation-shaped entry: a direct zone move, never a cast spell.
        const entered = makeRing("p1");
        entered.zone = "battlefield";
        state.players[0].battlefield.push(entered);
        state.pendingEvents = [
            ...(state.pendingEvents ?? []),
            {
                type: "PERMANENT_ENTERED",
                instanceId: entered.id,
                controllerId: "p1",
                cardId: theOneRing.id,
                types: ["Artifact"],
                // wasCast omitted — this is the point of the test.
            },
        ];
        const before = state.stack.length;
        processPendingActionTriggers(state);
        expect(state.stack.length).toBe(before);
        expect(playerHasProtectionFromEverything(state, "p1")).toBe(false);
    });
});

describe("The One Ring — protection bars targeting (CR 702.16b applied to a player via CR 115.4)", () => {
    it("getLegalTargets drops the protected player from the player candidates", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            playerProtectionFromEverything: ["p1"],
        });
        const req: TargetRequirement = { type: "player", count: 1 };
        // p1 is barred, p2 (unprotected) still offered — no regression.
        expect(getLegalTargets(state, req, NO_TARGETING_SOURCE)).toEqual([
            { type: "player", id: "p2" },
        ]);
    });

    it("bars the protected player's OWN spells too (protection from EVERYTHING has no controller exception)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            playerProtectionFromEverything: ["p1"],
        });
        const req: TargetRequirement = { type: "any", count: 1 };
        // `casterId` is p1 themselves — a hexproof-style controller exception
        // would keep p1 in the list; protection from everything does not have
        // one (CR 702.16i).
        const targets = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1");
        expect(targets).not.toContainEqual({ type: "player", id: "p1" });
        expect(targets).toContainEqual({ type: "player", id: "p2" });
    });

    it("backend gate: mirrors the exact decision game.ts::selectTarget's player branch makes (server-authoritative)", () => {
        // `selectTarget`'s player branch calls the SAME predicate and throws
        // when it returns true — the offered set (`getLegalTargets`, above)
        // and the accepted set can't diverge because both read this one
        // authority. Replicated here the same way the #1128 player-shroud
        // suite replicates its own backend gate.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            playerProtectionFromEverything: ["p1"],
        });
        expect(playerHasProtectionFromEverything(state, "p1")).toBe(true);
        expect(playerHasProtectionFromEverything(state, "p2")).toBe(false);
    });
});

describe("The One Ring — protection prevents all damage (CR 702.16e)", () => {
    it("a burn spell resolving at the protected player deals nothing", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            playerProtectionFromEverything: ["p1"],
        });
        const before = state.players[0].life;
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before);
        // The unprotected player is unaffected — no blanket regression.
        const beforeP2 = state.players[1].life;
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(beforeP2 - 3);
    });

    it("prevents at the shared chokepoint every player-damage sink routes through (combat included)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            playerProtectionFromEverything: ["p1"],
        });
        // `applyPlayerDamagePrevention` is the single function the spell,
        // redirect and combat-damage sinks all call, so asserting it here
        // covers combat damage without staging a whole combat.
        expect(
            applyPlayerDamagePrevention(state, "p1", "src1", undefined, 7)
        ).toBe(0);
        expect(
            applyPlayerDamagePrevention(state, "p2", "src1", undefined, 7)
        ).toBe(7);
    });

    it("spends no finite prevention shield on damage that was never going to land", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            playerProtectionFromEverything: ["p1"],
            playerDamagePrevention: [
                {
                    playerId: "p1",
                    match: {},
                    mode: "all",
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        });
        expect(
            applyPlayerDamagePrevention(state, "p1", "src1", undefined, 3)
        ).toBe(0);
        // The shield is untouched — protection ran first (CR 615.1).
        expect(state.playerDamagePrevention).toEqual([
            {
                playerId: "p1",
                match: {},
                mode: "all",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ]);
    });
});

describe("The One Ring — 'until your next turn' boundary (CR 702.16, issue #674)", () => {
    it("survives the opponent's whole turn and clears at the start of the grantee's own next turn", () => {
        // p1's turn ending (CLEANUP); one advancePhase crosses into p2's turn.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "CLEANUP",
            playerProtectionFromEverything: ["p1"],
        });
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        // Still protected — the whole point of the card is covering the
        // opponent's turn, so this boundary is NOT cleanup.
        expect(playerHasProtectionFromEverything(state, "p1")).toBe(true);

        state.phase = "CLEANUP";
        state.priorityPlayerId = "p2";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        expect(playerHasProtectionFromEverything(state, "p1")).toBe(false);
        expect(state.playerProtectionFromEverything).toBeUndefined();
    });

    it("clears only the grantee's entry when both players are protected", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "CLEANUP",
            playerProtectionFromEverything: ["p1", "p2"],
        });
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.playerProtectionFromEverything).toEqual(["p1"]);
    });
});

describe("The One Ring — burden counters (CR 122.1 / 122.6)", () => {
    it("{T} puts a burden counter on, THEN draws for the count including it", () => {
        const ring = makeRing("p1");
        // `makePlayer` seeds an EMPTY library — stock one deep enough for two
        // activations (1 + 2 cards).
        const library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(lightningBolt.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ring], library }),
                makePlayer("p2"),
            ],
        });
        const libraryBefore = state.players[0].library.length;
        const handBefore = state.players[0].hand.length;

        resolveActivated(state, ring, "the-one-ring-draw");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "ring1"
        )!;
        // First activation: 1 counter → 1 card (not 0 — the counter goes on
        // first and the draw reads the live count).
        expect(after.counters).toEqual({ burden: 1 });
        expect(state.players[0].hand.length).toBe(handBefore + 1);
        expect(state.players[0].library.length).toBe(libraryBefore - 1);

        // Second activation: 2 counters → 2 cards.
        after.isTapped = false;
        resolveActivated(state, after, "the-one-ring-draw");
        const after2 = state.players[0].battlefield.find(
            (c) => c.id === "ring1"
        )!;
        expect(after2.counters).toEqual({ burden: 2 });
        expect(state.players[0].hand.length).toBe(handBefore + 3);
    });

    it("upkeep trigger loses 1 life per burden counter", () => {
        const ring = makeRing("p1", { burden: 3 });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].life;
        fireTrigger(state, ring, "the-one-ring-upkeep-burden", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        expect(state.players[0].life).toBe(before - 3);
    });

    it("upkeep trigger costs nothing with no burden counters yet (no intervening-if)", () => {
        const ring = makeRing("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].life;
        fireTrigger(state, ring, "the-one-ring-upkeep-burden", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        expect(state.players[0].life).toBe(before);
    });

    it("the upkeep trigger fires only on its controller's upkeep (CR 603.6a)", () => {
        const trigger = theOneRing.triggeredAbilities!.find(
            (a) => a.id === "the-one-ring-upkeep-burden"
        )!;
        const self = {
            id: "ring1",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const event = (activePlayerId: string) =>
            ({
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId,
            }) as const;
        expect(trigger.matches(event("p1"), self)).toBe(true);
        expect(trigger.matches(event("p2"), self)).toBe(false);
    });
});

// Palantír of Orthanc (issue #3243). The DSL card's individual Ops are all
// already-exercised (`counters` / `scryReorder` / `mayPay` / `draw` / `mill`),
// so the per-Op regime covers them; what earns hand-written tests here is the
// FULL PATH the card is the first to walk end to end — an opponent-made
// may-choice inside the controller's own trigger, whose decline branch mills a
// counter-scaled X and drains the opponent for the total mana value of exactly
// those cards (the `sum` value member's first consumer).
describe("Palantír of Orthanc — the opponent's choice and its punisher (CR 117.3a / 122.6 / 202.3)", () => {
    const palantir = getDefinition("6efb6a69-562c-4d95-858d-b067444cfd7e");
    /** MV 4 over MV 1 — a total of 5, and each distinguishable from the other
     *  so a half-counted set is not mistaken for a correct one. */
    const bolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

    function makePalantir(counters?: Record<string, number>) {
        return makeInstance(palantir.id, {
            id: "palantir1",
            controllerId: "p1",
            ownerId: "p1",
            ...(counters ? { counters } : {}),
        });
    }

    /** p1 holds The One Ring (MV 4) over Lightning Bolt (MV 1) on top of a
     *  library deep enough for the scry to look at two. */
    function palantirState(library = [theOneRing.id, bolt.id, bolt.id]) {
        const permanent = makePalantir({ influence: 1 });
        return {
            state: makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [permanent],
                        library: library.map((defId, i) =>
                            makeInstance(defId, {
                                id: `lib-${i}`,
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "library",
                            })
                        ),
                    }),
                    makePlayer("p2"),
                ],
            }),
            permanent,
        };
    }

    /** Fire the end-step trigger at `p2` and answer the scry by keeping
     *  everything looked at on top, so the mill below sees the same order the
     *  fixture declared. Returns the may-pay choice the opponent now owns. */
    function fireEndStep(state: GameState, permanent: CardInstanceState) {
        state.stack.push({
            ...permanent,
            id: "trig-palantir",
            castById: "p1",
            zone: "stack",
            triggeredAbilityId: "palantir-of-orthanc-end-step",
            triggerSourceId: permanent.id,
            triggerEvent: { type: "PHASE_BEGIN", phase: "END_STEP" },
            targets: [{ type: "player", id: "p2" }],
        } as StackItem);
        // Suspends on the scry (CR 701.22) before the opponent's decision —
        // unless the library is empty, which makes the look a clean no-op
        // (CR 608.2b) and lands straight on the may-pay.
        expect(resolveTopOfStack(state)).toBeNull();
        const scry = state.pendingChoices![0];
        if (scry.kind === "order-top") {
            expect(scry.playerId).toBe("p1");
            applyPendingChoiceSubmit(state, {
                playerId: scry.playerId,
                stackItemId: scry.stackItemId,
                step: scry.step,
                choiceId: scry.choiceId,
                cardInstanceIds: [...(scry.candidateIds ?? [])],
                secondZoneIds: [],
            });
        }
        return state.pendingChoices?.[0];
    }

    it("adds an influence counter and hands the DECISION to the targeted opponent", () => {
        const { state, permanent } = palantirState();
        const mayPay = fireEndStep(state, permanent);

        // CR 122.1 — the counter goes on before the mill reads the count.
        expect(
            state.players[0].battlefield.find((c) => c.id === permanent.id)
                ?.counters?.influence
        ).toBe(2);
        // CR 117.3a — the choice belongs to the ANNOUNCED opponent, not to the
        // controller of the trigger. A controller-locked `mayPay` would put
        // p1's own name here and let the Palantír's controller decline for
        // them.
        expect(mayPay?.kind).toBe("may-pay");
        expect(mayPay?.playerId).toBe("p2");
    });

    it("the offer is ADDRESSED to the chooser — only p2 can answer it (CR 117.3a)", () => {
        const { state, permanent } = palantirState();
        fireEndStep(state, permanent);
        // The projection ships `pendingChoices` verbatim to BOTH seats, so a
        // prompt's TEXT is visible to the non-chooser as well — an engine-wide
        // property of every choice, not of this card, tracked by issue #1982.
        // What IS this card's to guarantee is the ADDRESSING: the offer names
        // p2, and the submit path refuses anyone else.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0].playerId).toBe("p2");
        expect(() =>
            applyMayPaySubmit(state, { playerId: "p1", accept: true })
        ).toThrow();
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("ACCEPTING makes the Palantír's controller draw, and nothing is milled", () => {
        const { state, permanent } = palantirState();
        const mayPay = fireEndStep(state, permanent)!;
        const life = state.players[1].life;
        applyMayPaySubmit(state, { playerId: "p2", accept: true });

        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib-0"]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].life).toBe(life);
        expect(mayPay.playerId).toBe("p2");
    });

    it("DECLINING mills X and drains the decliner for the total mana value of those cards", () => {
        const { state, permanent } = palantirState();
        fireEndStep(state, permanent);
        const life = state.players[1].life;
        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        // Two influence counters → mill 2: The One Ring (MV 4) + a Lightning
        // Bolt (MV 1) = 5 life, in ONE loss (CR 118.2), and paid by the player
        // who declined — not by the Palantír's controller.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "lib-0",
            "lib-1",
        ]);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[1].life).toBe(life - 5);
        expect(state.players[0].life).toBe(20);
    });

    it("a library SHORTER than X mills what it has and drains only for that (CR 608.2)", () => {
        const { state, permanent } = palantirState([bolt.id]);
        fireEndStep(state, permanent);
        const life = state.players[1].life;
        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["lib-0"]);
        expect(state.players[1].life).toBe(life - 1);
    });

    it("an EMPTY library mills nothing and loses 0 life — the clause still resolves", () => {
        const { state, permanent } = palantirState([]);
        fireEndStep(state, permanent);
        const life = state.players[1].life;
        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].life).toBe(life);
        // The trigger finished rather than staying suspended on an unresolved
        // amount — the failure mode a CR 608.2b `undefined` sum would produce.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});
