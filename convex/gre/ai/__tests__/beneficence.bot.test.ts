// Per-target beneficence + cast-variant ranking (issue #1888).
//
// Three layers, each pinned here at the seam a blade entry cannot reach
// deterministically:
//
//  1. `opBeneficence` — the sign of one Op for its recipient.
//  2. `misdirectedTargetCount` — that sign applied to a real announcement's
//     targets, at BOTH sites the bot chooses them (a cast, CR 601.2c, and an
//     activated ability, CR 602.2b), including the AURA derivation (an aura has
//     no resolution script at all, so its sign comes from what it grants its
//     host).
//  3. `selectRootMove` — the negative control the blade suite structurally
//     cannot express: a MISDIRECTED variant that strictly out-rewards its
//     siblings must still be chosen. The rule is a preference among
//     outcome-equal siblings, never a filter, and this is the only test that
//     can construct the reward gap on purpose.

import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import { misdirectedTargetCount, targetSlotBeneficence } from "../beneficence";
import { opBeneficence } from "../opValuers";
import {
    PLAYER_COUNTER_KINDS,
    type EffectPlayerRef,
    type PlayerCounterKind,
} from "../../../cards/types";
import { isDominatedNoOpMove, isNoOpChoiceAnswer } from "../dominance";
import { choiceCandidates } from "../choiceCandidates";
import { NEUTRAL_PRIOR } from "../choicePriors";
import { selectRootMove, type Edge, type Node } from "../../search";
import { getDefinition, tryGetDefinition } from "../../../cards";

function build(spec: BladeScenario["spec"]): GameState {
    return buildBladeState({
        label: "beneficence-unit",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

const me = (state: GameState) => state.players[0].id;
const opp = (state: GameState) => state.players[1].id;

function castsOf(state: GameState, name: string): Move[] {
    return enumerateMoves(state, me(state)).filter(
        (m) =>
            m.kind === "cast-spell" &&
            cardName(state, m.cardInstanceId) === name
    );
}

function cardName(state: GameState, instanceId: string): string | undefined {
    for (const p of state.players) {
        for (const zone of [p.hand, p.battlefield]) {
            const found = zone.find((c) => c.id === instanceId);
            if (found) {
                return tryGetDefinition(
                    (found.card as { id?: string }).id ?? ""
                )?.name;
            }
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------

describe("opBeneficence — the sign of an Op for its recipient (issue #1888)", () => {
    it("signs a gift, an attack and an unknowable Op", () => {
        expect(
            opBeneficence({ op: "draw", player: "controller", count: 1 })
        ).toBe("beneficial");
        expect(
            opBeneficence({
                op: "dealDamage",
                to: { target: 0 },
                amount: 3,
            })
        ).toBe("harmful");
        // CR 400.7 — a zone move's sign genuinely depends on which zones:
        // deliberately `neutral`, the fail-open default.
        expect(
            opBeneficence({
                op: "moveZone",
                target: { target: 0 },
                to: "hand",
            })
        ).toBe("neutral");
    });

    // Issue #2605 — `OP_BENEFICENCE` is the ONE table `/new-op` flags as
    // unguarded: a missing row falls through `?? "neutral"` silently, and the
    // bot loses the who-does-this-help axis on that Op. `moveSpellFromStack`
    // is the shape most likely to be dropped or mis-signed, because "return
    // target spell to its owner's HAND" reads superficially like a gift — it
    // is an attack (CR 400.7: the spell is un-cast and the mana wasted),
    // whichever of the three zones it names.
    it("signs every `moveSpellFromStack` destination as an attack, not a gift", () => {
        for (const destination of [
            "hand",
            "library-top",
            "library-bottom",
        ] as const) {
            expect(
                opBeneficence({
                    op: "moveSpellFromStack",
                    target: { target: 0 },
                    destination,
                })
            ).toBe("harmful");
        }
    });

    it("reads the SIGN off the parametrized Ops, not their name", () => {
        // CR 613 layer 7c / CR 122 — the same Op is a buff or a shrink.
        expect(
            opBeneficence({
                op: "pump",
                target: { target: 0 },
                power: 2,
                toughness: 2,
                duration: { phase: "end-of-turn" },
            })
        ).toBe("beneficial");
        expect(
            opBeneficence({
                op: "pump",
                target: { target: 0 },
                power: -2,
                toughness: -2,
                duration: { phase: "end-of-turn" },
            })
        ).toBe("harmful");
        expect(
            opBeneficence({
                op: "counters",
                target: { target: 0 },
                counter: "+1/+1",
                action: "add",
                count: 1,
            })
        ).toBe("beneficial");
        expect(
            opBeneficence({
                op: "counters",
                target: { target: 0 },
                counter: "+1/+1",
                action: "remove",
                count: 1,
            })
        ).toBe("harmful");
        expect(
            opBeneficence({
                op: "tapUntap",
                target: { target: 0 },
                action: "untap",
            })
        ).toBe("beneficial");
        expect(
            opBeneficence({
                op: "tapUntap",
                target: { target: 0 },
                action: "tap",
            })
        ).toBe("harmful");
    });

    // CR 122.1 — "A counter is a marker placed on an object or player". Issue
    // #1969 generalized the energy-only `getEnergy` Op into `addPlayerCounter`
    // over a closed kind vocabulary, and DELETED its flat `OP_BENEFICENCE`
    // row: one Op now covers a gift ("you get {E}", "you get an experience
    // counter") and an attack ("target player gets three poison counters"), so
    // the sign has to be read off the KIND. That deletion removes the safety
    // net — if this switch case is ever dropped, `opBeneficence` falls through
    // to `OP_BENEFICENCE[op.op] ?? "neutral"` and every player-counter card
    // silently valuates as neutral in trigger ordering and the target priors.
    // Hence one assertion per kind, exhaustively.
    it("reads a player counter's sign off its KIND, exhaustively (CR 122.1, issue #1969)", () => {
        const sign = (counter: PlayerCounterKind, player: EffectPlayerRef) =>
            opBeneficence({
                op: "addPlayerCounter",
                counter,
                player,
                amount: 1,
            });

        // Gifts: resources the recipient wants.
        expect(sign("energy", "controller")).toBe("beneficial");
        expect(sign("experience", "controller")).toBe("beneficial");
        // CR 122.1f — ten poison counters lose the game: an attack, whoever
        // the Op happens to name.
        expect(sign("poison", { target: 0 })).toBe("harmful");

        // The sign is the KIND's, NOT the recipient's — `opBeneficence` scores
        // the Op for whoever receives it, so naming the opponent must not flip
        // it (that inversion is `misdirectedTargetCount`'s job, below).
        expect(sign("energy", "opponent")).toBe("beneficial");
        expect(sign("experience", { target: 0 })).toBe("beneficial");
        expect(sign("poison", "controller")).toBe("harmful");

        // Every kind is covered: a new PLAYER_COUNTER_KINDS row without a
        // decision here is a red, not a silent "neutral".
        expect(new Set(PLAYER_COUNTER_KINDS)).toEqual(
            new Set(["poison", "energy", "experience"])
        );
        for (const kind of PLAYER_COUNTER_KINDS) {
            expect(sign(kind, "controller")).not.toBe("neutral");
        }
    });
});

describe("targetSlotBeneficence — per announced slot (issue #1888)", () => {
    it("reads a script Op's slot: Ancestral Recall's target player is given cards", () => {
        // "Target player draws three cards." — `{ op: "draw", player: { target: 0 } }`
        expect(
            targetSlotBeneficence(
                getDefinition("70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b"),
                undefined,
                0
            )
        ).toBe("beneficial");
    });

    it("reads an AURA's attachment payoff: Wild Growth is a gift to its host's controller", () => {
        // CR 605.4 — the aura has NO resolution script; its sign comes from the
        // `manaBonusForPotential` descriptor on its tap trigger.
        expect(
            targetSlotBeneficence(
                getDefinition("fd896dfa-66c0-4327-8e5b-489bbe350c95"),
                undefined,
                0
            )
        ).toBe("beneficial");
    });

    it("reads a MODE's own script: Vision Charm's mill mode attacks its target", () => {
        // CR 700.2c — the chosen mode supplies the script that is read.
        const visionCharm = getDefinition(
            "78b384d3-3adf-493a-8b89-bfe68fd1c3e2"
        );
        expect(targetSlotBeneficence(visionCharm, "mill", 0)).toBe("harmful");
        // The land-type mode takes no targets at all — no slot, no opinion.
        expect(targetSlotBeneficence(visionCharm, "land-type", 0)).toBe(
            "neutral"
        );
    });
});

describe("misdirectedTargetCount — the sign against the real board (issue #1888)", () => {
    const wildGrowthBoard = {
        cards: [
            {
                name: "Wild Growth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Forest",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 2,
            },
            {
                name: "Mountain",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        libraryCount: 20,
    };

    it("flags the aura handed to the opponent and clears the one kept at home", () => {
        const state = build(wildGrowthBoard);
        const casts = castsOf(state, "Wild Growth");
        expect(casts.length).toBeGreaterThan(1);

        const oppLands = new Set(state.players[1].battlefield.map((c) => c.id));
        let sawMine = false;
        let sawTheirs = false;
        for (const move of casts) {
            if (move.kind !== "cast-spell") continue;
            const misdirected = misdirectedTargetCount(state, move, me(state));
            if (oppLands.has(move.targets[0].id)) {
                expect(misdirected).toBe(1);
                sawTheirs = true;
            } else {
                expect(misdirected).toBe(0);
                sawMine = true;
            }
        }
        expect(sawMine && sawTheirs).toBe(true);
    });

    it("is silent on a card whose Ops carry no sign", () => {
        const state = build({
            cards: [
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        });
        // `dealDamage` IS signed (harmful) — aimed at the opponent's creature
        // it is correctly directed, so the count is 0 either way. This is the
        // "never penalise a correct cast" half of the rule.
        for (const move of castsOf(state, "Lightning Bolt")) {
            if (move.kind !== "cast-spell") continue;
            const targetIsOpp =
                state.players[1].battlefield.some(
                    (c) => c.id === move.targets[0]?.id
                ) || move.targets[0]?.id === opp(state);
            if (targetIsOpp) {
                expect(misdirectedTargetCount(state, move, me(state))).toBe(0);
            }
        }
    });
});

describe("X = 0 is provably nothing (issue #1888 item 2)", () => {
    // `Flash of Insight` declares `additionalCosts.flashbackExileFromGraveyard`
    // — owed only on a GRAVEYARD cast (CR 601.2a). The dominance probe used to
    // refuse the card outright on the presence of that object, leaving the
    // empty X = 0 branch in the move list.
    const board = {
        cards: [
            {
                name: "Flash of Insight",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Island",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 5,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        libraryCount: 20,
    };

    it("proves the X = 0 cast dominated and leaves every X ≥ 1 cast alone", () => {
        const state = build(board);
        const casts = castsOf(state, "Flash of Insight");
        const byX = new Map<number, Move>();
        for (const move of casts) {
            if (move.kind === "cast-spell") byX.set(move.chosenX ?? 0, move);
        }
        expect(byX.has(0)).toBe(true);
        expect(byX.has(1)).toBe(true);
        expect(isDominatedNoOpMove(state, me(state), byX.get(0)!)).toBe(true);
        expect(isDominatedNoOpMove(state, me(state), byX.get(1)!)).toBe(false);
    });

    it("drops X = 0 from the pruned enumeration", () => {
        const state = build(board);
        const pruned = enumerateMoves(state, me(state), {
            pruneDominatedNoOps: true,
        }).filter(
            (m) =>
                m.kind === "cast-spell" &&
                cardName(state, m.cardInstanceId) === "Flash of Insight"
        );
        expect(pruned.length).toBeGreaterThan(0);
        for (const move of pruned) {
            if (move.kind !== "cast-spell") continue;
            expect(move.chosenX ?? 0).toBeGreaterThanOrEqual(1);
        }
    });
});

// ---------------------------------------------------------------------------
// The negative control a blade cannot express (issue #1888)
// ---------------------------------------------------------------------------

function edge(move: Move, mover: string, reward: number, visits = 100): Edge {
    return {
        key: JSON.stringify(move),
        move,
        mover,
        node: { children: new Map() },
        visits,
        totalReward: reward * visits,
        totalMargin: 0,
        avail: visits,
    };
}

function nodeOf(edges: Edge[]): Node {
    return { children: new Map(edges.map((e) => [e.key, e])) };
}

// ---------------------------------------------------------------------------
// The OTHER announcement site: activated abilities (PR #1914 review finding 3)
// ---------------------------------------------------------------------------

describe("activated-ability targets are ranked too (CR 602.2b, PR #1914 review finding 3)", () => {
    /** Jandor's Saddlebags — "{3}, {T}: Untap target creature." (`arn/colorless.ts`).
     *  A tapped creature on EACH side, so both a correctly-directed and a
     *  misdirected activation are enumerated, and three untapped lands to pay.
     *
     *  Garruk Wildspeaker's "+1: Untap two target lands" is the same shape but
     *  is not reachable from here yet: `enumerateMoves` skips every ability with
     *  a `cost.loyalty` (`gre/moves.ts`, pending the loyalty framework's
     *  enumeration slice, issue #700). Ranking it is therefore latent, not live
     *  — this test pins the mechanism on an ability the bot can actually
     *  announce, and Garruk inherits it for free the day loyalty abilities are
     *  enumerated. */
    function saddlebagsBoard(): GameState {
        return build({
            cards: [
                {
                    name: "Jandor's Saddlebags",
                    owner: "me",
                    zone: "battlefield",
                },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    tapped: true,
                },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        });
    }

    function untapActivations(state: GameState) {
        return enumerateMoves(state, me(state)).filter(
            (m): m is Extract<Move, { kind: "activate-ability" }> =>
                m.kind === "activate-ability" &&
                m.abilityId === "jandors-saddlebags-untap"
        );
    }

    /** The two announcements, split by whose creature they point at. */
    function split(state: GameState) {
        const theirs = new Set(state.players[1].battlefield.map((c) => c.id));
        const moves = untapActivations(state);
        return {
            mine: moves.find((m) => !theirs.has(m.targets[0].id))!,
            theirs: moves.find((m) => theirs.has(m.targets[0].id))!,
        };
    }

    it("scores an untap aimed at the OPPONENT's creature as misdirected", () => {
        const state = saddlebagsBoard();
        const botId = me(state);
        const { mine, theirs } = split(state);
        expect(mine).toBeDefined();
        expect(theirs).toBeDefined();

        // `tapUntap action: "untap"` is `beneficial` (`opValuers.ts`), so the
        // sign comes off the ABILITY's Effect Script with zero per-card
        // knowledge — the identical derivation the cast side uses.
        expect(misdirectedTargetCount(state, theirs, botId)).toBe(1);
        expect(misdirectedTargetCount(state, mine, botId)).toBe(0);
    });

    it("returns 0 for an activation the derivation has no opinion about", () => {
        // Fail-open, same as the cast side: an unresolvable ability id yields no
        // signal rather than a fabricated one.
        const state = saddlebagsBoard();
        const { theirs } = split(state);
        expect(
            misdirectedTargetCount(
                state,
                { ...theirs, abilityId: "not-a-real-ability" },
                me(state)
            )
        ).toBe(0);
    });

    it("redirects an outcome-equal misdirected activation to its own-side sibling", () => {
        const state = saddlebagsBoard();
        const botId = me(state);
        const { mine, theirs } = split(state);

        // The live bug: every target tuple ties inside `OUTCOME_EPS`, so the
        // pick fell to rollout noise and could untap the OPPONENT's creature.
        const tied = [edge(mine, botId, 0.5), edge(theirs, botId, 0.5)];
        expect(
            selectRootMove(nodeOf(tied), [mine, theirs], state, botId)
        ).toEqual(mine);

        // Same negative control as the cast side: a strictly better-rewarding
        // misdirected activation is a preference loser, never a filtered move.
        const gapped = [edge(mine, botId, 0.1), edge(theirs, botId, 0.9)];
        expect(
            selectRootMove(nodeOf(gapped), [mine, theirs], state, botId)
        ).toEqual(theirs);
    });
});

describe("selectRootMove NEGATIVE CONTROL — the rule is a preference, not a filter (issue #1888)", () => {
    it("keeps a misdirected cast that strictly out-rewards its sibling", () => {
        const state = build({
            cards: [
                { name: "Wild Growth", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        });
        const botId = me(state);
        const casts = castsOf(state, "Wild Growth").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );
        const oppLands = new Set(state.players[1].battlefield.map((c) => c.id));
        const theirs = casts.find((m) => oppLands.has(m.targets[0].id))!;
        const mine = casts.find((m) => !oppLands.has(m.targets[0].id))!;
        expect(misdirectedTargetCount(state, theirs, botId)).toBe(1);

        // Outcome-EQUAL: the misdirected variant is redirected.
        const tied = [edge(mine, botId, 0.5), edge(theirs, botId, 0.5)];
        expect(
            selectRootMove(nodeOf(tied), [mine, theirs], state, botId)
        ).toEqual(mine);

        // Strictly better on mean reward (far outside `OUTCOME_EPS`): the
        // misdirected variant is NOT in the outcome-equal contender set at all,
        // so it survives — a genuinely correct opponent-targeting can never be
        // suppressed by the beneficence term.
        const gapped = [edge(mine, botId, 0.1), edge(theirs, botId, 0.9)];
        expect(
            selectRootMove(nodeOf(gapped), [mine, theirs], state, botId)
        ).toEqual(theirs);
    });
});

// ---------------------------------------------------------------------------
// Degenerate-branch penalty at a live choice node (issue #1888 item 3)
// ---------------------------------------------------------------------------

describe("degenerate choice branch — Chrome Mox imprints nothing (issue #1888)", () => {
    /** The imprint trigger resolved, choice live: "you MAY exile a nonartifact,
     *  nonland card from your hand" (CR 608.2b, `count: { min: 0, max: 1 }`). */
    function imprintChoiceState(): GameState {
        return buildBladeState({
            label: "beneficence-unit-imprint",
            spec: {
                cards: [
                    { name: "Chrome Mox", owner: "me", zone: "battlefield" },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                    {
                        name: "Mountain",
                        owner: "me",
                        zone: "battlefield",
                        count: 2,
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                libraryCount: 20,
            },
            setup: [
                { kind: "etb-trigger", card: "Chrome Mox" },
                { kind: "resolve-top" },
            ],
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [{ kind: "pass" }] },
        });
    }

    it("opens the imprint branch at all — the pick is now an in-tree decision", () => {
        const state = imprintChoiceState();
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("choose-hand-card");
        const keys = choiceCandidates(state, head!).map((c) => c.key);
        expect(keys).toContain("hand-pick:Lightning Bolt");
        expect(keys).toContain("hand-pick:none");
    });

    it("proves the empty answer a no-op and floors its prior below every real pick", () => {
        const state = imprintChoiceState();
        const head = state.pendingChoices![0];
        const candidates = choiceCandidates(state, head);
        const none = candidates.find((c) => c.key === "hand-pick:none")!;
        const imprint = candidates.find(
            (c) => c.key === "hand-pick:Lightning Bolt"
        )!;

        // The probe itself (`ai/dominance.ts`, one level down from the cast-level
        // proof): answering "nothing" leaves the position byte-identical.
        expect(isNoOpChoiceAnswer(state, head, none.move)).toBe(true);
        expect(isNoOpChoiceAnswer(state, head, imprint.move)).toBe(false);

        // …and that verdict reaches the prior, which was `NEUTRAL_PRIOR` — the
        // same score as every answer that DOES something.
        expect(none.prior).toBeLessThan(imprint.prior);
        expect(none.prior).toBeLessThan(NEUTRAL_PRIOR);
    });
});
