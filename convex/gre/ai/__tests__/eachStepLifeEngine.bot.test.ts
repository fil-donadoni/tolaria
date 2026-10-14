// Differential Reading of a standing LIFE engine on every player's step
// (issue #5574, ADR 0151, PRD #5160; follow-up of issue #5164).
//
// The defect: Karma's trigger deals damage to `$event.activePlayerId` — every
// player in turn (CR 603.2b, `phaseScope: "each"`) — equal to the Swamps THAT
// player controls. With no `draw` in the script it failed the #5164 engine
// predicate and fell back to the representative walk, which reads the scoped
// player as one fixed player: a fixed sign on every board. On a real board
// the engine is now read per side, the amount grounded on that side's own
// board (a count, a Domain, a CR 603.4 intervening-if), priced at
// `lifeSwing`: Karma helps the player with fewer Swamps.
//
// Every reading runs through the PRODUCTION leaf (`evaluate`,
// `permanentRealisedValue`, `cardValue` with the hand term's lens) over real
// registry definitions, and asserts a direction, never a constant.
import { describe, expect, it } from "vitest";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { UNDECIDABLE_TRIGGER_GATE } from "../../../cards/types";
import type { CardInstanceState, GameState } from "../../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import {
    cardValue,
    evaluate,
    handLatentLens,
    permanentRealisedValue,
} from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { cardValueById, MAX_LATENT_SCRIPT_VALUE } from "../../cardValue";
import { nonCreatureBodyRaw } from "../../creatureBody";
import {
    registeredDefinitions,
    withTemporaryDefinition,
} from "../../../cards/registry";
import {
    copperTablet,
    forest,
    island,
    mountain,
    plains,
    swamp,
} from "../../../cards/sets/lea/colorless.cards";
import { karma } from "../../../cards/sets/lea/white.cards";
import { spiritualSanctuary } from "../../../cards/sets/leg/white.cards";
import { collapsingBorders } from "../../../cards/sets/inv/red.cards";

const KARMA = karma().id;
const TABLET = copperTablet().id;
const SANCTUARY = spiritualSanctuary().id;
const BORDERS = collapsingBorders().id;
const SWAMP = swamp().id;
const FOREST = forest().id;
const FIVE_TYPES = [plains().id, island().id, SWAMP, mountain().id, FOREST];

function maskOfIntolerance(): CardDefinition {
    for (const def of registeredDefinitions()) {
        if (def.name === "Mask of Intolerance") return def;
    }
    throw new Error("Mask of Intolerance is not in the catalogue");
}

interface Side {
    lands: readonly string[];
    engine?: "board" | "hand";
}

function cards(
    pid: string,
    ids: readonly string[],
    where: CardInstanceState["zone"]
): CardInstanceState[] {
    return ids.map((id) =>
        makeInstance(id, { controllerId: pid, ownerId: pid, zone: where })
    );
}

/** p1 controls (or holds) `engine`; each side's battlefield holds `lands`,
 *  its hand two Forests and its library ten. */
function board(engine: string, own: Side, opp: Side): GameState {
    const side = (pid: string, s: Side) =>
        makePlayer(pid, {
            hand: [
                ...cards(pid, [FOREST, FOREST], "hand"),
                ...(s.engine === "hand" ? cards(pid, [engine], "hand") : []),
            ],
            library: cards(pid, Array(10).fill(FOREST), "library"),
            battlefield: [
                ...(s.engine === "board"
                    ? cards(pid, [engine], "battlefield")
                    : []),
                ...cards(pid, s.lands, "battlefield"),
            ],
        });
    return makeState({ players: [side("p1", own), side("p2", opp)] });
}

/** The engine's own worth on p1's board: its realised value minus the flat
 *  presence every permanent carries. */
function engineWorth(state: GameState): number {
    const perm = state.players[0].battlefield[0];
    return (
        permanentRealisedValue(state, perm) -
        DEFAULT_EVAL_WEIGHTS.permanentWeight
    );
}

const swamps = (n: number) => Array(n).fill(SWAMP);
const forests = (n: number) => Array(n).fill(FOREST);

describe("a standing each-step life engine reads the board (issue #5574)", () => {
    it("Karma helps the side with fewer Swamps, and the sign flips on the mirror board", () => {
        const helps = board(
            KARMA,
            { lands: forests(4), engine: "board" },
            { lands: swamps(4) }
        );
        const hurts = board(
            KARMA,
            { lands: swamps(4), engine: "board" },
            { lands: forests(4) }
        );
        expect(engineWorth(helps)).toBeGreaterThan(0);
        expect(engineWorth(hurts)).toBeLessThan(0);
        for (const s of [helps, hurts]) {
            expect(Math.abs(engineWorth(s))).toBeLessThan(
                MAX_LATENT_SCRIPT_VALUE
            );
        }
    });

    it("the position score with Karma beats the one without it only when the opponent has more Swamps", () => {
        const delta = (own: Side["lands"], opp: Side["lands"]) =>
            evaluate(
                board(KARMA, { lands: own, engine: "board" }, { lands: opp }),
                "p1"
            ) - evaluate(board(KARMA, { lands: own }, { lands: opp }), "p1");
        expect(delta(forests(4), swamps(4))).toBeGreaterThan(0);
        expect(delta(swamps(4), forests(4))).toBeLessThan(0);
    });

    it("hand face equals board face for Karma on the same board, whatever the sign", () => {
        // ADR 0151 / issue #5145 — casting Karma moves its worth from the
        // hand term to the board term unchanged.
        const faces = (own: Side["lands"], opp: Side["lands"]) => {
            const held = board(
                KARMA,
                { lands: own, engine: "hand" },
                { lands: opp }
            );
            const inHand = held.players[0].hand.find(
                (c) => String(c.card.id) === KARMA
            )!;
            return {
                handFace: cardValue(
                    held,
                    inHand,
                    handLatentLens(held, "p1", inHand)
                ),
                boardFace: engineWorth(
                    board(
                        KARMA,
                        { lands: own, engine: "board" },
                        { lands: opp }
                    )
                ),
            };
        };
        const helps = faces(forests(4), swamps(4));
        expect(helps.handFace).toBeGreaterThan(0);
        expect(helps.handFace).toBeCloseTo(helps.boardFace, 6);
        const hurts = faces(swamps(4), forests(4));
        expect(hurts.handFace).toBeLessThan(0);
        expect(hurts.handFace).toBeCloseTo(hurts.boardFace, 6);
    });

    it("Collapsing Borders grounds its Domain on each side: it helps the five-colour side", () => {
        // CR 305.6 — 1 life per basic land type among THAT player's lands,
        // then 3 damage: +2 a turn on five types, -2 on one.
        const helps = board(
            BORDERS,
            { lands: FIVE_TYPES, engine: "board" },
            { lands: forests(5) }
        );
        const hurts = board(
            BORDERS,
            { lands: forests(5), engine: "board" },
            { lands: FIVE_TYPES }
        );
        expect(engineWorth(helps)).toBeGreaterThan(0);
        expect(engineWorth(hurts)).toBeLessThan(0);
    });

    it("an intervening-if is decided per side: Spiritual Sanctuary feeds only the Plains player", () => {
        // CR 603.4 — "if that player controls a Plains".
        const p = plains().id;
        expect(
            engineWorth(
                board(
                    SANCTUARY,
                    { lands: [p], engine: "board" },
                    { lands: forests(1) }
                )
            )
        ).toBeGreaterThan(0);
        expect(
            engineWorth(
                board(
                    SANCTUARY,
                    { lands: forests(1), engine: "board" },
                    { lands: [p] }
                )
            )
        ).toBeLessThan(0);
    });

    it("Mask of Intolerance's compiled condition is decided per side: it hurts only the four-type player", () => {
        // CR 603.4 / 305.6 — "if there are four or more basic land types
        // among lands that player controls".
        const mask = maskOfIntolerance().id;
        expect(
            engineWorth(
                board(
                    mask,
                    { lands: forests(5), engine: "board" },
                    { lands: FIVE_TYPES }
                )
            )
        ).toBeGreaterThan(0);
        expect(
            engineWorth(
                board(
                    mask,
                    { lands: FIVE_TYPES, engine: "board" },
                    { lands: forests(5) }
                )
            )
        ).toBeLessThan(0);
    });

    it("a literal amount nets to a MEASURED zero: Copper Tablet drops its Latent Floor on a board", () => {
        // ADR 0151 rule 2 — a measured script reads its own number, and the
        // same 1 damage on every upkeep is worth nothing to either side.
        const tablet = board(
            TABLET,
            { lands: forests(2), engine: "board" },
            { lands: forests(2) }
        );
        expect(engineWorth(tablet)).toBeCloseTo(0, 6);
    });

    it("context-free, the life engines carry no fixed sign: they read nothing and keep the Latent Floor", () => {
        // ADR 0151 §1 — no board, no sides.
        expect(cardValueById(KARMA)).toBe(nonCreatureBodyRaw(4));
        expect(cardValueById(TABLET)).toBe(nonCreatureBodyRaw(2));
        expect(cardValueById(SANCTUARY)).toBe(nonCreatureBodyRaw(4));
        expect(cardValueById(BORDERS)).toBe(nonCreatureBodyRaw(4));
    });

    describe("fail-closed: a side the board cannot answer leaves the engine unread", () => {
        /** Karma with its one trigger rewritten by `edit`, same id. */
        function karmaVariant(
            edit: (
                t: NonNullable<CardDefinition["triggeredAbilities"]>[number]
            ) => NonNullable<CardDefinition["triggeredAbilities"]>[number]
        ): CardDefinition {
            const def = karma();
            return {
                ...def,
                triggeredAbilities: def.triggeredAbilities!.map(edit),
            };
        }
        const helps = () =>
            board(
                KARMA,
                { lands: forests(4), engine: "board" },
                { lands: swamps(4) }
            );

        it("an amount no side can ground (a graveyard count) reads nothing and keeps the floor", () => {
            const graveyardCount: EffectOp = {
                op: "dealDamage",
                amount: {
                    count: {
                        zone: "graveyard",
                        controller: { ref: "$event.activePlayerId" },
                    },
                },
                to: { player: { ref: "$event.activePlayerId" } },
            };
            const variant = karmaVariant((t) => ({
                ...t,
                effects: [graveyardCount],
            }));
            withTemporaryDefinition(variant, () => {
                expect(engineWorth(helps())).toBe(nonCreatureBodyRaw(4));
            });
        });

        it("a check-time condition with no intervening-if to ask reads nothing and keeps the floor", () => {
            const variant = karmaVariant((t) => ({
                ...t,
                gate: UNDECIDABLE_TRIGGER_GATE,
            }));
            withTemporaryDefinition(variant, () => {
                expect(engineWorth(helps())).toBe(nonCreatureBodyRaw(4));
            });
        });
    });
});
