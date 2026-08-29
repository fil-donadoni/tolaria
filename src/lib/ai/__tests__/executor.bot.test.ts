// Bot executor (ADR 0001, issue #110): every Move kind fires the correct
// EXISTING mutation sequence, on the bot seat, with the right args. This is the
// client side of the GRE→game.ts contract — it catches wrong-mutation,
// wrong-seat, and wrong-order bugs before they reach the server.
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Move } from "@convex/gre";
import { executeMove, type MoveMutations } from "../executor";

const GAME = "game1" as Id<"games">;
const BOT = "u1-p2";
const GP = { gameId: GAME, playerId: BOT };

function fakeMutations() {
    const m: Record<keyof MoveMutations, ReturnType<typeof vi.fn>> = {
        playCard: vi.fn().mockResolvedValue(null),
        summonCompanion: vi.fn().mockResolvedValue(null),
        turnPermanentFaceUp: vi.fn().mockResolvedValue(null),
        announceCast: vi.fn().mockResolvedValue(null),
        selectTarget: vi.fn().mockResolvedValue(null),
        selectTargets: vi.fn().mockResolvedValue(null),
        confirmTargets: vi.fn().mockResolvedValue(null),
        tapForPayment: vi.fn().mockResolvedValue(null),
        activateManaAbility: vi.fn().mockResolvedValue(null),
        activateAbility: vi.fn().mockResolvedValue(null),
        activatePlayerAbility: vi.fn().mockResolvedValue(null),
        tapForActivationPayment: vi.fn().mockResolvedValue(null),
        selectSacrifice: vi.fn().mockResolvedValue(null),
        selectActivationCost: vi.fn().mockResolvedValue(null),
        selectActivationExileCost: vi.fn().mockResolvedValue(null),
        selectActivationDiscardCost: vi.fn().mockResolvedValue(null),
        toggleAttacker: vi.fn().mockResolvedValue(null),
        confirmAttackers: vi.fn().mockResolvedValue(null),
        selectBlocker: vi.fn().mockResolvedValue(null),
        assignBlockerTarget: vi.fn().mockResolvedValue(null),
        confirmBlockers: vi.fn().mockResolvedValue(null),
        confirmDamage: vi.fn().mockResolvedValue(null),
        declareMulligan: vi.fn().mockResolvedValue(null),
        submitResolutionChoice: vi.fn().mockResolvedValue(null),
        submitMayPay: vi.fn().mockResolvedValue(null),
        submitMadnessDecline: vi.fn().mockResolvedValue(null),
        submitReboundDecline: vi.fn().mockResolvedValue(null),
        submitLandEntryChoice: vi.fn().mockResolvedValue(null),
        submitDrawReplacementPay: vi.fn().mockResolvedValue(null),
        submitNameCard: vi.fn().mockResolvedValue(null),
        submitRandomRevealAck: vi.fn().mockResolvedValue(null),
        passPriority: vi.fn().mockResolvedValue(null),
    };
    return m as unknown as MoveMutations &
        Record<keyof MoveMutations, ReturnType<typeof vi.fn>>;
}

function run(move: Move) {
    const m = fakeMutations();
    return executeMove(move, { gameId: GAME, botId: BOT, mutations: m }).then(
        () => m
    );
}

describe("executeMove (issue #110)", () => {
    it("pass → passPriority on the bot seat", async () => {
        const m = await run({ kind: "pass" });
        expect(m.passPriority).toHaveBeenCalledWith(GP);
    });

    it("mulligan → declareMulligan with the decision", async () => {
        const m = await run({ kind: "mulligan", decision: "keep" });
        expect(m.declareMulligan).toHaveBeenCalledWith({
            ...GP,
            decision: "keep",
        });
    });

    it("mulligan (mull) → declareMulligan with decision mull", async () => {
        const m = await run({ kind: "mulligan", decision: "mull" });
        expect(m.declareMulligan).toHaveBeenCalledWith({
            ...GP,
            decision: "mull",
        });
    });

    it("mulligan-bottom → submitResolutionChoice with the choice identity", async () => {
        const m = await run({
            kind: "mulligan-bottom",
            stackItemId: "mulligan",
            step: 0,
            choiceId: "mulligan-bottom-u1-p2",
            cardInstanceIds: ["c1", "c2"],
        });
        expect(m.submitResolutionChoice).toHaveBeenCalledWith({
            ...GP,
            stackItemId: "mulligan",
            step: 0,
            choiceId: "mulligan-bottom-u1-p2",
            cardInstanceIds: ["c1", "c2"],
        });
    });

    it("resolution-choice → submitResolutionChoice with the choice identity", async () => {
        const m = await run({
            kind: "resolution-choice",
            stackItemId: "tutor",
            step: 0,
            choiceId: "u1-p2",
            cardInstanceIds: ["fetched"],
        });
        expect(m.submitResolutionChoice).toHaveBeenCalledWith({
            ...GP,
            stackItemId: "tutor",
            step: 0,
            choiceId: "u1-p2",
            cardInstanceIds: ["fetched"],
        });
    });

    it("may-pay → submitMayPay with the boolean (separate entry point)", async () => {
        const m = await run({ kind: "may-pay", accept: true });
        expect(m.submitMayPay).toHaveBeenCalledWith({ ...GP, accept: true });
        // Never routes through the resolution-choice path.
        expect(m.submitResolutionChoice).not.toHaveBeenCalled();
    });

    it("random-reveal-ack → submitRandomRevealAck with the choice identity (#301)", async () => {
        const m = await run({
            kind: "random-reveal-ack",
            stackItemId: "bottle",
            choiceId: "bottle-of-suleiman-flip",
        });
        expect(m.submitRandomRevealAck).toHaveBeenCalledWith({
            ...GP,
            stackItemId: "bottle",
            choiceId: "bottle-of-suleiman-flip",
        });
        // No choice data — a no-decision reveal.
        expect(m.submitResolutionChoice).not.toHaveBeenCalled();
        expect(m.submitMayPay).not.toHaveBeenCalled();
    });

    it("play-land → playCard with the card id", async () => {
        const m = await run({ kind: "play-land", cardInstanceId: "land1" });
        expect(m.playCard).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "land1",
        });
    });

    it("summon-companion → summonCompanion on the bot seat, no card id (#1391)", async () => {
        const m = await run({ kind: "summon-companion" });
        expect(m.summonCompanion).toHaveBeenCalledWith(GP);
    });

    it("turn-face-up → turnPermanentFaceUp with the permanent's id (CR 116.2b / 702.37e, issue #2705)", async () => {
        const m = await run({
            kind: "turn-face-up",
            cardInstanceId: "morphed",
        });
        expect(m.turnPermanentFaceUp).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "morphed",
        });
        // A special action is ONE mutation: no announce, no tap round-trip.
        expect(m.announceCast).not.toHaveBeenCalled();
        expect(m.tapForPayment).not.toHaveBeenCalled();
    });

    it("cast-spell → announce, batch-select all targets, then batch-tap all lands (issue #1779)", async () => {
        const m = await run({
            kind: "cast-spell",
            cardInstanceId: "bolt",
            chosenX: undefined,
            chosenModeId: undefined,
            confirmTargets: false,
            targets: [{ type: "player", id: "u1-p1" }],
            tapPlan: [{ cardInstanceId: "mtn", manaChoiceIndex: undefined }],
        });
        expect(m.announceCast).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "bolt",
            chosenX: undefined,
            chosenModeId: undefined,
        });
        // Batched: ONE selectTargets call carrying the whole target array,
        // not one selectTarget call per target.
        expect(m.selectTargets).toHaveBeenCalledWith({
            ...GP,
            targets: [
                {
                    targetType: "player",
                    targetId: "u1-p1",
                    targetPlayerId: undefined,
                },
            ],
        });
        expect(m.selectTarget).not.toHaveBeenCalled();
        // Batched: ONE tapForPayment call carrying the whole payments array,
        // not one tapForPayment call per land.
        expect(m.tapForPayment).toHaveBeenCalledWith({
            ...GP,
            payments: [{ cardInstanceId: "mtn", manaChoiceIndex: undefined }],
        });
        // No confirmTargets for fixed-N selections.
        expect(m.confirmTargets).not.toHaveBeenCalled();
    });

    // issue #2420 — a `tapPlan` entry carrying `abilityId` (Urza's
    // `tapOtherFilter` leg, Farrelite Priest's pure `cost.mana`) ACTIVATES
    // the ability via `activateManaAbility`, never `tapForPayment`; a MIXED
    // plan still batches its consecutive PLAIN runs.
    it("cast-spell → an abilityId tapPlan entry funds via activateManaAbility, not tapForPayment", async () => {
        const m = await run({
            kind: "cast-spell",
            cardInstanceId: "brainstorm",
            chosenX: undefined,
            chosenModeId: undefined,
            confirmTargets: false,
            targets: [],
            tapPlan: [
                {
                    cardInstanceId: "urza",
                    abilityId: "urza-lha-mana",
                    tapOtherIds: ["art"],
                },
            ],
        });
        expect(m.activateManaAbility).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "urza",
            abilityId: "urza-lha-mana",
            manaChoiceIndex: undefined,
            tapOtherIds: ["art"],
        });
        expect(m.tapForPayment).not.toHaveBeenCalled();
    });

    it("cast-spell → a MIXED tapPlan runs its plain taps as batches around each ability activation, in order", async () => {
        const m = await run({
            kind: "cast-spell",
            cardInstanceId: "spell",
            chosenX: undefined,
            chosenModeId: undefined,
            confirmTargets: false,
            targets: [],
            tapPlan: [
                { cardInstanceId: "mtn1", manaChoiceIndex: undefined },
                {
                    cardInstanceId: "priest",
                    abilityId: "farrelite-priest-mana",
                },
                { cardInstanceId: "mtn2", manaChoiceIndex: undefined },
            ],
        });
        // The generic funding tap for Farrelite's OWN cost.mana leg (mtn1)
        // and the activation itself (priest) must both fire, in order,
        // BEFORE the unrelated trailing plain tap (mtn2) — `runTapPlan`
        // splits the plan into runs, not one call per plan.
        expect(m.tapForPayment).toHaveBeenCalledTimes(2);
        expect(m.tapForPayment).toHaveBeenNthCalledWith(1, {
            ...GP,
            payments: [{ cardInstanceId: "mtn1", manaChoiceIndex: undefined }],
        });
        expect(m.activateManaAbility).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "priest",
            abilityId: "farrelite-priest-mana",
            manaChoiceIndex: undefined,
            tapOtherIds: undefined,
        });
        expect(m.tapForPayment).toHaveBeenNthCalledWith(2, {
            ...GP,
            payments: [{ cardInstanceId: "mtn2", manaChoiceIndex: undefined }],
        });
        // Call order: tapForPayment(1) → activateManaAbility → tapForPayment(2).
        const order = [
            m.tapForPayment.mock.invocationCallOrder[0],
            m.activateManaAbility.mock.invocationCallOrder[0],
            m.tapForPayment.mock.invocationCallOrder[1],
        ];
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it("cast-spell → confirmTargets only for variable-count targets", async () => {
        const m = await run({
            kind: "cast-spell",
            cardInstanceId: "fireball",
            confirmTargets: true,
            targets: [{ type: "player", id: "u1-p1" }],
            tapPlan: [],
        });
        expect(m.confirmTargets).toHaveBeenCalledWith(GP);
    });

    // CR 601.2b (issue #2379) — the caster-chosen ADDITIONAL cost leg. The Move
    // carries the leg the search valued and CHARGED
    // (`applyAdditionalCostLegForSearch`); the executor must hand that exact id
    // to `announceCast`, which rejects a disjunction cast without one ("must
    // choose which additional cost to pay"). Dropping the forward stalls the
    // bot on a move it generated itself — the #2283/#2284 freeze shape (ADR
    // 0047) — and is invisible to every other assertion in this file, because
    // `toHaveBeenCalledWith` ignores a key whose value is `undefined`.
    it("cast-spell → announceCast carries the chosen additional-cost leg id (#2379)", async () => {
        const m = await run({
            kind: "cast-spell",
            cardInstanceId: "bitter-triumph",
            chosenX: undefined,
            chosenModeId: undefined,
            additionalCostLegId: "pay-3-life",
            confirmTargets: false,
            targets: [{ type: "permanent", id: "bears" }],
            tapPlan: [],
        });
        expect(m.announceCast).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "bitter-triumph",
            chosenX: undefined,
            chosenModeId: undefined,
            additionalCostLegId: "pay-3-life",
        });
        // Explicit: the id is on the announcement, not smuggled into a later
        // mutation (the leg is paid AT announcement, CR 601.2h).
        expect(m.announceCast.mock.calls[0][0].additionalCostLegId).toBe(
            "pay-3-life"
        );
    });

    // CR 702.33 / 702.27a (issue #2081) — the FORWARDING seam: the Move
    // carries the Kicker/Buyback payment the search valued and CHARGED
    // (`enumerateKickerVariants` / `applyKickerPermanentLegForSearch`), but
    // until this forward existed the executor dropped it on the floor —
    // `announceCast` was never told anything was kicked, however correctly
    // the enumerator and both search sandboxes priced it (the issue's own
    // title). Same invisibility risk the additional-cost-leg test above
    // documents: `toHaveBeenCalledWith` treats an omitted key and an explicit
    // `undefined` as equal, so a dropped forward would NOT go red on any
    // OTHER test in this file.
    it("cast-spell → announceCast carries kickerPayments and buyback (#2081)", async () => {
        const m = await run({
            kind: "cast-spell",
            cardInstanceId: "burst-lightning",
            chosenX: undefined,
            chosenModeId: undefined,
            kickerPayments: { kicker: 1 },
            confirmTargets: false,
            targets: [{ type: "permanent", id: "bears" }],
            tapPlan: [],
        });
        expect(m.announceCast).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "burst-lightning",
            chosenX: undefined,
            chosenModeId: undefined,
            kickerPayments: { kicker: 1 },
        });
        expect(m.announceCast.mock.calls[0][0].kickerPayments).toEqual({
            kicker: 1,
        });
    });

    it("cast-spell → announceCast carries buyback: true (#2081)", async () => {
        const m = await run({
            kind: "cast-spell",
            cardInstanceId: "corpse-dance",
            chosenX: undefined,
            chosenModeId: undefined,
            buybackPaid: true,
            confirmTargets: false,
            targets: [],
            tapPlan: [],
        });
        expect(m.announceCast.mock.calls[0][0].buyback).toBe(true);
    });

    it("activate-ability → activate, batch-select targets, then fund via tapForActivationPayment", async () => {
        const m = await run({
            kind: "activate-ability",
            cardInstanceId: "src",
            abilityId: "ping",
            chosenX: undefined,
            confirmTargets: false,
            targets: [{ type: "permanent", id: "creat" }],
            tapPlan: [{ cardInstanceId: "isl" }],
        });
        expect(m.activateAbility).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "src",
            abilityId: "ping",
            chosenX: undefined,
        });
        // Batched: ONE selectTargets call (issue #1779 — selectTargets serves
        // BOTH cast and activated-ability targeting).
        expect(m.selectTargets).toHaveBeenCalledWith({
            ...GP,
            targets: [
                {
                    targetType: "permanent",
                    targetId: "creat",
                    targetPlayerId: undefined,
                },
            ],
        });
        expect(m.selectTarget).not.toHaveBeenCalled();
        // tapForActivationPayment stays per-item (out of issue #1779's named
        // scope, which batches `tapForPayment` only).
        expect(m.tapForActivationPayment).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "isl",
            manaChoiceIndex: undefined,
        });
    });

    // issue #2420 — an activated ability's OWN cost can be co-funded by a
    // non-tap mana ability (Urza, Farrelite Priest) exactly like a spell's
    // cost: an `abilityId` tapPlan entry activates it via
    // `activateManaAbility`, never `tapForActivationPayment`.
    it("activate-ability → an abilityId tapPlan entry funds via activateManaAbility, not tapForActivationPayment", async () => {
        const m = await run({
            kind: "activate-ability",
            cardInstanceId: "src",
            abilityId: "ping",
            chosenX: undefined,
            confirmTargets: false,
            targets: [],
            tapPlan: [
                {
                    cardInstanceId: "urza",
                    abilityId: "urza-lha-mana",
                    tapOtherIds: ["art"],
                },
            ],
        });
        expect(m.activateManaAbility).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "urza",
            abilityId: "urza-lha-mana",
            manaChoiceIndex: undefined,
            tapOtherIds: ["art"],
        });
        expect(m.tapForActivationPayment).not.toHaveBeenCalled();
    });

    // CR 113.1b (issue #2903) — a player-level granted ability (Channel's "Pay
    // 1 life: Add {C}."). ONE mutation: `activatePlayerAbility` with the grant
    // instance id. No card id (the grant hangs off the player) and no announce /
    // tap round-trip — the life cost is paid server-side.
    it("activate-granted-ability → activatePlayerAbility with the grant instance id", async () => {
        const m = await run({
            kind: "activate-granted-ability",
            grantedAbilityInstanceId: "grant-1",
            abilityId: "channel-mana",
            sourceCardId: "channel",
        });
        expect(m.activatePlayerAbility).toHaveBeenCalledWith({
            ...GP,
            grantedAbilityInstanceId: "grant-1",
        });
        expect(m.activateAbility).not.toHaveBeenCalled();
        expect(m.tapForActivationPayment).not.toHaveBeenCalled();
    });

    it("declare-attackers → toggle each then confirm", async () => {
        const m = await run({
            kind: "declare-attackers",
            attackerIds: ["a1", "a2"],
        });
        expect(m.toggleAttacker).toHaveBeenNthCalledWith(1, {
            ...GP,
            cardInstanceId: "a1",
        });
        expect(m.toggleAttacker).toHaveBeenNthCalledWith(2, {
            ...GP,
            cardInstanceId: "a2",
        });
        expect(m.confirmAttackers).toHaveBeenCalledWith(GP);
    });

    it("declare-attackers with empty set → just confirm (no attack)", async () => {
        const m = await run({ kind: "declare-attackers", attackerIds: [] });
        expect(m.toggleAttacker).not.toHaveBeenCalled();
        expect(m.confirmAttackers).toHaveBeenCalledWith(GP);
    });

    it("declare-blockers → select+assign each, then confirm", async () => {
        const m = await run({
            kind: "declare-blockers",
            assignments: [{ blockerId: "b1", attackerId: "a1" }],
        });
        expect(m.selectBlocker).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "b1",
        });
        expect(m.assignBlockerTarget).toHaveBeenCalledWith({
            ...GP,
            attackerId: "a1",
        });
        expect(m.confirmBlockers).toHaveBeenCalledWith(GP);
    });
});
