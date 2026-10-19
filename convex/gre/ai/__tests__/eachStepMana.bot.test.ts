// Standing each-step MANA engines (issue #5626, ADR 0151, PRD #5160; slice
// of issue #5575).
//
// The defect: Eladamri's Vineyard has the player whose first main phase it
// is add {G}{G} (`$event.activePlayerId`, `phaseScope: "each"`, CR 603.2b),
// and the walker could not read it per side — so it read NOTHING and kept
// its Latent Floor (issue #5575), the same worth on every board. On a real
// board the mana is now read per side (`EachPlayerSide.manaUnits`): worth to
// a player only what its hand can spend of it beyond its own mana base —
// nothing when that base already casts everything it holds (CR 106.4, the
// unspent mana empties at the end of the phase). The Vineyard helps the
// player whose hand is stuck behind its lands.
//
// Readings run through the PRODUCTION leaf (`permanentRealisedValue`,
// `cardValue` with the hand term's lens) over real registry definitions.
import { describe, expect, it } from "vitest";
import { registeredDefinitions } from "../../../cards";
import type { CardDefinition } from "../../../cards/types";
import type { CardInstanceState, GameState } from "../../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import {
    cardValue,
    handLatentLens,
    permanentRealisedValue,
} from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { MAX_LATENT_SCRIPT_VALUE } from "../../cardValue";
import { isEachStepEngineScript } from "../opValuers";
import { dslStandingAbilityScriptValue } from "../cardScriptValue";
import { contextFreeGrounding } from "../grounding";
import { PLACEHOLDER_CARD_ID } from "../../constants";
import { forest } from "../../../cards/sets/lea/colorless.cards";
import { crawWurm, grizzlyBears } from "../../../cards/sets/lea/green.cards";

function byName(name: string): CardDefinition {
    for (const def of registeredDefinitions()) {
        if (def.name === name) return def;
    }
    throw new Error(`${name} is not in the catalogue`);
}

const VINEYARD = byName("Eladamri's Vineyard").id;
const MAGUS = byName("Magus of the Vineyard").id;
const FOREST = forest().id;
// {4}{G}{G}: out of reach of four Forests, cast with the engine's {G}{G}.
const WURM = crawWurm().id;
// {1}{G}: four Forests already cast it, the engine's mana goes unspent.
const BEAR = grizzlyBears().id;

interface Side {
    /** The card in hand: one the side's lands cannot cast alone, or one
     *  they can. */
    holds: "stuck" | "castable";
    engine?: { id: string; where: "board" | "hand" };
}

function cards(
    pid: string,
    id: string,
    n: number,
    where: CardInstanceState["zone"]
): CardInstanceState[] {
    return Array.from({ length: n }, () =>
        makeInstance(id, { controllerId: pid, ownerId: pid, zone: where })
    );
}

/** p1 controls (or holds) the engine; each side controls four Forests and
 *  holds one card. */
function board(own: Side, opp: Side): GameState {
    const side = (pid: string, s: Side) =>
        makePlayer(pid, {
            hand: [
                ...cards(pid, s.holds === "stuck" ? WURM : BEAR, 1, "hand"),
                ...(s.engine?.where === "hand"
                    ? cards(pid, s.engine.id, 1, "hand")
                    : []),
            ],
            library: cards(pid, BEAR, 20, "library"),
            battlefield: [
                ...(s.engine?.where === "board"
                    ? cards(pid, s.engine.id, 1, "battlefield")
                    : []),
                ...cards(pid, FOREST, 4, "battlefield"),
            ],
        });
    return makeState({ players: [side("p1", own), side("p2", opp)] });
}

/** The engine's realised value on p1's board (its first permanent). */
function engineValue(state: GameState): number {
    return permanentRealisedValue(state, state.players[0].battlefield[0]);
}

describe("a standing each-step mana engine reads the board (issue #5626)", () => {
    it("the family is read by the Differential, and every member fires in the first main phase", () => {
        // The side reader prices the mana as spent off the hand in a main
        // phase (`EachPlayerSide.manaUnits`): an engine adding mana in any
        // other step would read casts it cannot make.
        const family = new Set<string>();
        for (const def of registeredDefinitions()) {
            for (const t of def.triggeredAbilities ?? []) {
                const script = t.effects ?? t.aiEffects;
                if (t.phaseScope !== "each" || !script) continue;
                if (!isEachStepEngineScript(script)) continue;
                if (!script.some((op) => op.op === "addMana")) continue;
                family.add(def.name);
                expect(t.phaseStep, def.name).toBe("PRECOMBAT_MAIN");
            }
        }
        expect([...family].sort()).toEqual([
            "Eladamri's Vineyard",
            "Magus of the Vineyard",
        ]);
    });

    it("Eladamri's Vineyard is worth what it lets the opponent cast, and the sign flips on the mirror", () => {
        const engine = { id: VINEYARD, where: "board" as const };
        const feedsThem = board(
            { holds: "castable", engine },
            { holds: "stuck" }
        );
        const feedsMe = board(
            { holds: "stuck", engine },
            { holds: "castable" }
        );
        const worth = (s: GameState) =>
            engineValue(s) - DEFAULT_EVAL_WEIGHTS.permanentWeight;
        expect(worth(feedsThem)).toBeLessThan(0);
        expect(worth(feedsMe)).toBeGreaterThan(0);
        // CR 106.4 — mana nobody's hand spends is worth nothing either way.
        const neither = board(
            { holds: "castable", engine },
            { holds: "castable" }
        );
        expect(worth(neither)).toBe(0);
        for (const s of [feedsThem, feedsMe]) {
            expect(Math.abs(worth(s))).toBeLessThan(MAX_LATENT_SCRIPT_VALUE);
        }
    });

    it("Magus of the Vineyard's realised reading is the same script: its body fixed, the engine moves it", () => {
        const engine = { id: MAGUS, where: "board" as const };
        const feedsThem = board(
            { holds: "castable", engine },
            { holds: "stuck" }
        );
        const feedsMe = board(
            { holds: "stuck", engine },
            { holds: "castable" }
        );
        const neither = board(
            { holds: "castable", engine },
            { holds: "castable" }
        );
        expect(engineValue(feedsThem)).toBeLessThan(engineValue(neither));
        expect(engineValue(feedsMe)).toBeGreaterThan(engineValue(neither));
    });

    it("hand face equals board face on the same board, whatever the sign", () => {
        const faces = (own: Side["holds"], opp: Side["holds"]) => {
            const held = board(
                { holds: own, engine: { id: VINEYARD, where: "hand" } },
                { holds: opp }
            );
            const inHand = held.players[0].hand.find(
                (c) => String(c.card.id) === VINEYARD
            )!;
            return {
                handFace: cardValue(
                    held,
                    inHand,
                    handLatentLens(held, "p1", inHand)
                ),
                boardFace:
                    engineValue(
                        board(
                            {
                                holds: own,
                                engine: { id: VINEYARD, where: "board" },
                            },
                            { holds: opp }
                        )
                    ) - DEFAULT_EVAL_WEIGHTS.permanentWeight,
            };
        };
        const helps = faces("stuck", "castable");
        expect(helps.handFace).toBeGreaterThan(0);
        expect(helps.handFace).toBeCloseTo(helps.boardFace, 6);
        const hurts = faces("castable", "stuck");
        expect(hurts.handFace).toBeLessThan(0);
        expect(hurts.handFace).toBeCloseTo(hurts.boardFace, 6);
    });

    it("the card being valued is not its own stuck card: a landless hand holding only the Vineyard reads nothing spent", () => {
        // Casting the Vineyard takes it out of the hand; read against itself
        // ({G}, out of reach of no lands) it would be the card its own mana
        // pays for.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: cards("p1", VINEYARD, 1, "hand"),
                    library: cards("p1", BEAR, 20, "library"),
                }),
                makePlayer("p2", { library: cards("p2", BEAR, 20, "library") }),
            ],
        });
        const inHand = state.players[0].hand[0];
        expect(
            cardValue(state, inHand, handLatentLens(state, "p1", inHand))
        ).toBeCloseTo(0, 9);
    });

    it("a hidden hand voids the reading: the engine reads nothing, never a guess", () => {
        // A blind seat's hand is placeholders: no cost to read, so the side
        // is unreadable and the Differential falls back (ADR 0151 §1).
        const def = byName("Eladamri's Vineyard");
        const read = (hidden: boolean) => {
            const state = board(
                { holds: "stuck", engine: { id: VINEYARD, where: "hand" } },
                { holds: "castable" }
            );
            if (hidden) {
                const opp = state.players[1];
                opp.hand = opp.hand.map((c) => ({
                    ...c,
                    card: { ...c.card, id: PLACEHOLDER_CARD_ID },
                }));
            }
            const anchor = state.players[0].hand.find(
                (c) => String(c.card.id) === VINEYARD
            )!;
            return dslStandingAbilityScriptValue(
                def,
                contextFreeGrounding(),
                handLatentLens(state, "p1", anchor)!
            );
        };
        expect(read(false)).toBeGreaterThan(0);
        expect(read(true)).toBeUndefined();
    });
});
