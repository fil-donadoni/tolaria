// Realises an escalation-ladder rung (issue #2284) — the bot's legal way OUT of
// a window it cannot answer.
//
// Every rung here is a decline the Comprehensive Rules already define for that
// window, routed through the SAME public mutation a human's click would use. No
// rung invents a skip, and none mutates state outside the mutation surface:
//
//   - `cancel-target`        CR 608.2b / 601.2 — `cancelTarget`. A mandatory
//     target nobody chooses removes the ability from the stack; an "up to"
//     selection resolves with no target; an ANNOUNCED cast's selection rewinds
//     the announcement. The engine's one mutation covers all three.
//   - `confirm-no-blockers`  CR 509.1 — `confirmBlockers` with nothing selected.
//     Declaring no blockers is always a legal declaration.
//   - `confirm-no-attackers` CR 508.1 — `confirmAttackers` with nothing
//     selected. Declaring no attackers is always legal.
//   - `select-sacrifice`     CR 508.1g — the parked attack-declaration land tax
//     is mandatory and has no cancel; its exit is the minimal-legal victim set,
//     already resolved through the engine's own selection authority.
//   - `abort-announcement`   CR 601.2h — `cancelCast` / `cancelActivation`
//     rewinds an announcement whose costs were never paid.
//
// The switch is `assertNever`-closed over the decline sub-union of `BotAction`,
// so a new escalation kind cannot compile until the driver can actually realise
// it — the same guarantee `submitOwedPayment` gives the payment parks.

import type { Id } from "@convex/_generated/dataModel";
import type { BotAction } from "./brain";

type Seat = { gameId: Id<"games">; playerId: string };

/** The `BotAction` kinds `botActionRealisation` classifies as `"decline"`. */
export type DeclineAction = Extract<
    BotAction,
    {
        kind:
            | "cancel-target"
            | "confirm-no-blockers"
            | "confirm-no-attackers"
            | "abort-announcement"
            | "select-sacrifice";
    }
>;

/** The public `game.ts` mutations an escalation rung can name — exactly the
 *  ones a human's click drives. */
export type DeclineMutations = {
    cancelTarget: (a: Seat) => Promise<unknown>;
    confirmBlockers: (a: Seat) => Promise<unknown>;
    confirmAttackers: (a: Seat) => Promise<unknown>;
    cancelCast: (a: Seat) => Promise<unknown>;
    cancelActivation: (a: Seat) => Promise<unknown>;
    selectSacrifice: (a: Seat & { cardInstanceId: string }) => Promise<unknown>;
};

function assertNever(x: never): never {
    throw new Error(`Unhandled decline action: ${JSON.stringify(x)}`);
}

/** Submit `action` through the human mutation it names. Sequential and awaited:
 *  `selectSacrifice` fires one call per victim and the server commits the
 *  declaration the moment the last one lands. */
export async function submitDeclineAction(
    action: DeclineAction,
    seat: Seat,
    mutations: DeclineMutations
): Promise<void> {
    switch (action.kind) {
        case "cancel-target":
            await mutations.cancelTarget(seat);
            return;
        case "confirm-no-blockers":
            await mutations.confirmBlockers(seat);
            return;
        case "confirm-no-attackers":
            await mutations.confirmAttackers(seat);
            return;
        case "abort-announcement":
            await (action.container === "cast"
                ? mutations.cancelCast(seat)
                : mutations.cancelActivation(seat));
            return;
        case "select-sacrifice":
            for (const cardInstanceId of action.cardInstanceIds) {
                await mutations.selectSacrifice({ ...seat, cardInstanceId });
            }
            return;
        default:
            return assertNever(action);
    }
}
