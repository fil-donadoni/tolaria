// The ONE argument shape every `getPublicState` caller sends (issue #10896).
//
// The Convex client keys a subscription on `JSON.stringify({ udfPath, args })`
// (`serializePathAndArgs`), so `{ gameId, playerId, debugAllActions: false }`
// and `{ gameId, playerId }` are two subscriptions for the same seat and the
// same answer: every save of the `gameStates` row re-executed the query once
// for each, and each execution re-read the whole row — the largest line on
// the deployment's Database I/O bill. The board sent the flag; the capture
// hooks and the Bot driver did not.
//
// `false` is the server's default (`getPublicState`'s `?? false`), so it is
// never sent: only the debug view (`true`) carries the flag, and it is a
// different answer anyway.

import type { FunctionArgs } from "convex/server";
import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export function publicStateArgs(
    gameId: Id<"games">,
    playerId: string,
    debugAllActions = false
): FunctionArgs<typeof api.game.getPublicState> {
    return debugAllActions
        ? { gameId, playerId, debugAllActions: true }
        : { gameId, playerId };
}
