// An ETB Ability is spent on entering (issue #4758, PRD #4754; CONTEXT.md
// "ETB Ability"): CR 603.6a "When [this object] enters" — counted in a card's
// latent Card Value (hand, library, graveyard, playable exile) and never in
// its realized one on the battlefield, where what it did is already in the
// state it left behind.
//
// Three seams carry it, and each has its pins here:
//
//  1. the value model (`cardScriptValue.ts`): the realized reading skips an
//     ETB Ability, the latent one counts it undiscounted, and a creature
//     whose own ETB sacrifices it keeps no latent body;
//  2. the 1-ply policy probe (`policyProbeState`, the rollout policy AND the
//     Eval Pair bridge the Weight Fit reads): a cast settles the triggers its
//     resolution puts on the stack, the mover's own target announcement
//     included (CR 603.3d), so what the ETB did is in the scored state;
//  3. the Eval Pairs the issue names — the board after the right move
//     against the board after the other, through that same probe.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { cloneGameState } from "../../clone";
import {
    enumerateMoves,
    enumerateRaisedTargetMoves,
    type Move,
} from "../../moves";
import { resolveTopOfStack } from "../../state";
import {
    evaluate,
    evaluateBreakdown,
    permanentRealisedValue,
} from "../../evaluate";
import { applyMoveInSearch, policyValue } from "../../search";
import { buildPositionFromSpec } from "../blade/build";
import { findBladeScenario } from "../blade/registry";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import {
    dslAbilityScriptValue,
    dslRealizedAbilityScriptValue,
    etbSelfSacrificeWeight,
} from "../cardScriptValue";
import { cardValueById, creatureValueRaw } from "../../cardValue";
import { EVOKE_SACRIFICE_TRIGGER_ID } from "../../../cards/abilities/evoke";
import { manaValue } from "../../constants";
import { latentGraveyardValue } from "../graveyardReach";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";

type SpecCard = ScenarioSpec["cards"][number];

function position(cards: SpecCard[]): GameState {
    return buildPositionFromSpec({
        cards,
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    });
}

/** The 1-ply policy value of `pick` in `state` for the player to act — the
 *  exact number the rollout policy and the Eval Pair bridge read. */
function policyOf(state: GameState, pick: (m: Move) => boolean): number {
    const me = state.activePlayerId;
    const move = enumerateMoves(state, me).find(pick);
    if (!move) throw new Error("no such move in this position");
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, me, move);
    return policyValue(probe, me, move, DEFAULT_EVAL_WEIGHTS, me);
}

const isPass = (m: Move) => m.kind === "pass";

function castOf(state: GameState, name: string): (m: Move) => boolean {
    const id = getCardByName(name).id;
    const inHand = state.players
        .flatMap((p) => p.hand)
        .find((c) => (c.card as { id?: string }).id === id);
    if (!inHand) throw new Error(`${name} is not in a hand`);
    return (m) => m.kind === "cast-spell" && m.cardInstanceId === inHand.id;
}

const inHand = (name: string): SpecCard => ({
    name,
    owner: "me",
    zone: "hand",
});
const onBoard = (name: string, owner: "me" | "opp"): SpecCard => ({
    name,
    owner,
    zone: "battlefield",
    summoningSick: false,
});

describe("Eval Pairs — an ETB Ability is spent on entering (issue #4758)", () => {
    it("Flametongue Kavu held beats Flametongue Kavu cast with no opposing creature (its ETB can only hit its own side)", () => {
        const s = position([
            inHand("Flametongue Kavu"),
            onBoard("Grizzly Bears", "me"),
        ]);
        expect(policyOf(s, isPass)).toBeGreaterThan(
            policyOf(s, castOf(s, "Flametongue Kavu"))
        );
    });

    it("Flametongue Kavu cast into an opposing creature worth killing beats holding it", () => {
        const s = position([
            inHand("Flametongue Kavu"),
            onBoard("Serra Angel", "opp"),
        ]);
        expect(policyOf(s, castOf(s, "Flametongue Kavu"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });

    it("Skyclave Apparition held beats casting it with nothing to exile", () => {
        const s = position([inHand("Skyclave Apparition")]);
        expect(policyOf(s, isPass)).toBeGreaterThan(
            policyOf(s, castOf(s, "Skyclave Apparition"))
        );
    });

    it("Skyclave Apparition cast into a permanent worth exiling beats holding it", () => {
        const s = position([
            inHand("Skyclave Apparition"),
            onBoard("Hill Giant", "opp"),
        ]);
        expect(policyOf(s, castOf(s, "Skyclave Apparition"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });
});

describe("Eval Pairs — a removal ETB's potential is priced at a victim of its target's type (issue #4903)", () => {
    // Before issue #4903 every ETB's Representative Victim was a vanilla 2/2,
    // whatever its `targetRequirement` named, so "destroy target enchantment"
    // in hand was worth a creature kill and outweighed every enchantment,
    // artifact or land it could actually hit: holding the card scored above
    // casting it into a real target.
    it("Monk Realist cast into an opposing Glorious Anthem beats holding it (enchantment)", () => {
        const s = position([
            inHand("Monk Realist"),
            onBoard("Glorious Anthem", "opp"),
        ]);
        expect(policyOf(s, castOf(s, "Monk Realist"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });

    it("Viridian Shaman cast into an opposing Jayemdae Tome beats holding it (artifact)", () => {
        const s = position([
            inHand("Viridian Shaman"),
            onBoard("Jayemdae Tome", "opp"),
        ]);
        expect(policyOf(s, castOf(s, "Viridian Shaman"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });

    it("Ogre Arsonist cast into an opposing Forest beats holding it (land)", () => {
        const s = buildPositionFromSpec({
            cards: [inHand("Ogre Arsonist"), onBoard("Forest", "opp")],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 5,
            libraryCount: 20,
        });
        expect(policyOf(s, castOf(s, "Ogre Arsonist"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });
});

describe("Eval Pairs — Snapcaster Mage's ETB potential (issue #4217)", () => {
    /** The blade entry's own position, so the pair and the entry cannot drift. */
    function bladePosition(label: string): GameState {
        const entry = findBladeScenario(label);
        if (!entry) throw new Error(`no blade entry "${label}"`);
        return buildPositionFromSpec(entry.spec);
    }

    it("the reported position: holding Snapcaster Mage beats casting it into an empty graveyard", () => {
        const s = bladePosition(
            "Snapcaster Mage (issue #4217 reported position): holds it on turn 4 with an empty graveyard"
        );
        expect(policyOf(s, isPass)).toBeGreaterThan(
            policyOf(s, castOf(s, "Snapcaster Mage"))
        );
    });
});

describe("an ETB Ability in flight is credited once (issue #4758)", () => {
    // The window between entering and resolving: the trigger is spent from
    // the permanent's realized worth and not yet in the state it leaves
    // behind. Every probe that stops short of resolution scores it.

    /** Cast `name`, resolve the spell, and announce its ETB's target with the
     *  first legal selection — the trigger is then on the stack, unresolved. */
    function inFlight(cards: SpecCard[], name: string): GameState {
        const s = position(cards);
        const me = s.activePlayerId;
        const cast = enumerateMoves(s, me).find(castOf(s, name))!;
        applyMoveInSearch(s, me, cast);
        resolveTopOfStack(s);
        const announce = enumerateRaisedTargetMoves(s, me)[0];
        if (announce) applyMoveInSearch(s, me, announce);
        return s;
    }

    function withoutStack(s: GameState): GameState {
        const bare = cloneGameState(s);
        bare.stack = [];
        return bare;
    }

    it("a targeted ETB on the stack is worth its script to its controller", () => {
        const s = inFlight(
            [inHand("Flametongue Kavu"), onBoard("Serra Angel", "opp")],
            "Flametongue Kavu"
        );
        expect(s.stack).toHaveLength(1);
        expect(s.stack[0].targets?.length).toBe(1);
        const me = s.activePlayerId;
        expect(evaluate(s, me)).toBeGreaterThan(evaluate(withoutStack(s), me));
    });

    it("an ETB announced with no legal target is worth nothing", () => {
        const s = inFlight(
            [inHand("Skyclave Apparition")],
            "Skyclave Apparition"
        );
        expect(s.stack).toHaveLength(1);
        expect(s.stack[0].targets?.length ?? 0).toBe(0);
        const me = s.activePlayerId;
        expect(evaluate(s, me)).toBe(evaluate(withoutStack(s), me));
    });

    it("Eval Pair: Ravenous Rats cast into an opponent holding cards beats holding it — its discard waits on the opponent's pick", () => {
        const s = position([
            inHand("Ravenous Rats"),
            { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            { name: "Hill Giant", owner: "opp", zone: "hand" },
        ]);
        expect(policyOf(s, castOf(s, "Ravenous Rats"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });
});

describe("an in-flight self-sacrifice is priced at the body it takes (issue #4901)", () => {
    /** Solitude evoked with no mana (the pitch cost), its spell resolved: the
     *  body is on the battlefield and the evoke sacrifice waits on the stack. */
    function evokedInFlight(): GameState {
        const s = buildPositionFromSpec({
            cards: [
                inHand("Solitude"),
                inHand("Savannah Lions"),
                onBoard("Serra Angel", "opp"),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        });
        const me = s.activePlayerId;
        const cast = enumerateMoves(s, me).find(castOf(s, "Solitude"))!;
        applyMoveInSearch(s, me, cast);
        resolveTopOfStack(s);
        // Both ETB-time triggers (the card's own and the evoke sacrifice)
        // await their stack order (CR 603.3b): take the first ordering.
        const order = enumerateMoves(s, me).find(
            (m) => m.kind === "resolution-choice"
        );
        if (order) applyMoveInSearch(s, me, order);
        return s;
    }

    it("Eval Pair: the evoke sacrifice in flight scores below the same board with the body kept, by the body's worth", () => {
        const s = evokedInFlight();
        const me = s.activePlayerId;
        const sacrifice = s.stack.find(
            (i) => i.triggeredAbilityId === EVOKE_SACRIFICE_TRIGGER_ID
        );
        expect(sacrifice).toBeDefined();
        const kept = cloneGameState(s);
        kept.stack = kept.stack.filter(
            (i) => i.triggeredAbilityId !== EVOKE_SACRIFICE_TRIGGER_ID
        );
        const body = kept.players
            .find((p) => p.id === me)!
            .battlefield.find((c) => c.id === sacrifice!.triggerSourceId)!;
        const worth = permanentRealisedValue(kept, body, DEFAULT_EVAL_WEIGHTS);
        expect(worth).toBeGreaterThan(40);
        // `worth` itself, to float tolerance: the difference is a sum of weighted
        // terms and lands an ulp under it for some fitted vectors.
        expect(evaluate(kept, me) - evaluate(s, me)).toBeGreaterThanOrEqual(
            worth - 1e-9
        );
    });
});

describe("an escaped permanent's sacrifice in flight is not charged (issue #4901, CR 702.138b)", () => {
    it("Eval Pair: Phlage escaped from the graveyard keeps its body while its 'unless it escaped' trigger waits", () => {
        const phlage = "Phlage, Titan of Fire's Fury";
        const s = buildPositionFromSpec({
            cards: [
                { name: phlage, owner: "me", zone: "graveyard" },
                ...Array.from({ length: 5 }, () => ({
                    name: "Grizzly Bears",
                    owner: "me" as const,
                    zone: "graveyard" as const,
                })),
                { name: "Plateau", owner: "me", zone: "battlefield" },
                { name: "Plateau", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 2,
            libraryCount: 20,
        });
        const me = s.activePlayerId;
        const id = getCardByName(phlage).id;
        const cast = enumerateMoves(s, me).find(
            (m) =>
                m.kind === "cast-spell" &&
                s.players
                    .flatMap((p) => p.graveyard)
                    .some(
                        (c) =>
                            c.id === m.cardInstanceId &&
                            (c.card as { id?: string }).id === id
                    )
        )!;
        applyMoveInSearch(s, me, cast);
        resolveTopOfStack(s);
        for (let i = 0; i < 4; i++) {
            const step = enumerateMoves(s, me).find(
                (m) => m.kind === "resolution-choice"
            );
            if (!step) break;
            applyMoveInSearch(s, me, step);
        }
        const trigger = s.stack.find(
            (i) => i.triggeredAbilityId === "phlage-sacrifice-unless-escaped"
        );
        expect(trigger?.escaped).toBe(true);
        const without = cloneGameState(s);
        without.stack = without.stack.filter(
            (i) => i.triggeredAbilityId !== "phlage-sacrifice-unless-escaped"
        );
        const body = s.players
            .find((p) => p.id === me)!
            .battlefield.find((c) => c.id === trigger!.triggerSourceId)!;
        const worth = permanentRealisedValue(s, body, DEFAULT_EVAL_WEIGHTS);
        // Only the flat cost the walker still reads off the escape route's
        // `then` branch may remain — never the body itself.
        expect(evaluate(without, me) - evaluate(s, me)).toBeLessThan(worth / 2);
    });
});

describe("value model — latent vs realized faces (issue #4758)", () => {
    it("the realized reading leaves an ETB Ability out; the latent one counts it", () => {
        const ftk = getCardByName("Flametongue Kavu");
        expect(dslRealizedAbilityScriptValue(ftk)).toBe(0);
        expect(dslAbilityScriptValue(ftk)).toBeGreaterThan(0);
    });

    it("a 'whenever another creature you control enters' ability stays realized", () => {
        const guide = getCardByName("Guide of Souls");
        expect(guide.triggeredAbilities?.[0].etbAbility).toBe(false);
        expect(dslRealizedAbilityScriptValue(guide)).toBeGreaterThan(0);
    });

    it("a self ETB that schedules a delayed trigger stays realized — its consequence is still pending (Dash)", () => {
        const ragavan = getCardByName("Ragavan, Nimble Pilferer");
        const dash = ragavan.triggeredAbilities?.find(
            (t) => t.id === "dash-haste-and-return"
        );
        expect(dash?.etbAbility).toBe(false);
    });

    it("a creature whose own ETB sacrifices it keeps no latent body; one that can pay to keep it does", () => {
        const phlage = getCardByName("Phlage, Titan of Fire's Fury");
        expect(etbSelfSacrificeWeight(phlage)).toBe(1);
        expect(cardValueById(phlage.id)).toBeCloseTo(
            dslAbilityScriptValue(phlage)
        );
        const dreadnought = getCardByName("Phyrexian Dreadnought");
        expect(etbSelfSacrificeWeight(dreadnought)).toBe(0);
        // Mold Demon's "fewer than two Swamps" branch sacrifices whatever the
        // controller would pay, and the latent reading cannot see the Swamps:
        // an undecided gate (issue #4902), not the nothing a Dreadnought gets.
        expect(
            etbSelfSacrificeWeight(getCardByName("Mold Demon"))
        ).toBeGreaterThan(0);
        // An evoke sacrifice is decided by how the card is cast — undecided in
        // hand, so it takes the gate's weight.
        expect(etbSelfSacrificeWeight(getCardByName("Solitude"))).toBe(0.5);
    });

    it("a creature's latent script value is bounded like a non-creature's (issue #1508's cap)", () => {
        const oracle = getCardByName("Thassa's Oracle");
        const body =
            0.85 *
            creatureValueRaw(
                oracle.power ?? 0,
                oracle.toughness ?? 0,
                manaValue(oracle.manaCost),
                oracle.staticAbilities ?? []
            );
        expect(dslAbilityScriptValue(oracle)).toBeGreaterThan(300);
        expect(cardValueById(oracle.id)).toBeCloseTo(body + 300);
    });
});

describe("the cast route a zone implies (issue #4897, regression of #4758)", () => {
    const phlage = getCardByName("Phlage, Titan of Fire's Fury");
    const uro = getCardByName("Uro, Titan of Nature's Wrath");

    it("an escaped cast keeps the body its hand cast sacrifices (CR 702.138b)", () => {
        expect(etbSelfSacrificeWeight(phlage, "hand")).toBe(1);
        expect(etbSelfSacrificeWeight(phlage, "escape")).toBe(0);
        expect(etbSelfSacrificeWeight(uro, "hand")).toBe(1);
        expect(etbSelfSacrificeWeight(uro, "escape")).toBe(0);
        // Hand-side default is unchanged.
        expect(etbSelfSacrificeWeight(phlage)).toBe(1);
        // A sacrifice no escape decides is not lifted by the route.
        const solitude = getCardByName("Solitude");
        expect(etbSelfSacrificeWeight(solitude, "hand")).toBe(0.5);
    });

    it("a graveyard Phlage is priced with its body; the hand value is unchanged", () => {
        const inGraveyard = makeInstance(phlage.id, { zone: "graveyard" });
        const latent = DEFAULT_EVAL_WEIGHTS.latent;
        const escaped = cardValueById(phlage.id, latent, "escape");
        expect(latentGraveyardValue(inGraveyard, latent)).toBeCloseTo(escaped);
        expect(escaped).toBeGreaterThan(
            2 * cardValueById(phlage.id, latent, "hand")
        );
        expect(cardValueById(phlage.id)).toBeCloseTo(
            dslAbilityScriptValue(phlage)
        );
    });

    it("a graveyard card WITHOUT printed escape takes the hand route", () => {
        const solitude = getCardByName("Solitude");
        const card = makeInstance(solitude.id, { zone: "graveyard" });
        expect(latentGraveyardValue(card)).toBeCloseTo(
            cardValueById(solitude.id, DEFAULT_EVAL_WEIGHTS.latent, "hand")
        );
    });

    it("Eval Pair: Phlage in the graveyard outscores the same board with it exiled by more than the ETB-only value", () => {
        const fodder = () =>
            Array.from({ length: 5 }, () =>
                makeInstance(getCardByName("Lightning Bolt").id, {
                    zone: "graveyard",
                })
            );
        const board = (phlageZone: "graveyard" | "exile") =>
            makeState({
                players: [
                    makePlayer("p1", {
                        graveyard:
                            phlageZone === "graveyard"
                                ? [
                                      makeInstance(phlage.id, {
                                          zone: "graveyard",
                                      }),
                                      ...fodder(),
                                  ]
                                : fodder(),
                        exile:
                            phlageZone === "exile"
                                ? [makeInstance(phlage.id, { zone: "exile" })]
                                : [],
                    }),
                    makePlayer("p2"),
                ],
            });
        const w = DEFAULT_EVAL_WEIGHTS;
        const gap =
            evaluate(board("graveyard"), "p1", w) -
            evaluate(board("exile"), "p1", w);
        const etbOnly =
            w.graveyardReachFraction * dslAbilityScriptValue(phlage);
        expect(gap).toBeGreaterThan(etbOnly);
    });
});

describe("Eval Pairs — a self-sacrificing ETB Titan is cast from hand (issue #4898)", () => {
    /** The blade entry's own position, so the pair and the entry cannot drift. */
    function bladePosition(label: string): GameState {
        const entry = findBladeScenario(label);
        if (!entry) throw new Error(`no blade entry "${label}"`);
        return buildPositionFromSpec(entry.spec);
    }

    it("Uro hard-cast (+3 life, a card, an escape-ready graveyard card) outscores holding it", () => {
        const s = bladePosition(
            "self-sacrificing ETB: hard-casts Uro for its enter trigger"
        );
        expect(
            policyOf(s, castOf(s, "Uro, Titan of Nature's Wrath"))
        ).toBeGreaterThan(policyOf(s, isPass));
    });

    it("Phlage hard-cast with no lethal and no creature still outscores holding it (same shape, CR 702.138)", () => {
        const s = position([inHand("Phlage, Titan of Fire's Fury")]);
        expect(
            policyOf(s, castOf(s, "Phlage, Titan of Fire's Fury"))
        ).toBeGreaterThan(policyOf(s, isPass));
    });

    it("a card with escape in the graveyard keeps the curve top its hand cast raised (mana development is not spent)", () => {
        const uro = getCardByName("Uro, Titan of Nature's Wrath");
        const lands = () =>
            Array.from({ length: 4 }, (_, i) =>
                makeInstance(getCardByName(i % 2 ? "Island" : "Forest").id, {
                    zone: "battlefield",
                })
            );
        const board = (zone: "hand" | "graveyard" | "exile") =>
            makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: lands(),
                        hand:
                            zone === "hand"
                                ? [makeInstance(uro.id, { zone })]
                                : [],
                        graveyard:
                            zone === "graveyard"
                                ? [makeInstance(uro.id, { zone })]
                                : [],
                        exile:
                            zone === "exile"
                                ? [makeInstance(uro.id, { zone })]
                                : [],
                    }),
                    makePlayer("p2"),
                ],
            });
        const dev = (z: "hand" | "graveyard" | "exile") =>
            evaluateBreakdown(board(z), "p1", DEFAULT_EVAL_WEIGHTS).self
                .manaDevelopment;
        expect(dev("graveyard")).toBeGreaterThan(0);
        expect(dev("graveyard")).toBeCloseTo(dev("hand"));
        expect(dev("exile")).toBe(0);
    });
    it("a flashback card in the graveyard keeps its curve top; a granted permission does not", () => {
        const analysis = getCardByName("Echo of Eons");
        const lands = Array.from({ length: 4 }, () =>
            makeInstance(getCardByName("Island").id, { zone: "battlefield" })
        );
        const dev = (owner: Partial<Parameters<typeof makePlayer>[1]>) =>
            evaluateBreakdown(
                makeState({
                    players: [
                        makePlayer("p1", { battlefield: lands, ...owner }),
                        makePlayer("p2"),
                    ],
                }),
                "p1",
                DEFAULT_EVAL_WEIGHTS
            ).self.manaDevelopment;
        const card = (zone: "hand" | "graveyard") =>
            makeInstance(analysis.id, { zone });
        expect(dev({ graveyard: [card("graveyard")] })).toBeCloseTo(
            dev({ hand: [card("hand")] })
        );
        expect(dev({ graveyard: [card("graveyard")] })).toBeGreaterThan(0);
        // A nonland card with no own permission is a dead graveyard card.
        const bears = makeInstance(getCardByName("Grizzly Bears").id, {
            zone: "graveyard",
        });
        expect(dev({ graveyard: [bears] })).toBe(0);
    });
});
