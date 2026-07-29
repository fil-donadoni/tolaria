// Activation-timing discipline for the bot (issue #1890).
//
// The engine already knew that a holdable INSTANT in hand carries option value
// (ADR 0021); every seam that expressed it read `types.includes("Instant")`, so
// the mirror case — a battlefield permanent whose ACTIVATED ability can be used
// at instant speed — was invisible. The bot therefore spent Mother of Runes'
// protection at sorcery speed with nothing to protect against, and animated
// Mishra's Factory after its own combat.
//
// Four seams, four sections below:
//   1. `isDeferrableStackAbility` — the per-card-agnostic timing predicate.
//   2. `isDiscouragedRolloutMove` — the rollout default-policy guardrail.
//   3. `selectRootMove` — the hold-the-option tie-break, outcome-equality only.
//   4. `evaluate`'s flexibility term — the POSITIVE reason to hold up.
//
// The two cards are used as FIXTURES, never as special cases: nothing under test
// reads a card name. Mother of Runes supplies a `{T}` instant-speed ability and
// Mishra's Factory an `animatesSelf` one; any card with the same shape behaves
// identically.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    isDiscouragedRolloutMove,
    selectRootMove,
    type Edge,
    type Node,
} from "../search";
import {
    effectiveAbilityOf,
    hasLiveInstantSpeedAbility,
    isDeferrableStackAbility,
} from "../ai/abilityTiming";
import { evaluate } from "../evaluate";
import type { Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";

const MOTHER = getCardByName("Mother of Runes").id;
const FACTORY = getCardByName("Mishra's Factory").id;
const MOUNTAIN = getCardByName("Mountain").id;
const GIANT = getCardByName("Hill Giant").id;

const MOTHER_ABILITY = "mother-of-runes-protect";
const FACTORY_ANIMATE = "mishras-factory-animate";
const FACTORY_MANA = "mishras-factory-mana";

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
// 1. The timing predicate (CR 602.2a / 602.5)
// ---------------------------------------------------------------------------
describe("isDeferrableStackAbility — instant-speed activation (CR 602.2a)", () => {
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

    it("rejects an 'activate only as a sorcery' ability (CR 602.3b)", () => {
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
// 4. Flexibility: the POSITIVE reason to hold up (issue #1890 item 3)
// ---------------------------------------------------------------------------
describe("evaluate flexibility — battlefield activation options (issue #1890)", () => {
    it("an UNTAPPED instant-speed source is a live option; a tapped one is not", () => {
        expect(hasLiveInstantSpeedAbility(perm(MOTHER, "mom"), 0)).toBe(true);
        expect(
            hasLiveInstantSpeedAbility(
                perm(MOTHER, "mom", { isTapped: true }),
                0
            )
        ).toBe(false);
    });

    it("a mana-cost ability is a live option only while the mana is affordable", () => {
        // A TAPPED Mishra's Factory has only its {1} animate left (its two {T}
        // abilities are unpayable), so it is live with one mana available and
        // dead with none. This is what makes tapping out COST something.
        const tappedFactory = perm(FACTORY, "fac", { isTapped: true });
        expect(hasLiveInstantSpeedAbility(tappedFactory, 1)).toBe(true);
        expect(hasLiveInstantSpeedAbility(tappedFactory, 0)).toBe(false);
    });

    it("evaluate scores an untapped Mother of Runes ABOVE the same board tapped", () => {
        const untapped = botAt("PRECOMBAT_MAIN", [
            perm(MOTHER, "mom"),
            perm(MOUNTAIN, "m"),
        ]);
        const tapped = botAt("PRECOMBAT_MAIN", [
            perm(MOTHER, "mom", { isTapped: true }),
            perm(MOUNTAIN, "m"),
        ]);
        // Tapping a 1/1 changes no material term the evaluator reads except the
        // flexibility option it just spent — so this delta IS the new term.
        expect(evaluate(untapped, "p1")).toBeGreaterThan(
            evaluate(tapped, "p1")
        );
    });
});
