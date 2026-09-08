// The search's PUSH site must carry an ability-COPY grant's ORIGIN, not only
// its granting def id (issue #2943) — the #2468 failure, one field over.
//
// `resolveTopOfStack` looks a granted ability's template up on the granting
// card, and since #2943 it looks it up in ONE of two lists, chosen by the
// grant's explicit `origin` discriminator: `grantTemplates[]` (a lord-style
// grant, the default) or the card's own `activatedAbilities[]` (CR 607.2a —
// an ability copied off a card in a linked exile pile, which declares no
// `grantTemplates` at all). Drop the origin between `getEffectiveActivated-
// Abilities` and the pushed stack item and the lookup runs against the wrong
// list, finds nothing, and the item pops having done nothing — exactly the
// silent no-op #2468 fixed for the def id.
//
// The mutation-side commit sites (`convex/game.ts`) thread it; this file pins
// the SEARCH's own push, which is the seam the bot plays through and the one
// #2468 shows is easy to leave behind.
//
// Prodigal Sorcerer is the fixture: a real catalogue creature whose zap is a
// plain `activatedAbilities[]` entry. The grant is materialized directly onto
// `grantedActivatedAbilities`, the same field the layer system writes — the
// derivation itself is covered in `exileSetAbilityGrant.test.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveInSearch } from "../search";
import { compactState, expandState } from "../serialize";
import { resolveTopOfStack } from "../state";
import { enumerateMoves, type Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";

const BEAR = getCardByName("Grizzly Bears").id;
const SORCERER = getCardByName("Prodigal Sorcerer").id;
const ZAP = "prodigal-sorcerer-zap";

function grantedBearState(origin: "card-abilities" | undefined): GameState {
    const bear: CardInstanceState = makeInstance(BEAR, {
        controllerId: "p1",
        ownerId: "p1",
        id: "bear",
        isSummoningSick: false,
        grantedActivatedAbilities: [
            {
                sourceCardId: SORCERER,
                abilityId: ZAP,
                ...(origin ? { origin } : {}),
                auraId: "cauldron",
                seq: 1,
            },
        ],
    });
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1", { battlefield: [bear] }), makePlayer("p2")],
    });
}

/** The enumerated `activate-ability` move for the copied ability, aimed at the
 *  opponent. Taken from `enumerateMoves` rather than hand-built: the point of
 *  this file is the seam the BOT actually plays through. */
function enumeratedZap(
    state: GameState
): Extract<Move, { kind: "activate-ability" }> {
    const moves = enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" && m.abilityId === ZAP
    );
    const atOpponent = moves.find((m) => m.targets.some((t) => t.id === "p2"));
    expect(atOpponent).toBeDefined();
    return atOpponent!;
}

describe("ability-copy grant through the search (CR 607.2a, issue #2943)", () => {
    it("enumerates the copied ability as a move", () => {
        const state = grantedBearState("card-abilities");
        expect(
            enumerateMoves(state, "p1").some(
                (m) => m.kind === "activate-ability" && m.abilityId === ZAP
            )
        ).toBe(true);
    });

    it("pushes the origin alongside the granting def id", () => {
        const state = grantedBearState("card-abilities");
        applyMoveInSearch(state, "p1", enumeratedZap(state));
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].grantedSourceCardId).toBe(SORCERER);
        expect(state.stack[0].grantedAbilityOrigin).toBe("card-abilities");
    });

    it("resolves the copied ability for real — the damage lands", () => {
        const state = grantedBearState("card-abilities");
        applyMoveInSearch(state, "p1", enumeratedZap(state));
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        // CR 607.2a — the ability is the exiled card's own, resolved with the
        // BEAR as its source (CR 113.1).
        expect(state.players[1].life).toBe(19);
    });

    it("keeps the origin across a save/load, and still resolves after one", () => {
        // Review round 1 finding 1. `expandStackItem` is an explicit key
        // whitelist with no passthrough, so a written-but-unread key is dropped
        // silently — and a save ALWAYS intervenes between activating an ability
        // and resolving it (the opponent gets priority, which is a stable
        // point). The item would come back with its granting def id and no
        // origin, look the template up in `grantTemplates[]`, find nothing, and
        // pop having paid the tap for nothing.
        const state = grantedBearState("card-abilities");
        applyMoveInSearch(state, "p1", enumeratedZap(state));
        const reloaded = expandState(compactState(state));
        expect(reloaded.stack).toHaveLength(1);
        expect(reloaded.stack[0].grantedSourceCardId).toBe(SORCERER);
        expect(reloaded.stack[0].grantedAbilityOrigin).toBe("card-abilities");
        resolveTopOfStack(reloaded);
        expect(reloaded.players[1].life).toBe(19);
    });

    it("resolves NOTHING when the origin is dropped — the no-op this guards", () => {
        // The same grant with no `origin` means `grantTemplates[]`, which
        // Prodigal Sorcerer has none of. This is the shape a lost discriminator
        // produces, and it is silent: the item pops, the cost is paid, nothing
        // happens. Asserted so the guard above cannot pass vacuously.
        const state = grantedBearState(undefined);
        const moves = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "activate-ability" && m.abilityId === ZAP
        );
        expect(moves).toEqual([]);
    });
});
