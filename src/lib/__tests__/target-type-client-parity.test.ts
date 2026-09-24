// Issue #4479 — the client accepts exactly what the server accepts, for EVERY
// member of the `TargetRequirement.type` union.
//
// `target-filter-client-parity.test.ts` (issue #1734) proves the FILTER
// dimensions agree; this file proves the TYPE axis does. Before it, the
// client's `matchesTargetRequirement` was exercised against the server only for
// `Creature` and `player` — the other eleven members had no client/server
// agreement test at all, which is the three-site rule for target types
// (`.claude/rules/gre-development.md` § End-to-end targeting test) left open.
//
// The table is a `Record` over the scalar members of the union, so a new
// member that ships without a row is a `check:ts` error HERE, not a silent gap.
//
// Every row builds ONE state with one legal and one illegal candidate, asks the
// server (`getLegalTargets`) for its offered set, and asks the client for the
// set it would ring as clickable — computed off the REAL wire projection
// (`projectPublicState`), through the same predicates and the same
// `wants*` gates the board, the player faces, the stack panel and the
// graveyard dialog use. The two sets must be EQUAL: a set equality catches both
// the fail-open direction (client rings what the server rejects) and the
// over-filter one (client hides what the server offers).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import {
    getLegalTargets,
    NO_TARGETING_SOURCE,
    pendingTargetFiltersFromRequirement,
} from "@convex/gre/rules";
import type { GameState } from "@convex/gre/state";
import type { TargetRequirement } from "@convex/cards/types";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import {
    matchesPermanentTargetFilters,
    matchesPlayerTargetFilters,
    matchesSpellPendingTarget,
    matchesTargetRequirement,
    wantsPlayerTarget,
    wantsSpellTarget,
} from "~/lib/card-utils";
import { getEligibleGraveyards } from "~/lib/graveyard-targets";

import {
    animateWall,
    counterspell,
    grizzlyBears,
    solRing,
    forest,
    stoneRain,
} from "@convex/cards/sets/lea";
import { sorinLordOfInnistrad } from "@convex/cards/sets/dka/multicolor";

const CHOOSER = "p1";

/** One scalar member of the `TargetRequirement.type` union. */
type TargetTypeMember = Extract<TargetRequirement["type"], string>;

interface Row {
    /** The requirement under test — its `type` is the row's key. */
    requirement: TargetRequirement;
    /** A state holding the row's candidates. */
    build: () => GameState;
    /** `kind:id` of a candidate the server MUST offer. */
    legal: string;
    /** `kind:id` of a candidate the server must NOT offer. */
    illegal: string;
}

/** The `PendingTarget` the SERVER builds for `requirement` — the same
 *  `pendingTargetFiltersFromRequirement` lowering `announceCast` runs. */
function pendingFor(requirement: TargetRequirement): PendingTarget {
    return {
        playerId: CHOOSER,
        cardInstanceId: "src",
        targetType: requirement.type,
        count: requirement.count,
        selected: [],
        ...pendingTargetFiltersFromRequirement(requirement, undefined),
    } as unknown as PendingTarget;
}

function serverOffered(
    state: GameState,
    requirement: TargetRequirement
): string[] {
    return getLegalTargets(state, requirement, NO_TARGETING_SOURCE, CHOOSER)
        .map((t) => `${t.type}:${t.id}`)
        .sort();
}

/** Every candidate the CLIENT would ring as clickable, off the projection —
 *  each kind behind the same `wants*` gate its surface reads. */
function clientOffered(
    state: GameState,
    requirement: TargetRequirement
): string[] {
    const projected = projectPublicState(state, 1, CHOOSER);
    const pending = pendingFor(requirement);
    const players = projected.players as unknown as Player[];
    const boardPlayers = players.map((p) => ({
        id: p.id,
        battlefield: p.battlefield as unknown as CardInstance[],
    }));
    const offered: string[] = [];

    // The graveyard dialog (`graveyard-target-dialog.tsx`) opens only for a
    // graveyard-zone requirement; the battlefield surfaces serve every other.
    if (pending.zone === "graveyard") {
        for (const yard of getEligibleGraveyards(
            pending,
            players,
            CHOOSER,
            projected.activePlayerId
        )) {
            for (const card of yard.cards) {
                offered.push(`graveyard-card:${card.id}`);
            }
        }
        return offered.sort();
    }

    // Battlefield (`useBattlefieldVisualState` / `useBattlefieldInteraction`).
    for (const player of players) {
        for (const card of player.battlefield as unknown as CardInstance[]) {
            if (
                matchesTargetRequirement(card, pending.targetType) &&
                matchesPermanentTargetFilters(
                    card,
                    pending,
                    players,
                    projected.activePlayerId,
                    {
                        turn: projected.turn,
                        controlChangedThisTurn:
                            projected.controlChangedThisTurn,
                    },
                    projected.emblems
                )
            ) {
                offered.push(`permanent:${card.id}`);
            }
        }
    }

    // Player faces (`usePlayerInteraction`).
    if (wantsPlayerTarget(pending.targetType)) {
        for (const player of boardPlayers) {
            if (
                matchesPlayerTargetFilters(
                    player,
                    pending,
                    projected.activePlayerId,
                    boardPlayers
                )
            ) {
                offered.push(`player:${player.id}`);
            }
        }
    }

    // Stack panel (`game-stack.tsx`).
    if (wantsSpellTarget(pending.targetType)) {
        for (const item of projected.stack) {
            if (
                matchesSpellPendingTarget(item, pending, {
                    playerId: CHOOSER,
                    activePlayerId: projected.activePlayerId,
                    players: boardPlayers,
                })
            ) {
                offered.push(`spell:${item.id}`);
            }
        }
    }
    return offered.sort();
}

/** A state with `cards` on p2's battlefield and `spells` on the stack. */
function board(
    cards: ReturnType<typeof makeInstance>[],
    spells: string[] = []
): GameState {
    const state = makeState();
    state.players[1].battlefield.push(...cards);
    for (const id of spells) pushSpell(state, id, "p2");
    return state;
}

const onBoard = (cardId: string, id: string, types?: string[]) =>
    makeInstance(cardId, {
        id,
        controllerId: "p2",
        ...(types ? { types: types as never } : {}),
    });

const BEARS = () => onBoard(grizzlyBears.id, "bears");

// ─── the table ──────────────────────────────────────────────────────────────

const ROWS: Record<TargetTypeMember, Row> = {
    Creature: {
        requirement: { type: "Creature", count: 1 },
        build: () => board([BEARS(), onBoard(forest.id, "forest")]),
        legal: "permanent:bears",
        illegal: "permanent:forest",
    },
    Planeswalker: {
        requirement: { type: "Planeswalker", count: 1 },
        build: () =>
            board([onBoard(sorinLordOfInnistrad.id, "sorin"), BEARS()]),
        legal: "permanent:sorin",
        illegal: "permanent:bears",
    },
    // CR 304.4 / 307.4 — an instant or sorcery can never be a permanent, so a
    // battlefield instance of one is SYNTHETIC: it pins the matcher's type
    // axis, not a reachable board. The illegal candidate is the same card as a
    // SPELL — "target instant" is not "target instant spell" (`spell` +
    // `spellTypeFilter`), and the client must not ring the stack for it.
    Instant: {
        requirement: { type: "Instant", count: 1 },
        build: () =>
            board(
                [onBoard(counterspell.id, "instant-perm")],
                [counterspell.id]
            ),
        legal: "permanent:instant-perm",
        illegal: "spell:*",
    },
    Sorcery: {
        requirement: { type: "Sorcery", count: 1 },
        build: () =>
            board([onBoard(stoneRain.id, "sorcery-perm")], [stoneRain.id]),
        legal: "permanent:sorcery-perm",
        illegal: "spell:*",
    },
    Artifact: {
        requirement: { type: "Artifact", count: 1 },
        build: () => board([onBoard(solRing.id, "ring"), BEARS()]),
        legal: "permanent:ring",
        illegal: "permanent:bears",
    },
    Enchantment: {
        requirement: { type: "Enchantment", count: 1 },
        build: () => board([onBoard(animateWall.id, "aura"), BEARS()]),
        legal: "permanent:aura",
        illegal: "permanent:bears",
    },
    Land: {
        requirement: { type: "Land", count: 1 },
        build: () => board([onBoard(forest.id, "forest"), BEARS()]),
        legal: "permanent:forest",
        illegal: "permanent:bears",
    },
    // No Battle and no Kindred permanent is in the catalogue yet; the matcher
    // reads only the instance's `types`, which the projection carries as-is.
    Battle: {
        requirement: { type: "Battle", count: 1 },
        build: () => board([onBoard(forest.id, "battle", ["Battle"]), BEARS()]),
        legal: "permanent:battle",
        illegal: "permanent:bears",
    },
    Kindred: {
        requirement: { type: "Kindred", count: 1 },
        build: () =>
            board([
                onBoard(solRing.id, "kindred", ["Kindred", "Artifact"]),
                BEARS(),
            ]),
        legal: "permanent:kindred",
        illegal: "permanent:bears",
    },
    player: {
        requirement: { type: "player", count: 1 },
        build: () => board([BEARS()]),
        legal: "player:p2",
        illegal: "permanent:bears",
    },
    // CR 115.4 — "any target": creature, planeswalker, battle or player; never
    // a land.
    any: {
        requirement: { type: "any", count: 1 },
        build: () => board([BEARS(), onBoard(forest.id, "forest")]),
        legal: "permanent:bears",
        illegal: "permanent:forest",
    },
    spell: {
        requirement: { type: "spell", count: 1 },
        build: () => board([BEARS()], [counterspell.id]),
        legal: "spell:*",
        illegal: "permanent:bears",
    },
    // Lace instants — any spell OR any permanent (land included), never a
    // player.
    "spell-or-permanent": {
        requirement: { type: "spell-or-permanent", count: 1 },
        build: () => board([onBoard(forest.id, "forest")], [counterspell.id]),
        legal: "permanent:forest",
        illegal: "player:p2",
    },
    // CR 400.7 — a graveyard card; the permanent of the same card on the
    // battlefield is not one.
    card: {
        requirement: { type: "card", count: 1, zone: "graveyard" },
        build: () => {
            const state = board([BEARS()]);
            state.players[1].graveyard.push(
                makeInstance(grizzlyBears.id, {
                    id: "dead-bears",
                    controllerId: "p2",
                    zone: "graveyard",
                })
            );
            return state;
        },
        legal: "graveyard-card:dead-bears",
        illegal: "permanent:bears",
    },
};

/** `spell:*` names the row's (single) stack item, whose id is minted. */
function resolveKey(state: GameState, key: string): string {
    return key === "spell:*" ? `spell:${state.stack[0].id}` : key;
}

describe("TargetRequirement.type — client matcher agrees with getLegalTargets (issue #4479)", () => {
    for (const [type, row] of Object.entries(ROWS)) {
        it(`${type}: legal offered, illegal refused, client set = server set`, () => {
            const state = row.build();
            const server = serverOffered(state, row.requirement);
            expect(server).toContain(resolveKey(state, row.legal));
            expect(server).not.toContain(resolveKey(state, row.illegal));
            expect(clientOffered(state, row.requirement)).toEqual(server);
        });
    }
});
