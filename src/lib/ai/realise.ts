// Turns a decided `BotAction` into the mutation sequence that submits it
// (issue #2284).
//
// This was the body of `useVsAiDriver`'s effect: a chain of
// `botActionRealisation(action.kind) === "…"` branches, each building its own
// mutation call inline. It moved here because the escalation ladder needs the
// SAME realisations — a rung that submits an empty blocker declaration must go
// through the same `confirmBlockers` a normal declaration does, or the ladder
// becomes a second, untested submission path. One function, two callers:
//
//   * the driver's normal decision path, which may also hand the window to the
//     Worker search (`"worker"` → `null` here, and the driver searches);
//   * the driver's watchdog, which never searches — the ladder only runs
//     because the search already had nothing to say.
//
// It returns a RUNNER rather than a promise so the caller can hold its in-flight
// guard around the whole sequence (ADR 0091 decision 6: a realisation is atomic;
// each mutation bumps the state seq and re-fires the reactive effect, so a
// half-built announcement must not let a second decision interleave).

import type { Id } from "@convex/_generated/dataModel";
import type { PublicGameState } from "@convex/gameProjections";
import { botActionRealisation, type BotAction } from "./brain";
import { botActionToMove } from "./bot-view";
import { executeMove, type MoveMutations } from "./executor";
import {
    submitOwedPayment,
    type OwedPaymentMutations,
} from "./pay-owed-payment";
import {
    submitDeclineAction,
    isDeclineAction,
    type DeclineMutations,
} from "./decline";

type Seat = { gameId: Id<"games">; playerId: string };

/** The direct (non-Move-realised) mutations the parked-window branches drive. */
export type DirectMutations = {
    autoTapForAttackTax: (a: Seat) => Promise<unknown>;
    cancelAttackTax: (a: Seat) => Promise<unknown>;
    resolveManaSpendChoice: (
        a: Seat & { spendOrder: string[] }
    ) => Promise<unknown>;
    selectCastExileCost: (
        a: Seat & { cardInstanceIds: string[] }
    ) => Promise<unknown>;
    selectConvokeCreatures: (
        a: Seat & { creatureInstanceIds: string[] }
    ) => Promise<unknown>;
    confirmDamage: (a: Seat) => Promise<unknown>;
    passPriority: (a: Seat) => Promise<unknown>;
};

export type RealisationContext = {
    gameId: Id<"games">;
    botId: string;
    /** The bot-viewpoint projection the action was decided from — the executor
     *  needs it to lower a `BotAction` back to the `Move` it realises. */
    botState: PublicGameState;
    mutations: MoveMutations;
    owedPayment: OwedPaymentMutations;
    decline: DeclineMutations;
    direct: DirectMutations;
};

/** The mutation sequence that submits `action`, or `null` when there is nothing
 *  to submit directly — either because the window belongs to the Worker search
 *  (`"worker"`), because the bot owes nothing (`"none"`), because the bot cannot
 *  answer at all (`"unanswered"` — the driver escalates instead), or because the
 *  action carries no realisable payload (a `submit-target` whose Move cannot be
 *  lowered against the current projection).
 *
 *  `pass` is realised here DIRECTLY even though `botActionRealisation` classifies
 *  it `"worker"`: the caller decides whether this window is worth searching
 *  (`shouldThink`, issue #113) or whether the ladder has reached its
 *  pass-priority rung, and both then submit the identical `passPriority`. */
export function realiseBotAction(
    action: BotAction,
    ctx: RealisationContext
): (() => Promise<unknown>) | null {
    const seat = { gameId: ctx.gameId, playerId: ctx.botId };

    switch (botActionRealisation(action.kind)) {
        case "none":
        case "unanswered":
            return null;

        // Combat-damage confirmation (CR 510.1c, multi-block): the engine
        // pre-fills the default assignment on step entry, so confirming is
        // enough. Without it the bot would `pass` and the server would reject it
        // ("Must assign combat damage…") forever.
        case "confirm-damage":
            return () => ctx.direct.confirmDamage(seat);

        // CR 508.1c/1g — the parked mana attack tax (Propaganda / Collective
        // Restraint): pay it (auto-tap) or drop the declaration.
        case "attack-tax":
            return action.kind === "pay-attack-tax"
                ? () => ctx.direct.autoTapForAttackTax(seat)
                : () => ctx.direct.cancelAttackTax(seat);

        // CR 601.2g (issue #1446) — the parked generic-spend choice: the gate
        // already picked a deterministic flexibility-preserving `spendOrder`.
        case "mana-spend":
            if (action.kind !== "resolve-mana-spend") return null;
            return () =>
                ctx.direct.resolveManaSpendChoice({
                    ...seat,
                    spendOrder: action.spendOrder,
                });

        // CR 601.2g / 702.66 (issue #1336) — the parked cast-cost graveyard
        // exile pick (delve's variable offset; flashback / escape exile costs).
        case "cast-exile-cost":
            if (action.kind !== "cast-exile-cost") return null;
            return () =>
                ctx.direct.selectCastExileCost({
                    ...seat,
                    cardInstanceIds: action.cardInstanceIds,
                });

        // CR 702.51 (issue #1338) — the parked Convoke creature pick (Hogaak).
        case "convoke-creatures":
            if (action.kind !== "convoke-creatures") return null;
            return () =>
                ctx.direct.selectConvokeCreatures({
                    ...seat,
                    creatureInstanceIds: action.creatureInstanceIds,
                });

        // ADR 0091 / issue #1209 — EVERY OTHER payment park. Generic on purpose:
        // a park added to the census in `convex/gre/owedPayment.ts` becomes
        // non-stalling here with NO new driver wiring.
        case "owed-payment":
            if (action.kind !== "pay-owed-payment") return null;
            return () =>
                submitOwedPayment(action.submission, seat, ctx.owedPayment);

        // issue #2284 — an escalation rung: the CR-legal decline for the window,
        // through the same mutation a human's click would use.
        //
        // Narrowed on `action.kind` rather than cast: `action as DeclineAction`
        // was the one place in this dispatch chain where the compiler stopped
        // checking, so a future `BotAction` classified `"decline"` in
        // `botActionRealisation` but missing from the `DeclineAction` union would
        // have compiled and only failed at RUNTIME in `submitDeclineAction`'s
        // `assertNever`. `isDeclineAction` is a real narrowing, so the guarantee
        // "a new escalation kind is a build error until the driver can realise
        // it" stays true.
        case "decline":
            if (!isDeclineAction(action)) return null;
            return () => submitDeclineAction(action, seat, ctx.decline);

        // Brain-resolved windows (mulligan keep / mull / bottom-N, the ADR 0016
        // interactive-choice defaults, the minimal-legal raised-target answer)
        // replay through the executor as the Move they realise.
        case "executor": {
            const move = botActionToMove(action, ctx.botState, ctx.botId);
            if (!move) return null;
            return () =>
                executeMove(move, {
                    gameId: ctx.gameId,
                    botId: ctx.botId,
                    mutations: ctx.mutations,
                });
        }

        // The Worker's windows. `pass` is the one the caller can also submit
        // directly (see the doc comment); the real decisions cannot.
        case "worker":
            return action.kind === "pass"
                ? () => ctx.direct.passPriority(seat)
                : null;
    }
}
