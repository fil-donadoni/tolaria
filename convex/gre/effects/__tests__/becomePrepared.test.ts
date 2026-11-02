// `becomePrepared` (issue #3689) — CR 722.3a "this creature becomes prepared",
// the Op's permanent test. It gives the designation through the SAME seam
// "enters prepared" uses (`becomePrepared`, `gre/prepare.ts`), so CR 722.3a's
// two refusals and CR 722.3c's exiled copy come from one place.
//
//  1. The Op on an announced slot: gains (one copy in exile), refuses twice
//     (already prepared; no prepare spell), skips a gone target (CR 608.2b),
//     acts per member of a `forEach` set, and crosses the wire.
//  2. `$source` through the cards that print it: Emeritus of Truce's entry
//     trigger behind its resolution-time comparison (CR 608.2c), and Emeritus
//     of Abundance's attack trigger behind its intervening "if" (CR 603.4),
//     checked both as it triggers and as it resolves.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { insetSpellDefinitionId } from "../../../cards/insetSpell";
import { withTemporaryDefinition } from "../../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectOp, GameEvent } from "../../../cards/types";
import { projectPublicState } from "../../../gameProjections";
import {
    emitPermanentEntered,
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../state";
import { collectTriggers } from "../../triggers";

const TRUCE = getCardByName("Emeritus of Truce").id;
const PLOWSHARES = insetSpellDefinitionId(TRUCE, "prepare");
const ABUNDANCE = getCardByName("Emeritus of Abundance").id;
const BEARS = getCardByName("Grizzly Bears").id;
const FOREST = getCardByName("Forest").id;

function withScript<T>(effects: EffectOp[], fn: (id: string) => T): T {
    const def: CardDefinition = {
        id: "t3689-become-prepared",
        name: "t3689-become-prepared",
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Sorcery"],
        targetRequirement: { type: "Creature", count: 1 },
        effects,
    };
    return withTemporaryDefinition(def, () => fn(def.id));
}

const PREPARE_TARGET: EffectOp[] = [
    { op: "becomePrepared", target: { target: 0 } },
];

function permanent(
    cardId: string,
    id: string,
    owner: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        ...overrides,
    });
}

function board(
    mine: CardInstanceState[],
    theirs: CardInstanceState[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: mine }),
            makePlayer("p2", { battlefield: theirs }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const copiesOf = (state: GameState, permanentId: string) =>
    state.players
        .flatMap((p) => p.exile)
        .filter((c) => c.preparedCopyOf === permanentId);

const onBattlefield = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);

describe("Effect Script Op: becomePrepared (CR 722.3a, issue #3689)", () => {
    it("CR 722.3a/c — prepares a permanent with a prepare spell: the designation and ONE exiled copy its controller may cast; both cross the wire", () => {
        withScript(PREPARE_TARGET, (id) => {
            const state = board([permanent(TRUCE, "truce", "p1")]);
            pushSpell(state, id, "p1", [{ type: "permanent", id: "truce" }]);
            resolveTopOfStack(state);
            expect(onBattlefield(state, "truce")!.prepared).toBe(true);
            const copies = copiesOf(state, "truce");
            expect(copies.map((c) => c.card.id)).toEqual([PLOWSHARES]);
            expect(copies[0]!.castableFromExileBy).toBe("p1");
            expect(getPlayer(state, "p1").exile).toHaveLength(1);

            const own = projectPublicState(state, 1, "p1");
            expect(
                own.players[0].battlefield.find((c) => c.id === "truce")!
                    .prepared
            ).toBe(true);
            const slimCopy = own.players[0].exile.find(
                (c) => c.id === copies[0]!.id
            )!;
            expect(slimCopy.card.id).toBe(PLOWSHARES);
            expect(slimCopy.castableFromExileBy).toBe("p1");
        });
    });

    it("CR 722.3a — a silent no-op on a permanent that is already prepared: no second copy", () => {
        withScript(PREPARE_TARGET, (id) => {
            const state = board([permanent(TRUCE, "truce", "p1")]);
            pushSpell(state, id, "p1", [{ type: "permanent", id: "truce" }]);
            resolveTopOfStack(state);
            const [first] = copiesOf(state, "truce");
            pushSpell(state, id, "p1", [{ type: "permanent", id: "truce" }]);
            expect(() => resolveTopOfStack(state)).not.toThrow();
            expect(onBattlefield(state, "truce")!.prepared).toBe(true);
            expect(copiesOf(state, "truce").map((c) => c.id)).toEqual([
                first!.id,
            ]);
        });
    });

    it("CR 722.3a — a silent no-op on a permanent without a prepare spell: no designation, no copy", () => {
        withScript(PREPARE_TARGET, (id) => {
            const state = board([], [permanent(BEARS, "bears", "p2")]);
            pushSpell(state, id, "p1", [{ type: "permanent", id: "bears" }]);
            expect(() => resolveTopOfStack(state)).not.toThrow();
            expect(onBattlefield(state, "bears")!.prepared).toBeUndefined();
            expect(state.players.flatMap((p) => p.exile)).toEqual([]);
        });
    });

    it("CR 608.2b — skips a target that has left the battlefield", () => {
        withScript(PREPARE_TARGET, (id) => {
            const state = board([]);
            pushSpell(state, id, "p1", [{ type: "permanent", id: "gone" }]);
            expect(() => resolveTopOfStack(state)).not.toThrow();
            expect(state.players.flatMap((p) => p.exile)).toEqual([]);
        });
    });

    it("prepares every member of a forEach set through $each, the copy going to each one's controller", () => {
        withScript(
            [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        { op: "becomePrepared", target: { ref: "$each" } },
                    ],
                },
            ],
            (id) => {
                const state = board(
                    [permanent(TRUCE, "mine", "p1")],
                    [
                        permanent(TRUCE, "theirs", "p2"),
                        permanent(BEARS, "bears", "p2"),
                    ]
                );
                pushSpell(state, id, "p1", [{ type: "permanent", id: "mine" }]);
                resolveTopOfStack(state);
                expect(onBattlefield(state, "mine")!.prepared).toBe(true);
                expect(onBattlefield(state, "theirs")!.prepared).toBe(true);
                expect(onBattlefield(state, "bears")!.prepared).toBeUndefined();
                expect(copiesOf(state, "theirs").map((c) => c.ownerId)).toEqual(
                    ["p2"]
                );
                expect(getPlayer(state, "p1").exile).toHaveLength(1);
            }
        );
    });
});

describe("Emeritus of Truce — the entry trigger's comparison gates the designation (CR 608.2c)", () => {
    /** Truce enters for p1; its trigger targets `player` and resolves. */
    function enterAndResolve(
        state: GameState,
        player: "p1" | "p2"
    ): CardInstanceState {
        const truce = permanent(TRUCE, "truce", "p1");
        getPlayer(state, "p1").battlefield.push(truce);
        emitPermanentEntered(state, truce);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        state.stack[0]!.targets = [{ type: "player", id: player }];
        resolveTopOfStack(state);
        return onBattlefield(state, "truce")!;
    }

    it("the opponent gets the Inkling and then controls more creatures: Truce becomes prepared", () => {
        // p2: one Bears + the Inkling = 2; p1: Truce alone = 1.
        const state = board([], [permanent(BEARS, "bears", "p2")]);
        const truce = enterAndResolve(state, "p2");
        const inklings = getPlayer(state, "p2").battlefield.filter((c) =>
            (c.subtypes ?? []).includes("Inkling")
        );
        expect(inklings).toHaveLength(1);
        expect(inklings[0]!.staticAbilities).toContain("flying");
        expect(truce.prepared).toBe(true);
        expect(copiesOf(state, "truce").map((c) => c.card.id)).toEqual([
            PLOWSHARES,
        ]);
    });

    it("the controller takes the Inkling and the opponent no longer controls more: Truce stays unprepared", () => {
        // Same board: p2 one Bears; p1 Truce + the Inkling = 2. Not more.
        const state = board([], [permanent(BEARS, "bears", "p2")]);
        const truce = enterAndResolve(state, "p1");
        expect(
            getPlayer(state, "p1").battlefield.filter((c) =>
                (c.subtypes ?? []).includes("Inkling")
            )
        ).toHaveLength(1);
        expect(truce.prepared).toBeUndefined();
        expect(copiesOf(state, "truce")).toEqual([]);
    });
});

describe("Emeritus of Abundance — the intervening if (CR 603.4) on its attack trigger", () => {
    /** p1: Abundance, already UNPREPARED (it attacked once before), and
     *  `lands` Forests. */
    function abundanceBoard(lands: number): GameState {
        return board([
            permanent(ABUNDANCE, "abundance", "p1"),
            ...Array.from({ length: lands }, (_, i) =>
                permanent(FOREST, `forest-${i}`, "p1")
            ),
        ]);
    }

    const attack: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "p1",
        attackerIds: ["abundance"],
    };

    it("CR 603.4 — with seven lands as it attacks, the ability does not trigger", () => {
        expect(collectTriggers(abundanceBoard(7), [attack])).toEqual([]);
    });

    it("CR 603.4 — with eight lands it triggers and, still eight as it resolves, Abundance becomes prepared", () => {
        const state = abundanceBoard(8);
        const triggers = collectTriggers(state, [attack]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "abundance")!.prepared).toBe(true);
        expect(copiesOf(state, "abundance").map((c) => c.card.id)).toEqual([
            insetSpellDefinitionId(ABUNDANCE, "prepare"),
        ]);
    });

    it("CR 603.4 — triggered with eight lands, but seven as it resolves: removed from the stack, does nothing", () => {
        const state = abundanceBoard(8);
        const triggers = collectTriggers(state, [attack]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "forest-0");
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(onBattlefield(state, "abundance")!.prepared).toBeUndefined();
        expect(copiesOf(state, "abundance")).toEqual([]);
    });
});
