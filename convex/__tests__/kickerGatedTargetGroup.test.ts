/**
 * CR 702.33g / CR 601.2c (issue #4220) — a target group announced ONLY if the
 * spell was kicked, driven through the REAL cast path: the `announceCast` and
 * `selectTargets` mutation handlers, then `resolveTopOfStack`.
 *
 * CR 702.33g: "If part of a spell's ability has its effect only if that spell
 * was kicked, and that part of the ability includes any targets, the spell's
 * controller chooses those targets only if that spell was kicked. Otherwise,
 * the spell is cast as if it did not have those targets." CR 601.2c states the
 * general rule: "A spell may require some targets only if an alternative or
 * additional cost (such as a kicker cost) ... was chosen for it".
 *
 * The engine's OTHER encoding of that rule — `kickedTargetRequirement`, the
 * base requirement with a wider COUNT swapped in — can only say "another of
 * the same". This file is about the shape for a kicked half naming something
 * ELSE, which has no count to widen: Orim's Thunder announces an
 * artifact-or-enchantment always and a creature only when kicked.
 *
 * No catalogue card carries the shape yet (Orim's Thunder is blocked on the
 * grammar half of its own text, filed separately), so every test registers a
 * variant — the `withTemporaryDefinitionAsync` seam `modalCardinality.test.ts`
 * uses for the same reason. What the harness buys over a hand-built
 * `PendingTarget` is the one thing a unit test cannot reach: `announceCast`'s
 * own decision about which groups this cast has.
 */

import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { ankhOfMishra, plains } from "../cards/sets/lea/colorless";
import { grizzlyBears } from "../cards/sets/lea/green";
import { withTemporaryDefinitionAsync } from "../cards";
import type { CardDefinition } from "../cards/types";
import { announceCast, selectTargets } from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness";
import type { Id } from "../_generated/dataModel";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../gre/state";
import { projectPublicState } from "../gameProjections";

/** Orim's Thunder's announcement, with its out-of-scope back-reference
 *  ("damage equal to that permanent's mana value") replaced by a fixed 2 —
 *  the grammar half of that card is its own issue, and nothing here depends on
 *  it. The base group is an artifact-or-enchantment; the KICKED half announces
 *  a creature, a descriptor the widened-count encoding cannot express. */
const THUNDER: CardDefinition = {
    id: "5f86bba5-e203-4a86-a415-ce748f6d1f6f",
    name: "Kicked Thunder",
    rarity: "uncommon",
    oracleText:
        "Kicker {1}{R}\nDestroy target artifact or enchantment. If this spell was kicked, it deals 2 damage to target creature.",
    manaCost: {},
    types: ["Instant"],
    kickers: [{ id: "kicker", description: "Kicker {1}{R}", mana: { X: 1 } }],
    targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
    additionalTargetRequirements: [
        { type: "Creature", count: 1, announcedOnlyIfKicked: true },
    ],
    effects: [
        { op: "destroy", target: { target: 0 } },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [{ op: "dealDamage", amount: 2, to: { target: 1 } }],
        },
    ],
};

const SPELL = "thunder-1";
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

function permanent(
    cardId: string,
    id: string,
    owner: string
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });
}

/** p1 holds the spell and four generic mana; p2 has the artifact the base
 *  group destroys and the 2/2 the kicked group burns. */
function board(): GameState {
    const spell = makeInstance(THUNDER.id, {
        id: SPELL,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                battlefield: [permanent(plains.id, "my-plains", "p1")],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 4 },
            }),
            makePlayer("p2", {
                battlefield: [
                    permanent(ankhOfMishra.id, "ankh", "p2"),
                    permanent(grizzlyBears.id, "bears", "p2"),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

async function announce(
    harness: ReturnType<typeof makeMutationCtx>,
    kickerPayments?: Record<string, number>
): Promise<void> {
    await runMutation(
        announceCast as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        {
            ...BASE,
            cardInstanceId: SPELL,
            ...(kickerPayments ? { kickerPayments } : {}),
        }
    );
}

async function pick(
    harness: ReturnType<typeof makeMutationCtx>,
    targetId: string
): Promise<void> {
    await runMutation(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, targets: [{ targetType: "permanent", targetId }] }
    );
}

function bothBattlefields(state: GameState): CardInstanceState[] {
    return state.players.flatMap((p) => p.battlefield);
}

/** Probe's announcement — "Draw three cards, then discard two cards. If this
 *  spell was kicked, target player discards two cards." The card declares NO
 *  `targetRequirement` at all: its only group is the gated one, so an unkicked
 *  cast is a spell with no targets (CR 601.2c — "otherwise, the spell is cast
 *  as though it did not require those targets"). This is the shape that made
 *  `announceCast` build the group LIST before choosing the group that opens
 *  the selection, and the compiler emits it (`targetSelectors.test.ts`). */
const PROBE: CardDefinition = {
    id: "f8d227b6-1627-4ea1-b815-887094497abf",
    name: "Gated Probe",
    rarity: "common",
    oracleText:
        "Kicker {1}\nDraw a card. If this spell was kicked, target player loses 2 life.",
    manaCost: {},
    types: ["Sorcery"],
    kickers: [{ id: "kicker", description: "Kicker {1}", mana: { X: 1 } }],
    additionalTargetRequirements: [
        { type: "player", count: 1, announcedOnlyIfKicked: true },
    ],
    effects: [
        { op: "draw", player: "controller", count: 1 },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [{ op: "loseLife", player: { target: 0 }, amount: 2 }],
        },
    ],
};

const PROBE_SPELL = "probe-1";

/** p1 holds Probe with a library to draw from; nothing else matters. */
function probeBoard(): GameState {
    const spell = makeInstance(PROBE.id, {
        id: PROBE_SPELL,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const library = Array.from({ length: 5 }, (_, i) =>
        makeInstance(plains.id, {
            id: `lib-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                library,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 4 },
            }),
            makePlayer("p2", {}),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("the gated group is the card's ONLY group (Probe, CR 601.2c)", () => {
    it("an UNKICKED cast opens no selection at all and goes straight to the stack", async () => {
        await withTemporaryDefinitionAsync(PROBE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(probeBoard()),
            ]);
            await runMutation(
                announceCast as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                { ...BASE, cardInstanceId: PROBE_SPELL }
            );
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0]!.targets ?? []).toEqual([]);
        });
    });

    it("a KICKED cast opens the gated group as slot 0 and resolves against it", async () => {
        await withTemporaryDefinitionAsync(PROBE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(probeBoard()),
            ]);
            await runMutation(
                announceCast as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    ...BASE,
                    cardInstanceId: PROBE_SPELL,
                    kickerPayments: { kicker: 1 },
                }
            );
            // The promoted group governs the whole selection — its own type,
            // its own count, nothing queued behind it.
            expect(harness.state().pendingTarget?.targetType).toBe("player");
            expect(harness.state().pendingTarget?.count).toBe(1);
            expect(
                harness.state().pendingTarget?.remainingRequirements
            ).toBeUndefined();

            await runMutation(
                selectTargets as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    ...BASE,
                    targets: [{ targetType: "player", targetId: "p2" }],
                }
            );
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            // `{ target: 0 }` inside the kicked branch names the gated group's
            // pick — the promotion put it at announced slot 0.
            expect(state.stack[0]!.targets).toEqual([
                { type: "player", id: "p2" },
            ]);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2")!.life).toBe(18);
        });
    });
});

describe("a target group announced only if kicked (CR 702.33g)", () => {
    it("an UNKICKED cast opens the base group and never asks for the gated one", async () => {
        await withTemporaryDefinitionAsync(THUNDER, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
            await announce(harness);
            const pt = harness.state().pendingTarget;
            // CR 702.33g — "the spell is cast as if it did not have those
            // targets": the gated group is not merely deferred, it is absent.
            expect(pt?.targetType).toEqual(["Artifact", "Enchantment"]);
            expect(pt?.remainingRequirements).toBeUndefined();
        });
    });

    it("an unkicked cast finalizes on the base pick alone and resolves", async () => {
        await withTemporaryDefinitionAsync(THUNDER, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
            await announce(harness);
            await pick(harness, "ankh");
            const state = harness.state();
            // One pick ended the whole selection — the gated group would have
            // kept the prompt open for a second one.
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0]!.targets).toEqual([
                { type: "permanent", id: "ankh" },
            ]);
            resolveTopOfStack(state);
            const p2 = getPlayer(state, "p2")!;
            expect(p2.battlefield.map((c) => c.id)).toEqual(["bears"]);
            // The gated half did not run: the 2/2 is untouched. The field is
            // `damageMarked` (CR 120.3e — damage from a source with neither
            // wither nor infect is MARKED on the creature);
            // `damage` does not exist on `CardInstanceState`, so reading it
            // would make this assertion vacuously green.
            expect(
                p2.battlefield.find((c) => c.id === "bears")?.damageMarked ?? 0
            ).toBe(0);
        });
    });

    it("a KICKED cast asks for both groups, one prompt at a time, each with its OWN requirement", async () => {
        await withTemporaryDefinitionAsync(THUNDER, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
            await announce(harness, { kicker: 1 });
            const first = harness.state().pendingTarget;
            expect(first?.targetType).toEqual(["Artifact", "Enchantment"]);
            // CR 601.2c — the gated group is QUEUED, not merged into the first
            // group's count: its descriptor is its own.
            expect(first?.count).toBe(1);
            expect(first?.remainingRequirements).toEqual([
                { type: "Creature", count: 1, announcedOnlyIfKicked: true },
            ]);

            await pick(harness, "ankh");
            const second = harness.state().pendingTarget;
            // The walk advanced rather than finalizing, and the prompt now
            // states the gated group's requirement.
            expect(second?.targetType).toBe("Creature");
            expect(second?.count).toBe(1);
            expect(second?.selected).toEqual([]);
            expect(second?.remainingRequirements).toBeUndefined();
        });
    });

    it("carries the gated group's own prompt across the wire (ADR 0074)", async () => {
        // SURFACE assertion through the real reducer: a projection that
        // dropped the second group's `targetType` would leave the board
        // highlighting artifacts while the server wanted a creature, with
        // every server test still green.
        await withTemporaryDefinitionAsync(THUNDER, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
            await announce(harness, { kicker: 1 });
            await pick(harness, "ankh");
            const view = projectPublicState(harness.state(), 1, "p1");
            expect(view.pendingTarget?.targetType).toBe("Creature");
            expect(view.pendingTarget?.count).toBe(1);
        });
    });

    it("resolution reads the two picks POSITIONALLY, in declaration order", async () => {
        await withTemporaryDefinitionAsync(THUNDER, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
            await announce(harness, { kicker: 1 });
            await pick(harness, "ankh");
            await pick(harness, "bears");
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            // `{ target: 0 }` is the base group's pick, `{ target: 1 }` the
            // gated group's — the flat concatenation `finalizeTargetSelection`
            // commits (CR 601.2c).
            expect(state.stack[0]!.targets).toEqual([
                { type: "permanent", id: "ankh" },
                { type: "permanent", id: "bears" },
            ]);
            resolveTopOfStack(state);
            // The artifact was destroyed and the 2/2 took the 2 damage, so
            // both are gone (CR 704.5g lethal damage).
            expect(bothBattlefields(state).map((c) => c.id)).toEqual([
                "my-plains",
            ]);
        });
    });
});
