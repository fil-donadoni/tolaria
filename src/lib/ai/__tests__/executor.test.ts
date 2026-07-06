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
        announceCast: vi.fn().mockResolvedValue(null),
        selectTarget: vi.fn().mockResolvedValue(null),
        confirmTargets: vi.fn().mockResolvedValue(null),
        tapForPayment: vi.fn().mockResolvedValue(null),
        activateAbility: vi.fn().mockResolvedValue(null),
        tapForActivationPayment: vi.fn().mockResolvedValue(null),
        toggleAttacker: vi.fn().mockResolvedValue(null),
        confirmAttackers: vi.fn().mockResolvedValue(null),
        selectBlocker: vi.fn().mockResolvedValue(null),
        assignBlockerTarget: vi.fn().mockResolvedValue(null),
        confirmBlockers: vi.fn().mockResolvedValue(null),
        confirmDamage: vi.fn().mockResolvedValue(null),
        declareMulligan: vi.fn().mockResolvedValue(null),
        submitResolutionChoice: vi.fn().mockResolvedValue(null),
        submitMayPay: vi.fn().mockResolvedValue(null),
        submitLandEntryChoice: vi.fn().mockResolvedValue(null),
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

    it("cast-spell → announce, select each target, then tap each land in order", async () => {
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
        expect(m.selectTarget).toHaveBeenCalledWith({
            ...GP,
            targetType: "player",
            targetId: "u1-p1",
            targetPlayerId: undefined,
        });
        expect(m.tapForPayment).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "mtn",
            manaChoiceIndex: undefined,
        });
        // No confirmTargets for fixed-N selections.
        expect(m.confirmTargets).not.toHaveBeenCalled();
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

    it("activate-ability → activate, then fund via tapForActivationPayment", async () => {
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
        expect(m.selectTarget).toHaveBeenCalledWith({
            ...GP,
            targetType: "permanent",
            targetId: "creat",
            targetPlayerId: undefined,
        });
        expect(m.tapForActivationPayment).toHaveBeenCalledWith({
            ...GP,
            cardInstanceId: "isl",
            manaChoiceIndex: undefined,
        });
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
