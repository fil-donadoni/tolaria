// The Dark (DRK) — per-card behavior tests (twin of leg.test.ts / arn.test.ts).
// Each skeleton card gets a dedicated describe block citing the CR section it
// exercises. Tests assert external behavior only (definition shape, zone after
// resolution, projected wire-format characteristics), per the PRD testing
// decisions (#409).
//
// THIS slice covers the walking skeleton (#410): the `drk` set is registered
// and three vanilla creatures resolve from the stack onto the battlefield and
// survive projection.

import { describe, it, expect } from "vitest";
import {
    squire,
    goblinHero,
    scarwoodGoblins,
    knightsOfThorn,
    pikemen,
    angryMob,
    exorcist,
    miracleWorker,
    witchHunter,
    preacher,
    dustToDust,
    tivadarsCrusade,
    holyLight,
    morale,
    martyrsCry,
    fireAndBrimstone,
} from "../drk";
import { getCardById, getCardByName, getAllCards } from "../../index";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import { checkStateBasedActions } from "../../../gre/sba";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { getLegalTargets } from "../../../gre/rules";
import { projectPublicState } from "../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";

// --- helpers (mirror arn.test.ts) ------------------------------------------

/** Push an activated ability onto the stack (cost assumed paid), then resolve. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** Answer the head pending choice by injecting picks, then resolve again. */
function answerChoice(state: GameState, picks: string[]): void {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("no pending choice to answer");
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: picks,
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

describe("DRK registry parity", () => {
    it("registers the skeleton creatures by id", () => {
        expect(getCardById(squire.id)).toBe(squire);
        expect(getCardById(goblinHero.id)).toBe(goblinHero);
        expect(getCardById(scarwoodGoblins.id)).toBe(scarwoodGoblins);
    });

    it("registers them by name (debug-panel / pool lookup path)", () => {
        // The Debug-panel preset scenario and the card pool both resolve cards
        // by name via getCardByName (game.ts seedScenario) — registration alone
        // must make the cards reachable.
        expect(getCardByName("Squire")).toBe(squire);
        expect(getCardByName("Goblin Hero")).toBe(goblinHero);
        expect(getCardByName("Scarwood Goblins")).toBe(scarwoodGoblins);
    });

    it("includes them in getAllCards (deck-builder index)", () => {
        const all = getAllCards();
        expect(all).toContain(squire);
        expect(all).toContain(goblinHero);
        expect(all).toContain(scarwoodGoblins);
    });
});

// ---------------------------------------------------------------------------
// Vanilla creatures (CR 302 — Creature cards as pure data: types/subtypes +
// P/T only; values validated against MTGJSON data/json/DRK.json)
// ---------------------------------------------------------------------------

describe("Squire (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(squire.types).toEqual(["Creature"]);
        expect(squire.subtypes).toEqual(["Human", "Soldier"]);
        expect(squire.power).toBe(1);
        expect(squire.toughness).toBe(2);
        expect(squire.manaCost).toEqual({ X: 1, W: 1 });
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, squire.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Goblin Hero (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(goblinHero.types).toEqual(["Creature"]);
        expect(goblinHero.subtypes).toEqual(["Goblin"]);
        expect(goblinHero.power).toBe(2);
        expect(goblinHero.toughness).toBe(2);
        expect(goblinHero.manaCost).toEqual({ X: 2, R: 1 });
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, goblinHero.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Scarwood Goblins (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(scarwoodGoblins.types).toEqual(["Creature"]);
        expect(scarwoodGoblins.subtypes).toEqual(["Goblin"]);
        expect(scarwoodGoblins.power).toBe(2);
        expect(scarwoodGoblins.toughness).toBe(2);
        expect(scarwoodGoblins.manaCost).toEqual({ R: 1, G: 1 });
    });

    it("resolves onto the battlefield and survives projection (CR 608.3)", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its definition must be recoverable from the registry by
        // id after projectPublicState (the card survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, scarwoodGoblins.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.name).toBe("Scarwood Goblins");
        expect(def.subtypes).toEqual(["Goblin"]);
    });
});

// ---------------------------------------------------------------------------
// Keyword creatures (CR 702 — keywords map to staticAbilities[]; definition
// snapshot is the convention for plain keywords)
// ---------------------------------------------------------------------------

describe("Knights of Thorn — protection from red + banding (CR 702.16 / 702.22)", () => {
    it("carries the keywords and canonical stats", () => {
        expect(knightsOfThorn.staticAbilities).toContain("protection from red");
        expect(knightsOfThorn.staticAbilities).toContain("banding");
        expect(knightsOfThorn.power).toBe(2);
        expect(knightsOfThorn.toughness).toBe(2);
        expect(knightsOfThorn.manaCost).toEqual({ X: 3, W: 1 });
        expect(knightsOfThorn.subtypes).toEqual(["Human", "Knight"]);
    });
});

describe("Pikemen — first strike + banding (CR 702.7 / 702.22)", () => {
    it("carries the keywords and canonical stats", () => {
        expect(pikemen.staticAbilities).toContain("first strike");
        expect(pikemen.staticAbilities).toContain("banding");
        expect(pikemen.power).toBe(1);
        expect(pikemen.toughness).toBe(1);
        expect(pikemen.manaCost).toEqual({ X: 1, W: 1 });
        expect(pikemen.subtypes).toEqual(["Human", "Soldier"]);
    });
});

// ---------------------------------------------------------------------------
// Angry Mob — turn-conditional CDA P/T (CR 604.3, layer 7a)
// ---------------------------------------------------------------------------

describe("Angry Mob — CDA P/T (CR 604.3 / 102.1)", () => {
    function setup(activePlayerId: string, opponentSwamps: number) {
        const mob = makeInstance(angryMob.id, {
            id: "mob",
            controllerId: "p1",
            ownerId: "p1",
        });
        const swampId = getCardByName("Swamp").id;
        const swamps = Array.from({ length: opponentSwamps }, (_, i) =>
            makeInstance(swampId, {
                id: `swamp-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [mob] }),
                makePlayer("p2", { battlefield: swamps }),
            ],
        });
        return { state, mob };
    }

    it("is 2 + opponents' Swamps during the controller's turn", () => {
        const { state, mob } = setup("p1", 3);
        expect(getEffectivePower(state, mob)).toBe(5); // 2 + 3
        expect(getEffectiveToughness(state, mob)).toBe(5);
    });

    it("is a flat 2/2 during another player's turn", () => {
        const { state, mob } = setup("p2", 3);
        expect(getEffectivePower(state, mob)).toBe(2);
        expect(getEffectiveToughness(state, mob)).toBe(2);
    });

    it("only counts opponents' Swamps, not the controller's", () => {
        const { state, mob } = setup("p1", 0);
        const swampId = getCardByName("Swamp").id;
        state.players[0].battlefield.push(
            makeInstance(swampId, {
                id: "own-swamp",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(getEffectivePower(state, mob)).toBe(2); // own Swamp excluded
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const { state } = setup("p1", 2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "mob"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Exorcist — {1}{W},{T}: destroy target black creature (CR 605 / 701.7)
// ---------------------------------------------------------------------------

describe("Exorcist — destroy target black creature (CR 605 / 701.7)", () => {
    it("destroys the targeted black creature", () => {
        const ex = makeInstance(exorcist.id, { id: "ex", controllerId: "p1" });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ex] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        resolveActivated(state, ex, "exorcist-destroy-black", [
            { type: "permanent", id: "black" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "black")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "black")).toBe(
            true
        );
    });

    it("only lists black creatures as legal targets", () => {
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const white = makeInstance(getCardByName("White Knight").id, {
            id: "white",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [black, white] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            exorcist.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("black");
        expect(ids).not.toContain("white");
    });
});

// ---------------------------------------------------------------------------
// Miracle Worker — {T}: destroy target Aura attached to a creature you control
// ---------------------------------------------------------------------------

describe("Miracle Worker — destroy your Aura (CR 605 / 701.7)", () => {
    it("destroys an Aura attached to a creature the controller controls", () => {
        const mw = makeInstance(miracleWorker.id, {
            id: "mw",
            controllerId: "p1",
        });
        const myCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A DRK Brainwash-style Aura would attach here; reuse any Aura in pool.
        const auraId = getCardByName("Holy Strength").id;
        const aura = makeInstance(auraId, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "mine",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mw, myCreature, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, mw, "miracle-worker-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
    });

    it("does NOT destroy an Aura on an opponent's creature", () => {
        const mw = makeInstance(miracleWorker.id, {
            id: "mw",
            controllerId: "p1",
        });
        const theirCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(getCardByName("Holy Strength").id, {
            id: "aura",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "theirs",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mw] }),
                makePlayer("p2", { battlefield: [theirCreature, aura] }),
            ],
        });
        resolveActivated(state, mw, "miracle-worker-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        // Host is an opponent's creature → no destruction.
        expect(
            state.players[1].battlefield.find((c) => c.id === "aura")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Witch Hunter — ping + bounce (CR 605 / 119 / 701.10)
// ---------------------------------------------------------------------------

describe("Witch Hunter — ping a player and bounce a creature", () => {
    it("deals 1 damage to the targeted player", () => {
        const wh = makeInstance(witchHunter.id, {
            id: "wh",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wh] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wh, "witch-hunter-ping", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });

    it("returns an opponent's creature to its owner's hand", () => {
        const wh = makeInstance(witchHunter.id, {
            id: "wh",
            controllerId: "p1",
        });
        const creature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wh] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        resolveActivated(state, wh, "witch-hunter-bounce", [
            { type: "permanent", id: "lion" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "lion")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "lion")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Preacher — control gain "for as long as this remains tapped" (CR 611.2b)
// ---------------------------------------------------------------------------

describe("Preacher — steal a creature while tapped (CR 611.2b)", () => {
    function setup() {
        const pr = makeInstance(preacher.id, {
            id: "preacher",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true, // {T} cost already paid
        });
        const victim = makeInstance(getCardByName("Savannah Lions").id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pr] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state };
    }

    it("the opponent chooses the creature, control moves to the activator", () => {
        const { state } = setup();
        // Target the opponent (player); the opponent then picks the creature.
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "preacher-steal",
            [{ type: "player", id: "p2" }]
        );
        // requestChoice suspended → opponent picks the victim.
        answerChoice(state, ["victim"]);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "victim")
                ?.controllerId
        ).toBe("p1");
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
    });

    it("control reverts the instant Preacher untaps (source-tapped lapses)", () => {
        const { state } = setup();
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "preacher-steal",
            [{ type: "player", id: "p2" }]
        );
        answerChoice(state, ["victim"]);
        checkStateBasedActions(state);
        // Untap Preacher → condition lapses → revert.
        const pr = state.players[0].battlefield.find(
            (c) => c.id === "preacher"
        )!;
        pr.isTapped = false;
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
                ?.controllerId
        ).toBe("p2");
    });
});

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

describe("Dust to Dust — exile two target artifacts (CR 701.18)", () => {
    it("exiles both targeted artifacts", () => {
        const art1 = makeInstance(getCardByName("Ornithopter").id, {
            id: "a1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const art2 = makeInstance(getCardByName("Ornithopter").id, {
            id: "a2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [art1, art2] }),
            ],
        });
        pushSpell(state, dustToDust.id, "p1", [
            { type: "permanent", id: "a1" },
            { type: "permanent", id: "a2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "a1",
            "a2",
        ]);
    });
});

describe("Tivadar's Crusade — destroy all Goblins (CR 701.7 / 205.3)", () => {
    it("destroys Goblins and leaves non-Goblins alone", () => {
        const goblin = makeInstance(scarwoodGoblins.id, {
            id: "gob",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [goblin, bear] }),
            ],
        });
        pushSpell(state, tivadarsCrusade.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "gob")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeDefined();
    });
});

describe("Holy Light — nonwhite creatures get -1/-1 (CR 611.2 / 202.2)", () => {
    it("weakens nonwhite creatures but spares white ones", () => {
        const white = makeInstance(getCardByName("White Knight").id, {
            id: "white",
            controllerId: "p1",
            ownerId: "p1",
        });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [white] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        const whiteP = getEffectivePower(state, white);
        const whiteT = getEffectiveToughness(state, white);
        pushSpell(state, holyLight.id, "p1");
        resolveTopOfStack(state);
        // White unchanged.
        expect(getEffectivePower(state, white)).toBe(whiteP);
        expect(getEffectiveToughness(state, white)).toBe(whiteT);
        // Black Knight (2/2) → 1/1.
        expect(getEffectivePower(state, black)).toBe(1);
        expect(getEffectiveToughness(state, black)).toBe(1);
    });
});

describe("Morale — attacking creatures get +1/+1 (pump-combat)", () => {
    it("declares the canonical pump-combat effect", () => {
        expect(morale.effect).toEqual({
            kind: "pump-combat",
            side: "attacking",
            power: 1,
            toughness: 1,
        });
    });
});

describe("Martyr's Cry — exile white creatures, draw per exiled (CR 701.18 / 121.1)", () => {
    it("exiles all white creatures and each controller draws one per exiled", () => {
        const w1 = makeInstance(getCardByName("White Knight").id, {
            id: "w1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const w2 = makeInstance(getCardByName("Savannah Lions").id, {
            id: "w2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const libCard = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "lib",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [w1] }),
                makePlayer("p2", {
                    battlefield: [w2, black],
                    library: [libCard],
                }),
            ],
        });
        pushSpell(state, martyrsCry.id, "p1");
        resolveTopOfStack(state);
        // White creatures exiled; black survives.
        expect(
            state.players[0].battlefield.find((c) => c.id === "w1")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "w2")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "black")
        ).toBeDefined();
        // p2 controlled one exiled white creature → drew one card.
        expect(state.players[1].hand.some((c) => c.id === "lib")).toBe(true);
    });
});

describe("Fire and Brimstone — 4 to a player who attacked + 4 to you (CR 506.2 / 119)", () => {
    function attackerState() {
        // p2 controls a creature flagged as having attacked this turn.
        const attacker = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            hasAttackedThisTurn: true,
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
    }

    it("only a player who attacked this turn is a legal target", () => {
        const state = attackerState();
        const legal = getLegalTargets(
            state,
            fireAndBrimstone.targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("p2"); // attacked
        expect(ids).not.toContain("p1"); // did not attack
    });

    it("deals 4 to the attacker and 4 to the caster", () => {
        const state = attackerState();
        pushSpell(state, fireAndBrimstone.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16); // 20 - 4
        expect(state.players[0].life).toBe(16); // 20 - 4 to you
    });
});

// ---------------------------------------------------------------------------
// Deferred cards are intentionally NOT exported / registered. Guard that the
// pool stays honest (no half-card leaks until their mechanic ships).
// ---------------------------------------------------------------------------

describe("DRK deferred cards (not yet in pool)", () => {
    it.each(["Brainwash", "Blood of the Martyr", "Festival", "Cleansing"])(
        "%s is not registered (its mechanic is deferred — see TODO(#411))",
        (name) => {
            expect(() => getCardByName(name)).toThrow();
        }
    );
});
