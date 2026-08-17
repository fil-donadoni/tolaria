// The bot's move enumerator read a permanent's PRINTED activated abilities
// only (`convex/gre/moves.ts`, `enumerateAbilityMoves`), so every GRANTED
// activated ability was invisible to the Brain — the move was never offered,
// at any search depth (issue #2469).
//
// The fix swaps the enumerator's source from `tryGetDefinition(cardId)
// ?.activatedAbilities` to `getEffectiveActivatedAbilities(perm)`
// (`convex/gre/activatedAbilities.ts`) — the SAME post-layer authority every
// other consumer already reads (the activation mutation, the search's push
// gate, the mana-ability probes, the client ability views; CR 611.2a /
// 613.1f). Two behavioural changes ride along, both asserted below:
//
//   1. A permanent whose DEFINITION declares no activated abilities at all
//      can still hold granted ones — the old `!def?.activatedAbilities`
//      early return killed this case outright, before any per-ability gate
//      ever ran.
//   2. `getEffectiveActivatedAbilities` applies the "loses all abilities"
//      rule (CR 613.7, `grantOutrankedByAbilityLoss`) PER ability by
//      timestamp, not the coarse all-or-nothing the enumerator used to apply
//      via a bare `abilitiesSuppressedBy.length > 0` check: a grant NEWER
//      than the suppression survives, one OLDER does not.
//
// Splinter Twin (`convex/cards/sets/roe/red.ts`) supplies the grant template
// (`grantTemplates: [{ id: "splinter-twin-copy", cost: { tap: true },
// useStack: true, ... }]`), materialized directly onto
// `grantedActivatedAbilities` exactly as the `activated-grant` static-effect
// mechanism (CR 113.1) and the layer system leave it — no Aura instance is
// needed on the battlefield for this test, matching the fixture shape in
// `grantedAbilityActivationInSearch.bot.test.ts` (issue #2468), which this
// file does not duplicate: that file's scope is the search's PUSH/resolve of
// an already-offered move; this file's scope is whether the move is offered
// at all.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";

const BEAR = getCardByName("Grizzly Bears").id;
const SPLINTER_TWIN = getCardByName("Splinter Twin").id;
const TWIN_ABILITY = "splinter-twin-copy";

function mine(id: string, extra = {}): CardInstanceState {
    return makeInstance(BEAR, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        isSummoningSick: false,
        ...extra,
    });
}

function stateWithBear(bear: CardInstanceState): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1", { battlefield: [bear] }), makePlayer("p2")],
    });
}

describe("enumerateAbilityMoves reads the post-layer authority (CR 611.2a / 613.1f, issue #2469)", () => {
    it("offers a GRANTED activated ability whose SOURCE permanent's printed activatedAbilities list is empty", () => {
        // Grizzly Bears is a vanilla creature — its CardDefinition carries no
        // `activatedAbilities` at all. Before the fix `!def?.activatedAbilities`
        // returned `[]` for this permanent before any grant was ever consulted.
        const bear = mine("bear", {
            grantedActivatedAbilities: [
                {
                    sourceCardId: SPLINTER_TWIN,
                    abilityId: TWIN_ABILITY,
                    auraId: "twin-aura",
                    seq: 1,
                },
            ],
        });
        const state = stateWithBear(bear);

        const moves = enumerateMoves(state, "p1");
        const activation = moves.find(
            (m) => m.kind === "activate-ability" && m.abilityId === TWIN_ABILITY
        );

        expect(
            activation,
            "the granted ability must appear as an enumerated move"
        ).toBeDefined();
        expect(activation).toMatchObject({
            kind: "activate-ability",
            cardInstanceId: "bear",
            abilityId: TWIN_ABILITY,
        });
    });

    it("does NOT offer any activated ability at all for a permanent with an empty printed list and no grants (baseline)", () => {
        const bear = mine("bear");
        const state = stateWithBear(bear);

        const moves = enumerateMoves(state, "p1");
        const anyAbilityMove = moves.some((m) => m.kind === "activate-ability");
        expect(anyAbilityMove).toBe(false);
    });

    it("CR 613.7 — a grant OLDER than a 'loses all abilities' effect is not offered", () => {
        const bear = mine("bear", {
            grantedActivatedAbilities: [
                {
                    sourceCardId: SPLINTER_TWIN,
                    abilityId: TWIN_ABILITY,
                    auraId: "twin-aura",
                    // Grant timestamp precedes the suppression below.
                    seq: 1,
                },
            ],
            abilitiesSuppressedBy: [{ sourceId: "stripper", seq: 5 }],
        });
        const state = stateWithBear(bear);

        const moves = enumerateMoves(state, "p1");
        const offered = moves.some(
            (m) => m.kind === "activate-ability" && m.abilityId === TWIN_ABILITY
        );
        expect(offered).toBe(false);
    });

    it("CR 613.7 — a grant NEWER than a 'loses all abilities' effect IS offered", () => {
        const bear = mine("bear", {
            grantedActivatedAbilities: [
                {
                    sourceCardId: SPLINTER_TWIN,
                    abilityId: TWIN_ABILITY,
                    auraId: "twin-aura",
                    // Grant timestamp is strictly AFTER the suppression below —
                    // it survives the ability-loss effect (Humility, then Fire
                    // Whip is the canonical CR 613.7 example).
                    seq: 9,
                },
            ],
            abilitiesSuppressedBy: [{ sourceId: "stripper", seq: 5 }],
        });
        const state = stateWithBear(bear);

        const moves = enumerateMoves(state, "p1");
        const offered = moves.some(
            (m) => m.kind === "activate-ability" && m.abilityId === TWIN_ABILITY
        );
        expect(offered).toBe(true);
    });
});
