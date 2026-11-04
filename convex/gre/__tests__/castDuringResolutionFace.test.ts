// The face a cast made DURING RESOLUTION announces (CR 608.2g): a split half
// (CR 709.3), an Adventure (CR 715.3) or a modal back face (CR 712.11b), priced,
// targeted and stamped as that subject. Every case runs the real Op or the real
// card through `resolveTopOfStack` and reads the offer back off
// `projectPublicState`, because that is the only thing the client sees.

import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import type { EffectOp } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { splitHalfDefinitionId } from "../../cards/splitCard";
import { projectPublicState } from "../../gameProjections";
import { adventureCastAltCostId } from "../adventure";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { modalBackCastAltCostId } from "../modalBackCast";
import { splitCastAltCostId } from "../splitCast";
import { resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState, StackItem } from "../state";
import {
    modalCreatureBackProbe,
    modalInstantBackProbe,
} from "./fixtures/modalBackProbe.fixture";

const STAND_DELIVER = getCardByName("Stand // Deliver");
const BONECRUSHER = getCardByName("Bonecrusher Giant");
const SHELLDOCK = getCardByName("Shelldock Isle");
const WORD_OF_COMMAND = getCardByName("Word of Command");
const HILL_GIANT = getCardByName("Hill Giant");

const STAND = splitCastAltCostId(STAND_DELIVER, "left");
const DELIVER = splitCastAltCostId(STAND_DELIVER, "right");
const STOMP = adventureCastAltCostId(BONECRUSHER);
const FLARE = modalBackCastAltCostId(modalInstantBackProbe);
const BEHEMOTH = modalBackCastAltCostId(modalCreatureBackProbe);

function card(
    name: string,
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(getCardByName(name).id, {
        id,
        controllerId: ownerId,
        ownerId,
        zone,
    });
}

function lands(name: string, count: number, ownerId = "p1") {
    return Array.from({ length: count }, (_, i) =>
        card(name, `${name}-${ownerId}-${i}`, ownerId, "battlefield")
    );
}

function registerScript(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    });
    return id;
}

/** "Exile the top card of your library. You may cast that card." — public, so
 *  the offer itself carries the face rows. */
const CHANDRA_SHAPE = registerScript("test-cdr-face-public", [
    {
        op: "castDuringResolution",
        fromTopOfLibrary: true,
        player: "controller",
    },
]);

function resolveOffer(
    topCardDefId: string,
    battlefield: CardInstanceState[],
    p2Battlefield: CardInstanceState[] = []
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield,
                library: [
                    makeInstance(topCardDefId, {
                        id: "top",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
    pushSpell(state, CHANDRA_SHAPE, "p1");
    resolveTopOfStack(state);
    return state;
}

function submit(state: GameState, id: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [id],
    });
}

/** The option ids the head choice shows, as the client receives them. */
function offeredIds(state: GameState, viewerId = "p1"): string[] | undefined {
    return projectPublicState(
        state,
        1,
        viewerId
    ).pendingChoices?.[0]?.options?.map((o) => o.id);
}

function tappedCount(state: GameState, seat = 0): number {
    return state.players[seat].battlefield.filter((c) => c.isTapped).length;
}

function spellOnStack(state: GameState, id = "top") {
    return state.stack.find((s) => s.id === id);
}

describe("split card cast during resolution (CR 709.3 / 608.2g)", () => {
    it("offers both halves and no printed row: no cast puts the combined object on the stack", () => {
        const state = resolveOffer(
            STAND_DELIVER.id,
            [...lands("Plains", 1), ...lands("Island", 3)],
            [card("Hill Giant", "bear", "p2", "battlefield")]
        );
        expect(offeredIds(state)).toEqual([STAND, DELIVER, "decline"]);
    });

    it("prices and targets the chosen half and puts only that half on the stack (CR 709.3a / 709.3b)", () => {
        const state = resolveOffer(
            STAND_DELIVER.id,
            [...lands("Plains", 1), ...lands("Island", 3)],
            [card("Hill Giant", "bear", "p2", "battlefield")]
        );
        submit(state, STAND);
        // Stand targets a creature: the half's own requirement, not Deliver's.
        expect(state.pendingChoices![0].kind).toBe("choose-damage-target");
        submit(state, "bear");

        const spell = spellOnStack(state)!;
        expect(spell.card.id).toBe(
            splitHalfDefinitionId(STAND_DELIVER.id, "left")
        );
        expect(spell.targets?.map((t) => t.id)).toEqual(["bear"]);
        // {W}, never the combined CR 709.4b cost.
        expect(tappedCount(state)).toBe(1);
    });

    it("withholds a half no payment covers: Deliver at {2}{U} on one Plains", () => {
        const state = resolveOffer(STAND_DELIVER.id, lands("Plains", 1), [
            card("Hill Giant", "bear", "p2", "battlefield"),
        ]);
        expect(offeredIds(state)).toEqual([STAND, "decline"]);
    });

    it("withholds a half with no legal target, and passes silently when neither half is left (CR 601.2c / 608.2b)", () => {
        // Deliver can return a land; Stand finds no creature.
        const noCreature = resolveOffer(STAND_DELIVER.id, [
            ...lands("Plains", 1),
            ...lands("Island", 3),
        ]);
        expect(offeredIds(noCreature)).toEqual([DELIVER, "decline"]);

        const nothing = resolveOffer(STAND_DELIVER.id, []);
        expect(nothing.pendingChoices ?? []).toHaveLength(0);
        expect(nothing.players[0].exile.map((c) => c.id)).toEqual(["top"]);
    });
});

describe("Adventure card cast during resolution (CR 715.3 / 608.2g)", () => {
    it("offers the card and the Adventure, naming the printed row once there is a choice", () => {
        const state = resolveOffer(BONECRUSHER.id, lands("Mountain", 3));
        expect(offeredIds(state)).toEqual(["cast", STOMP, "decline"]);
        const options = projectPublicState(state, 1, "p1").pendingChoices![0]
            .options!;
        expect(options[0].label).toBe("Cast Bonecrusher Giant");
        expect(options[1].label).toContain("Stomp");
    });

    it("casts it as an Adventure at the Adventure's price and target (CR 715.3a / 715.3b)", () => {
        const state = resolveOffer(BONECRUSHER.id, lands("Mountain", 3));
        submit(state, STOMP);
        expect(state.pendingChoices![0].kind).toBe("choose-damage-target");
        submit(state, "p2");

        const spell = spellOnStack(state)!;
        expect(spell.card.id).not.toBe(BONECRUSHER.id);
        expect(spell.types).toEqual(["Instant"]);
        expect(tappedCount(state)).toBe(2); // {1}{R}, not {2}{R}
    });

    it("the printed row still casts the creature at its own cost", () => {
        const state = resolveOffer(BONECRUSHER.id, lands("Mountain", 3));
        submit(state, "cast");
        const spell = spellOnStack(state)!;
        expect(spell.card.id).toBe(BONECRUSHER.id);
        expect(tappedCount(state)).toBe(3);
    });

    it("this effect may cast a card its own Adventure exiled as an Adventure again (CR 715.3d)", () => {
        const script = registerScript("test-cdr-face-hand", [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                count: 1,
                prompt: "Choose a card.",
                bind: "$picked",
            },
            {
                op: "castDuringResolution",
                card: { ref: "$picked" },
                player: "controller",
                source: "hand",
                free: true,
            },
        ]);
        const giant = card("Bonecrusher Giant", "giant", "p1", "hand");
        giant.castFromExileNotAsAdventure = true;
        const state = makeState({
            players: [makePlayer("p1", { hand: [giant] }), makePlayer("p2")],
        });
        pushSpell(state, script, "p1");
        resolveTopOfStack(state);
        submit(state, "giant");
        // A hand card is hidden: the offer stays Cast / Decline.
        expect(offeredIds(state)).toEqual(["cast", "decline"]);
        submit(state, "cast");
        expect(offeredIds(state)).toEqual(["printed", STOMP]);
    });
});

describe("modal double-faced card cast during resolution (CR 712.11b / 712.11c)", () => {
    it("the effect's generic permission reaches the back face, priced as that face", () => {
        const state = resolveOffer(
            modalInstantBackProbe.id,
            lands("Mountain", 1)
        );
        // {R} covers the back; the front's {1}{W} stays a row, as a printed cast
        // always has (the offer does not ask its payment, CR 601.2h).
        expect(offeredIds(state)).toEqual(["cast", FLARE, "decline"]);
        submit(state, FLARE);
        submit(state, "p2");

        const spell = spellOnStack(state)!;
        expect(spell.transformed).toBe(true);
        expect(spell.types).toEqual(["Instant"]);
        expect(tappedCount(state)).toBe(1);
    });

    it("a back-face creature comes down back face up", () => {
        const state = resolveOffer(modalCreatureBackProbe.id, [
            ...lands("Forest", 3),
        ]);
        submit(state, BEHEMOTH);
        expect(spellOnStack(state)!.power).toBe(4);
        expect(tappedCount(state)).toBe(3);
    });

    it("declining the offer leaves the card in exile, whatever rows it had", () => {
        const state = resolveOffer(
            modalInstantBackProbe.id,
            lands("Mountain", 1)
        );
        submit(state, "decline");
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["top"]);
        expect(tappedCount(state)).toBe(0);
    });
});

describe("a HIDDEN card keeps the byte-identical offer (CR 406.3)", () => {
    /** The real Hideaway flow: Shelldock Isle hides the top card, then its
     *  ability offers it. */
    function hiddenOffer(hiddenDefId: string): GameState {
        const isle = makeInstance(SHELLDOCK.id, {
            id: "isle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const library = [
            makeInstance(hiddenDefId, {
                id: "hidden",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            ...Array.from({ length: 4 }, (_, i) =>
                card("Hill Giant", `filler-${i}`, "p1", "library")
            ),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [isle], library }),
                makePlayer("p2", {
                    battlefield: [
                        card("Hill Giant", "bear", "p2", "battlefield"),
                    ],
                }),
            ],
        });
        const onStack = (key: Partial<StackItem>) =>
            ({
                ...isle,
                zone: "stack",
                castById: "p1",
                targets: [],
                ...key,
            }) as StackItem;
        state.stack.push(
            onStack({
                triggeredAbilityId: "hideaway",
                triggerSourceId: isle.id,
                triggerEvent: {
                    type: "PERMANENT_ENTERED",
                    instanceId: isle.id,
                    controllerId: "p1",
                    types: ["Land"],
                },
            })
        );
        resolveTopOfStack(state);
        submit(state, "hidden");
        state.stack.push(onStack({ abilityId: "shelldock-isle-play-hidden" }));
        resolveTopOfStack(state);
        return state;
    }

    it("shows the same two rows and no subject to the opponent, then asks the face once accepted", () => {
        const state = hiddenOffer(STAND_DELIVER.id);
        const asSeenByOpponent = projectPublicState(state, 1, "p2")
            .pendingChoices![0];
        expect(asSeenByOpponent.options?.map((o) => o.id)).toEqual([
            "cast",
            "decline",
        ]);
        expect(asSeenByOpponent.options?.[0].label).toBe("Play");
        expect(asSeenByOpponent.subjectCardId).toBeUndefined();

        submit(state, "cast");
        expect(offeredIds(state)).toEqual([STAND, DELIVER]);
        submit(state, STAND);
        submit(state, "bear");
        expect(spellOnStack(state, "hidden")?.targets?.[0]?.id).toBe("bear");
    });

    it("a hidden one-spell card never sees a face prompt", () => {
        const state = hiddenOffer(HILL_GIANT.id);
        submit(state, "cast");
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(spellOnStack(state, "hidden")).toBeDefined();
    });
});

describe("cascade (CR 702.85a) asks the RESULTING spell's mana value of each face", () => {
    function cascadeOver(spellCost: { X: number; R: number }): GameState {
        const id = `test-cdr-face-cascade-${spellCost.X}`;
        registerTokenDefinition({
            id,
            name: id,
            rarity: "common",
            manaCost: spellCost,
            types: ["Sorcery"],
            effects: [{ op: "cascade", player: "controller" }],
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(modalCreatureBackProbe.id, {
                            id: "top",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        return state;
    }

    it("withholds a back face whose mana value is not below the cascading spell's", () => {
        // Front {W} = 1 < 2 is the hit; the back {2}{G} = 3 is no cast here.
        expect(offeredIds(cascadeOver({ X: 1, R: 1 }))).toEqual([
            "cast",
            "decline",
        ]);
    });

    it("offers it when it is below, for free", () => {
        const state = cascadeOver({ X: 3, R: 1 });
        expect(offeredIds(state)).toEqual(["cast", BEHEMOTH, "decline"]);
        submit(state, BEHEMOTH);
        expect(spellOnStack(state)!.power).toBe(4);
        expect(tappedCount(state)).toBe(0);
    });
});

describe('"any number" loop (CR 608.2g) announces a face per card', () => {
    it("asks the picked card's face, and a lone reachable half needs no prompt", () => {
        const script = registerScript("test-cdr-face-any", [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                count: 2,
                prompt: "Choose cards.",
                bind: "$picked",
            },
            {
                op: "castDuringResolution",
                card: { ref: "$picked" },
                player: "controller",
                source: "hand",
                free: true,
                anyNumber: true,
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        card("Bonecrusher Giant", "giant", "p1", "hand"),
                        card("Stand // Deliver", "split", "p1", "hand"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, script, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["giant", "split"],
        });

        submit(state, "giant");
        expect(offeredIds(state)).toEqual(["printed", STOMP]);
        submit(state, STOMP);
        submit(state, "p2");
        expect(spellOnStack(state, "giant")?.types).toEqual(["Instant"]);

        // No creature, nothing but the land-less board: Stand has no target, and
        // Deliver has none either, so the split card drops out of the loop.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["split"]);
    });
});

describe("Word of Command (ADR 0037, CR 709.3 / 715.3) — a controlled cast announces too", () => {
    function worded(handCardName: string, p2Lands: CardInstanceState[]) {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [card(handCardName, "chosen", "p2", "hand")],
                    battlefield: p2Lands,
                }),
            ],
        });
        pushSpell(state, WORD_OF_COMMAND.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        submit(state, "chosen");
        return state;
    }

    it("routes the face to the controller and pays from the controlled player's lands", () => {
        const state = worded("Bonecrusher Giant", lands("Mountain", 3, "p2"));
        expect(state.pendingChoices![0].playerId).toBe("p1");
        expect(offeredIds(state)).toEqual(["printed", STOMP]);
        submit(state, STOMP);
        submit(state, "p1");

        const spell = spellOnStack(state, "chosen")!;
        expect(spell.castById).toBe("p2");
        expect(spell.actingPlayerId).toBe("p1");
        expect(spell.types).toEqual(["Instant"]);
        expect(tappedCount(state, 1)).toBe(2);
    });

    it("a split card with one castable half takes it with no prompt; it never prices the whole card", () => {
        const state = worded("Stand // Deliver", [
            ...lands("Plains", 1, "p2"),
            card("Hill Giant", "bear", "p2", "battlefield"),
        ]);
        // Only Stand is payable: straight to its target.
        expect(state.pendingChoices![0].kind).toBe("choose-damage-target");
        submit(state, "bear");
        expect(tappedCount(state, 1)).toBe(1);
        expect(spellOnStack(state, "chosen")).toBeDefined();
    });
});

// A printed Hill Giant has no faces: the offer every shipped single-spell card
// raises must not change by a byte.
describe("a card that is one spell", () => {
    it("keeps the plain Cast / Decline offer", () => {
        const state = resolveOffer(HILL_GIANT.id, lands("Mountain", 4));
        const options = projectPublicState(state, 1, "p1").pendingChoices![0]
            .options!;
        expect(options.map((o) => o.label)).toEqual(["Cast", "Decline"]);
    });
});
