// Differential Reading of an each-player one-shot script (issue #5162,
// ADR 0151, PRD #5160).
//
// The defect: a `forEach { set: "players" }` body names `$each`, and the
// walker values it ONCE for a representative member, read as the caster
// (`isSelf` of an opaque ref). So Wheel of Fortune sat in hand at "the caster
// draws seven" whatever the hands held, and Innocent Blood at one edict's
// worth whatever the boards held — the reading could not know who the
// symmetric effect hurts more. On a real board it is now the opponent's
// realised loss minus the caster's own, each side read off the board.
//
// Every reading runs through the PRODUCTION lens (`handLatentLens`, the one
// `evaluate`'s hand term builds) over real registry definitions. The script's
// own number is read rather than the hand term because `latentValue` floors a
// measured reading at zero: a negative differential would be invisible there.
import { describe, expect, it } from "vitest";
import {
    getDefinition,
    withTemporaryDefinition,
} from "../../../cards/registry";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { handLatentLens } from "../../evaluate";
import { dslSpellScriptValue } from "../cardScriptValue";
import { contextFreeLatentLens } from "../grounding";
import { wheelOfFortune } from "../../../cards/sets/lea/red.cards";
import { timetwister } from "../../../cards/sets/lea/blue.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { forest } from "../../../cards/sets/lea/colorless.cards";
import { innocentBlood } from "../../../cards/sets/ody/black.cards";
import { shivanDragon } from "../../../cards/sets/lea/red.cards";
import { balance } from "../../../cards/sets/lea/white.cards";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import { windsOfChange } from "../../../cards/sets/leg/red.cards";

interface Side {
    hand?: readonly string[];
    board?: readonly string[];
    library?: readonly string[];
}

/** The script reading of `cardId` held by p1, on the board `own` / `opp`
 *  describe, with whether the lens MEASURED it. */
function readOnBoard(
    cardId: string,
    own: Side,
    opp: Side,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): { value: number | undefined; measured: boolean } {
    const at = (pid: string, ids: readonly string[] = [], zone = "hand") =>
        ids.map((id) =>
            makeInstance(id, {
                controllerId: pid,
                ownerId: pid,
                zone: zone as "hand",
            })
        );
    const held = makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [held, ...at("p1", own.hand)],
                battlefield: at("p1", own.board, "battlefield"),
                library: at("p1", own.library, "library"),
            }),
            makePlayer("p2", {
                hand: at("p2", opp.hand),
                battlefield: at("p2", opp.board, "battlefield"),
                library: at("p2", opp.library, "library"),
            }),
        ],
    });
    const lens = handLatentLens(state, "p1", held, weights)!;
    const value = dslSpellScriptValue(getDefinition(cardId), lens);
    return { value, measured: lens.measured() };
}

const cards = (n: number, id: string) => Array.from({ length: n }, () => id);

describe("an each-player hand script reads the hands (issue #5162)", () => {
    const wheel = wheelOfFortune().id;
    const bear = grizzlyBears().id;

    it("Wheel of Fortune flips sign between seven cards against one and one against seven", () => {
        // CR 701.9 — every player discards their whole hand, then draws
        // seven. The draws net out; what the Wheel moves is whose hand was
        // worth more. Seven held against one is the caster's loss.
        const ahead = readOnBoard(
            wheel,
            { hand: cards(6, bear) },
            { hand: [bear] }
        );
        const behind = readOnBoard(wheel, {}, { hand: cards(7, bear) });
        expect(ahead.value).toBeLessThan(0);
        expect(behind.value).toBeGreaterThan(0);
        expect(ahead.measured && behind.measured).toBe(true);
    });

    it("reads ZERO when both hands are the same", () => {
        // Seven draws on each side, the same hand discarded on each side:
        // the sides cancel exactly. Reading only one side would not.
        const even = readOnBoard(
            wheel,
            { hand: cards(3, bear) },
            { hand: cards(3, bear) }
        );
        expect(even.value).toBeCloseTo(0, 9);
        expect(even.measured).toBe(true);
    });

    it("a whole hand shuffled into its library reads like a discarded one", () => {
        // `moveZone` hand → library on `$each`, then seven draws: the hand
        // leaves exactly as a Wheel's does, so the sign follows whose hand
        // was worth more.
        const def: CardDefinition = {
            id: "each-player-test:shuffle-in",
            name: "Each Player Shuffle In",
            rarity: "common",
            manaCost: { U: 1, generic: 2 },
            types: ["Sorcery"],
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "moveZone",
                            player: { ref: "$each" },
                            from: "hand",
                            to: "library",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: { ref: "$each" },
                        },
                        { op: "draw", player: { ref: "$each" }, count: 7 },
                    ],
                },
            ],
        };
        withTemporaryDefinition(def, () => {
            const ahead = readOnBoard(
                def.id,
                { hand: cards(6, bear) },
                { hand: [bear] }
            );
            const behind = readOnBoard(def.id, {}, { hand: cards(7, bear) });
            expect(ahead.value).toBeLessThan(0);
            expect(behind.value).toBeGreaterThan(0);
            expect(ahead.measured && behind.measured).toBe(true);
        });
    });

    it("context-free, the representative member stands", () => {
        // A draft pick has no board: no side can be read, the walker's one
        // representative walk is the reading, byte-identical to before.
        const def = wheelOfFortune();
        expect(contextFreeLatentLens().eachPlayerDifferential).toBeUndefined();
        expect(dslSpellScriptValue(def, contextFreeLatentLens())).toBe(
            dslSpellScriptValue(def)
        );
    });
});

describe("an each-player edict reads both boards (issue #5162)", () => {
    const blood = innocentBlood().id;
    const bear = grizzlyBears().id;

    it("Innocent Blood flips sign with who has the creatures", () => {
        // CR 701.21a — each player sacrifices a creature of their choice.
        // The caster with none and the opponent with two is a free removal
        // spell; the mirror is the caster's own loss.
        const free = readOnBoard(blood, {}, { board: [bear, bear] });
        const costly = readOnBoard(blood, { board: [bear, bear] }, {});
        expect(free.value).toBeGreaterThan(0);
        expect(costly.value).toBeLessThan(0);
        expect(free.measured && costly.measured).toBe(true);
    });

    it("each side gives up its CHEAPEST member", () => {
        // The opponent keeps its Shivan Dragon and sacrifices the Bears, so
        // against the caster's own Bears the edict is even.
        const even = readOnBoard(
            blood,
            { board: [bear] },
            { board: [bear, shivanDragon().id] }
        );
        expect(even.value).toBeCloseTo(0, 9);
    });

    it("counts only the members its filter names", () => {
        // A land is no creature: the opponent's Forests are not a victim.
        const none = readOnBoard(
            blood,
            {},
            { board: [forest().id, forest().id] }
        );
        expect(none.value).toBe(0);
        expect(none.measured).toBe(true);
    });
});

describe("a body the Differential cannot attribute keeps today's reading (issue #5162)", () => {
    /** The reading of `def` on two different boards must equal its
     *  context-free reading, and never be marked measured. */
    function expectRepresentative(def: CardDefinition) {
        const contextFree = dslSpellScriptValue(def);
        for (const [own, opp] of [
            [{ hand: cards(5, grizzlyBears().id) }, {}],
            [{}, { hand: cards(5, grizzlyBears().id) }],
        ] as [Side, Side][]) {
            const read = readOnBoard(def.id, own, opp);
            expect(read.value).toBe(contextFree);
            expect(read.measured).toBe(false);
        }
    }

    const sorcery = (id: string, effects: EffectOp[]): CardDefinition => ({
        id: `each-player-test:${id}`,
        name: `Each Player ${id}`,
        rarity: "common",
        manaCost: { R: 1, generic: 2 },
        types: ["Sorcery"],
        effects,
    });

    it("an each-OPPONENT script is not symmetric and is byte-identical", () => {
        // "Each opponent discards their hand, then draws two" names a fixed
        // side: no `$each`, no Differential.
        const def = sorcery("opponent", [
            { op: "discard", player: "opponent" },
            { op: "draw", player: "opponent", count: 2 },
        ]);
        withTemporaryDefinition(def, () => expectRepresentative(def));
    });

    it("a body of symmetric Ops only reads nothing off the board", () => {
        // "Each player draws two": the sides net out, and no side read the
        // board — the representative walk stands.
        const def = sorcery("draw", [
            {
                op: "forEach",
                select: { set: "players" },
                effects: [{ op: "draw", player: { ref: "$each" }, count: 2 }],
            },
        ]);
        withTemporaryDefinition(def, () => expectRepresentative(def));
    });

    it("an edict whose filter the lens cannot match exactly is fail-closed", () => {
        // A mana-value bound is not read: counting every creature, or none,
        // would both be guesses (the sweep lens's own rule).
        const def = sorcery("cheap-edict", [
            {
                op: "forEach",
                select: { set: "players" },
                simultaneous: true,
                effects: [
                    {
                        op: "choice",
                        kind: "sacrifice-permanents",
                        player: { ref: "$each" },
                        zone: "battlefield",
                        filter: { type: "Creature", manaValueAtMost: 3 },
                        count: 1,
                        prompt: "Sacrifice a creature.",
                        bind: "$sac",
                    },
                    { op: "sacrifice", permanents: { ref: "$sac" } },
                ],
            },
        ]);
        withTemporaryDefinition(def, () => expectRepresentative(def));
    });

    it("a body with an Op it cannot attribute is fail-closed", () => {
        // Timetwister also shuffles each graveyard into its library — a
        // graveyard term the hand read does not cover.
        expectRepresentative(timetwister());
    });
});

describe("a keep-N edict reads the members above the fewest (issue #5559)", () => {
    const bal = balance().id;
    const land = forest().id;
    const bear = grizzlyBears().id;

    it("Balance flips sign between five lands against two and two against five", () => {
        // CR 701.21a — each player sacrifices the lands above the fewest any
        // player controls. Five against two costs the caster three lands; the
        // mirror costs the opponent three.
        const ahead = readOnBoard(
            bal,
            { board: cards(5, land) },
            { board: cards(2, land) }
        );
        const behind = readOnBoard(
            bal,
            { board: cards(2, land) },
            { board: cards(5, land) }
        );
        expect(ahead.value).toBeLessThan(0);
        expect(behind.value).toBeGreaterThan(0);
        expect(ahead.measured && behind.measured).toBe(true);
    });

    it("reads ZERO on an even board", () => {
        // Nobody is above the fewest: no step takes anything.
        const even = readOnBoard(
            bal,
            { board: [land, land, bear], hand: [bear] },
            { board: [land, land, bear], hand: [bear] }
        );
        expect(even.value).toBe(0);
        expect(even.measured).toBe(true);
    });

    it("the caster's hand is counted without Balance itself", () => {
        // One card beside Balance against one card: Balance is on the stack
        // when the hands are counted, so the hands are even.
        const even = readOnBoard(bal, { hand: [bear] }, { hand: [bear] });
        expect(even.value).toBe(0);
    });

    it("a side gives up its CHEAPEST members above the fewest", () => {
        // The opponent keeps its Shivan Dragon and sacrifices the Bears down
        // to the caster's one creature: even against nothing taken from the
        // caster, the reading is one Bears' worth — the Dragon's would be
        // more.
        const keepsBest = readOnBoard(
            bal,
            { board: [bear] },
            { board: [bear, shivanDragon().id] }
        );
        const oneBear = readOnBoard(bal, {}, { board: [bear] });
        expect(keepsBest.value).toBeGreaterThan(0);
        expect(keepsBest.value).toBeCloseTo(oneBear.value!, 9);
    });
});

describe("a held Differential is a fitted fraction of the swing (issue #5560)", () => {
    it("scales Wheel of Fortune's reading by `heldDifferentialFraction`", () => {
        // Credited in full, the held price IS what the cast realises, and
        // casting ties holding at one ply: the Bot passed a Wheel against a
        // seven-card hand on every seed. The hand credits a fraction.
        const wheel = wheelOfFortune().id;
        const bear = grizzlyBears().id;
        const opp = { hand: cards(7, bear) };
        const full = readOnBoard(wheel, {}, opp, {
            ...DEFAULT_EVAL_WEIGHTS,
            heldDifferentialFraction: 1,
        });
        const held = readOnBoard(wheel, {}, opp);
        expect(full.value).toBeGreaterThan(0);
        expect(held.value).toBeCloseTo(
            DEFAULT_EVAL_WEIGHTS.heldDifferentialFraction * full.value!,
            9
        );
        expect(held.value).toBeLessThan(full.value!);
    });
});

describe("an each-player draw is priced off the drawing side's board (issue #5573)", () => {
    const wheel = wheelOfFortune().id;
    const bear = grizzlyBears().id;
    const land = forest().id;
    const bears = cards(20, bear);
    const forests = cards(20, land);

    const sorcery = (id: string, body: EffectOp[]): CardDefinition => ({
        id: `each-player-draw-test:${id}`,
        name: `Each Player Draw ${id}`,
        rarity: "common",
        manaCost: { R: 1, generic: 2 },
        types: ["Sorcery"],
        effects: [{ op: "forEach", select: { set: "players" }, effects: body }],
    });
    const each = { ref: "$each" } as const;

    it("Wheel of Fortune credits the side with the better library, and flips on the mirror", () => {
        // CR 701.9 / 121.1 — equal hands leave equally; the seven each player
        // draws are what differ: Bears off the top beat Forests.
        const better = readOnBoard(
            wheel,
            { hand: cards(3, bear), library: bears },
            { hand: cards(3, bear), library: forests }
        );
        const worse = readOnBoard(
            wheel,
            { hand: cards(3, bear), library: forests },
            { hand: cards(3, bear), library: bears }
        );
        expect(better.value).toBeGreaterThan(0);
        expect(worse.value).toBeLessThan(0);
        expect(better.measured && worse.measured).toBe(true);
    });

    it("a symmetric draw-only body reads the library gap too", () => {
        // "Each player draws two" (Faerie Mastermind's, Urza's Guilt's first
        // step): no longer netted to zero by a flat magnitude.
        const def = sorcery("draw-two", [
            { op: "draw", player: each, count: 2 },
        ]);
        withTemporaryDefinition(def, () => {
            const better = readOnBoard(
                def.id,
                { library: bears },
                { library: forests }
            );
            const worse = readOnBoard(
                def.id,
                { library: forests },
                { library: bears }
            );
            expect(better.value).toBeGreaterThan(0);
            expect(worse.value).toBeLessThan(0);
            expect(better.measured && worse.measured).toBe(true);
        });
    });

    it("Wheel's seven land in the hand its discard emptied", () => {
        // The caster holds seven Forests, the opponent nothing; both draw
        // Bears. Into the emptied hand both sides keep seven Bears, so the
        // draws cancel and the Wheel reads exactly its discard. Read into the
        // seven Forests still held, the caster's cleanup discard (CR 514.1)
        // would eat the gain and the Wheel would read lower.
        const discardOnly = sorcery("discard", [
            { op: "discard", player: each },
        ]);
        const board: [Side, Side] = [
            { hand: cards(7, land), library: bears },
            { library: bears },
        ];
        withTemporaryDefinition(discardOnly, () => {
            const wheelRead = readOnBoard(wheel, ...board);
            const discardRead = readOnBoard(discardOnly.id, ...board);
            expect(wheelRead.measured).toBe(true);
            expect(wheelRead.value).toBeCloseTo(discardRead.value!, 9);
        });
    });

    it("a counted discard shrinks the hand the draw lands in", () => {
        // Each player discards three, then draws three. The caster's six
        // Bears go to three, so its three Bears are all kept, as the
        // opponent's are into an empty hand: the draws cancel and the body
        // reads exactly its discard.
        const edict: EffectOp[] = [
            {
                op: "choice",
                kind: "discard-hand",
                player: each,
                zone: "hand",
                count: 3,
                prompt: "Discard three cards.",
                bind: "$discarded",
            },
            { op: "discard", player: each, cards: { ref: "$discarded" } },
        ];
        const discardThenDraw = sorcery("discard-then-draw", [
            ...edict,
            { op: "draw", player: each, count: 3 },
        ]);
        const discardOnly = sorcery("discard-three", edict);
        const board: [Side, Side] = [
            { hand: cards(6, bear), library: bears },
            { library: bears },
        ];
        withTemporaryDefinition(discardThenDraw, () =>
            withTemporaryDefinition(discardOnly, () => {
                const both = readOnBoard(discardThenDraw.id, ...board);
                const discard = readOnBoard(discardOnly.id, ...board);
                expect(both.measured).toBe(true);
                expect(both.value).toBeCloseTo(discard.value!, 9);
            })
        );
    });

    it("Winds of Change draws back as many cards as each hand shuffled in", () => {
        // CR 701.24 — each player's three cards go into a library of Forests
        // and three come back off it: the caster's Bears are worth more than
        // the opponent's Forests, and the draw-back is credited. The reading
        // sits above the shuffle-in alone, at exactly a literal draw of three
        // on each side: the count is each side's own hand.
        const shuffleOnly = sorcery("shuffle-only", [
            { op: "moveZone", player: each, from: "hand", to: "library" },
            { op: "libraryLook", action: "shuffle", player: each },
        ]);
        const drawThree = sorcery("shuffle-draw-three", [
            { op: "moveZone", player: each, from: "hand", to: "library" },
            { op: "libraryLook", action: "shuffle", player: each },
            { op: "draw", player: each, count: 3 },
        ]);
        const board: [Side, Side] = [
            { hand: cards(3, bear), library: forests },
            { hand: cards(3, land), library: forests },
        ];
        withTemporaryDefinition(shuffleOnly, () =>
            withTemporaryDefinition(drawThree, () => {
                const winds = readOnBoard(windsOfChange().id, ...board);
                const shuffled = readOnBoard(shuffleOnly.id, ...board);
                const literal = readOnBoard(drawThree.id, ...board);
                expect(winds.measured).toBe(true);
                expect(winds.value).toBeGreaterThan(shuffled.value!);
                expect(winds.value).toBeCloseTo(literal.value!, 9);
            })
        );
    });
});
