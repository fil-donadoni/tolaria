// MOM red — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Etali, Primal Conqueror // Etali, Primal Sickness (issue #2608). The ETB is
// the tracer for three widenings, each tested here through the REAL
// resolution path (`resolveTopOfStack` + the game.ts pending-choice submit):
//   - `revealUntilMatch.bind` — the matching card's id, a picks binding;
//   - a body picks binding read past its `forEach` as ONE set ("the nonland
//     cards exiled this way", across every player's walk);
//   - `castDuringResolution.anyNumber` — "cast any number of spells from
//     among …", CR 608.2g.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../../__tests__/setup.helper";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { legalActions } from "../../../../gre/legalActions";
import { projectPublicState } from "../../../../gameProjections";
import { activateAbilityOnState } from "../../../../game";
import { transformPermanent } from "../../../../gre/transform";
import { getCardByName } from "../../../index";
import { withTemporaryDefinition } from "../../../registry";
import type { CardDefinition, EffectOp } from "../../../types";

const ETALI = getCardByName("Etali, Primal Conqueror");
const BEARS = getCardByName("Grizzly Bears");
const MOUNTAIN = getCardByName("Mountain");
const SWAMP = getCardByName("Swamp");
const DISENCHANT = getCardByName("Disenchant");

function card(
    defId: string,
    id: string,
    owner: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
    });
}

/** Etali on p1's battlefield with its ETB on the stack. `libraries` are
 *  listed TOP FIRST (`peekLibraryTop` reads index 0). */
function etbOnStack(libraries: {
    p1: CardInstanceState[];
    p2: CardInstanceState[];
}): GameState {
    const etali = card(ETALI.id, "etali", "p1", "battlefield");
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [etali], library: libraries.p1 }),
            makePlayer("p2", { library: libraries.p2 }),
        ],
    });
    state.stack.push({
        ...etali,
        id: "etali-etb",
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "etali-primal-conqueror-etb",
        triggerSourceId: etali.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: etali.id,
            controllerId: "p1",
            types: ["Creature"],
        },
        targets: undefined,
    } as StackItem);
    return state;
}

function exileIds(state: GameState, seat: 0 | 1): string[] {
    return state.players[seat].exile.map((c) => c.id).sort();
}

function offeredIds(state: GameState): string[] | undefined {
    const head = state.pendingChoices?.[0];
    if (head?.kind !== "option-pick") return undefined;
    return head.options?.map((o) => o.id);
}

describe("Etali, Primal Conqueror — each player exiles until a nonland card; cast any number free (CR 608.2g, issue #2608)", () => {
    it("exiles from EVERY library until a nonland card, then offers both nonland cards — cast across owners, last cast resolves first", () => {
        const state = etbOnStack({
            p1: [
                card(MOUNTAIN.id, "m1", "p1", "library"),
                card(BEARS.id, "b1", "p1", "library"),
                card(BEARS.id, "b1-deep", "p1", "library"),
            ],
            p2: [
                card(SWAMP.id, "s2", "p2", "library"),
                card(SWAMP.id, "s2b", "p2", "library"),
                card(BEARS.id, "b2", "p2", "library"),
            ],
        });
        resolveTopOfStack(state);

        // Each walk stops AT its first nonland card; everything walked is in
        // its OWNER's exile, and nothing below the hit moved.
        expect(exileIds(state, 0)).toEqual(["b1", "m1"]);
        expect(exileIds(state, 1)).toEqual(["b2", "s2", "s2b"]);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["b1-deep"]);
        expect(state.players[1].library).toHaveLength(0);

        // Only the NONLAND cards are offered, in APNAP order, plus "stop".
        expect(state.pendingChoices![0].playerId).toBe("p1");
        expect(offeredIds(state)).toEqual(["b1", "b2", "stop"]);

        // The opponent's card first: Etali's controller casts it.
        submitChoice(state, ["b2"]);
        expect(offeredIds(state)).toEqual(["b1", "stop"]);
        submitChoice(state, ["b1"]);

        // Both cast, nothing left to offer: the resolution is over.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.map((s) => s.id)).toEqual(["b2", "b1"]);
        for (const s of state.stack) expect(s.castById).toBe("p1");
        // The lands stay exiled.
        expect(exileIds(state, 0)).toEqual(["m1"]);
        expect(exileIds(state, 1)).toEqual(["s2", "s2b"]);

        // CR 608.2g — the LAST spell cast is the topmost object.
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("b1");
        resolveTopOfStack(state);
        const stolen = state.players[0].battlefield.find((c) => c.id === "b2");
        expect(stolen?.controllerId).toBe("p1");
        expect(stolen?.ownerId).toBe("p2");
    });

    it("casting is optional — stopping at once casts nothing, and the uncast cards stay exiled with no later permission", () => {
        const state = etbOnStack({
            p1: [card(BEARS.id, "b1", "p1", "library")],
            p2: [card(BEARS.id, "b2", "p2", "library")],
        });
        resolveTopOfStack(state);
        submitChoice(state, ["stop"]);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(exileIds(state, 0)).toEqual(["b1"]);
        expect(exileIds(state, 1)).toEqual(["b2"]);
        // CR 608.2g — the permission died with the resolution: no action
        // casts either card afterwards, even with priority in a main phase.
        state.phase = "PRECOMBAT_MAIN";
        state.priorityPlayerId = "p1";
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 };
        const offered = JSON.stringify(legalActions(state));
        expect(offered).toContain('"p1"'); // p1 does have priority actions
        expect(offered).not.toContain('"b1"');
        expect(offered).not.toContain('"b2"');
    });

    it("a card that cannot be cast (no legal target) is skipped and the others are still offered", () => {
        const state = etbOnStack({
            p1: [card(BEARS.id, "b1", "p1", "library")],
            p2: [card(DISENCHANT.id, "dis", "p2", "library")],
        });
        resolveTopOfStack(state);
        expect(offeredIds(state)).toEqual(["b1", "dis", "stop"]);

        // No artifact or enchantment anywhere: Disenchant is not cast.
        submitChoice(state, ["dis"]);
        expect(offeredIds(state)).toEqual(["b1", "stop"]);
        submitChoice(state, ["b1"]);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.map((s) => s.id)).toEqual(["b1"]);
        expect(exileIds(state, 1)).toEqual(["dis"]);
    });

    it("an empty library exiles nothing and loses nothing; a library with no nonland card is exiled whole (CR 101.3 / 609.3)", () => {
        const state = etbOnStack({
            p1: [
                card(MOUNTAIN.id, "m1", "p1", "library"),
                card(MOUNTAIN.id, "m2", "p1", "library"),
            ],
            p2: [],
        });
        resolveTopOfStack(state);

        expect(exileIds(state, 0)).toEqual(["m1", "m2"]);
        expect(state.players[0].library).toHaveLength(0);
        // Nothing nonland was exiled: no offer at all.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        checkStateBasedActions(state);
        expect(state.gameOver).toBeFalsy();
    });

    it("the offer reaches the chooser's client through the projection, with the exiled cards public to both (CR 406.3)", () => {
        const state = etbOnStack({
            p1: [card(BEARS.id, "b1", "p1", "library")],
            p2: [card(BEARS.id, "b2", "p2", "library")],
        });
        resolveTopOfStack(state);

        const mine = projectPublicState(state, 0, "p1");
        const choice = mine.pendingChoices?.[0];
        expect(choice?.kind).toBe("option-pick");
        expect(choice?.options?.map((o) => o.label)).toEqual([
            "Grizzly Bears",
            "Grizzly Bears",
            "Stop casting",
        ]);
        const theirs = projectPublicState(state, 0, "p2");
        const p1Exile = theirs.players.find((p) => p.id === "p1")!.exile;
        expect(p1Exile.map((c) => c.id)).toEqual(["b1"]);
        expect(JSON.stringify(p1Exile)).toContain(BEARS.id);
    });
});

describe("a forEach body's picks binding is read as a set only AFTER the construct (issue #2608)", () => {
    /** Etali with the cast moved INSIDE the body: each player's own hit is
     *  offered during that player's iteration. */
    function castInsideBody(): CardDefinition {
        const etb = ETALI.triggeredAbilities![0];
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: { set: "players" },
                effects: [
                    {
                        op: "revealUntilMatch",
                        player: { ref: "$each" },
                        filter: { excludeType: "Land" },
                        match: "exile",
                        rest: "exile",
                        bind: "$hit",
                    },
                    {
                        op: "castDuringResolution",
                        player: "controller",
                        card: { ref: "$hit" },
                        source: "exile",
                        free: true,
                    },
                ],
            },
        ];
        return { ...ETALI, triggeredAbilities: [{ ...etb, effects }] };
    }

    it("an iteration whose walk found nothing reads nothing — never an earlier iteration's card", () => {
        withTemporaryDefinition(castInsideBody(), () => {
            const state = etbOnStack({
                p1: [card(BEARS.id, "b1", "p1", "library")],
                p2: [card(SWAMP.id, "s2", "p2", "library")],
            });
            resolveTopOfStack(state);
            // p1's iteration: its own hit, offered once.
            expect(offeredIds(state)).toEqual(["cast", "decline"]);
            submitChoice(state, ["decline"]);
            // p2's iteration exiled only a land: no second offer of b1.
            expect(state.pendingChoices).toBeUndefined();
            expect(exileIds(state, 0)).toEqual(["b1"]);
            expect(exileIds(state, 1)).toEqual(["s2"]);
        });
    });
});

describe("Etali, Primal Conqueror — {9}{G/P}: transform, sorcery speed (CR 107.4f / 701.27a)", () => {
    function boardWithMana(pool: Partial<Record<string, number>>): GameState {
        const etali = card(ETALI.id, "etali", "p1", "battlefield");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [etali],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...pool },
                }),
                makePlayer("p2"),
            ],
        });
        state.phase = "PRECOMBAT_MAIN";
        return state;
    }

    it("pays the pip with 2 life and transforms Etali into Etali, Primal Sickness", () => {
        const state = boardWithMana({ C: 9 });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "etali",
            abilityId: "etali-primal-conqueror-transform",
            phyrexianLifePips: 1,
        });
        expect(state.players[0].life).toBe(18);
        resolveTopOfStack(state);
        const flipped = state.players[0].battlefield.find(
            (c) => c.id === "etali"
        )!;
        expect(flipped.transformed).toBe(true);
        const seen = projectPublicState(state, 0, "p2").players[0]
            .battlefield[0];
        expect(JSON.stringify(seen)).toContain("Etali, Primal Sickness");
    });
});

describe("Etali, Primal Sickness — combat damage to a player is that many poison counters (CR 120.3b / 704.5c)", () => {
    it("eleven combat damage gives eleven poison counters, and the player loses", () => {
        const etali = card(ETALI.id, "etali", "p1", "battlefield");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [etali] }),
                makePlayer("p2"),
            ],
        });
        transformPermanent(state, etali);
        expect(etali.transformed).toBe(true);
        state.stack.push({
            ...etali,
            id: "etali-poison",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "etali-primal-sickness-poison",
            triggerSourceId: etali.id,
            triggerEvent: {
                type: "DAMAGE_DEALT",
                sourceInstanceId: etali.id,
                sourceControllerId: "p1",
                target: { type: "player", id: "p2" },
                amount: 11,
                isCombat: true,
                sourceTypes: ["Creature"],
            },
            targets: undefined,
        } as StackItem);
        resolveTopOfStack(state);
        expect(state.players[1].poisonCounters).toBe(11);
        checkStateBasedActions(state);
        expect(state.gameOver).toBeTruthy();
    });
});
