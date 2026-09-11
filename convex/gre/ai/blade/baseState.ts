// The base position every blade scenario — and every Verdict — is built on
// top of.
//
// Split out of `runner.ts` for ONE reason (issue #3405): the runner reaches
// `blade/setup`, which reaches `convex/game`, which reaches `convex/auth` and
// the Convex function shell. Anything importing the runner is therefore
// server-only, and the client-bundle purity guard (ADR 0074,
// `scripts/__tests__/client-bundle-purity.test.ts`) refuses it — while the
// verdict quiz has to rebuild a position IN THE BROWSER, with the same builder
// the fit will use, or the candidate keys it submits resolve against nothing.
//
// So this half is pure engine: a base state, no setup steps, no Convex.
// `runner.ts` re-exports it, so there is still exactly one definition.

import { getCardByName } from "../../../cards";
import { createInitialGameState, type PlayerInput } from "../../setup";
import type { GameState } from "../../state";

/** Shuffle seed for the base (pre-scenario) game state. Fixed forever —
 *  changing it re-rolls the whole suite. */
const BASE_STATE_SEED = 0x51ade;

/** Size of the synthetic base deck. A scenario clears both libraries anyway
 *  when it sets `libraryCount`; this only has to be a legal-sized pile the
 *  engine can draw from. */
const BASE_DECK_SIZE = 60;

/** Filler card for the synthetic base deck: a basic land, so any card left in
 *  a library the scenario did not override is inert (no cast decisions, no
 *  triggers) and cannot perturb a rollout. */
const BASE_DECK_CARD = "Plains";

/** A seat's identity — the only thing `buildBladeLoadState` needs to vary per
 *  call: which player id/name/bgColor a seat is built AS. */
export type SeatIdentity = { id: string; name: string; bgColor: string };

/** The harness's own default identities. */
const DEFAULT_SEAT_IDENTITIES: [SeatIdentity, SeatIdentity] = [
    { id: "p1", name: "Blade P1", bgColor: "#000000" },
    { id: "p2", name: "Blade P2", bgColor: "#000000" },
];

function syntheticPlayer(identity: SeatIdentity): PlayerInput {
    const def = getCardByName(BASE_DECK_CARD);
    return {
        ...identity,
        deck: {
            id: `blade-${identity.id}`,
            name: "Blade base deck",
            format: "freeform",
            cards: Array.from({ length: BASE_DECK_SIZE }, () => ({
                cardId: def.id,
                cardName: def.name,
            })),
        },
    };
}

/**
 * The base `GameState` every blade scenario is applied on top of: two seats
 * with identical synthetic decks, shuffled at a fixed seed.
 * `buildStateFromScenario` finalizes the mulligan and clears every zone, so
 * nothing but the leftover library survives.
 *
 * `identities` defaults to the harness's own `p1`/`p2` seats — every caller
 * before issue #1432 review round 3 relied on that default and still gets
 * it unchanged. `buildBladeLoadState` is the one caller that passes an
 * override: building the SAME position but AS the live game's actual player
 * ids, so identity (owner/controller ids throughout every card, plus
 * `activePlayerId`/`priorityPlayerId`, both derived from `players[0].id` in
 * `createInitialGameState`) is correct by construction from the very first
 * card dealt — not patched onto a `p1`/`p2`-built state after the fact, which
 * would leave every internal `ownerId`/`controllerId` still pointing at the
 * old `p1`/`p2` strings.
 */
export function buildBladeBaseState(
    identities: [SeatIdentity, SeatIdentity] = DEFAULT_SEAT_IDENTITIES
): GameState {
    return createInitialGameState(
        [syntheticPlayer(identities[0]), syntheticPlayer(identities[1])],
        BASE_STATE_SEED
    );
}
