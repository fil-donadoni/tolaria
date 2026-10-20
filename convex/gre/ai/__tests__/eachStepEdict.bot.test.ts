// Standing each-step engines beyond draw and life (issue #5575, ADR 0151,
// PRD #5160).
//
// The defect: Destructive Flow's trigger has the player whose upkeep it is
// sacrifice a nonbasic land (`$event.activePlayerId`, `phaseScope: "each"`,
// CR 603.2b), and the walker read it ONCE, as an edict on the opponent — a
// fixed positive sign, the same on the board where its controller is the
// only player with nonbasic lands. On a real board the edict is now read per
// side (`EachPlayerSide.sacrificeUnits`, CR 701.21a: each player sacrifices
// its own cheapest), the opponent's loss minus the controller's. Every other
// standing script on the scoped player that the Differential cannot read
// reads NOTHING and keeps its Latent Floor, never the representative sign.
// Issues #5624, #5625, #5626, #5627 and #5628 read the remaining shipped
// families per side (a discard at random, a mill, mana, a library reveal, a
// bounce); a bound mill stands in for a family no side reader prices.
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
import {
    dslAbilityScriptValue,
    dslStandingAbilityScriptValue,
} from "../cardScriptValue";
import { contextFreeGrounding } from "../grounding";
import { isEachStepEngineScript, isEachStepScopedScript } from "../opValuers";
import { forest, tundra } from "../../../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { destructiveFlow } from "../../../cards/sets/pls/multicolor.cards";

const FLOW = destructiveFlow().id;
const BASIC = forest().id;
const NONBASIC = tundra().id;
const BEAR = grizzlyBears().id;

interface Side {
    nonbasics: number;
    flow?: "board" | "hand";
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

/** p1 controls (or holds) Destructive Flow; each side controls three
 *  Forests and `nonbasics` Tundras, two Grizzly Bears in hand. */
function board(own: Side, opp: Side): GameState {
    const side = (pid: string, s: Side) =>
        makePlayer(pid, {
            hand: [
                ...cards(pid, BEAR, 2, "hand"),
                ...(s.flow === "hand" ? cards(pid, FLOW, 1, "hand") : []),
            ],
            library: cards(pid, BEAR, 20, "library"),
            battlefield: [
                ...(s.flow === "board"
                    ? cards(pid, FLOW, 1, "battlefield")
                    : []),
                ...cards(pid, BASIC, 3, "battlefield"),
                ...cards(pid, NONBASIC, s.nonbasics, "battlefield"),
            ],
        });
    return makeState({ players: [side("p1", own), side("p2", opp)] });
}

/** Destructive Flow's own worth on p1's board: its realised value minus the
 *  flat presence every permanent carries. */
function flowWorth(state: GameState): number {
    const flow = state.players[0].battlefield[0];
    return (
        permanentRealisedValue(state, flow) -
        DEFAULT_EVAL_WEIGHTS.permanentWeight
    );
}

describe("a standing each-step edict reads the board (issue #5575)", () => {
    it("Destructive Flow is worth what it takes from the side with nonbasic lands, and the sign flips on the mirror", () => {
        // CR 701.21a — each player sacrifices its own: a player with only
        // basics gives up nothing.
        const theirs = board({ nonbasics: 0, flow: "board" }, { nonbasics: 2 });
        const mine = board({ nonbasics: 2, flow: "board" }, { nonbasics: 0 });
        expect(flowWorth(theirs)).toBeGreaterThan(0);
        expect(flowWorth(mine)).toBeLessThan(0);
        for (const s of [theirs, mine]) {
            expect(Math.abs(flowWorth(s))).toBeLessThan(
                MAX_LATENT_SCRIPT_VALUE
            );
        }
    });

    it("hand face equals board face on the same board, whatever the sign", () => {
        const faces = (own: number, opp: number) => {
            const held = board(
                { nonbasics: own, flow: "hand" },
                { nonbasics: opp }
            );
            const inHand = held.players[0].hand.find(
                (c) => String(c.card.id) === FLOW
            )!;
            return {
                handFace: cardValue(
                    held,
                    inHand,
                    handLatentLens(held, "p1", inHand)
                ),
                boardFace: flowWorth(
                    board({ nonbasics: own, flow: "board" }, { nonbasics: opp })
                ),
            };
        };
        const takes = faces(0, 2);
        expect(takes.handFace).toBeGreaterThan(0);
        expect(takes.handFace).toBeCloseTo(takes.boardFace, 6);
        const costs = faces(2, 0);
        expect(costs.handFace).toBeLessThan(0);
        expect(costs.handFace).toBeCloseTo(costs.boardFace, 6);
    });
});

/** Every catalogue trigger on every player's step whose script names the
 *  scoped player beyond the life family (issue #5574's), as a definition
 *  carrying that trigger alone — so no other ability of the card speaks. */
function scopedEngines(): { name: string; def: CardDefinition }[] {
    const out: { name: string; def: CardDefinition }[] = [];
    for (const def of registeredDefinitions()) {
        for (const t of def.triggeredAbilities ?? []) {
            const script = t.effects ?? t.aiEffects;
            if (t.phaseScope !== "each" || !script) continue;
            if (!isEachStepScopedScript(script)) continue;
            out.push({
                name: def.name,
                def: {
                    ...def,
                    activatedAbilities: [],
                    staticAbilities: [],
                    triggeredAbilities: [t],
                },
            });
        }
    }
    return out;
}

const BOUND_MILL = "a bound mill";

/** Worry Beads with its mill bound — a script on the scoped player no side
 *  reader prices (`isStepSideOp`: a bound mill feeds a later Op), so the
 *  census below keeps an unread member once every shipped family is read. */
function boundMillEngine(): { name: string; def: CardDefinition } {
    const beads = [...registeredDefinitions()].find(
        (d) => d.name === "Worry Beads"
    )!;
    const trigger = beads.triggeredAbilities![0];
    return {
        name: BOUND_MILL,
        def: {
            ...beads,
            activatedAbilities: [],
            staticAbilities: [],
            triggeredAbilities: [
                {
                    ...trigger,
                    effects: trigger.effects!.map((op) =>
                        op.op === "mill" ? { ...op, bind: "milled" } : op
                    ),
                },
            ],
        },
    };
}

describe("no standing each-step script takes the representative sign (issue #5575)", () => {
    const engines = scopedEngines();

    it("the census finds the shipped engines beyond draw and life", () => {
        const names = new Set(engines.map((e) => e.name));
        for (const name of [
            "Destructive Flow",
            "Mana Vortex",
            "Bottomless Pit",
            "Worry Beads",
            "Oath of Druids",
            "Sunken Hope",
            "Eladamri's Vineyard",
            "Howling Mine",
        ]) {
            expect(names, name).toContain(name);
        }
    });

    it("context-free, every one reads nothing", () => {
        // ADR 0151 §1 — no board, no sides: the engine carries no fixed sign.
        for (const { name, def } of engines) {
            expect(dslStandingAbilityScriptValue(def), name).toBeUndefined();
            expect(dslAbilityScriptValue(def), name).toBe(0);
        }
    });

    it("on a board, a family the Differential does not read yet reads nothing", () => {
        const state = board({ nonbasics: 1 }, { nonbasics: 1 });
        const anchor = state.players[0].hand[0];
        const lens = handLatentLens(state, "p1", anchor)!;
        const unread = [...engines, boundMillEngine()].filter(({ def }) => {
            const script = def.triggeredAbilities![0];
            return !isEachStepEngineScript(
                (script.effects ?? script.aiEffects)!
            );
        });
        const names = unread.map((e) => e.name);
        // Issue #5625 — the mill family was the last shipped one unread; the
        // bound variant keeps this reading non-vacuous.
        expect(names).toContain(BOUND_MILL);
        // Issue #5627 — the library to battlefield family is read per side.
        expect(names).not.toContain("Oath of Druids");
        // Issue #5625 — the mill family is read per side.
        expect(names).not.toContain("Worry Beads");
        for (const { name, def } of unread) {
            expect(
                dslStandingAbilityScriptValue(
                    def,
                    contextFreeGrounding(),
                    lens
                ),
                name
            ).toBeUndefined();
        }
    });
});
