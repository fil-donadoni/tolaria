// ODY (Odyssey) — black behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { refreshExpectedInput } from "../../../../gre/expectedInput";
import { validateEffectScript } from "../../../../gre/effects/validate";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";
import { getDefinition } from "../../../index";

const innocentBlood = getDefinition("d26af8f6-df64-4027-880c-f2fae2d8103f");
const entomb = getDefinition("f60a2091-fb97-4f04-911b-fce9b6351044");

const BEAR_ID = "test-odyb-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

const bearFor = (owner: string, cid: string) =>
    makeInstance(BEAR_ID, { id: cid, controllerId: owner, ownerId: owner });

// Innocent Blood — "Each player sacrifices a creature of their choice."
// (CR 701.21.) The first DSL card composing a `choice` Op inside a forEach
// construct (ADR 0045, issue #807): the players set iterates in APNAP order
// (CR 101.4), each iteration suspending on a `sacrifice-permanents` Pending
// Choice for the current player. Since issue #1872 the construct carries
// `simultaneous: true`, so EVERY player's pick is collected before ANY
// sacrifice is applied — CR 101.4's "Then the actions happen simultaneously",
// whose worked example in the rules text is this card's own line.
describe("Innocent Blood (each player sacrifices a creature — DSL-only choice-inside-forEach, CR 701.21 / 101.4 / issue #807)", () => {
    it("is a {B} sorcery, DSL-only with a valid Effect Script and no targets", () => {
        expect(innocentBlood.manaCost).toEqual({ B: 1 });
        expect(innocentBlood.types).toEqual(["Sorcery"]);
        expect(innocentBlood.targetRequirement).toBeUndefined();
        expect(innocentBlood.resolve).toBeUndefined();
        expect(innocentBlood.resolveSteps).toBeUndefined();
        expect(validateEffectScript(innocentBlood)).toEqual([]);
    });

    it("each player picks and sacrifices one creature, in APNAP order (CR 101.4 / 701.21)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bearFor("p1", "ibA1"), bearFor("p1", "ibA2")],
                }),
                makePlayer("p2", { battlefield: [bearFor("p2", "ibB1")] }),
            ],
        });
        // p2 casts it; APNAP still starts from the ACTIVE player (p1).
        pushSpell(state, innocentBlood.id, "p2");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1"); // active player decides first
        expect(head.count).toBe(1);
        expect(head.prompt).toBe(
            "Innocent Blood: choose a creature to sacrifice."
        );
        // CR 608.3 — the sorcery stays on the stack across the wait.
        expect(state.stack.map((s) => s.card.id)).toEqual([innocentBlood.id]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["ibA1"],
        });
        // CR 101.4 (issue #1872) — p1's pick is RECORDED, not yet applied:
        // p2 is prompted while p1's chosen bear is still on the battlefield
        // and p1's graveyard is still empty. This is the whole order-visible
        // difference; with the sacrifices applied per iteration, "ibA1" would
        // already be in p1's graveyard here and any graveyard-count or
        // death-watching effect would see one death instead of two.
        head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "ibA1",
            "ibA2",
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["ibB1"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["ibB1"],
        });
        // "Then the actions happen simultaneously" — both sacrifices land in
        // the same resolution frame, after every choice was made.
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["ibA2"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["ibA1"]);
        expect(state.players[1].battlefield).toHaveLength(0);
        // p2's graveyard: the sacrificed bear + the resolved sorcery
        // (cast by p2, CR 608.2k).
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("ibB1");
        expect(state.players[1].graveyard.map((c) => c.card.id)).toContain(
            innocentBlood.id
        );
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("a player with no creatures is skipped — no prompt, no sacrifice (CR 608.2b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1"), // creatureless — never prompted
                makePlayer("p2", { battlefield: [bearFor("p2", "ibOnly")] }),
            ],
        });
        pushSpell(state, innocentBlood.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["ibOnly"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("resolves cleanly when NO player controls a creature (CR 608.2b)", () => {
        const state = makeState();
        pushSpell(state, innocentBlood.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull(); // never suspended
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
    });

    it("indestructible does not prevent the sacrifice (CR 701.21a)", () => {
        const tough = makeInstance(BEAR_ID, {
            id: "ibInd",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [tough] }),
            ],
        });
        pushSpell(state, innocentBlood.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["ibInd"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("ibInd");
    });

    it("wire format: the suspended sacrifice prompt, Expected Input and final board cross the projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bearFor("p1", "ibW1")] }),
                makePlayer("p2", { battlefield: [bearFor("p2", "ibW2")] }),
            ],
        });
        pushSpell(state, innocentBlood.id, "p1");
        resolveTopOfStack(state);
        refreshExpectedInput(state); // ADR 0047 persistence-seam refresh
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1");
        expect(projected.expectedInput).toEqual({
            kind: "choice",
            playerId: "p1",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
            choiceKind: "sacrifice-permanents",
        });

        // Complete both iterations, then re-assert on the projected state.
        for (const [pid, pick] of [
            ["p1", "ibW1"],
            ["p2", "ibW2"],
        ] as const) {
            const h = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: pid,
                stackItemId: h.stackItemId,
                step: h.step,
                choiceId: h.choiceId,
                cardInstanceIds: [pick],
            });
        }
        const done = projectPublicState(state, 1, "p2");
        expect(done.players[0].battlefield).toHaveLength(0);
        expect(done.players[1].battlefield).toHaveLength(0);
        expect(done.players[0].graveyard.map((c) => c.id)).toContain("ibW1");
        expect(done.players[1].graveyard.map((c) => c.id)).toContain("ibW2");
    });
});

describe("Entomb (CR 701.23 / 400.7 / 701.24, issue #677)", () => {
    it("searches for any card and puts it into the graveyard, then shuffles", () => {
        const libBear = makeInstance(BEAR_ID, {
            id: "bearEntomb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [libBear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, entomb.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bearEntomb"],
        });
        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "bearEntomb"
        );
    });
});

const hauntingEchoes = getDefinition("aca4c571-48b8-4150-93f8-4cb5c8e797c4");

// CR 205.4a — a BASIC land: the supertype is what "other than basic land
// cards" turns on, and the graveyard/exile zone readers carried no supertypes
// at all until issue #2711, so this fixture is also the regression fixture for
// that fail-open.
const SWAMP_ID = "test-odyb-swamp";
registerTokenDefinition({
    id: SWAMP_ID,
    name: SWAMP_ID,
    rarity: "common",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Swamp"],
});

// A NONBASIC land — same card type, no `Basic` supertype, so it must be
// exiled while the Swamp above stays.
const WASTE_ID = "test-odyb-waste";
registerTokenDefinition({
    id: WASTE_ID,
    name: WASTE_ID,
    rarity: "common",
    manaCost: {},
    types: ["Land"],
});

// A nonland card that exists ONLY in the library, so nothing exiled from the
// graveyard ever shares its name.
const RELIC_ID = "test-odyb-relic";
registerTokenDefinition({
    id: RELIC_ID,
    name: RELIC_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
});

const inZone = (
    cardId: string,
    id: string,
    zone: "graveyard" | "library"
): ReturnType<typeof makeInstance> =>
    makeInstance(cardId, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        zone,
    });

// Haunting Echoes — "Exile all cards from target player's graveyard other than
// basic land cards. For each card exiled this way, search that player's
// library for all cards with the same name as that card and exile them. Then
// that player shuffles." (CR 404 / 205.4a / 701.23a / 201.2 / 701.24a.)
describe("Haunting Echoes (CR 404 / 205.4a / 201.2 / 701.23a / 701.24a, issue #2711)", () => {
    /** p2's graveyard holds one basic land, one nonbasic land, two bears and
     *  nothing else; p2's library holds a bear (name-matched by the graveyard
     *  bears), a basic Swamp (name-matched by the graveyard Swamp, which is
     *  NOT exiled — so it must survive) and a relic nothing names. */
    const scenario = () => {
        const gySwamp = inZone(SWAMP_ID, "gy-swamp", "graveyard");
        const gyWaste = inZone(WASTE_ID, "gy-waste", "graveyard");
        const gyBear = inZone(BEAR_ID, "gy-bear", "graveyard");
        const libBear = inZone(BEAR_ID, "lib-bear", "library");
        const libSwamp = inZone(SWAMP_ID, "lib-swamp", "library");
        const libRelic = inZone(RELIC_ID, "lib-relic", "library");
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    graveyard: [gySwamp, gyWaste, gyBear],
                    library: [libBear, libSwamp, libRelic],
                }),
            ],
        });
        return state;
    };

    it("has a valid Effect Script", () => {
        expect(validateEffectScript(hauntingEchoes)).toEqual([]);
    });

    it("exiles every non-basic-land graveyard card, leaves the basic land, and exiles only the library cards sharing an exiled card's name — then shuffles", () => {
        const state = scenario();
        const before = state.rngCounter;
        pushSpell(state, hauntingEchoes.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeUndefined();

        const p2 = state.players[1];
        // CR 205.4a — the basic land is the ONLY graveyard survivor.
        expect(p2.graveyard.map((c) => c.id)).toEqual(["gy-swamp"]);
        // CR 201.2 — the library bear shares a name with an EXILED card, so it
        // goes; the library Swamp shares a name with a card that was NOT
        // exiled, so it stays; the relic shares a name with nothing.
        expect(p2.library.map((c) => c.id).sort()).toEqual([
            "lib-relic",
            "lib-swamp",
        ]);
        expect(p2.exile.map((c) => c.id).sort()).toEqual([
            "gy-bear",
            "gy-waste",
            "lib-bear",
        ]);
        // CR 701.24a — "Then that player shuffles": the seeded PRNG advanced.
        expect(state.rngCounter).toBeGreaterThan(before);
    });

    it("is a clean no-op on an empty graveyard but still shuffles (CR 608.2b / 701.24a)", () => {
        // Three cards, not one: `seededShuffle` draws one random index per
        // swap, so a single-card library advances the PRNG zero times and the
        // shuffle assertion below would be vacuous.
        const library = [
            inZone(BEAR_ID, "lib-bear", "library"),
            inZone(SWAMP_ID, "lib-swamp", "library"),
            inZone(RELIC_ID, "lib-relic", "library"),
        ];
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [], library }),
            ],
        });
        const before = state.rngCounter;
        pushSpell(state, hauntingEchoes.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].library.map((c) => c.id).sort()).toEqual([
            "lib-bear",
            "lib-relic",
            "lib-swamp",
        ]);
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.rngCounter).toBeGreaterThan(before);
    });

    it("shows the exiled pile and the surviving zones through the wire projection", () => {
        const state = scenario();
        pushSpell(state, hauntingEchoes.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        const view = projectPublicState(state, 1, "p1");
        const opp = view.players[1];
        expect(opp.exile.map((c) => c.id).sort()).toEqual([
            "gy-bear",
            "gy-waste",
            "lib-bear",
        ]);
        expect(opp.graveyard.map((c) => c.id)).toEqual(["gy-swamp"]);
        expect(opp.library.count).toBe(2);
    });
});
