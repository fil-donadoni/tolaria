// Splice onto Arcane (CR 702.47, issue #2394).
//
// The mechanic's own permanent test. Everything here drives the REAL commit
// path (`finalizeTargetSelection`, `convex/game.ts`) and the REAL resolution
// (`resolveTopOfStack`) with the two shipped cards — Lava Spike (the Arcane
// spell, `cards/sets/chk/red.ts`) and Through the Breach (the splice source) —
// rather than hand-building a stack item, because the whole claim of the
// implementation is that splice rides the EXISTING additional-cost path: a
// hand-built item would prove the merge and skip the path.
//
// Five CR subrules, each with its own block below:
//   702.47a — reveal as you cast a [quality] spell, pay [cost] additionally
//   702.47b — no card twice; several cards compose; main spell's effects first
//   702.47c — the spell gains the TEXT; the card stays in hand, uncast
//   702.47d — the added text's targets (the one shape that fails closed)
//   702.47e — the splice changes leave with the spell
import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    additionalCostPaymentSnapshot,
    foldKickerCosts,
    resolveKickerPayments,
    totalKickerCount,
} from "../kicker";
import {
    enumerateSpliceOptions,
    spliceAcceptsSpell,
    spliceAugmentedDefinition,
    spliceCardIsSupported,
    spliceCostId,
    spliceMergedEffects,
} from "../splice";
import {
    getPlayer,
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { tryAutoCommitPendingCast } from "../activation";
import { fireDelayedTriggers } from "../phases";
import { compactState, expandState } from "../serialize";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { lavaSpike, throughTheBreach } from "../../cards/sets/chk/red";
import { fork, grizzlyBears } from "../../cards/sets/lea";

const SPIKE = "spike1";
const BREACH = "breach1";
const BREACH_2 = "breach2";
const BEARS = "bears1";
const BEARS_2 = "bears2";

/** The board every block starts from: Lava Spike in hand ready to cast at the
 *  opponent, one or two Through the Breach beside it, a creature for the
 *  spliced text to find, and exactly enough mana in the pool for the printed
 *  `{R}` plus `breaches` × `{2}{R}{R}` (CR 702.47a — the splice cost is paid on
 *  top of the spell's own). */
function board(breaches: number, creatures = 1): GameState {
    const hand = [
        makeInstance(lavaSpike.id, {
            id: SPIKE,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        }),
        ...[BEARS, BEARS_2].slice(0, creatures).map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        ),
        ...[BREACH, BREACH_2].slice(0, breaches).map((id) =>
            makeInstance(throughTheBreach.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        ),
    ];
    return makeState({
        players: [
            makePlayer("p1", {
                hand,
                manaPool: {
                    W: 0,
                    U: 0,
                    B: 0,
                    R: 1 + 2 * breaches,
                    G: 0,
                    C: 2 * breaches,
                },
            }),
            makePlayer("p2"),
        ],
    });
}

/** Cast Lava Spike at p2 through the REAL commit path, revealing each named
 *  hand card to splice (CR 702.47a — the reveal is declared as part of the
 *  announcement, so it arrives on `PendingTarget` exactly as a Kicker's
 *  payment does). */
function castSpikeSplicing(
    state: GameState,
    revealed: string[],
    opts: { expectOnStack?: boolean } = {}
): NonNullable<GameState["stack"][number]> {
    const payments: Record<string, number> = {};
    for (const id of revealed) payments[spliceCostId(id)] = 1;
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: SPIKE,
        targetType: "any",
        count: 1,
        selected: [{ type: "player", id: "p2" }],
        ...(revealed.length > 0 ? { kickerPayments: payments } : {}),
    };
    finalizeTargetSelection(state, pt, "p1");
    const item = state.stack.find((s) => s.id === SPIKE);
    if (opts.expectOnStack === false) {
        return item as NonNullable<GameState["stack"][number]>;
    }
    expect(item, "Lava Spike never reached the stack").toBeDefined();
    return item!;
}

/** Resolve the spell on top of the stack, answering the `choose-hand-card`
 *  choice the spliced text raises with `picks` (an empty array declines — the
 *  Oracle line is "You MAY put a creature card…"). */
function resolveAnswering(state: GameState, picks: string[]): void {
    resolveTopOfStack(state);
    const head = state.pendingChoices?.[0];
    if (!head) return;
    expect(head.kind).toBe("choose-hand-card");
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

describe("splice — the reveal is offered off the SPELL's subtype (CR 702.47a)", () => {
    it("offers every splice-eligible hand card as a cost entry when an Arcane spell is cast", () => {
        const state = board(1);
        const p1 = getPlayer(state, "p1");
        const options = enumerateSpliceOptions(
            p1.hand,
            lavaSpike.subtypes ?? [],
            SPIKE
        );
        expect(options.map((o) => o.handCardInstanceId)).toEqual([BREACH]);
        expect(options[0].entry.id).toBe(spliceCostId(BREACH));
        expect(options[0].entry.mana).toEqual({ X: 2, R: 2 });
        expect(options[0].entry.keyword).toBe("splice");
        // CR 702.47c — the entry names the PRINTED card whose text the spell
        // gains, so the reveal survives the card leaving the hand.
        expect(options[0].entry.splicedCardId).toBe(throughTheBreach.id);
    });

    it("offers nothing when the spell does not have the named subtype", () => {
        const state = board(1);
        const p1 = getPlayer(state, "p1");
        // Grizzly Bears is a Bear, not an Arcane spell.
        expect(
            enumerateSpliceOptions(p1.hand, grizzlyBears.subtypes ?? [], BEARS)
        ).toEqual([]);
    });

    it("never offers the card being cast as a splice onto itself", () => {
        // Through the Breach is itself Arcane, so casting it finds its own
        // splice ability in hand — CR 601.2a has already moved it out of hand.
        const state = board(1);
        const p1 = getPlayer(state, "p1");
        expect(
            enumerateSpliceOptions(
                p1.hand,
                throughTheBreach.subtypes ?? [],
                BREACH
            )
        ).toEqual([]);
    });

    it("augments the cast definition so the whole additional-cost path prices the reveal", () => {
        const state = board(1);
        const p1 = getPlayer(state, "p1");
        const augmented = spliceAugmentedDefinition(lavaSpike, p1, SPIKE);
        const id = spliceCostId(BREACH);
        // The declared entry list is untouched; the synthesized one is appended.
        expect(lavaSpike.kickers).toBeUndefined();
        expect(augmented.kickers?.map((k) => k.id)).toEqual([id]);
        // The validator `announceCast` uses accepts it…
        expect(resolveKickerPayments(augmented, { [id]: 1 })).toEqual({
            [id]: 1,
        });
        // …and rejects it on the PRINTED definition, so a client that names a
        // reveal the board does not offer is refused.
        expect(() => resolveKickerPayments(lavaSpike, { [id]: 1 })).toThrow();
        // CR 702.47a — "you pay [cost] as an additional cost": {R} + {2}{R}{R}.
        const cost = { R: 1 };
        foldKickerCosts(cost, augmented, { [id]: 1 }, undefined);
        expect(cost).toEqual({ R: 3, X: 2 });
    });

    it("leaves a cast with no splice option identity-stable", () => {
        const state = board(0);
        const p1 = getPlayer(state, "p1");
        expect(spliceAugmentedDefinition(lavaSpike, p1, SPIKE)).toBe(lavaSpike);
    });
});

describe("splice — a spliced spell is not KICKED, and the reveal is recorded (CR 702.33d / 702.47c)", () => {
    it("routes the payment to the unkicked record and snapshots the printed card id", () => {
        const state = board(1);
        const p1 = getPlayer(state, "p1");
        const augmented = spliceAugmentedDefinition(lavaSpike, p1, SPIKE);
        const id = spliceCostId(BREACH);
        const snapshot = additionalCostPaymentSnapshot(augmented, { [id]: 1 });
        // CR 702.33d defines "kicked" over KICKER costs alone.
        expect(snapshot.kickerPayments).toBeUndefined();
        expect(totalKickerCount(snapshot.kickerPayments)).toBe(0);
        expect(snapshot.unkickedCostPayments).toEqual({ [id]: 1 });
        expect(snapshot.splicedCardIds).toEqual([throughTheBreach.id]);
    });

    it("stamps the record onto the stack item through the real commit path", () => {
        const state = board(1);
        const item = castSpikeSplicing(state, [BREACH]);
        expect(item.splicedCardIds).toEqual([throughTheBreach.id]);
        expect(item.kickerPayments).toBeUndefined();
        // CR 702.47a — the printed {R} and the splice {2}{R}{R} both came out
        // of the pool the board was given exactly enough of.
        const p1 = getPlayer(state, "p1");
        expect(p1.manaPool).toEqual({
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 0,
        });
    });

    it("CR 702.47b — one card can never be revealed twice onto the same spell", () => {
        const state = board(1);
        const p1 = getPlayer(state, "p1");
        const augmented = spliceAugmentedDefinition(lavaSpike, p1, SPIKE);
        expect(() =>
            resolveKickerPayments(augmented, { [spliceCostId(BREACH)]: 2 })
        ).toThrow();
    });
});

describe("splice — the spell gains the TEXT and the card stays in hand (CR 702.47b/c)", () => {
    it("resolves the main spell's effects FIRST, then the spliced card's", () => {
        const state = board(1);
        castSpikeSplicing(state, [BREACH]);
        resolveAnswering(state, [BEARS]);
        const p1 = getPlayer(state, "p1");
        const p2 = getPlayer(state, "p2");
        // Lava Spike's own effect — the main spell's, which CR 702.47b puts
        // first.
        expect(p2.life).toBe(20 - 3);
        // Through the Breach's text, run as part of THIS spell.
        const bears = p1.battlefield.find((c) => c.id === BEARS);
        expect(
            bears,
            "the spliced text never put the creature in play"
        ).toBeDefined();
        expect(bears!.staticAbilities).toContain("haste");
        expect(state.delayedTriggers).toHaveLength(1);
        // CR 702.47c — the revealed card was never cast: still in hand, no
        // second stack object, nothing in the graveyard.
        expect(p1.hand.map((c) => c.id)).toContain(BREACH);
        expect(p1.graveyard.map((c) => c.id)).not.toContain(BREACH);
        expect(state.stack).toHaveLength(0);
        // The delayed sacrifice captured the creature the spliced text put in
        // play, not a fresh choice at fire time (CR 603.7).
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === BEARS)
        ).toBe(false);
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toContain(
            BEARS
        );
    });

    it("leaves the spell untouched when the caster declines every reveal", () => {
        const state = board(1);
        const item = castSpikeSplicing(state, []);
        expect(item.splicedCardIds).toBeUndefined();
        resolveAnswering(state, []);
        const p1 = getPlayer(state, "p1");
        expect(getPlayer(state, "p2").life).toBe(20 - 3);
        // No choice was ever raised: the spell ran its printed text alone.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(p1.battlefield.some((c) => c.id === BEARS)).toBe(false);
        expect(p1.hand.map((c) => c.id)).toContain(BEARS);
    });

    it("CR 702.47b — several revealed cards COMPOSE, each paid separately, and each copy's text gets its OWN bindings", () => {
        const state = board(2, 2);
        const item = castSpikeSplicing(state, [BREACH, BREACH_2]);
        // Two separate payments, two copies of the text.
        expect(item.unkickedCostPayments).toEqual({
            [spliceCostId(BREACH)]: 1,
            [spliceCostId(BREACH_2)]: 1,
        });
        expect(item.splicedCardIds).toEqual([
            throughTheBreach.id,
            throughTheBreach.id,
        ]);
        const merged = spliceMergedEffects(lavaSpike, item.splicedCardIds)!;
        expect(merged).toHaveLength(
            (lavaSpike.effects?.length ?? 0) +
                2 * (throughTheBreach.effects?.length ?? 0)
        );
        // The main spell's op is still first (CR 702.47b).
        expect(merged[0]).toEqual(lavaSpike.effects![0]);
        // THE REGRESSION. A binding is not an in-memory variable: `recallChoice`
        // scans the persisted `collectedChoices` keys and returns the FIRST
        // whose name matches, so two copies of one splice card sharing `$picked`
        // would have copy 2 read copy 1's snapshot — the caster answers the
        // second prompt and nothing happens. `spliceMergedEffects` renames each
        // segment's own bindings, so the second answer is the second creature.
        resolveAnswering(state, [BEARS]);
        const second = state.pendingChoices?.[0];
        expect(
            second,
            "the second spliced copy never asked its own question"
        ).toBeDefined();
        applyPendingChoiceSubmit(state, {
            playerId: second!.playerId,
            stackItemId: second!.stackItemId,
            step: second!.step,
            choiceId: second!.choiceId,
            cardInstanceIds: [BEARS_2],
        });
        const p1 = getPlayer(state, "p1");
        expect(state.stack).toHaveLength(0);
        // BOTH creatures entered, each with haste, each with its OWN delayed
        // sacrifice capturing itself (CR 603.7) — not one creature granted
        // haste twice and captured twice.
        expect(p1.battlefield.map((c) => c.id).sort()).toEqual([
            BEARS,
            BEARS_2,
        ]);
        for (const id of [BEARS, BEARS_2]) {
            const entered = p1.battlefield.find((c) => c.id === id)!;
            expect(
                entered.staticAbilities.filter((a) => a === "haste")
            ).toEqual(["haste"]);
        }
        expect((state.delayedTriggers ?? []).map((t) => t.payload)).toEqual([
            { captured: BEARS },
            { captured: BEARS_2 },
        ]);
        // Both revealed cards are still in hand (CR 702.47c).
        expect(p1.hand.map((c) => c.id).sort()).toEqual([BREACH, BREACH_2]);
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);
        const after = getPlayer(state, "p1");
        expect(after.battlefield).toEqual([]);
        expect(after.graveyard.map((c) => c.id).sort()).toEqual([
            BEARS,
            BEARS_2,
            SPIKE,
        ]);
    });
});

describe("splice — the added text's targets are the one shape that fails CLOSED (CR 702.47d)", () => {
    it("accepts only a script-bodied spell and an untargeted, script-bodied splice card", () => {
        expect(spliceAcceptsSpell(lavaSpike)).toBe(true);
        expect(spliceCardIsSupported(throughTheBreach)).toBe(true);
        // CR 702.47d puts the added text's targets in the main spell's own
        // CR 601.2c announcement, which carries ONE requirement — so a
        // targeting splice card is not offered rather than offered untargeted.
        expect(
            spliceCardIsSupported({
                ...throughTheBreach,
                targetRequirement: { type: ["Creature"], count: 1 },
            })
        ).toBe(false);
        // CR 702.47c gives the spell "the rules text of EACH of the spliced
        // cards" — all of it. `spliceMergedEffects` contributes `effects` and
        // nothing else, so a splice card that also prints a triggered, static
        // or activated ability would be paid for and deliver half its text.
        expect(
            spliceCardIsSupported({
                ...throughTheBreach,
                triggeredAbilities: [
                    {
                        id: "probe",
                        oracleText: "When this happens, nothing does.",
                        event: "SPELL_CAST",
                        effects: [],
                    },
                ],
            } as unknown as typeof throughTheBreach)
        ).toBe(false);
        expect(
            spliceCardIsSupported({
                ...throughTheBreach,
                staticAbilities: ["flying"],
            })
        ).toBe(false);
        expect(
            spliceCardIsSupported({
                ...throughTheBreach,
                activatedAbilities: [
                    {
                        id: "probe",
                        oracleText: "{T}: Nothing.",
                        cost: {},
                        effects: [],
                    },
                ],
            } as unknown as typeof throughTheBreach)
        ).toBe(false);
        // An imperative body has no interpreter resume cursor for the merge to
        // extend, so it is not a splice target either.
        expect(
            spliceAcceptsSpell({
                ...lavaSpike,
                effects: undefined,
                resolve: () => {},
            })
        ).toBe(false);
    });

    it("offers no reveal for a splice card the merge cannot honour", () => {
        const state = board(1);
        const p1 = getPlayer(state, "p1");
        // The same board, asked about a spell whose body is imperative.
        const imperative = {
            ...lavaSpike,
            effects: undefined,
            resolve: () => {},
        };
        expect(
            spliceAugmentedDefinition(imperative, p1, SPIKE).kickers
        ).toBeUndefined();
    });
});

describe("splice — the reveal survives the PARKED cast commit (CR 601.2h)", () => {
    it("stamps the text when the caster taps for the cost after announcing", () => {
        // The commit path a HUMAN takes. `announceCast` /
        // `finalizeTargetSelection` commit inline only when the pool already
        // covers the folded cost; otherwise they PARK and
        // `tryAutoCommitPendingCast` commits once the caster has paid. Tapping
        // lands for {R} + {2}{R}{R} is therefore the ordinary route, and it
        // reads the cast definition through a THIRD lookup of its own.
        const state = board(1);
        getPlayer(state, "p1").manaPool = {
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 0,
        };
        castSpikeSplicing(state, [BREACH], { expectOnStack: false });
        expect(
            state.pendingCast,
            "an unaffordable spliced cast did not park"
        ).toBeDefined();
        // CR 702.47a — the parked cost is the printed {R} PLUS the splice cost.
        expect(state.pendingCast!.manaCost).toEqual({ R: 3, X: 2 });
        getPlayer(state, "p1").manaPool = {
            W: 0,
            U: 0,
            B: 0,
            R: 3,
            G: 0,
            C: 2,
        };
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        const item = state.stack.find((si) => si.id === SPIKE)!;
        expect(
            item.splicedCardIds,
            "the splice cost was charged and the text was not gained"
        ).toEqual([throughTheBreach.id]);
        resolveAnswering(state, [BEARS]);
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === BEARS)
        ).toBe(true);
    });
});

describe("splice — the gained text is not copied and does not outlive the stack (CR 702.47e / 707.2)", () => {
    it("CR 702.47e — a resolved spell's card carries no splice back, so a recast is unspliced", () => {
        const state = board(1);
        castSpikeSplicing(state, [BREACH]);
        resolveAnswering(state, [BEARS]);
        const p1 = getPlayer(state, "p1");
        const spent = p1.graveyard.find((c) => c.id === SPIKE)!;
        expect(
            (spent as { splicedCardIds?: string[] }).splicedCardIds,
            "the spell kept its splice changes after leaving the stack"
        ).toBeUndefined();
        // And the card recast from that graveyard copy gains nothing: the
        // second creature stays in hand, because nothing was revealed.
        p1.graveyard = p1.graveyard.filter((c) => c.id !== SPIKE);
        p1.hand.push({ ...spent, zone: "hand" });
        p1.manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
        const before = p1.battlefield.length;
        castSpikeSplicing(state, []);
        resolveAnswering(state, []);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(getPlayer(state, "p1").battlefield).toHaveLength(before);
    });

    it("CR 707.2 — a COPY of a spliced spell is a copy of the main spell alone", () => {
        // CR 707.2: "Other effects (including … text-changing effects) … are
        // not copied", and CR 702.47c makes the reveal a text-changing effect —
        // unlike `kickerPayments`, which a copy does inherit.
        const state = board(1);
        const spliced = castSpikeSplicing(state, [BREACH]);
        expect(spliced.splicedCardIds).toEqual([throughTheBreach.id]);
        // The real copy path: Fork, resolving on top of the spliced spell.
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: SPIKE }]);
        resolveTopOfStack(state);
        // CR 707.10 — Fork offers the copy new targets; keep the originals.
        delete state.pendingTarget;
        const copy = state.stack.find((si) => si.isCopy)!;
        expect(copy, "Fork made no copy").toBeDefined();
        expect(
            copy.splicedCardIds,
            "the copy inherited the spliced text"
        ).toBeUndefined();
        // Resolving the copy deals the damage and does nothing else.
        resolveAnswering(state, []);
        expect(getPlayer(state, "p2").life).toBe(20 - 3);
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === BEARS)
        ).toBe(false);
    });
});

describe("splice — the changes ride the stack item and leave with it (CR 702.47e)", () => {
    it("survives a save/load while the spell sits on the stack", () => {
        const state = board(1);
        castSpikeSplicing(state, [BREACH]);
        const reloaded = expandState(compactState(state));
        const item = reloaded.stack.find((s) => s.id === SPIKE)!;
        expect(item.splicedCardIds).toEqual([throughTheBreach.id]);
        // …and the reloaded spell still resolves its gained text.
        resolveAnswering(reloaded, [BEARS]);
        expect(
            getPlayer(reloaded, "p1").battlefield.some((c) => c.id === BEARS)
        ).toBe(true);
    });

    it("SURFACE — the revealed card projects as still in the caster's hand", () => {
        const state = board(1);
        castSpikeSplicing(state, [BREACH]);
        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        // CR 702.47c — the client sees the reveal as a card that never moved.
        expect(
            (me.hand as { id: string }[]).map((c) => c.id),
            "the revealed card left the caster's hand on the wire"
        ).toContain(BREACH);
        const slimItem = projected.stack.find((s) => s.id === SPIKE)!;
        expect(slimItem.splicedCardIds).toEqual([throughTheBreach.id]);
        // The projection must not fabricate a kick out of a splice payment.
        expect(slimItem.kickerPayments).toBeUndefined();
    });
});
