// evaluate heuristic (issue #111, CR-agnostic position scoring). Asserts the
// ORDERING contract — winning > losing, and more life / board / cards / mana
// score higher all else equal — not the magnitudes (the weights are expected to
// be iterated). See `convex/gre/evaluate.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    cardValue,
    evaluate,
    evaluateCreature,
    materialMargin,
    WIN_SCORE,
} from "../evaluate";
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

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 ground
const GIANT = getCardByName("Hill Giant").id; // 3/3 ground
const SPRITES = getCardByName("Scryb Sprites").id; // 1/1 flying
const MOUNTAIN = getCardByName("Mountain").id;
const BOP = getCardByName("Birds of Paradise").id; // 0/1 flying mana dork

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
