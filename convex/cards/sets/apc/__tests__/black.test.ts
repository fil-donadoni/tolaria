// Per-card behaviour tests for APC black cards
// (`convex/cards/sets/apc/black.ts`).
//
// Both cards are hand-tail (issue #3806) and both carry a card-level claim no
// Op test makes:
//
//   * Dead Ringers — the printed line is a DOUBLE NEGATIVE ("unless either one
//     is a color the other isn't") over a colour SET, and every cheaper
//     reading is wrong in a way that still looks like a working card:
//     `sharesColor` destroys a gold/mono pair it must spare, and any
//     "shares nothing" reading spares two colourless creatures it must
//     destroy. The gate is also at RESOLUTION, not at targeting: a mismatched
//     pair is perfectly legal to target and simply does nothing.
//   * Mind Extraction — the discard reads the colours of a creature that is
//     already in the graveyard (CR 608.2h), and a colourless victim must
//     discard NOTHING. The fail-open shape of that read empties the hand.
//
// The cost → snapshot half of Mind Extraction runs through `game.ts` in
// `convex/__tests__/sacrificedColorsFullPath.test.ts`; these tests exercise
// the REAL card definitions at resolution.
//
// Resolved through the REGISTRY SEAM by id, never by name.
import { describe, expect, it } from "vitest";
import { FACE_DOWN_CARD_ID, getDefinition } from "../../../index";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    advancePhase,
    emitBlockersConfirmedEvents,
    finalizeCleanup,
} from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { compactState, expandState } from "../../../../gre/serialize";
import { collectTriggers } from "../../../../gre/triggers";
import type { GameEvent } from "../../../types";
import { activateAbility, passPriority } from "../../../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../../../__tests__/gameMutationHarness";
import type { Id } from "../../../../_generated/dataModel";

const GAME_ID = "game-1" as Id<"games">;

const DEAD_RINGERS = getDefinition("9b78028c-3ebd-432d-b628-e1fa284f08f3");
const MIND_EXTRACTION = getDefinition("7d77ddcc-e66b-4036-8a55-ec42953918d1");
const SUPPRESS = getDefinition("642eefde-8727-44ff-9e04-373abfcd0679");

/** Angus Mackenzie — {G}{W}{U}, nonblack and multicoloured. */
const GOLD_CREATURE = getDefinition("57264bd9-94f6-4d4d-baff-2b2900585635");
/** Grizzly Bears — {1}{G}, nonblack and monocoloured. */
const GREEN_CREATURE = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
/** Ornithopter — colourless (CR 105.2c). */
const COLORLESS_CREATURE = getDefinition(
    "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0"
);
/** Barktooth Warbeard — {4}{B}{R}, so BLACK: never a legal target. */
const BLACK_CREATURE = getDefinition("0ea52228-f8ad-4623-9e05-f162473bfc03");
/** Dark Ritual — a black card in hand. */
const BLACK_CARD = getDefinition("ebb6664d-23ca-456e-9916-afcd6f26aa7f");
/** Lightning Bolt — a red card in hand. */
const RED_CARD = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

describe("Dead Ringers — destroy two target nonblack creatures unless either is a color the other isn't (CR 105.2 / 608.2b, issue #3806)", () => {
    /** p2 controls the two creatures named by definition id. */
    function board(aDef: string, bDef: string): GameState {
        const a = makeInstance(aDef, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b = makeInstance(bDef, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
    }

    function cast(state: GameState, bId = "b"): string[] {
        pushSpell(state, DEAD_RINGERS.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: bId },
        ]);
        resolveTopOfStack(state);
        return state.players[1].battlefield.map((c) => c.id).sort();
    }

    it("destroys both when the colour SETS are equal", () => {
        expect(cast(board(GREEN_CREATURE.id, GREEN_CREATURE.id))).toEqual([]);
    });

    // The `sharesColor` misparse: a green-white-blue creature SHARES green
    // with a mono-green one, and green is a colour it isn't. Neither dies.
    it("destroys NEITHER when one is a colour the other isn't", () => {
        expect(cast(board(GOLD_CREATURE.id, GREEN_CREATURE.id))).toEqual([
            "a",
            "b",
        ]);
    });

    // CR 105.2c — colourless is the absence of colour, not a sixth colour:
    // neither is a colour the other isn't, so both die.
    it("destroys two COLOURLESS creatures (CR 105.2c)", () => {
        expect(
            cast(board(COLORLESS_CREATURE.id, COLORLESS_CREATURE.id))
        ).toEqual([]);
    });

    it("destroys neither when only one is colourless", () => {
        expect(cast(board(COLORLESS_CREATURE.id, GREEN_CREATURE.id))).toEqual([
            "a",
            "b",
        ]);
    });

    // The "unless" is a RESOLUTION gate, not a targeting restriction: a
    // mismatched pair is legal to announce and simply does nothing.
    it("targets any two NONBLACK creatures — the colour gate is not a targeting one", () => {
        const state = board(GOLD_CREATURE.id, GREEN_CREATURE.id);
        const black = makeInstance(BLACK_CREATURE.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(black);
        const legal = getLegalTargets(
            state,
            DEAD_RINGERS.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const ids = legal
            .filter((t) => t.type === "permanent")
            .map((t) => (t as { id: string }).id)
            .sort();
        expect(ids).toEqual(["a", "b"]);
    });

    // CR 608.2b — "if part of the effect requires information about an
    // illegal target, it fails to determine any such information".
    it("destroys neither when one target is gone (CR 608.2b)", () => {
        const state = board(GREEN_CREATURE.id, GREEN_CREATURE.id);
        expect(() => cast(state, "ghost")).not.toThrow();
        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);
    });
});

describe("Mind Extraction — discard all cards of each of the sacrificed creature's colors (CR 105.2 / 608.2h, issue #3806)", () => {
    /** p2's hand is one green creature, one black card and one red card;
     *  `colors` is the cost-sacrifice snapshot stamped on the stack item. */
    function run(colors: string[] | undefined): {
        graveyard: string[];
        hand: string[];
        revealed: boolean;
    } {
        const cards: CardInstanceState[] = [
            GREEN_CREATURE.id,
            BLACK_CARD.id,
            RED_CARD.id,
        ].map((defId, i) =>
            makeInstance(defId, {
                id: `h${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: cards })],
        });
        const item = pushSpell(state, MIND_EXTRACTION.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "victim",
            mv: 2,
            ...(colors !== undefined ? { colors: colors as never[] } : {}),
        };
        resolveTopOfStack(state);
        const player = state.players[1];
        return {
            graveyard: player.graveyard.map((c) => c.id).sort(),
            hand: player.hand.map((c) => c.id).sort(),
            // CR 701.20a — the reveal happens regardless of what is discarded.
            revealed: [...player.hand, ...player.graveyard].every(
                (c) => (c.knownTo ?? []).length > 0
            ),
        };
    }

    it("discards every card of the sacrificed creature's colour", () => {
        const out = run(["G"]);
        expect(out.graveyard).toEqual(["h0"]);
        expect(out.hand).toEqual(["h1", "h2"]);
    });

    it("discards the UNION for a multicoloured victim", () => {
        expect(run(["B", "R"]).graveyard).toEqual(["h1", "h2"]);
    });

    // CR 105.2c — no colours, so no card is "of" them. The reveal still
    // happened; the discard found nothing.
    it("discards NOTHING for a colourless victim, but still reveals (CR 105.2c / 701.20a)", () => {
        const out = run([]);
        expect(out.graveyard).toEqual([]);
        expect(out.hand).toEqual(["h0", "h1", "h2"]);
        expect(out.revealed).toBe(true);
    });

    it("discards nothing with no snapshot colours at all (CR 608.2b)", () => {
        expect(run(undefined).graveyard).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Zombie Boa (issue #3809) — a chosen COLOUR parameterises a this-turn
// "becomes blocked by a creature of that color" trigger (CR 509.3d).
// ---------------------------------------------------------------------------

const ZOMBIE_BOA = getDefinition("1fb8c277-3154-47c9-835f-327cac297a5e");

/** p1 attacks-ready with Zombie Boa (and a second attacker); p2 holds two
 *  green creatures and one black-and-red one as potential blockers. */
function boaBoard(): GameState {
    const blocker = (defId: string, id: string) =>
        makeInstance(defId, { id, controllerId: "p2", ownerId: "p2" });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(ZOMBIE_BOA.id, {
                        id: "boa",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(GREEN_CREATURE.id, {
                        id: "other-attacker",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    blocker(GREEN_CREATURE.id, "g1"),
                    blocker(GREEN_CREATURE.id, "g2"),
                    blocker(BLACK_CREATURE.id, "k1"),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** Resolves Zombie Boa's ability (cost assumed paid) and names `color`. */
function activateBoa(state: GameState, color: string): void {
    const boa = state.players[0].battlefield.find((c) => c.id === "boa")!;
    state.stack.push({
        ...boa,
        zone: "stack",
        castById: "p1",
        abilityId: "zombie-boa-watch",
        targets: [],
    });
    resolveTopOfStack(state);
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("option-pick");
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [color],
    });
}

/** Declares `blocks` (blocker → attacker) as confirmed and fires the
 *  BLOCKERS_CONFIRMED batch, putting any resulting triggers on the stack. */
function block(
    state: GameState,
    attackerIds: string[],
    blocks: Record<string, string>
): void {
    state.phase = "DECLARE_BLOCKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockersConfirmed: true,
        blockerAssignments: Object.fromEntries(
            Object.entries(blocks).map(([b, a]) => [b, [a]])
        ),
    };
    emitBlockersConfirmedEvents(state);
}

const boaTriggers = (state: GameState) =>
    state.stack.filter((i) => i.delayedTriggerId !== undefined);

const onBattlefield = (state: GameState, id: string) =>
    state.players.some((p) => p.battlefield.some((c) => c.id === id));

describe("Zombie Boa — choose a color; whenever it becomes blocked by a creature of that color this turn, destroy that creature (CR 509.3d, issue #3809)", () => {
    it("fires only for a blocker of the chosen colour, and destroys THAT blocker", () => {
        const state = boaBoard();
        activateBoa(state, "G");
        block(state, ["boa"], { g1: "boa", k1: "boa" });
        // The black-and-red blocker does not trigger it at all: the colour is
        // part of the trigger event, not an intervening-if.
        expect(boaTriggers(state)).toHaveLength(1);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "g1")).toBe(false);
        expect(onBattlefield(state, "k1")).toBe(true);
        // Wire format — the destroyed blocker is in its owner's graveyard.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].graveyard.map((c) => c.id)).toContain("g1");
    });

    it("the colour condition survives the persisted snapshot (serialize round-trip)", () => {
        const live = boaBoard();
        activateBoa(live, "G");
        const state = expandState(compactState(live));
        expect(state.delayedTriggers?.[0]?.blockerColors).toEqual(["G"]);
        block(state, ["boa"], { g1: "boa", k1: "boa" });
        expect(boaTriggers(state)).toHaveLength(1);
    });

    it("triggers once for EACH creature of that colour blocking it (CR 509.3d)", () => {
        const state = boaBoard();
        activateBoa(state, "G");
        block(state, ["boa"], { g1: "boa", g2: "boa" });
        expect(boaTriggers(state)).toHaveLength(2);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "g1")).toBe(false);
        expect(onBattlefield(state, "g2")).toBe(false);
    });

    it("a colourless blocker matches no colour — fail closed (CR 105.2c)", () => {
        const state = boaBoard();
        state.players[1].battlefield.push(
            makeInstance(COLORLESS_CREATURE.id, {
                id: "thopter",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        activateBoa(state, "G");
        block(state, ["boa"], { thopter: "boa" });
        expect(boaTriggers(state)).toHaveLength(0);
    });

    it("CR 400.7 — a Boa that left and came back is a new object: the old watch is gone", () => {
        const state = boaBoard();
        activateBoa(state, "G");
        expect(state.delayedTriggers ?? []).toHaveLength(1);
        // Flicker: it leaves (PERMANENT_LEFT) and returns under the same id.
        const boa = state.players[0].battlefield.find((c) => c.id === "boa")!;
        removePermanentTo(state, "boa", "exile");
        collectTriggers(state, [
            {
                type: "PERMANENT_LEFT",
                instanceId: "boa",
                toZone: "exile",
            } as GameEvent,
        ]);
        // The departure itself drops the watch.
        expect(
            (state.delayedTriggers ?? []).filter(
                (t) => t.timing === "becomes-blocked-by"
            )
        ).toHaveLength(0);
        state.players[0].exile = state.players[0].exile.filter(
            (c) => c.id !== "boa"
        );
        state.players[0].battlefield.push({ ...boa, zone: "battlefield" });
        block(state, ["boa"], { g1: "boa" });
        expect(boaTriggers(state)).toHaveLength(0);
        expect(onBattlefield(state, "g1")).toBe(true);
    });

    it("watches only Zombie Boa — a green creature blocking ANOTHER attacker is untouched", () => {
        const state = boaBoard();
        activateBoa(state, "G");
        block(state, ["boa", "other-attacker"], { g1: "other-attacker" });
        expect(boaTriggers(state)).toHaveLength(0);
    });

    it("naming another colour turns the same block into no trigger", () => {
        const state = boaBoard();
        activateBoa(state, "B");
        block(state, ["boa"], { g1: "boa", k1: "boa" });
        expect(boaTriggers(state)).toHaveLength(1);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "k1")).toBe(false);
        expect(onBattlefield(state, "g1")).toBe(true);
    });

    it("lasts the rest of the turn (stays queued after firing) and expires at cleanup (CR 514.2)", () => {
        const state = boaBoard();
        activateBoa(state, "G");
        block(state, ["boa"], { g1: "boa" });
        expect(
            state.delayedTriggers?.filter(
                (t) => t.timing === "becomes-blocked-by"
            )
        ).toHaveLength(1);
        state.stack = [];
        state.combat = undefined;
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("is activatable only as a sorcery, through game.ts", async () => {
        const activate = async (state: GameState) => {
            const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
            await runMutation(
                activateAbility as unknown as Handler<unknown, void>,
                harness.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    cardInstanceId: "boa",
                    abilityId: "zombie-boa-watch",
                }
            );
            return harness.state();
        };
        const mana = { W: 0, U: 0, B: 2, R: 0, G: 0, C: 0 };
        // Own main phase, empty stack: legal, and the ability is on the stack.
        const legal = boaBoard();
        legal.players[0].manaPool = { ...mana };
        const after = await activate(legal);
        expect(after.stack[after.stack.length - 1]?.abilityId).toBe(
            "zombie-boa-watch"
        );
        // A non-empty stack is not sorcery timing (CR 307.1 / 602.5d).
        const busy = boaBoard();
        busy.players[0].manaPool = { ...mana };
        busy.stack.push({
            ...busy.players[1].battlefield[0],
            zone: "stack",
            castById: "p2",
            targets: [],
        });
        await expect(activate(busy)).rejects.toThrow(/sorcery/i);
    });
});

describe("Suppress — target player exiles their hand face down; it returns at the end step of THAT player's NEXT turn (CR 406.3 / 603.7, issue #3812)", () => {
    const HAND = ["h1", "h2", "h3"];

    /** p1 active in turn 1's main phase with Suppress on the stack aimed at
     *  `target`; both players hold three cards and a library to draw from. */
    function suppressBoard(target: "p1" | "p2", handOf = HAND): GameState {
        const hand = (owner: string) =>
            handOf.map((id, i) =>
                makeInstance(
                    [GREEN_CREATURE, RED_CARD, BLACK_CARD][i % 3]!.id,
                    {
                        id: `${owner}-${id}`,
                        ownerId: owner,
                        controllerId: owner,
                        zone: "hand",
                    }
                )
            );
        const library = (owner: string) =>
            Array.from({ length: 6 }, (_, i) =>
                makeInstance(GREEN_CREATURE.id, {
                    id: `${owner}-lib${i}`,
                    ownerId: owner,
                    controllerId: owner,
                    zone: "library",
                })
            );
        const state = makeState({
            players: [
                makePlayer("p1", { hand: hand("p1"), library: library("p1") }),
                makePlayer("p2", { hand: hand("p2"), library: library("p2") }),
            ],
        });
        pushSpell(state, SUPPRESS.id, "p1", [{ type: "player", id: target }]);
        return state;
    }

    const exiledIds = (state: GameState, pid: string) =>
        state.players.find((p) => p.id === pid)!.exile.map((c) => c.id);
    const handIds = (state: GameState, pid: string) =>
        state.players.find((p) => p.id === pid)!.hand.map((c) => c.id);

    /** Resolve whatever is on the stack, else step the turn structure, until
     *  `stop` holds. */
    function runUntil(state: GameState, stop: (s: GameState) => boolean) {
        for (let i = 0; i < 80; i++) {
            if (stop(state)) return;
            if (state.stack.length > 0) resolveTopOfStack(state);
            else advancePhase(state);
        }
        throw new Error("runUntil: condition never reached");
    }
    const atEndStep = (turn: number) => (s: GameState) =>
        s.turn === turn && s.phase === "END_STEP";

    it("exiles the target's WHOLE hand face down — hidden from BOTH viewers on the wire", () => {
        const state = suppressBoard("p2");
        resolveTopOfStack(state);
        const opp = HAND.map((id) => `p2-${id}`);
        expect(handIds(state, "p2")).toEqual([]);
        expect(exiledIds(state, "p2")).toEqual(opp);
        // The caster's own hand is untouched.
        expect(handIds(state, "p1")).toHaveLength(3);
        // CR 406.3 — no player may examine them: no `knownTo` grant at all.
        for (const c of state.players[1].exile) {
            expect(c.faceDownBy).toBe("face-down-exile");
            expect(c.knownTo).toBeUndefined();
        }
        // Wire format — the owner AND the opponent both see face-down cards
        // with no identity.
        for (const viewer of ["p1", "p2"]) {
            const view = projectPublicState(state, 1, viewer);
            const pile = view.players[1].exile;
            expect(pile).toHaveLength(3);
            for (const c of pile) {
                expect(c.card.id).toBe(FACE_DOWN_CARD_ID);
                expect(c.faceDown).toBe(true);
            }
        }
    });

    it("returns those cards at the end step of THAT player's next turn — not at the caster's end step", () => {
        const state = suppressBoard("p2");
        resolveTopOfStack(state);
        runUntil(state, atEndStep(1));
        // Turn 1 is the caster's: nothing fires.
        expect(state.stack).toHaveLength(0);
        expect(exiledIds(state, "p2")).toHaveLength(3);
        runUntil(state, atEndStep(2));
        expect(state.activePlayerId).toBe("p2");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        for (const id of HAND) {
            expect(handIds(state, "p2")).toContain(`p2-${id}`);
        }
        expect(exiledIds(state, "p2")).toEqual([]);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
        // The returned cards were never revealed: the caster learns nothing.
        for (const c of state.players[1].hand) {
            expect(c.knownTo ?? []).not.toContain("p1");
        }
    });

    it("targeting yourself skips THIS turn's end step: it returns on your NEXT turn (turn 3)", () => {
        const state = suppressBoard("p1");
        resolveTopOfStack(state);
        expect(exiledIds(state, "p1")).toHaveLength(3);
        runUntil(state, atEndStep(1));
        expect(state.stack).toHaveLength(0);
        runUntil(state, atEndStep(2));
        expect(state.stack).toHaveLength(0);
        runUntil(state, atEndStep(3));
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        for (const id of HAND)
            expect(handIds(state, "p1")).toContain(`p1-${id}`);
    });

    it("CR 603.7c — a card that left exile meanwhile is a new object and is not returned", () => {
        const state = suppressBoard("p2");
        resolveTopOfStack(state);
        const opp = state.players[1];
        const [gone] = opp.exile.splice(0, 1);
        opp.graveyard.push({ ...gone!, zone: "graveyard" });
        runUntil(state, atEndStep(2));
        resolveTopOfStack(state);
        expect(handIds(state, "p2")).not.toContain(gone!.id);
        expect(opp.graveyard.map((c) => c.id)).toContain(gone!.id);
        expect(handIds(state, "p2")).toHaveLength(2 + 1); // two returned + turn 2 draw
    });

    it("an empty hand exiles nothing; the trigger still fires and returns nothing", () => {
        const state = suppressBoard("p2", []);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toHaveLength(1);
        runUntil(state, atEndStep(2));
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("the turn gate and the frozen card list survive the persisted snapshot (serialize round-trip)", () => {
        const live = suppressBoard("p2");
        resolveTopOfStack(live);
        const state = expandState(compactState(live));
        const [t] = state.delayedTriggers ?? [];
        expect(t?.timing).toBe("player-next-turn-end-step");
        expect(t?.targetPlayerId).toBe("p2");
        expect(t?.scheduledOnTurn).toBe(1);
        expect(t?.payload.exiled).toEqual(HAND.map((id) => `p2-${id}`));
        expect(state.players[1].exile[0]?.faceDownBy).toBe("face-down-exile");
    });

    it("full path: resolves and returns through game.ts passPriority, and the client view follows", async () => {
        const pass = (ctx: Parameters<typeof runMutation>[1], pid: string) =>
            runMutation<{ gameId: Id<"games">; playerId: string }, void>(
                passPriority as unknown as Handler<never, void>,
                ctx,
                { gameId: GAME_ID, playerId: pid }
            );
        const harness = makeMutationCtx("p1", [
            gameStateSeed(suppressBoard("p2")),
        ]);
        const step = async () => {
            const live = harness.state();
            const pid = live.priorityPlayerId;
            const authed = makeMutationCtx(pid, [gameStateSeed(live, 99)]);
            await pass(authed.ctx, pid);
            harness.doc("gs-1").state = authed.doc("gs-1").state;
        };
        // Both players pass: Suppress resolves.
        for (let i = 0; i < 4 && harness.state().stack.length > 0; i++) {
            await step();
        }
        const exiled = harness.state();
        expect(exiled.players[1].hand).toHaveLength(0);
        const oppView = projectPublicState(exiled, 1, "p2");
        expect(oppView.players[1].exile.map((c) => c.card.id)).toEqual([
            FACE_DOWN_CARD_ID,
            FACE_DOWN_CARD_ID,
            FACE_DOWN_CARD_ID,
        ]);
        // The intervening turn structure is exercised by the GRE tests above
        // (declaring attackers is its own mutation); jump the PERSISTED state
        // to p2's turn-2 postcombat main, then let game.ts carry it into the
        // end step, fire the trigger and resolve it.
        const jumped = harness.state();
        jumped.turn = 2;
        jumped.activePlayerId = "p2";
        jumped.priorityPlayerId = "p2";
        jumped.passCount = 0;
        jumped.phase = "POSTCOMBAT_MAIN";
        harness.doc("gs-1").state = gameStateSeed(jumped).state;
        for (let i = 0; i < 12; i++) {
            if (harness.state().players[1].exile.length === 0) break;
            await step();
        }
        const back = harness.state();
        expect(back.turn).toBe(2);
        expect(back.players[1].exile).toHaveLength(0);
        const ownerView = projectPublicState(back, 1, "p2");
        for (const id of HAND) {
            expect(ownerView.players[1].hand.map((c) => c?.id)).toContain(
                `p2-${id}`
            );
        }
    });
});
