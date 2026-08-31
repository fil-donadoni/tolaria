// Activation-timing discipline for the bot (issue #1890).
//
// The engine already knew that a holdable INSTANT in hand carries option value
// (ADR 0021); every seam that expressed it read `types.includes("Instant")`, so
// the mirror case — a battlefield permanent whose ACTIVATED ability can be used
// at instant speed — was invisible. The bot therefore spent Mother of Runes'
// protection at sorcery speed with nothing to protect against, and animated
// Mishra's Factory after its own combat.
//
// Five sections below:
//   1. `isDeferrableStackAbility` — the per-card-agnostic timing predicate.
//   2. `isDiscouragedRolloutMove` — the rollout default-policy guardrail.
//   3. `selectRootMove` — the hold-the-option tie-break, outcome-equality only.
//   4. `isTransientOnlyAbility` — the narrowing that keeps section 3 honest.
//   5. The NEGATIVE CONTROL, at the level it can actually fail: the bot's
//      CHOICE in a reactive window.
//
// NOT here, and deliberately: issue #1890 item 3, a board-side `evaluate`
// flexibility term for a permanent offering a live instant-speed option. It is
// blocked on issue #1920 (`applyMoveInSearch` applies an activation's costs and
// never its effect, so spending an option shows no payoff at any depth) — a
// symmetric credit for holding one converts the pre-existing exact tie in the
// REACTIVE window into a deterministic decline, which section 5 is the pin
// against.
//
// The cards are used as FIXTURES, never as special cases: nothing under test
// reads a card name. Mother of Runes supplies a `{T}` instant-speed ability whose
// effect expires this turn, Prodigal Sorcerer a `{T}` one that BUILDS permanent
// material, and Mishra's Factory an `animatesSelf` one; any card with the same
// shape behaves identically.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    isDiscouragedRolloutMove,
    selectRolloutMove,
    selectRootMove,
    type Edge,
    type Node,
} from "../search";
import {
    effectiveAbilityOf,
    isDeferrableStackAbility,
    isTransientOnlyAbility,
    spendsStandingPermanent,
} from "../ai/abilityTiming";
import type { Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";

const MOTHER = getCardByName("Mother of Runes").id;
const FACTORY = getCardByName("Mishra's Factory").id;
const SORCERER = getCardByName("Prodigal Sorcerer").id;
const ORB = getCardByName("Zuran Orb").id;
const TITANIA = getCardByName("Titania, Protector of Argoth").id;
const FOREST = getCardByName("Forest").id;
const BOLT = getCardByName("Lightning Bolt").id;
const GIANT = getCardByName("Hill Giant").id;

const MOTHER_ABILITY = "mother-of-runes-protect";
const SORCERER_ZAP = "prodigal-sorcerer-zap";
const FACTORY_ANIMATE = "mishras-factory-animate";
const FACTORY_MANA = "mishras-factory-mana";
const ORB_GAIN = "zuran-orb-gain-life";

function perm(cardId: string, id: string, extra = {}): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        isSummoningSick: false,
        ...extra,
    });
}

function activation(cardInstanceId: string, abilityId: string): Move {
    return {
        kind: "activate-ability",
        cardInstanceId,
        abilityId,
        targets: [],
        confirmTargets: false,
        tapPlan: [],
    };
}

/** p1 is the active player with priority, at `phase`, with `battlefield`. */
function botAt(
    phase: GameState["phase"],
    battlefield: CardInstanceState[],
    extra: Partial<GameState> = {}
): GameState {
    return makeState({
        phase,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
        ...extra,
    });
}

// ---------------------------------------------------------------------------
// 1. The timing predicate (CR 117.1b / 602.5d)
// ---------------------------------------------------------------------------
describe("isDeferrableStackAbility — instant-speed activation (CR 117.1b)", () => {
    it("accepts a plain {T} stack ability (Mother of Runes)", () => {
        const mother = perm(MOTHER, "mom");
        const ability = effectiveAbilityOf(mother, MOTHER_ABILITY);
        expect(ability).toBeDefined();
        expect(isDeferrableStackAbility(ability!)).toBe(true);
    });

    it("accepts a manland's animate ability (Mishra's Factory)", () => {
        const factory = perm(FACTORY, "fac");
        const ability = effectiveAbilityOf(factory, FACTORY_ANIMATE);
        expect(isDeferrableStackAbility(ability!)).toBe(true);
    });

    it("rejects a MANA ability — payment plumbing, never on the stack (CR 605.3a)", () => {
        const factory = perm(FACTORY, "fac");
        const mana = effectiveAbilityOf(factory, FACTORY_MANA);
        expect(mana?.useStack).toBe(false);
        expect(isDeferrableStackAbility(mana!)).toBe(false);
    });

    it("rejects an 'activate only as a sorcery' ability (CR 602.5d)", () => {
        const ability = effectiveAbilityOf(perm(MOTHER, "mom"), MOTHER_ABILITY);
        expect(
            isDeferrableStackAbility({ ...ability!, sorcerySpeedOnly: true })
        ).toBe(false);
    });

    it("rejects a loyalty ability (CR 606.3) and a phase-restricted one (CR 602.5)", () => {
        const ability = effectiveAbilityOf(
            perm(MOTHER, "mom"),
            MOTHER_ABILITY
        )!;
        expect(
            isDeferrableStackAbility({
                ...ability,
                cost: { ...ability.cost, loyalty: -2 },
            })
        ).toBe(false);
        expect(
            isDeferrableStackAbility({
                ...ability,
                activationPhaseRestriction: ["DECLARE_BLOCKERS"],
            })
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 2. Rollout default-policy guardrail (issue #1890 item 1)
// ---------------------------------------------------------------------------
describe("isDiscouragedRolloutMove — activated abilities (issue #1890)", () => {
    it("flags a {T} instant-speed activation at sorcery speed (own main phase)", () => {
        const state = botAt("PRECOMBAT_MAIN", [perm(MOTHER, "mom")]);
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("mom", MOTHER_ABILITY)
            )
        ).toBe(true);
    });

    it("does NOT flag the same activation in a reactive window (declare blockers)", () => {
        const state = botAt("DECLARE_BLOCKERS", [perm(MOTHER, "mom")]);
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("mom", MOTHER_ABILITY)
            )
        ).toBe(false);
    });

    it("does NOT flag the activation in the mover's own main phase with a NON-EMPTY stack", () => {
        // The fetchland-charter shape, and the reason the sorcery window is
        // asked of `isSorceryTimingFor` rather than the phase alone: a main
        // phase with something ON the stack is already a RESPONSE window, which
        // is exactly where an activation belongs. Without the empty-stack clause
        // this branch fired here too and turned the answer into a `pass`.
        const state = botAt("PRECOMBAT_MAIN", [perm(MOTHER, "mom")]);
        pushSpell(state, BOLT, "p2", [{ type: "permanent", id: "mom" }]);
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("mom", MOTHER_ABILITY)
            )
        ).toBe(false);
    });

    it("does NOT flag the same activation on the OPPONENT'S turn", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [perm(MOTHER, "mom")] }),
                makePlayer("p2"),
            ],
        });
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("mom", MOTHER_ABILITY)
            )
        ).toBe(false);
    });

    it("flags an activation cast BEFORE blocks by the attacking player (ADR 0021 §3)", () => {
        const state = botAt(
            "DECLARE_ATTACKERS",
            [perm(MOTHER, "mom"), perm(GIANT, "g")],
            {
                combat: {
                    attackerIds: ["g"],
                    confirmed: true,
                    blockersConfirmed: false,
                    blockerAssignments: {},
                },
            }
        );
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("mom", MOTHER_ABILITY)
            )
        ).toBe(true);
    });

    it("never flags a MANA ability — out of scope by construction (CR 605.3a)", () => {
        const state = botAt("PRECOMBAT_MAIN", [perm(FACTORY, "fac")]);
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("fac", FACTORY_MANA)
            )
        ).toBe(false);
    });

    // --- item 4: the pointless manland animation ---------------------------
    it("flags a self-animation after the mover's own combat (END_OF_COMBAT)", () => {
        const state = botAt("END_OF_COMBAT", [perm(FACTORY, "fac")]);
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("fac", FACTORY_ANIMATE)
            )
        ).toBe(true);
    });

    it("flags a self-animation in the mover's END STEP", () => {
        const state = botAt("END_STEP", [perm(FACTORY, "fac")]);
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("fac", FACTORY_ANIMATE)
            )
        ).toBe(true);
    });

    it("does NOT flag the animation BEFORE combat, where the body can still attack", () => {
        const state = botAt("BEGINNING_OF_COMBAT", [perm(FACTORY, "fac")]);
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("fac", FACTORY_ANIMATE)
            )
        ).toBe(false);
    });

    it("does NOT flag the animation on the OPPONENT'S turn, where the body can block", () => {
        const state = makeState({
            phase: "END_OF_COMBAT",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [perm(FACTORY, "fac")] }),
                makePlayer("p2"),
            ],
        });
        expect(
            isDiscouragedRolloutMove(
                state,
                "p1",
                activation("fac", FACTORY_ANIMATE)
            )
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 3. Root hold-the-option tie-break (issue #1890 item 2)
// ---------------------------------------------------------------------------
describe("selectRootMove — hold an instant-speed activation (issue #1890)", () => {
    const PASS: Move = { kind: "pass" };
    const ACTIVATE = activation("mom", MOTHER_ABILITY);
    const ANIMATE = activation("fac", FACTORY_ANIMATE);

    function rootOf(
        edges: {
            move: Move;
            meanReward: number;
            meanMargin: number;
            visits?: number;
        }[]
    ): Node {
        const children = new Map<string, Edge>();
        edges.forEach((e, i) => {
            const visits = e.visits ?? 100;
            children.set(`${e.move.kind}:${i}`, {
                move: e.move,
                key: `${e.move.kind}:${i}`,
                mover: "p1",
                node: { children: new Map() },
                visits,
                totalReward: e.meanReward * visits,
                totalMargin: e.meanMargin * visits,
                avail: visits,
            });
        });
        return { children };
    }

    it("FIRE: holds the ability when activating and passing are outcome-equal", () => {
        // The activation wins the raw material tie-break on noise; holding the
        // option is never worse when the two are outcome-equal.
        const state = botAt("PRECOMBAT_MAIN", [perm(MOTHER, "mom")]);
        const root = rootOf([
            { move: ACTIVATE, meanReward: 0.6635, meanMargin: 330 },
            { move: PASS, meanReward: 0.6631, meanMargin: 327 },
        ]);
        expect(selectRootMove(root, [ACTIVATE, PASS], state, "p1").kind).toBe(
            "pass"
        );
    });

    it("NO-FIRE: an activation with REAL value still wins on mean reward", () => {
        const state = botAt("PRECOMBAT_MAIN", [perm(MOTHER, "mom")]);
        const root = rootOf([
            { move: ACTIVATE, meanReward: 0.92, meanMargin: 330 },
            { move: PASS, meanReward: 0.6, meanMargin: 400 },
        ]);
        expect(selectRootMove(root, [ACTIVATE, PASS], state, "p1").kind).toBe(
            "activate-ability"
        );
    });

    it("NO-FIRE: a value-building activation at sorcery speed is left alone", () => {
        // The Sandstorm Salvager shape, and the reason `isTransientOnlyAbility`
        // exists: Prodigal Sorcerer's ping moves PERMANENT material (damage
        // marked on a creature / a player's life), banked the moment it
        // resolves, whenever that is. Without the transience clause this rule
        // swallowed the whole build-a-board class along with the tricks.
        const ZAP = activation("tim", SORCERER_ZAP);
        const state = botAt("PRECOMBAT_MAIN", [perm(SORCERER, "tim")]);
        const root = rootOf([
            { move: ZAP, meanReward: 0.6635, meanMargin: 330 },
            { move: PASS, meanReward: 0.6631, meanMargin: 327 },
        ]);
        expect(selectRootMove(root, [ZAP, PASS], state, "p1").kind).toBe(
            "activate-ability"
        );
    });

    it("NO-FIRE: outside the mover's main phase the tie-break is silent", () => {
        // A reactive window is exactly where an activation belongs; the material
        // tie-break decides it, not the hold rule.
        const state = botAt("DECLARE_BLOCKERS", [perm(MOTHER, "mom")]);
        const root = rootOf([
            { move: ACTIVATE, meanReward: 0.6635, meanMargin: 330 },
            { move: PASS, meanReward: 0.6631, meanMargin: 327 },
        ]);
        expect(selectRootMove(root, [ACTIVATE, PASS], state, "p1").kind).toBe(
            "activate-ability"
        );
    });

    it("FIRE: holds a pointless self-animation at END_OF_COMBAT (item 4)", () => {
        // Not a main phase, so the sorcery-speed half is silent — this is the
        // manland-shaped branch, and it is a policy judgement rather than a
        // `dominance.ts` exact-equality proof precisely because the animation
        // DOES change the board.
        const state = botAt("END_OF_COMBAT", [perm(FACTORY, "fac")]);
        const root = rootOf([
            { move: ANIMATE, meanReward: 0.6635, meanMargin: 330 },
            { move: PASS, meanReward: 0.6631, meanMargin: 327 },
        ]);
        expect(selectRootMove(root, [ANIMATE, PASS], state, "p1").kind).toBe(
            "pass"
        );
    });
});

// ---------------------------------------------------------------------------
// 4. The transience narrowing (issue #1890 item 2)
// ---------------------------------------------------------------------------
describe("isTransientOnlyAbility — Op-derived, fail-closed (issue #1890)", () => {
    const mother = effectiveAbilityOf(perm(MOTHER, "mom"), MOTHER_ABILITY)!;
    const zap = effectiveAbilityOf(perm(SORCERER, "tim"), SORCERER_ZAP)!;

    it("TRUE for an until-end-of-turn effect, through a structural construct", () => {
        // Mother's script is an `optionChoice` whose every mode grants
        // protection with `duration: { phase: "end-of-turn" }` — so this also
        // exercises the recursion into a construct's branches.
        expect(isTransientOnlyAbility(mother)).toBe(true);
    });

    it("FALSE for an ability that BUILDS permanent material", () => {
        // `dealDamage` carries no `duration` at all: it is banked on resolution.
        expect(isTransientOnlyAbility(zap)).toBe(false);
    });

    it("FALSE with no Effect Script to read — fail closed", () => {
        expect(isTransientOnlyAbility({ ...mother, effects: undefined })).toBe(
            false
        );
        expect(isTransientOnlyAbility({ ...mother, effects: [] })).toBe(false);
    });

    it("FALSE when ONE Op of the script is lasting", () => {
        expect(
            isTransientOnlyAbility({
                ...mother,
                effects: [...mother.effects!, ...zap.effects!],
            })
        ).toBe(false);
    });

    it("FALSE when ONE BRANCH of a construct is lasting", () => {
        const script = mother.effects![0];
        if (script.op !== "optionChoice") throw new Error("fixture changed");
        expect(
            isTransientOnlyAbility({
                ...mother,
                effects: [
                    {
                        ...script,
                        modes: [
                            ...script.modes,
                            { ...script.modes[0], effects: zap.effects! },
                        ],
                    },
                ],
            })
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 5. NEGATIVE CONTROL, at the level where it can actually fail: the bot's
//    CHOICE in the reactive window (issue #1890, gap tracked by #1920)
// ---------------------------------------------------------------------------
describe("selectRolloutMove — the reactive window is never muted (issue #1890)", () => {
    const ACTIVATE = activation("mom", MOTHER_ABILITY);
    const PASS: Move = { kind: "pass" };

    /** The opponent's turn, their removal on the stack aimed at the bot's Mother
     *  of Runes, the bot holding priority: the window the ability EXISTS for. */
    function underRemoval(): GameState {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [perm(MOTHER, "mom")] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, BOLT, "p2", [{ type: "permanent", id: "mom" }]);
        return state;
    }

    it("carries no rollout-policy penalty in the response window", () => {
        expect(isDiscouragedRolloutMove(underRemoval(), "p1", ACTIVATE)).toBe(
            false
        );
    });

    it("the default policy does not DECLINE the activation", () => {
        // The pin the blade entries structurally cannot provide: both of them
        // assert ENUMERATION (the move is still offered, unpenalised), and the
        // failure mode this guards is a CHOICE — the policy ranking `pass`
        // strictly above an activation it is supposed to be neutral on.
        //
        // `selectRolloutMove` takes an EXACT-EQUALITY argmax: ties share the
        // `rng`-picked bucket, so `() => 0` returns the first tied candidate.
        // Any evaluator term that makes spending a board option cost something
        // the search cannot repay — issue #1890 item 3 on top of the #1920
        // payoff gap — drops the activation out of the bucket entirely, and
        // then NO `rng` value can return it. Deliberately asserted as "not
        // ranked below `pass`", not as an exact tie, so a future fix that makes
        // the activation genuinely WIN here strengthens the test instead of
        // breaking it.
        expect(
            selectRolloutMove(
                underRemoval(),
                "p1",
                "p1",
                [ACTIVATE, PASS],
                () => 0
            )
        ).toEqual(ACTIVATE);
    });
});

// ---------------------------------------------------------------------------
// 6. The SECOND justification: a cost that gives up a standing permanent
//    (issue #2939)
// ---------------------------------------------------------------------------
//
// Zuran Orb is the fixture, and — like every other card in this file — only as
// a SHAPE: a `useStack: true` ability with a sacrifice cost whose payoff (life)
// outlives the turn. Nothing under test reads its name.
describe("spendsStandingPermanent — cost-side domination (issue #2939)", () => {
    const orb = perm(ORB, "orb");
    const orbAbility = effectiveAbilityOf(orb, ORB_GAIN)!;

    it("accepts a `sacrificeFilter` cost (CR 701.21a, paid per CR 602.1)", () => {
        expect(orbAbility.cost.sacrificeFilter).toBeDefined();
        expect(spendsStandingPermanent(orbAbility)).toBe(true);
    });

    it("accepts a cost that sacrifices the SOURCE itself", () => {
        expect(
            spendsStandingPermanent({
                ...orbAbility,
                cost: { sacrifice: true },
            })
        ).toBe(true);
    });

    it("rejects a `{T}` cost — the untap step gives it back (CR 502.1)", () => {
        const zap = effectiveAbilityOf(perm(SORCERER, "tim"), SORCERER_ZAP)!;
        expect(zap.cost.tap).toBe(true);
        expect(spendsStandingPermanent(zap)).toBe(false);
    });

    it("rejects the other irreversible costs — deliberate, fail-closed exclusions", () => {
        for (const cost of [
            { life: 2 },
            { removeCounter: { type: "corpse", count: 1 } },
            { discardThis: true },
        ]) {
            expect(spendsStandingPermanent({ ...orbAbility, cost })).toBe(
                false
            );
        }
    });

    it("is INDEPENDENT of the payoff clause — the Orb is not transient", () => {
        // The whole reason the cost clause has to exist: `isTransientOnlyAbility`
        // is silent here (gained life never expires), so before #2939 nothing
        // deferred this activation at all.
        expect(isTransientOnlyAbility(orbAbility)).toBe(false);
        expect(isDeferrableStackAbility(orbAbility)).toBe(true);
    });
});

describe("selectRootMove — a sacrifice engine is held, then converted (issue #2939)", () => {
    // The cost pick is part of the Move the search enumerates; the conversion
    // rule REPLAYS the move to score the immediate position, so a move with no
    // pick would apply as a no-op and prove nothing.
    const ACTIVATE: Move = {
        ...activation("orb", ORB_GAIN),
        costPicks: { sacrificeIds: ["f1"] },
    };
    const PASS: Move = { kind: "pass" };

    function rootOf(
        edges: { move: Move; meanReward: number; meanMargin: number }[],
        mover: string
    ): Node {
        const children = new Map<string, Edge>();
        edges.forEach((e, i) => {
            const visits = 100;
            children.set(`${e.move.kind}:${i}`, {
                move: e.move,
                key: `${e.move.kind}:${i}`,
                mover,
                node: { children: new Map() },
                visits,
                totalReward: e.meanReward * visits,
                totalMargin: e.meanMargin * visits,
                avail: visits,
            });
        });
        return { children };
    }

    /** The engine plus enough lands for the sacrifice cost to be payable.
     *  Titania is here for the same reason the issue's position has her: she
     *  is what makes converting a land a material GAIN, and the conversion rule
     *  fires only while it is one. */
    const engineBoard = () => [
        perm(ORB, "orb"),
        perm(TITANIA, "tit"),
        perm(FOREST, "f1"),
        perm(FOREST, "f2"),
        perm(FOREST, "f3"),
    ];

    it("FIRE (hold): the bot's own main phase, outcome-equal — keeps the land", () => {
        const state = botAt("PRECOMBAT_MAIN", engineBoard());
        const root = rootOf(
            [
                { move: ACTIVATE, meanReward: 0.6635, meanMargin: 330 },
                { move: PASS, meanReward: 0.6631, meanMargin: 327 },
            ],
            "p1"
        );
        expect(selectRootMove(root, [ACTIVATE, PASS], state, "p1").kind).toBe(
            "pass"
        );
    });

    it("NO-FIRE (hold): an activation with REAL value still wins on mean reward", () => {
        // The gate that keeps the rule from ever costing the bot a real play:
        // it fires only inside `OUTCOME_EPS`, so the sacrifice that is actually
        // decisive this turn is untouched.
        const state = botAt("PRECOMBAT_MAIN", engineBoard());
        const root = rootOf(
            [
                { move: ACTIVATE, meanReward: 0.92, meanMargin: 330 },
                { move: PASS, meanReward: 0.6, meanMargin: 400 },
            ],
            "p1"
        );
        expect(selectRootMove(root, [ACTIVATE, PASS], state, "p1").kind).toBe(
            "activate-ability"
        );
    });

    it("FIRE (convert): the OPPONENT's end step, outcome-equal — takes the option", () => {
        // The mirror. `pass` is the incumbent pick AND carries the better
        // subtree margin (the shape measured on the issue's position: both
        // subtrees hold the same future activation, so the accumulation cannot
        // discriminate); the immediate position decides instead.
        const state = makeState({
            phase: "END_STEP",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: engineBoard() }),
                makePlayer("p2"),
            ],
        });
        const root = rootOf(
            [
                { move: PASS, meanReward: 0.6635, meanMargin: 1781 },
                { move: ACTIVATE, meanReward: 0.6631, meanMargin: 1552 },
            ],
            "p1"
        );
        expect(selectRootMove(root, [ACTIVATE, PASS], state, "p1").kind).toBe(
            "activate-ability"
        );
    });

    it("NO-FIRE (convert): a conversion that does not pay is left held", () => {
        // The stop condition, and the reason the rule needs no counter and no
        // per-card knowledge: strip the payoff engine off the board and
        // sacrificing a land for 2 life is a material LOSS, so
        // `firingBeatsHolding` declines it in the very window it would
        // otherwise fire in. This is what keeps a repeatable engine from
        // eating every land the bot has.
        const state = makeState({
            phase: "END_STEP",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        perm(ORB, "orb"),
                        perm(FOREST, "f1"),
                        perm(FOREST, "f2"),
                        perm(FOREST, "f3"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const root = rootOf(
            [
                { move: PASS, meanReward: 0.6635, meanMargin: 1781 },
                { move: ACTIVATE, meanReward: 0.6631, meanMargin: 1552 },
            ],
            "p1"
        );
        expect(selectRootMove(root, [ACTIVATE, PASS], state, "p1").kind).toBe(
            "pass"
        );
    });

    it("NO-FIRE (convert): the bot's OWN end step is not the last window", () => {
        // Its own end step is followed by the whole opponent turn, in which the
        // option is still worth holding — so the hold rule owns this window and
        // the conversion rule must stay silent.
        const state = botAt("END_STEP", engineBoard());
        const root = rootOf(
            [
                { move: PASS, meanReward: 0.6635, meanMargin: 1781 },
                { move: ACTIVATE, meanReward: 0.6631, meanMargin: 1552 },
            ],
            "p1"
        );
        expect(selectRootMove(root, [ACTIVATE, PASS], state, "p1").kind).toBe(
            "pass"
        );
    });
});
