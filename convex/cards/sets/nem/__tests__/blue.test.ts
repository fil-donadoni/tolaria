// NEM — blue card behavior tests (ADR 0043 per-colour split). One describe per
// non-trivial card. Dominate exercises the gainControl Op in a new
// combination (indefinite control change on a spell target) plus the
// X-dependent `mvFilter` target-legality path, so it earns hand-written GRE +
// wire coverage per § Card testing convention.

import { describe, it, expect } from "vitest";
import { accumulatedKnowledge, daze, dominate, parallaxTide } from "..";
import { grizzlyBears, serraAngel } from "../../lea";
import { lightningBolt } from "../../lea/red";
import { ornithopter } from "../../atq/colorless";
import { island } from "../../lea/colorless";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getLegalActions,
    getLegalTargets,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { resolveActivated, resolveTrigger, LEFT } from "./helpers";

// Accumulated Knowledge exercises the `count` construct's NEW dynamic-count
// path (name filter + acrossAllPlayers scope, issue #985), which the canned-
// scenario smoke generator skips-with-reason (an exact-name, all-graveyards
// count isn't faithfully sizable). Per that contract it earns a hand-written
// per-card test tying the shipped definition to the CR 122 / 201.2 outcome.
describe("Accumulated Knowledge ({1}{U}: draw 1 + 1 per copy in all graveyards)", () => {
    const bearLibrary = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `ak-lib-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    const akInGraveyard = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(accumulatedKnowledge.id, {
                id: `ak-gy-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "graveyard",
            })
        );

    it("draws exactly 1 with no copies in any graveyard (CR 121.1)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: bearLibrary("p1", 5) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, accumulatedKnowledge.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(1);
    });

    it("draws 1 + 1 per copy across BOTH graveyards, surviving projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: bearLibrary("p1", 6),
                    graveyard: akInGraveyard("p1", 1),
                }),
                makePlayer("p2", { graveyard: akInGraveyard("p2", 2) }),
            ],
        });
        pushSpell(state, accumulatedKnowledge.id, "p1");
        resolveTopOfStack(state);
        // draw 1 + (1 in p1's + 2 in p2's graveyard) = 4 (CR 122).
        expect(state.players[0].hand.length).toBe(4);
        // Wire format: the drawn hand survives the client projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(4);
    });
});

// Daze — {1}{U} Instant. "Counter target spell unless its controller pays
// {1}." The `mayPay` Op suspends the spell on a Pay/Skip decision — the smoke
// sweep can't scenario-generate the mid-resolution PendingChoice, so it's
// hand-written here for both branches (CR 701.5a / 117.3a).
describe("Daze (counter unless controller pays {1}, CR 701.5a / 117.3a)", () => {
    it("declining the payment counters the target spell", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, daze.id, "p1", [{ type: "spell", id: bolt.id }]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2"); // the TARGET's controller decides
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([bolt.id]);
        // The bolt never resolved — no damage dealt.
        expect(state.players[0].life).toBe(20);
    });

    it("paying {1} lets the spell resolve normally, spending the mana", () => {
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
        });
        const state = makeState({ players: [makePlayer("p1"), p2] });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, daze.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.players[1].manaPool.C).toBe(0);
        // Daze resolved without countering — bolt is still on the stack, now
        // on top; resolving it deals its damage.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeDefined();
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
    });

    it("the countered-and-graveyarded outcome survives the wire-format projection", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, daze.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].graveyard.map((c) => c.id)).toEqual([
            bolt.id,
        ]);
        expect(projected.stack).toHaveLength(0);
    });
});

describe("Dominate ({X}{1}{U}{U}: gain control of target creature with MV <= X)", () => {
    // CR 202.3 — legal targets are creatures whose mana value is X or less.
    it("only creatures with mana value <= X are legal targets", () => {
        const small = makeInstance(grizzlyBears.id, {
            id: "small",
            controllerId: "p2",
            ownerId: "p2",
        }); // MV 2
        const big = makeInstance(serraAngel.id, {
            id: "big",
            controllerId: "p2",
            ownerId: "p2",
        }); // MV 5
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [small, big] }),
            ],
        });
        // X = 3: MV-2 Bears legal, MV-5 Serra Angel not.
        const legal = getLegalTargets(
            state,
            dominate.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1",
            3
        ).map((t) => t.id);
        expect(legal).toContain("small");
        expect(legal).not.toContain("big");

        // X = 5 widens the ceiling: both become legal.
        const legalWide = getLegalTargets(
            state,
            dominate.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1",
            5
        ).map((t) => t.id);
        expect(legalWide).toContain("small");
        expect(legalWide).toContain("big");
    });

    // CR 613.1b — resolving moves control to the caster (layer 2), indefinitely.
    it("moves control of the target creature to the caster, surviving the wire projection", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Before: p2 controls the bear.
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p2");

        const item = pushSpell(state, dominate.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);

        // After: the bear moves to p1's battlefield under p1's control, still
        // owned by p2 (a control change only, CR 613.1b / 108.4).
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(stolen?.controllerId).toBe("p1");
        expect(stolen?.ownerId).toBe("p2");

        // Wire format: the control change survives projection to the client
        // (the projection reads controllerId, not the fat definition).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slim?.controllerId).toBe("p1");
    });

    // CR 107.3 / 202.3 — castability gate for an X-dependent mv ceiling. The
    // `hasEnoughLegalTargets` gate (getLegalActions) used to resolve `mvFilter
    // { max: "X" }` at X = 0 only, so Dominate was offered "cast" solely when a
    // mana-value-0 creature existed — otherwise dead in hand despite a payable,
    // higher X reaching the real targets. Regression: the gate now probes every
    // announceable X (0..maxAffordableX). This is a bug-CLASS fix — any card
    // whose target legality rides an X-parametrized mv bound benefits.
    describe("cast affordance respects raise-X-to-reach targets (bug class)", () => {
        const dom = () =>
            makeInstance(dominate.id, {
                id: "dom",
                controllerId: "p1",
                ownerId: "p1",
            });
        const islands = (n: number) =>
            Array.from({ length: n }, (_, i) =>
                makeInstance(island.id, {
                    id: `land${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        const gate = (
            p1Lands: number,
            p2Board: ReturnType<typeof makeInstance>[]
        ) => {
            const hand = dom();
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [hand],
                        battlefield: islands(p1Lands),
                    }),
                    makePlayer("p2", { battlefield: p2Board }),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                phase: "PRECOMBAT_MAIN",
            });
            return getLegalActions(state, state.players[0], hand);
        };

        it("castable when only an mv>=1 creature exists but X can be raised to reach it", () => {
            const bears = makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p2",
                ownerId: "p2",
            }); // MV 2; 6 lands → X up to 3 reaches it
            expect(gate(6, [bears])).toContain("cast");
        });

        it("castable at X = 0 when an mv<=0 creature (Ornithopter) exists", () => {
            const orn = makeInstance(ornithopter.id, {
                id: "orn",
                controllerId: "p2",
                ownerId: "p2",
            }); // MV 0
            expect(gate(3, [orn])).toContain("cast");
        });

        it("NOT castable when X can't be raised high enough to reach any creature", () => {
            const bears = makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p2",
                ownerId: "p2",
            }); // MV 2; exactly {1}{U}{U} → X = 0, out of reach
            expect(gate(3, [bears])).not.toContain("cast");
        });

        it("NOT castable with no creatures on board", () => {
            expect(gate(6, [])).not.toContain("cast");
        });
    });
});

// Parallax Tide — protocol card (ADR 0028 exile-and-return bundle, resolve()).
// Fading 5 rides the getDefinition seam; the repeatable "remove a fade counter:
// exile target land" activation and the leaves-the-battlefield return both use
// the resolve()-only `exileWithAttachments` / `returnExiledForSource` pair, so
// it earns hand-written GRE + wire coverage per § Card testing convention.
describe("Parallax Tide (Fading 5 + remove-fade-counter: exile target land; return on leave, CR 702.32 / 603.7a)", () => {
    it("enters with five fade counters (Fading 5 seam injection, ADR 0054)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, parallaxTide.id, "p1");
        resolveTopOfStack(state);
        const tide = state.players[0].battlefield.find(
            (c) => c.card.id === parallaxTide.id
        )!;
        expect(tide.counters).toEqual({ fade: 5 });
    });

    it("exiles the target land keyed to itself, then returns it to its owner when it leaves (CR 603.7a)", () => {
        const tide = makeInstance(parallaxTide.id, {
            id: "tide",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 5 },
        });
        const victim = makeInstance(island.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tide] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });

        // Activate: exile the opponent's land (cost payment is exercised by
        // game.ts + the affordability catalogue; resolve just does the exile).
        resolveActivated(state, tide, "parallax-tide-exile", [
            { type: "permanent", id: "victim" },
        ]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        expect(state.players[1].exile.some((c) => c.id === "victim")).toBe(
            true
        );
        // ADR 0028 — the exile is keyed to this enchantment's instance id.
        expect(state.exileHeld?.some((b) => b.sourceId === "tide")).toBe(true);

        // Tide leaves the battlefield → the return trigger fires and each owner
        // gets their exiled card back (CR 603.7a).
        const tideInPlay = state.players[0].battlefield.find(
            (c) => c.id === "tide"
        )!;
        resolveTrigger(state, tideInPlay, "parallax-tide-return", LEFT("tide"));
        expect(state.players[1].exile.some((c) => c.id === "victim")).toBe(
            false
        );
        const returned = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(returned).toBeDefined();
        expect(returned?.ownerId).toBe("p2");
    });

    it("wire format: an exiled land is off every battlefield after projectPublicState", () => {
        const tide = makeInstance(parallaxTide.id, {
            id: "tide",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 5 },
        });
        const victim = makeInstance(island.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tide] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, tide, "parallax-tide-exile", [
            { type: "permanent", id: "victim" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        const stillOnBoard = projected.players
            .flatMap((p) => p.battlefield)
            .some((c) => c.id === "victim");
        expect(stillOnBoard).toBe(false);
    });
});
