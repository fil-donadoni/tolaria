// evaluate heuristic (issue #111, CR-agnostic position scoring). Asserts the
// ORDERING contract — winning > losing, and more life / board / cards / mana
// score higher all else equal — not the magnitudes (the weights are expected to
// be iterated). See `convex/gre/evaluate.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    cardValue,
    evaluate,
    evaluateAutoTapPosition,
    evaluateBreakdown,
    evaluateCreature,
    materialMargin,
    WIN_SCORE,
} from "../evaluate";
import type { CardInstanceState, GameState } from "../state";
import {
    dangerClock,
    predictUnblockedDamage,
    predictCombatOutcome,
} from "../dangerClock";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 ground
const GIANT = getCardByName("Hill Giant").id; // 3/3 ground
const SPRITES = getCardByName("Scryb Sprites").id; // 1/1 flying
const MOUNTAIN = getCardByName("Mountain").id;
const BOP = getCardByName("Birds of Paradise").id; // 0/1 flying mana dork
const GROWTH = getCardByName("Giant Growth").id; // instant, G (MV 1)
// A utility creature with a DSL activated ability (a mana-cost regenerate
// shield): its ability-script value is large relative to its modest body, the
// exact shape that inverted the issue-#149 invariant before review #1440.
// (Not Orcish Artillery — issue #1521 corrected `dealDamage`'s self-damage
// sign, so its "2 damage to any target and 3 to you" ability now nets a
// realistic small COST rather than the double-counted-as-gain total the old
// buggy valuer produced; Uthden Troll's ability has no self-directed half.)
const UTILITY_CREATURE = getCardByName("Uthden Troll").id;

function bear(controllerId: string, id: string) {
    return makeInstance(BEARS, { controllerId, ownerId: controllerId, id });
}

describe("evaluate (issue #111)", () => {
    it("a won position outranks any non-won position", () => {
        const won = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 0 })],
        });
        const even = makeState();
        expect(evaluate(won, "p1")).toBeGreaterThan(evaluate(even, "p1"));
        expect(evaluate(won, "p1")).toBeGreaterThanOrEqual(WIN_SCORE);
    });

    it("a lost position ranks below every non-lost position", () => {
        const lost = makeState({
            players: [makePlayer("p1", { life: 0 }), makePlayer("p2")],
        });
        const even = makeState();
        expect(evaluate(lost, "p1")).toBeLessThan(evaluate(even, "p1"));
        expect(evaluate(lost, "p1")).toBeLessThanOrEqual(-WIN_SCORE);
    });

    it("is zero-sum symmetric: my win is the opponent's loss", () => {
        const s = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 0 })],
        });
        expect(evaluate(s, "p1")).toBeGreaterThanOrEqual(WIN_SCORE);
        expect(evaluate(s, "p2")).toBeLessThanOrEqual(-WIN_SCORE);
    });

    it("more life scores higher, all else equal", () => {
        const ahead = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        const behind = makeState({
            players: [makePlayer("p1", { life: 10 }), makePlayer("p2")],
        });
        expect(evaluate(ahead, "p1")).toBeGreaterThan(evaluate(behind, "p1"));
    });

    it("more board presence scores higher", () => {
        const withBoard = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear("p1", "b1")] }),
                makePlayer("p2"),
            ],
        });
        const empty = makeState();
        expect(evaluate(withBoard, "p1")).toBeGreaterThan(
            evaluate(empty, "p1")
        );
        // The opponent having the same board flips the sign.
        const oppBoard = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear("p2", "b2")] }),
            ],
        });
        expect(evaluate(oppBoard, "p1")).toBeLessThan(evaluate(empty, "p1"));
    });

    it("card advantage (hand size) scores higher", () => {
        const moreCards = makeState({
            players: [
                makePlayer("p1", {
                    hand: [bear("p1", "h1"), bear("p1", "h2")],
                }),
                makePlayer("p2"),
            ],
        });
        const fewerCards = makeState({
            players: [
                makePlayer("p1", { hand: [bear("p1", "h1")] }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(moreCards, "p1")).toBeGreaterThan(
            evaluate(fewerCards, "p1")
        );
    });

    it("untapped mana sources count as available mana", () => {
        const untapped = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                            isTapped: false,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const tapped = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(untapped, "p1")).toBeGreaterThan(
            evaluate(tapped, "p1")
        );
    });

    it("developing a land scores strictly higher than holding it in hand (issue #149)", () => {
        // Same land, all else equal: in hand vs in play. A land drop must be a
        // strictly positive evaluation delta or the bot ties play-land with pass
        // and stalls its own mana. Asserted for both the leaf heuristic
        // (`evaluate`) and the ISMCTS tie-break margin (`materialMargin`).
        const landInHand = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const landInPlay = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                            isTapped: false,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(landInPlay, "p1")).toBeGreaterThan(
            evaluate(landInHand, "p1")
        );
        expect(materialMargin(landInPlay, "p1")).toBeGreaterThan(
            materialMargin(landInHand, "p1")
        );
    });

    it("an evasive creature is worth more than a ground creature of equal power", () => {
        // 1/1 flyer vs an artificially-equal ground baseline: give p1 a flyer,
        // p2 a vanilla 1/1-equivalent. The flyer's evasion bonus tips p1 ahead.
        const flyer = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(SPRITES, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "f1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(SPRITES, {
                            controllerId: "p2",
                            ownerId: "p2",
                            id: "f2",
                            staticAbilities: [], // strip flying → ground 1/1
                        }),
                    ],
                }),
            ],
        });
        expect(evaluate(flyer, "p1")).toBeGreaterThan(0);
    });
});

// Forge `evaluateCreature` port + Forge-scale magnitudes (ADR 0018, issue #194).
// Ordering asserts only — the weights are expected to be re-tuned.
describe("evaluateCreature — Forge scale & keyword vocabulary (ADR 0018)", () => {
    /** A bare creature instance in a one-creature state, so `evaluateCreature`
     *  can read effective P/T through the layer system. */
    function loneCreature(
        cardId: string,
        overrides: Partial<Parameters<typeof makeInstance>[1]> = {}
    ) {
        const inst = makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id: "c",
            ...overrides,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        return { state, inst };
    }

    it("is Forge-scale: a vanilla 2/2 is worth in the hundreds", () => {
        const { state, inst } = loneCreature(BEARS);
        expect(evaluateCreature(state, inst)).toBeGreaterThan(100);
    });

    it("a bigger body is worth more (power + toughness weighted)", () => {
        const bears = loneCreature(BEARS); // 2/2
        const giant = loneCreature(GIANT); // 3/3
        expect(evaluateCreature(giant.state, giant.inst)).toBeGreaterThan(
            evaluateCreature(bears.state, bears.inst)
        );
    });

    it("higher mana value adds worth, all else equal", () => {
        // Same body (2/2), different embedded mana cost — `getInstanceManaCost`
        // reads the embedded cost first, so this isolates the MV term.
        const cheap = loneCreature(BEARS, {
            card: { id: BEARS, manaCost: { G: 1, C: 1 } }, // MV 2
        });
        const pricey = loneCreature(BEARS, {
            card: { id: BEARS, manaCost: { G: 1, C: 5 } }, // MV 6
        });
        expect(evaluateCreature(pricey.state, pricey.inst)).toBeGreaterThan(
            evaluateCreature(cheap.state, cheap.inst)
        );
    });

    it("evasion is power-scaled: the flying bonus grows with power", () => {
        // Flying on a 3/3 is worth more than flying on a 1/1 — the bonus tracks
        // the damage the evasion pushes through (CR 509.1b).
        const bigFlyer = loneCreature(GIANT, { staticAbilities: ["flying"] });
        const bigGround = loneCreature(GIANT, { staticAbilities: [] });
        const smallFlyer = loneCreature(SPRITES, {
            staticAbilities: ["flying"],
        });
        const smallGround = loneCreature(SPRITES, { staticAbilities: [] });
        const bigBonus =
            evaluateCreature(bigFlyer.state, bigFlyer.inst) -
            evaluateCreature(bigGround.state, bigGround.inst);
        const smallBonus =
            evaluateCreature(smallFlyer.state, smallFlyer.inst) -
            evaluateCreature(smallGround.state, smallGround.inst);
        expect(bigBonus).toBeGreaterThan(smallBonus);
        expect(smallBonus).toBeGreaterThan(0);
    });

    it("defender is penalised: it can't attack, so its power is dead weight", () => {
        const wall = loneCreature(GIANT, { staticAbilities: ["defender"] });
        const attacker = loneCreature(GIANT, { staticAbilities: [] });
        expect(evaluateCreature(wall.state, wall.inst)).toBeLessThan(
            evaluateCreature(attacker.state, attacker.inst)
        );
    });

    it("an unimplemented keyword is zero-cost (no entry → no bonus)", () => {
        // Structured so a new keyword drops in at one weight entry: a keyword the
        // table doesn't know adds nothing, equalling the vanilla value.
        const known = loneCreature(GIANT, { staticAbilities: [] });
        const unknown = loneCreature(GIANT, {
            staticAbilities: ["totally-made-up-keyword"],
        });
        expect(evaluateCreature(unknown.state, unknown.inst)).toBe(
            evaluateCreature(known.state, known.inst)
        );
    });

    it("WIN_SCORE dominates even a wide Forge-scale board", () => {
        // Ten 3/3s a side is a far wider board than the engine's card pool
        // supports; the material margin must still be a small fraction of
        // WIN_SCORE so a win always outranks any material lead.
        const ten = (owner: string) =>
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
                makeInstance(GIANT, {
                    controllerId: owner,
                    ownerId: owner,
                    id: `${owner}-g${i}`,
                })
            );
        const wide = makeState({
            players: [
                makePlayer("p1", { battlefield: ten("p1") }),
                makePlayer("p2"),
            ],
        });
        expect(Math.abs(materialMargin(wide, "p1"))).toBeLessThan(WIN_SCORE);
    });
});

// Latent `cardValue` primitive + hand term (ADR 0018, issue #195). Ordering
// asserts only.
describe("cardValue — latent worth + aiValue override (ADR 0018)", () => {
    const state = makeState();
    const inHand = (cardId: string, extra = {}) =>
        makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id: "h",
            zone: "hand",
            ...extra,
        });

    it("a creature outranks a basic land (a bomb is not pitched for a land)", () => {
        expect(cardValue(state, inHand(BEARS))).toBeGreaterThan(
            cardValue(state, inHand(MOUNTAIN))
        );
    });

    it("a bigger creature is worth more latent than a smaller one", () => {
        expect(cardValue(state, inHand(GIANT))).toBeGreaterThan(
            cardValue(state, inHand(BEARS))
        );
    });

    it("latent creature worth is a discount of its realized board worth", () => {
        // A creature in hand still has to be cast and survive, so its latent
        // worth is below the realized `evaluateCreature` — which keeps deploying
        // it a strictly positive move.
        const onBoard = makeInstance(GIANT, {
            controllerId: "p1",
            ownerId: "p1",
            id: "b",
        });
        const boardState = makeState({
            players: [
                makePlayer("p1", { battlefield: [onBoard] }),
                makePlayer("p2"),
            ],
        });
        expect(cardValue(state, inHand(GIANT))).toBeLessThan(
            evaluateCreature(boardState, onBoard)
        );
    });

    it("an ABILITY-BEARING creature's latent worth stays below its realized board worth (review #1440, issue #149)", () => {
        // Regression guard for the inverted invariant: the latent (in-hand) term
        // counts a creature's DSL ability value, but `evaluateCreature` used to
        // count ONLY the body — so for a utility creature whose ability worth
        // exceeds the body's latent discount margin (a 1/x pinger), latent(hand)
        // exceeded realized(board) and the bot would HOARD the creature instead
        // of playing it. With the ability value now added symmetrically to the
        // realized board worth (un-discounted vs the latent 0.5× discount), and
        // the body still discounted latently (0.85×), latent < realized is
        // guaranteed. This case FAILS under the old body-only realized code
        // (latent counts the ability, realized does not) and PASSES now.
        const onBoard = makeInstance(UTILITY_CREATURE, {
            controllerId: "p1",
            ownerId: "p1",
            id: "b",
        });
        const boardState = makeState({
            players: [
                makePlayer("p1", { battlefield: [onBoard] }),
                makePlayer("p2"),
            ],
        });
        const latent = cardValue(state, inHand(UTILITY_CREATURE));
        const realized = evaluateCreature(boardState, onBoard);
        // Non-tautological: the ability worth is real. A 2/2 Uthden Troll in
        // play out-values a BIGGER vanilla 3/3 Hill Giant precisely because its
        // realized worth now includes the regenerate-shield ability — if the
        // ability value were dropped, the smaller body would rank below the
        // Giant.
        const giantOnBoard = makeInstance(GIANT, {
            controllerId: "p1",
            ownerId: "p1",
            id: "g",
        });
        const giantState = makeState({
            players: [
                makePlayer("p1", { battlefield: [giantOnBoard] }),
                makePlayer("p2"),
            ],
        });
        expect(realized).toBeGreaterThan(
            evaluateCreature(giantState, giantOnBoard)
        );
        expect(latent).toBeLessThan(realized);
    });

    it("aiValue on the card overrides the derived value verbatim", () => {
        // Embedded override (the registry path is the production source; fixtures
        // may inline it). A duct-taped 1 beats nothing, a 9999 bomb beats a land.
        const dud = inHand(GIANT, { card: { id: GIANT, aiValue: 1 } });
        const bomb = inHand(MOUNTAIN, {
            card: { id: MOUNTAIN, aiValue: 9999 },
        });
        expect(cardValue(state, dud)).toBe(1);
        expect(cardValue(state, bomb)).toBe(9999);
        // Override flips the natural order: the "bomb land" now outranks a real
        // creature, the "dud giant" falls below a basic land.
        expect(cardValue(state, bomb)).toBeGreaterThan(
            cardValue(state, inHand(GIANT))
        );
        expect(cardValue(state, dud)).toBeLessThan(
            cardValue(state, inHand(MOUNTAIN))
        );
    });

    it("the hand term sums cardValue: a hand of bombs out-scores a hand of lands", () => {
        const bombs = makeState({
            players: [
                makePlayer("p1", {
                    hand: [inHand(GIANT), makeInstance(GIANT, { id: "h2" })],
                }),
                makePlayer("p2"),
            ],
        });
        const lands = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        inHand(MOUNTAIN),
                        makeInstance(MOUNTAIN, { id: "h2" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(bombs, "p1")).toBeGreaterThan(evaluate(lands, "p1"));
    });
});

// Danger Clock — the race term (ADR 0018, issue #196). Ordering asserts only.
describe("dangerClock — race term, net of blockers (ADR 0018)", () => {
    const attacker = (cardId: string, id: string, extra = {}) =>
        makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            isSummoningSick: false,
            ...extra,
        });
    const oppCreature = (cardId: string, id: string, extra = {}) =>
        makeInstance(cardId, {
            controllerId: "p2",
            ownerId: "p2",
            id,
            isSummoningSick: false,
            ...extra,
        });

    it("predicts a lone attacker's full power when unblocked", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker(GIANT, "g")] }), // 3/3
                makePlayer("p2"),
            ],
        });
        expect(predictUnblockedDamage(state, "p1", "p2")).toBe(3);
    });

    it("is net of blockers: a legal blocker chumps the threat to zero", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker(GIANT, "g")] }),
                makePlayer("p2", { battlefield: [oppCreature(GIANT, "wall")] }),
            ],
        });
        // The 3/3 can be blocked by the opponent's 3/3 → no damage through.
        expect(predictUnblockedDamage(state, "p1", "p2")).toBe(0);
    });

    it("respects evasion: a ground blocker can't stop a flyer", () => {
        const flyer = attacker(GIANT, "f", { staticAbilities: ["flying"] });
        const ground = oppCreature(GIANT, "wall", { staticAbilities: [] });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flyer] }),
                makePlayer("p2", { battlefield: [ground] }),
            ],
        });
        // Ground 3/3 cannot block the flyer → 3 still gets through.
        expect(predictUnblockedDamage(state, "p1", "p2")).toBe(3);
    });

    it("is symmetric: a mirrored board nets to a zero clock", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker(GIANT, "g1")] }),
                makePlayer("p2", { battlefield: [oppCreature(GIANT, "g2")] }),
            ],
        });
        expect(dangerClock(state, "p1")).toBe(0);
    });

    it("holding the strictly faster clock scores positive", () => {
        // p1's attacker is unblockable; p2's same-size attacker is blocked by
        // p1 → p1 races faster.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        attacker(GIANT, "mine", {
                            staticAbilities: ["flying"],
                        }),
                        attacker(GIANT, "blocker"), // blocks p2's ground attacker
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [oppCreature(GIANT, "theirs")], // ground, blockable
                }),
            ],
        });
        expect(dangerClock(state, "p1")).toBeGreaterThan(0);
        expect(dangerClock(state, "p2")).toBeLessThan(0); // symmetric sign flip
    });

    it("an opposing lethal clock with no blocker scores worse, and worse still at lower life", () => {
        const threatened = (life: number) =>
            makeState({
                players: [
                    makePlayer("p1", { life }), // no blockers
                    makePlayer("p2", {
                        battlefield: [oppCreature(GIANT, "threat")],
                    }),
                ],
            });
        // Under an unblocked opposing clock the term is negative (defend!).
        expect(dangerClock(threatened(20), "p1")).toBeLessThan(0);
        // The same board is more dangerous the lower the bot's life.
        expect(dangerClock(threatened(3), "p1")).toBeLessThan(
            dangerClock(threatened(20), "p1")
        );
    });

    it("evaluate rewards holding the faster clock, all else equal", () => {
        // Two positions with the SAME material (a 3/3 each side), differing only
        // in WHO can be blocked: when my attacker evades and theirs doesn't, I
        // hold the faster clock and the leaf scores higher.
        const iRaceFaster = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        attacker(GIANT, "mine", {
                            staticAbilities: ["flying"],
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [oppCreature(GIANT, "theirs")],
                }),
            ],
        });
        const theyRaceFaster = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [attacker(GIANT, "mine")],
                }),
                makePlayer("p2", {
                    battlefield: [
                        oppCreature(GIANT, "theirs", {
                            staticAbilities: ["flying"],
                        }),
                    ],
                }),
            ],
        });
        expect(evaluate(iRaceFaster, "p1")).toBeGreaterThan(
            evaluate(theyRaceFaster, "p1")
        );
    });
});

// ---------------------------------------------------------------------------
// Temporary (until-end-of-turn) buffs are not permanent material
// (ADR 0020 §2, issue #207). The leaf used to count a combat trick's +X/+X as
// lasting board material — the creatures term rose by the full body delta —
// giving the bot a false incentive to dump a trick at sorcery speed. The
// realized creature value now reads PERMANENT effective P/T, so an
// until-boundary buff (7d temp pump or 7b temp set) does not reorder material
// the way a permanent change (a +1/+1 counter) does.
// ---------------------------------------------------------------------------
describe("evaluateCreature — temporary buffs excluded from material (issue #207)", () => {
    const EOT = { phase: "end-of-turn" } as const;

    function vanilla(id: string, overrides = {}) {
        return makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            ...overrides,
        });
    }

    it("an until-end-of-turn pump (Giant Growth +3/+3) adds no creature material", () => {
        const plain = vanilla("plain");
        const pumped = vanilla("pumped", {
            temporaryPTMods: [{ power: 3, toughness: 3, duration: EOT }],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plain, pumped] }),
                makePlayer("p2"),
            ],
        });
        expect(evaluateCreature(state, pumped)).toBe(
            evaluateCreature(state, plain)
        );
    });

    it("an until-end-of-turn set-P/T (7b) is likewise not counted as material", () => {
        const plain = vanilla("plain2");
        const setBig = vanilla("setbig", {
            temporaryPTSet: [{ power: 6, toughness: 6, duration: EOT }],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plain, setBig] }),
                makePlayer("p2"),
            ],
        });
        expect(evaluateCreature(state, setBig)).toBe(
            evaluateCreature(state, plain)
        );
    });

    it("a PERMANENT +1/+1 counter DOES raise creature material (control)", () => {
        const plain = vanilla("plain3");
        const buffed = vanilla("buffed", { counters: { "+1/+1": 1 } });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plain, buffed] }),
                makePlayer("p2"),
            ],
        });
        expect(evaluateCreature(state, buffed)).toBeGreaterThan(
            evaluateCreature(state, plain)
        );
    });
});

// ---------------------------------------------------------------------------
// Combat-aware declare-attackers leaf (ADR 0020 §3, issue #208). A
// declare-attackers position is otherwise scored on the PRE-damage snapshot, so
// the leaf returns the same value for every attack set and the choice falls to
// the noisy rollout (a mana dork suiciding for 1). Folding the expected combat
// exchange into the leaf lets it tell a profitable attack from a creature
// walking into death. Reuses the pure Danger Clock block predictor.
// ---------------------------------------------------------------------------
describe("predictCombatOutcome — crude declared-combat resolution (issue #208)", () => {
    const atk = (cardId: string, id: string, extra = {}) =>
        makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            isSummoningSick: false,
            isAttacking: true,
            isTapped: true,
            ...extra,
        });
    const blk = (cardId: string, id: string, extra = {}) =>
        makeInstance(cardId, {
            controllerId: "p2",
            ownerId: "p2",
            id,
            isSummoningSick: false,
            ...extra,
        });

    /** A DECLARE_BLOCKERS state with `attackerIds` already declared by p1. */
    function declaredCombat(
        attackers: ReturnType<typeof atk>[],
        blockers: ReturnType<typeof blk>[]
    ) {
        return makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: attackers }),
                makePlayer("p2", { battlefield: blockers }),
            ],
            combat: {
                attackerIds: attackers.map((a) => a.id),
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    it("a 2/2 into a 3/3 dies for nothing (surviving killer block)", () => {
        const state = declaredCombat([atk(BEARS, "g")], [blk(GIANT, "wall")]);
        const out = predictCombatOutcome(state, "p1", "p2");
        expect(out.deadAttackerIds).toEqual(["g"]);
        expect(out.deadBlockerIds).toEqual([]);
        expect(out.faceDamage).toBe(0);
    });

    it("a 3/3 into an open board hits for its full power", () => {
        const state = declaredCombat([atk(GIANT, "g")], []);
        const out = predictCombatOutcome(state, "p1", "p2");
        expect(out.faceDamage).toBe(3);
        expect(out.deadAttackerIds).toEqual([]);
    });

    it("equal bodies trade — both die", () => {
        const state = declaredCombat([atk(GIANT, "g")], [blk(GIANT, "wall")]);
        const out = predictCombatOutcome(state, "p1", "p2");
        expect(out.deadAttackerIds).toEqual(["g"]);
        expect(out.deadBlockerIds).toEqual(["wall"]);
        expect(out.faceDamage).toBe(0);
    });
});

describe("evaluate — declare-attackers leaf distinguishes attack sets (issue #208)", () => {
    const atk = (cardId: string, id: string, extra = {}) =>
        makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            isSummoningSick: false,
            isAttacking: true,
            isTapped: true,
            ...extra,
        });
    const blk = (cardId: string, id: string) =>
        makeInstance(cardId, {
            controllerId: "p2",
            ownerId: "p2",
            id,
            isSummoningSick: false,
        });

    function declaredCombat(
        attackers: ReturnType<typeof atk>[],
        blockers: ReturnType<typeof blk>[]
    ) {
        return makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: attackers }),
                makePlayer("p2", { battlefield: blockers }),
            ],
            combat: {
                attackerIds: attackers.map((a) => a.id),
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    it("a profitable attack outranks a suicidal one (no longer identical)", () => {
        // Suicidal: a 2/2 swings into a 3/3 and dies for nothing.
        const suicidal = declaredCombat([atk(BEARS, "g")], [blk(GIANT, "w")]);
        // Profitable: a 3/3 swings into an open board for 3 to the face.
        const profitable = declaredCombat([atk(GIANT, "g")], []);
        expect(evaluate(profitable, "p1")).toBeGreaterThan(
            evaluate(suicidal, "p1")
        );
    });

    it("holding a mana dork back outranks sending it to die for nothing", () => {
        // p1 has a real 3/3 and a Birds of Paradise (0/1). Sending BoP alongside
        // the Giant taps it and walks it into a fatal block for 0 damage; holding
        // it back keeps the body and the mana. The held-back line must score higher.
        const giantAttacking = atk(GIANT, "giant");
        const bopAttacking = atk(BOP, "bop");
        const attackBoth = declaredCombat(
            [giantAttacking, bopAttacking],
            [blk(BEARS, "w")]
        );
        // Hold BoP back: it is not in the attack set, untapped, still a blocker/source.
        const giantOnly = declaredCombat(
            [atk(GIANT, "giant2")],
            [blk(BEARS, "w2")]
        );
        giantOnly.players[0].battlefield.push(
            makeInstance(BOP, {
                controllerId: "p1",
                ownerId: "p1",
                id: "bop-held",
                isSummoningSick: false,
                isTapped: false,
            })
        );
        expect(evaluate(giantOnly, "p1")).toBeGreaterThan(
            evaluate(attackBoth, "p1")
        );
    });
});

describe("reactive flexibility (ADR 0021 slice 1, issue #221)", () => {
    const handCard = (cardId: string, id: string) =>
        makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            zone: "hand",
        });
    const land = (id: string, tapped: boolean) =>
        makeInstance(MOUNTAIN, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            isTapped: tapped,
        });

    // A holdable instant in hand with N untapped lands to pay for it, vs the same
    // hand with the lands tapped out (no response possible this turn).
    const withMana = (tapped: boolean, hand = [handCard(GROWTH, "gg")]) =>
        makeState({
            players: [
                makePlayer("p1", {
                    hand,
                    battlefield: [land("m1", tapped)],
                }),
                makePlayer("p2"),
            ],
        });

    it("a castable held instant with open mana scores higher than tapped out", () => {
        // AC1: open mana → a response is possible → flexibility value; tapped out
        // → no response → no flexibility. The term itself must reflect this.
        const open = withMana(false);
        const tapped = withMana(true);
        expect(evaluateBreakdown(open, "p1").self.flexibility).toBeGreaterThan(
            0
        );
        expect(evaluateBreakdown(tapped, "p1").self.flexibility).toBe(0);
        expect(evaluate(open, "p1")).toBeGreaterThan(evaluate(tapped, "p1"));
    });

    it("holding a castable instant beats spending it for no payoff", () => {
        // AC2: the held line keeps the card + untapped mana; the spent line has
        // burned both for no board change. Holding must score higher.
        const held = withMana(false);
        const spentForNothing = makeState({
            players: [
                makePlayer("p1", { hand: [], battlefield: [land("m1", true)] }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(held, "p1")).toBeGreaterThan(
            evaluate(spentForNothing, "p1")
        );
    });

    it("the flexibility term is additive to the latent hand value, not a re-count", () => {
        // AC3: the card's body is counted ONCE, in the `hand` term (latent
        // cardValue). Flexibility is a separate, bounded bonus gated on
        // castability — present only when the card can be cast now.
        const open = evaluateBreakdown(withMana(false), "p1").self;
        const tapped = evaluateBreakdown(withMana(true), "p1").self;
        // Same card in hand both ways → identical hand (latent) value.
        expect(open.hand).toBe(tapped.hand);
        expect(open.hand).toBeGreaterThan(0);
        // Flexibility lives in its own term and only appears when affordable.
        expect(open.flexibility).toBeGreaterThan(0);
        expect(tapped.flexibility).toBe(0);
    });

    it("a non-instant in hand earns no flexibility, even with open mana", () => {
        // AC4: a sorcery-speed card (a creature here) cannot answer anything in a
        // reactive window, so holding it carries no option value.
        const creatureInHand = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard(BEARS, "bears")],
                    battlefield: [land("m1", false), land("m2", false)],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluateBreakdown(creatureInHand, "p1").self.flexibility).toBe(
            0
        );
    });

    it("an unaffordable instant (cost exceeds open mana) earns no flexibility", () => {
        // Castability gate: one untapped land cannot pay a 2-cost instant, so it
        // contributes no option value even though it is instant-speed.
        const tooExpensive = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard(getCardByName("Counterspell").id, "cs")],
                    battlefield: [land("m1", false)],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluateBreakdown(tooExpensive, "p1").self.flexibility).toBe(0);
    });

    it("the flexibility term is bounded — extra castable instants saturate", () => {
        // The term is capped so a hand stuffed with cheap instants can never let
        // option value dominate genuine material.
        const board = [
            land("m1", false),
            land("m2", false),
            land("m3", false),
            land("m4", false),
            land("m5", false),
        ];
        const three = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        handCard(GROWTH, "g1"),
                        handCard(GROWTH, "g2"),
                        handCard(GROWTH, "g3"),
                    ],
                    battlefield: board,
                }),
                makePlayer("p2"),
            ],
        });
        const five = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        handCard(GROWTH, "g1"),
                        handCard(GROWTH, "g2"),
                        handCard(GROWTH, "g3"),
                        handCard(GROWTH, "g4"),
                        handCard(GROWTH, "g5"),
                    ],
                    battlefield: board,
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluateBreakdown(five, "p1").self.flexibility).toBe(
            evaluateBreakdown(three, "p1").self.flexibility
        );
    });
});

// ---------------------------------------------------------------------------
// Non-creature beneficial permanents are realized material (issue #365). A
// static-buff Enchantment (Castle) and a card-advantage Artifact (Jayemdae
// Tome) carry no power/toughness, so before the fix their loss barely moved the
// material margin and the bot would Disenchant its own. Their realized
// battlefield worth must register, so destroying one is a measurable,
// correctly-signed material change.
// ---------------------------------------------------------------------------
describe("non-creature beneficial permanents are material (issue #365)", () => {
    const CASTLE = getCardByName("Castle").id; // {3}{W} Enchantment, +0/+2 buff
    const TOME = getCardByName("Jayemdae Tome").id; // {4} Artifact, card draw

    function withPerm(cardId: string, ownerId: string, id: string) {
        return makeInstance(cardId, { controllerId: ownerId, ownerId, id });
    }

    it("destroying the bot's own Enchantment lowers its material margin", () => {
        const withCastle = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [withPerm(CASTLE, "p1", "castle")],
                }),
                makePlayer("p2"),
            ],
        });
        const without = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Losing the Castle is a strict, measurable material LOSS for p1.
        expect(materialMargin(without, "p1")).toBeLessThan(
            materialMargin(withCastle, "p1")
        );
        // And it is more than the flat board-presence bonus alone (W_PERMANENT
        // = 5): the realized non-creature body now counts.
        expect(
            materialMargin(withCastle, "p1") - materialMargin(without, "p1")
        ).toBeGreaterThan(5);
    });

    it("destroying a card-advantage Artifact lowers the controller's margin", () => {
        const withTome = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [withPerm(TOME, "p1", "tome")],
                }),
                makePlayer("p2"),
            ],
        });
        const without = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        expect(materialMargin(without, "p1")).toBeLessThan(
            materialMargin(withTome, "p1")
        );
    });

    it("the opponent's beneficial permanent is a NEGATIVE term for the bot", () => {
        // The same permanent on the opponent's board lowers the bot's margin —
        // destroying THAT is a gain, so the friendly-vs-enemy sign is correct.
        const oppHasTome = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [withPerm(TOME, "p2", "tome")],
                }),
            ],
        });
        const neither = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        expect(materialMargin(oppHasTome, "p1")).toBeLessThan(
            materialMargin(neither, "p1")
        );
    });

    it("a land is NOT given a realized body (mana term owns it, issue #149)", () => {
        const MOUNTAIN_ID = getCardByName("Mountain").id;
        const withLand = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [withPerm(MOUNTAIN_ID, "p1", "mtn")],
                }),
                makePlayer("p2"),
            ],
        });
        // A land's permanents term is the flat W_PERMANENT only (5); its value
        // lives in the `mana` term, not a duplicated non-creature body.
        expect(evaluateBreakdown(withLand, "p1").self.permanents).toBe(5);
    });
});

describe("evaluateAutoTapPosition — source-quality bonus (issue #794)", () => {
    const FACTORY = getCardByName("Mishra's Factory").id; // {T}: C + animate
    const FOREST = getCardByName("Forest").id; // {T}: G, plain basic
    const TUNDRA = getCardByName("Tundra").id; // {T}: W or U, dual

    function landState(landId: string, id: string, tapped = false): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(landId, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id,
                            isTapped: tapped,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("values an untapped dual-purpose manland above a plain basic", () => {
        const withFactory = landState(FACTORY, "src");
        const withForest = landState(FOREST, "src");
        expect(evaluateAutoTapPosition(withFactory, "p1")).toBeGreaterThan(
            evaluateAutoTapPosition(withForest, "p1")
        );
    });

    it("values an untapped color-flexible dual land above a mono basic", () => {
        const withTundra = landState(TUNDRA, "src");
        const withForest = landState(FOREST, "src");
        expect(evaluateAutoTapPosition(withTundra, "p1")).toBeGreaterThan(
            evaluateAutoTapPosition(withForest, "p1")
        );
    });

    it("tapping the manland removes its source-quality bonus", () => {
        const untapped = landState(FACTORY, "src", false);
        const tapped = landState(FACTORY, "src", true);
        // The tapped position loses both the flat mana term AND the untapped
        // dual-purpose bonus, so it scores strictly lower.
        expect(evaluateAutoTapPosition(tapped, "p1")).toBeLessThan(
            evaluateAutoTapPosition(untapped, "p1")
        );
    });

    it("adds no bonus over base evaluate for a plain tapped board", () => {
        // A tapped basic is neither a color-flexible nor a dual-purpose untapped
        // source, so the auto-tap score equals the base static evaluate.
        const tapped = landState(FOREST, "src", true);
        expect(evaluateAutoTapPosition(tapped, "p1")).toBe(
            evaluate(tapped, "p1")
        );
    });
});

describe("manaDevelopment term (issue #2686)", () => {
    // A basic land instance and a hand card instance, both controlled by `p1`.
    const land = (id: string) =>
        makeInstance(MOUNTAIN, { controllerId: "p1", ownerId: "p1", id });
    const held = (id: string) =>
        makeInstance(GIANT, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            zone: "hand",
        });

    it("prices an early-game land above 2 life, and a flooded land below a relevant card", () => {
        // On-curve: 2 lands, one 4-MV Hill Giant in hand (handNeed 4 > lands 2).
        const twoLands = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land("a"), land("b")],
                    hand: [held("h1")],
                }),
                makePlayer("p2"),
            ],
        });
        const threeLands = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land("a"), land("b"), land("c")],
                    hand: [held("h1")],
                }),
                makePlayer("p2"),
            ],
        });
        // Flooded: 7 lands, empty hand (handNeed 0).
        const sevenLands = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: ["a", "b", "c", "d", "e", "f", "g"].map(land),
                }),
                makePlayer("p2"),
            ],
        });
        const eightLands = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: ["a", "b", "c", "d", "e", "f", "g", "h"].map(
                        land
                    ),
                }),
                makePlayer("p2"),
            ],
        });

        const onCurveLand =
            materialMargin(threeLands, "p1") - materialMargin(twoLands, "p1");
        const floodedLand =
            materialMargin(eightLands, "p1") - materialMargin(sevenLands, "p1");

        // The term's whole contribution is the on-curve/flooded spread: an
        // on-curve land carries `manaDevWeight` (12) on top of the flat 17; a
        // flooded one does not. Zeroing `manaDevWeight` collapses on-curve to
        // flooded (17 == 17), so this strict inequality is the load-bearing half.
        expect(onCurveLand).toBeGreaterThan(floodedLand);
        expect(onCurveLand - floodedLand).toBe(12);
        // Early-game land > 2 life (2 × lifeWeight = 16).
        expect(onCurveLand).toBeGreaterThan(
            2 * DEFAULT_EVAL_WEIGHTS.lifeWeight
        );
        // Flooded land < a relevant card (the held Hill Giant's latent worth).
        expect(floodedLand).toBeLessThan(cardValue(sevenLands, held("h1")));
    });

    // Issue #2927: the fixture above proves the FORMULA but not the BEHAVIOUR —
    // its flooded position holds an EMPTY hand, the one hand shape no real
    // position has. With demand as the SUM of hand mana values (the #2686
    // proxy) the flooded branch was unreachable in play: any realistic hand
    // sums past every land count a game reaches, so `min(lands, handNeed)`
    // always selected `lands`. These fixtures all hold cards.
    const cheap = (id: string) =>
        makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            zone: "hand",
        });
    const withLands = (count: number, hand: CardInstanceState[]) =>
        makeState({
            players: [
                makePlayer("p1", {
                    battlefield: Array.from({ length: count }, (_, i) =>
                        land(`l${i}`)
                    ),
                    hand,
                }),
                makePlayer("p2"),
            ],
        });
    const devTerm = (state: GameState) =>
        evaluateBreakdown(state, "p1").self.manaDevelopment;

    it("reaches the flooded branch from a REALISTIC position — a full hand of cheap spells (issue #2927)", () => {
        // Four 2-MV Grizzly Bears in hand: the top of the curve is 2, so a
        // board of seven lands is flooded. Under the #2686 sum proxy this same
        // hand demanded 4 x 2 = 8 lands — MORE than the seven on the board —
        // so the position read as ON CURVE and the flooded branch never fired.
        const hand = ["h1", "h2", "h3", "h4"].map(cheap);
        const sumOfHand = hand.length * 2;
        expect(sumOfHand).toBeGreaterThan(7); // the old proxy's dead branch

        const sevenLands = withLands(7, hand);
        const eightLands = withLands(8, hand);
        const floodedLand =
            materialMargin(eightLands, "p1") - materialMargin(sevenLands, "p1");

        // Demand is the top of the curve (2), so the term is pinned at 2 lands'
        // worth of development in BOTH positions: the eighth land buys none.
        expect(devTerm(sevenLands)).toBe(
            2 * DEFAULT_EVAL_WEIGHTS.manaDevWeight
        );
        expect(devTerm(eightLands)).toBe(devTerm(sevenLands));
        // ... and that surplus land is back at the flat 17: a point ABOVE a
        // 2-life gain (16), which is the rollout-noise tie the term's header
        // documents, and well below a card in hand.
        expect(floodedLand).toBe(
            DEFAULT_EVAL_WEIGHTS.permanentWeight +
                DEFAULT_EVAL_WEIGHTS.manaWeight
        );
        expect(floodedLand).toBeLessThan(cardValue(sevenLands, held("h1")));
    });

    it("keeps an on-curve land above 2 life with the same realistic hand (issue #2927)", () => {
        // Same four cheap cards plus one 4-MV Hill Giant: the top of the curve
        // is now 4, so lands 1-4 are on curve and the fourth still earns the
        // development bonus.
        const hand = [...["h1", "h2", "h3", "h4"].map(cheap), held("big")];
        const threeLands = withLands(3, hand);
        const fourLands = withLands(4, hand);
        const onCurveLand =
            materialMargin(fourLands, "p1") - materialMargin(threeLands, "p1");
        expect(onCurveLand).toBeGreaterThan(
            2 * DEFAULT_EVAL_WEIGHTS.lifeWeight
        );
        expect(onCurveLand).toBe(
            DEFAULT_EVAL_WEIGHTS.permanentWeight +
                DEFAULT_EVAL_WEIGHTS.manaWeight +
                DEFAULT_EVAL_WEIGHTS.manaDevWeight
        );
    });

    // Issue #2928: casting is not a mana-development change. A card moving
    // hand → battlefield must leave the term where it was, or the evaluator
    // pays a flooded bot to sit on its hand in exactly the positions where
    // emptying it is mandatory.
    const onBattlefield = (cardId: string, id: string) =>
        makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            summoningSick: false,
        });
    const board = (
        lands: number,
        hand: CardInstanceState[],
        nonLands: CardInstanceState[]
    ) =>
        makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        ...Array.from({ length: lands }, (_, i) =>
                            land(`l${i}`)
                        ),
                        ...nonLands,
                    ],
                    hand,
                }),
                makePlayer("p2"),
            ],
        });

    it("does not move when a card leaves the hand for the battlefield (issue #2928)", () => {
        // Six lands and one 4-MV Hill Giant: the hand tops out at 4, which the
        // six lands already cover. Casting it is the move the bot is supposed
        // to make, and the term must not charge for it.
        const inHand = board(6, [held("g")], []);
        const inPlay = board(6, [], [onBattlefield(GIANT, "g")]);
        expect(devTerm(inPlay)).toBe(devTerm(inHand));
    });

    it("charges the cast nothing that zeroing manaDevWeight would refund (issue #2928)", () => {
        // The invariant asserted where it bites — on `evaluate` itself, not on
        // the term in isolation. The delta of CASTING is computed twice, at
        // `manaDevWeight` 12 and at 0: if the term is cast-invariant the two
        // deltas are identical, and if it is not, the difference IS the toll
        // the flooded bot pays for emptying its hand.
        const inHand = board(6, [held("g")], []);
        const inPlay = board(6, [], [onBattlefield(GIANT, "g")]);
        const zeroed = { ...DEFAULT_EVAL_WEIGHTS, manaDevWeight: 0 };
        const castDelta = (w: typeof DEFAULT_EVAL_WEIGHTS) =>
            evaluate(inPlay, "p1", w) - evaluate(inHand, "p1", w);
        expect(castDelta(DEFAULT_EVAL_WEIGHTS)).toBe(castDelta(zeroed));
    });

    it("keeps the base justified once the spell that wanted it is in play (issue #2928)", () => {
        // The board is the other half of the same demand: a 4-MV permanent in
        // play wants its four lands exactly as the card in hand did. With an
        // empty hand and that permanent out, the fourth land is still on curve
        // — 29, above 2 life — while a seventh is flooded at 17.
        const four = board(4, [], [onBattlefield(GIANT, "g")]);
        const three = board(3, [], [onBattlefield(GIANT, "g")]);
        const seven = board(7, [], [onBattlefield(GIANT, "g")]);
        const six = board(6, [], [onBattlefield(GIANT, "g")]);
        const onCurveLand =
            materialMargin(four, "p1") - materialMargin(three, "p1");
        const floodedLand =
            materialMargin(seven, "p1") - materialMargin(six, "p1");
        expect(onCurveLand).toBeGreaterThan(
            2 * DEFAULT_EVAL_WEIGHTS.lifeWeight
        );
        expect(onCurveLand - floodedLand).toBe(
            DEFAULT_EVAL_WEIGHTS.manaDevWeight
        );
    });

    it("does not pay for hand SIZE — drawing a card no bigger than the curve leaves the term flat (issue #2927)", () => {
        // The #2686 sum proxy raised demand on every draw, so a bot could gain
        // development by drawing a card while gaining no land at all. Demand is
        // the curve's top end, so a second copy of a card already in hand moves
        // nothing; a card ABOVE the top end is the only thing that does.
        const oneCheap = withLands(3, [cheap("h1")]);
        const twoCheap = withLands(3, [cheap("h1"), cheap("h2")]);
        const withBigger = withLands(3, [cheap("h1"), held("big")]);
        expect(devTerm(twoCheap)).toBe(devTerm(oneCheap));
        expect(devTerm(withBigger)).toBeGreaterThan(devTerm(oneCheap));
    });
});
