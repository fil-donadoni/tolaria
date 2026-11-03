// Miracle (CR 702.94) — the reveal window at the draw seam, the private
// reveal choice, the linked triggered ability (CR 603.11) and the cast for the
// miracle cost during its resolution (CR 608.2g), on every draw site that can
// put a first card of the turn into a hand.
//
// CR 702.94a: "Miracle [cost]" means "You may reveal this card from your hand
// as you draw it if it's the first card you've drawn this turn. When you
// reveal this card this way, you may cast it by paying [cost] rather than its
// mana cost."

import { describe, it, expect } from "vitest";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { registerTokenDefinition, getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    resolveTopOfStack,
    type GameState,
    type PendingChoice,
} from "../state";
import {
    applyMiracleRevealSubmit,
    applyPendingChoiceSubmit,
} from "../pendingChoiceSubmit";
import { advancePhase } from "../phases";
import { applyRaisedTargetFinalization } from "../pendingTargetOrigin";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { computeSoloViewerId } from "../../soloViewer";
import { validateEffectScript } from "../effects/validate";
import { GOLDEN_FIXTURES } from "../../oracle/grammar/fixtures";
import { metamorphosisFanatic } from "../../cards/sets/dsc/black.cards";

const islandId = getCardByName("Island").id;
const swampId = getCardByName("Swamp").id;
const bearsId = getCardByName("Balduvian Bears").id;
const sphereId = getCardByName("Sphere of Resistance").id;

/** Devastation Tide, exactly as the compiler emits it (its golden fixture's
 *  expected definition), registered under a test id: the timing proof runs on
 *  the compiled card, not a lookalike. */
const TIDE_ID = "test-miracle-devastation-tide";
registerTokenDefinition({
    ...(GOLDEN_FIXTURES.find((f) => f.card.name === "Devastation Tide")!
        .expected as unknown as CardDefinition),
    id: TIDE_ID,
    rarity: "rare",
});

/** A sorcery whose only effect is a DSL `draw` of `count` for `player`. */
function registerDrawSpell(
    id: string,
    count: number,
    player: "controller" | "opponent" = "controller"
): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { U: 1 },
        types: ["Sorcery"],
        effects: [{ op: "draw", player, count } as EffectOp],
    });
    return id;
}

/** A legacy `resolve()` sorcery drawing through the SYNCHRONOUS primitive. */
const SYNC_DRAW_ID = "test-miracle-sync-draw";
registerTokenDefinition({
    id: SYNC_DRAW_ID,
    name: SYNC_DRAW_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    resolve: (ctx) => ctx.drawCards(ctx.controller, 1),
});

function card(cardId: string, id: string, ownerId: string, zone: string) {
    return makeInstance(cardId, {
        id,
        ownerId,
        controllerId: ownerId,
        zone: zone as never,
    });
}

function islands(ownerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        card(islandId, `${ownerId}-island-${i}`, ownerId, "battlefield")
    );
}

/** p1 resolves a draw spell; `tide` sits on top of the drawing library. */
function drawSpellState(opts: {
    spellId: string;
    drawer?: "p1" | "p2";
    drawnThisTurn?: string[];
    p1Battlefield?: ReturnType<typeof card>[];
    p2Battlefield?: ReturnType<typeof card>[];
}): GameState {
    const drawer = opts.drawer ?? "p1";
    const library = [
        card(TIDE_ID, "tide", drawer, "library"),
        card(bearsId, `${drawer}-second`, drawer, "library"),
    ];
    const state = makeState({
        players: [
            makePlayer("p1", {
                ...(drawer === "p1" ? { library } : {}),
                ...(drawer === "p1" && opts.drawnThisTurn
                    ? { drawnThisTurn: opts.drawnThisTurn }
                    : {}),
                battlefield: opts.p1Battlefield ?? islands("p1", 2),
            }),
            makePlayer("p2", {
                ...(drawer === "p2" ? { library } : {}),
                battlefield: opts.p2Battlefield ?? [
                    card(bearsId, "p2-bears", "p2", "battlefield"),
                ],
            }),
        ],
    });
    pushSpell(state, opts.spellId, "p1");
    return state;
}

const head = (state: GameState): PendingChoice | undefined =>
    state.pendingChoices?.[0];

const hand = (state: GameState, i: number) =>
    state.players[i].hand.map((c) => c.id);

describe("Miracle reveal window (CR 702.94a) — raised at the draw itself", () => {
    it("the FIRST draw of the turn raises a private reveal choice for the drawer", () => {
        const state = drawSpellState({
            spellId: registerDrawSpell("test-miracle-draw-one", 1),
        });
        expect(resolveTopOfStack(state)).toBeNull(); // suspended mid-resolution
        expect(head(state)).toMatchObject({
            kind: "miracle-reveal",
            playerId: "p1",
            cardInstanceId: "tide",
            privateToChooser: true,
        });
        expect(head(state)!.stackItemId).not.toBe("");
        expect(hand(state, 0)).toEqual(["tide"]); // the draw happened
    });

    it("a second-or-later draw of the turn raises nothing", () => {
        const state = drawSpellState({
            spellId: registerDrawSpell("test-miracle-draw-late", 1),
            drawnThisTurn: ["earlier-draw"],
        });
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(hand(state, 0)).toEqual(["tide"]);
        expect(state.stack).toHaveLength(0);
    });

    it("on 'draw two cards' the reveal is asked BEFORE the second card is drawn", () => {
        const state = drawSpellState({
            spellId: registerDrawSpell("test-miracle-draw-two", 2),
        });
        resolveTopOfStack(state);
        expect(head(state)?.kind).toBe("miracle-reveal");
        // The second card is still on the library: the player decides
        // without having seen it.
        expect(hand(state, 0)).toEqual(["tide"]);
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "p1-second",
        ]);
        applyMiracleRevealSubmit(state, { playerId: "p1", reveal: false });
        // Resumed at the next card — drawn once, never re-drawn.
        expect(hand(state, 0)).toEqual(["tide", "p1-second"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("declining leaves an ordinary hidden card: no trigger, no stack object", () => {
        const state = drawSpellState({
            spellId: registerDrawSpell("test-miracle-decline", 1),
        });
        resolveTopOfStack(state);
        applyMiracleRevealSubmit(state, { playerId: "p1", reveal: false });
        expect(state.stack).toHaveLength(0);
        const tide = state.players[0].hand.find((c) => c.id === "tide")!;
        expect(tide.knownTo ?? []).not.toContain("p2");
    });

    it("the turn-based draw step raises it too (stackless), and revealing triggers", () => {
        const tide = card(TIDE_ID, "tide", "p1", "library");
        const state = makeState({
            turn: 3,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    library: [tide],
                    battlefield: islands("p1", 2),
                }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state); // → DRAW: CR 504.1 draw, then the window
        expect(head(state)).toMatchObject({
            kind: "miracle-reveal",
            playerId: "p1",
            stackItemId: "",
            privateToChooser: true,
        });
        applyMiracleRevealSubmit(state, { playerId: "p1", reveal: true });
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].delayedEffects?.[0]).toMatchObject({
            op: "castDuringResolution",
            source: "hand",
            alternativeCost: { X: 1, U: 1 },
        });
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("the linked trigger joins the draw's own triggers in ONE APNAP batch (CR 603.3b)", () => {
        // p1 draws in their draw step under p2's Sheoldred ("Whenever an
        // opponent draws a card, they lose 2 life"). Both abilities triggered
        // on that draw, so the active player's goes on the stack first and
        // the non-active player's lands on top — never the reverse order a
        // flush BEFORE the reveal would produce.
        const sheoldred = card(
            getCardByName("Sheoldred, the Apocalypse").id,
            "sheoldred",
            "p2",
            "battlefield"
        );
        const state = makeState({
            turn: 3,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    library: [card(TIDE_ID, "tide", "p1", "library")],
                    battlefield: islands("p1", 2),
                }),
                makePlayer("p2", { battlefield: [sheoldred] }),
            ],
        });
        advancePhase(state);
        expect(head(state)?.kind).toBe("miracle-reveal");
        expect(state.stack).toHaveLength(0); // nothing placed before the answer
        applyMiracleRevealSubmit(state, { playerId: "p1", reveal: true });
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].controllerId).toBe("p1"); // the miracle trigger
        expect(state.stack[0].delayedEffects?.[0].op).toBe(
            "castDuringResolution"
        );
        expect(state.stack[1].controllerId).toBe("p2"); // Sheoldred, on top
    });

    it("the synchronous draw primitive raises it STACKLESS, answered after the resolution", () => {
        const state = drawSpellState({ spellId: SYNC_DRAW_ID });
        // The resolve() closure completes — the stackless window does not
        // park it.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(0);
        expect(head(state)).toMatchObject({
            kind: "miracle-reveal",
            stackItemId: "",
        });
        expect(state.priorityPlayerId).toBe("p1");
        applyMiracleRevealSubmit(state, { playerId: "p1", reveal: true });
        expect(state.stack).toHaveLength(1);
    });
});

describe("the linked triggered ability (CR 702.94a / 603.11) and the miracle cast (CR 608.2g)", () => {
    function revealedTrigger(
        spellId: string,
        p1Battlefield = islands("p1", 2)
    ) {
        const state = drawSpellState({ spellId, p1Battlefield });
        resolveTopOfStack(state);
        applyMiracleRevealSubmit(state, { playerId: "p1", reveal: true });
        return state;
    }

    it("revealing shows the card to every player and puts a real trigger on the stack", () => {
        const state = revealedTrigger(registerDrawSpell("test-miracle-rev", 1));
        const tide = state.players[0].hand.find((c) => c.id === "tide")!;
        expect(tide.knownTo).toEqual(expect.arrayContaining(["p1", "p2"]));
        // CR 117.3b — the spell finished; the trigger waits on the stack with
        // priority to the active player, so the opponent gets a window too.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].controllerId).toBe("p1");
        expect(state.stack[0].triggerSourceId).toBe("tide");
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("on resolution, Cast puts the spell on the stack having paid the MIRACLE cost", () => {
        const state = revealedTrigger(
            registerDrawSpell("test-miracle-cast", 1),
            [...islands("p1", 5)]
        );
        expect(resolveTopOfStack(state)).toBeNull(); // the Cast/Decline offer
        const offer = head(state)!;
        expect(offer.kind).toBe("option-pick");
        expect(offer.subjectCardId).toBe(TIDE_ID); // revealed → public
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });
        const top = state.stack[state.stack.length - 1];
        expect((top.card as { id?: string }).id).toBe(TIDE_ID);
        // {1}{U}, not {3}{U}{U}: two of the five Islands tapped.
        const tapped = state.players[0].battlefield.filter((c) => c.isTapped);
        expect(tapped).toHaveLength(2);
        expect(hand(state, 0)).not.toContain("tide");
    });

    it("cost modifiers still apply to the miracle cost (CR 601.2f)", () => {
        const sphere = card(sphereId, "sphere", "p2", "battlefield");
        const state = drawSpellState({
            spellId: registerDrawSpell("test-miracle-sphere", 1),
            p1Battlefield: islands("p1", 5),
            p2Battlefield: [sphere],
        });
        resolveTopOfStack(state);
        applyMiracleRevealSubmit(state, { playerId: "p1", reveal: true });
        resolveTopOfStack(state);
        const offer = head(state)!;
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });
        // Sphere of Resistance: {1} more → three Islands for {1}{U} + {1}.
        expect(
            state.players[0].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(3);
    });

    it("declining the cast leaves the card in hand", () => {
        const state = revealedTrigger(
            registerDrawSpell("test-miracle-nocast", 1)
        );
        resolveTopOfStack(state);
        const offer = head(state)!;
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["decline"],
        });
        expect(state.stack).toHaveLength(0);
        expect(hand(state, 0)).toContain("tide");
    });

    it("a card that left the hand before the trigger resolves is not cast", () => {
        const state = revealedTrigger(
            registerDrawSpell("test-miracle-gone", 1)
        );
        const p1 = state.players[0];
        const tide = p1.hand.splice(
            p1.hand.findIndex((c) => c.id === "tide"),
            1
        )[0];
        p1.graveyard.push({ ...tide, zone: "graveyard" });
        expect(resolveTopOfStack(state)).not.toBeNull(); // silent pass
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("a SORCERY revealed on the opponent's turn is cast and resolves (CR 608.2g)", () => {
        // p1 is active and makes p2 draw: Devastation Tide is p2's first draw
        // of p1's turn.
        const state = drawSpellState({
            spellId: registerDrawSpell("test-miracle-opp-turn", 1, "opponent"),
            drawer: "p2",
            p1Battlefield: [card(bearsId, "p1-bears", "p1", "battlefield")],
            p2Battlefield: islands("p2", 2),
        });
        resolveTopOfStack(state);
        expect(head(state)).toMatchObject({
            kind: "miracle-reveal",
            playerId: "p2",
        });
        // Through the REAL projection: the opponent's seat never sees the
        // window; the drawer's does.
        expect(
            (projectPublicState(state, 1, "p1").pendingChoices ?? []).filter(
                (c) => c.kind === "miracle-reveal"
            )
        ).toHaveLength(0);
        expect(
            projectPublicState(state, 1, "p2").pendingChoices?.[0].kind
        ).toBe("miracle-reveal");
        applyMiracleRevealSubmit(state, { playerId: "p2", reveal: true });
        expect(state.activePlayerId).toBe("p1");
        resolveTopOfStack(state); // p2's trigger → the offer
        const offer = head(state)!;
        expect(offer.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });
        resolveTopOfStack(state); // Devastation Tide resolves
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "p1-bears"
        );
        expect(hand(state, 0)).toContain("p1-bears");
        // Lands are not nonland permanents: p2's Islands stay.
        expect(state.players[1].battlefield).toHaveLength(2);
    });

    it("an UNRELATED reveal of the card does not trigger the miracle ability (CR 603.11)", () => {
        // Drawn as the second card (no window), then revealed by a generic
        // reveal effect: nothing on the stack afterwards.
        const state = drawSpellState({
            spellId: registerDrawSpell("test-miracle-unrelated-draw", 1),
            drawnThisTurn: ["earlier-draw"],
        });
        resolveTopOfStack(state);
        registerTokenDefinition({
            id: "test-miracle-reveal-hand",
            name: "test-miracle-reveal-hand",
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Sorcery"],
            effects: [{ op: "reveal", player: "controller", zone: "hand" }],
        });
        pushSpell(state, "test-miracle-reveal-hand", "p1");
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});

describe("Metamorphosis Fanatic (DSC) — a creature miracle with a lifelink-counter return", () => {
    it("cast for {1}{B} via its miracle trigger, its ETB returns a creature with lifelink", () => {
        // The runtime catalogue is regenerated on the base; the set module
        // is what this change owns.
        registerTokenDefinition(metamorphosisFanatic());
        const fanaticId = metamorphosisFanatic().id;
        const fanatic = card(fanaticId, "fanatic", "p1", "library");
        const corpse = card(bearsId, "corpse", "p1", "graveyard");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [fanatic],
                    graveyard: [corpse],
                    battlefield: [
                        card(swampId, "swamp-0", "p1", "battlefield"),
                        card(swampId, "swamp-1", "p1", "battlefield"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, registerDrawSpell("test-miracle-fanatic", 1), "p1");
        resolveTopOfStack(state);
        applyMiracleRevealSubmit(state, { playerId: "p1", reveal: true });
        resolveTopOfStack(state);
        const offer = head(state)!;
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });
        resolveTopOfStack(state); // Fanatic enters; its ETB trigger waits
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "fanatic"
        );
        // CR 603.3d — the "up to one target" is chosen as the trigger goes on
        // the stack, through the engine-raised selection's own commit.
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        pt.selected = [
            { type: "graveyard-card", id: "corpse", playerId: "p1" },
        ];
        applyRaisedTargetFinalization(state, pt);
        resolveTopOfStack(state);
        const returned = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === bearsId
        )!;
        expect(returned.counters?.lifelink).toBe(1);
        expect(returned.staticAbilities).toContain("lifelink");
    });
});

describe("Private Choice on the wire (CR 702.94a)", () => {
    function openWindow(): GameState {
        const state = drawSpellState({
            spellId: registerDrawSpell("test-miracle-wire", 1),
        });
        resolveTopOfStack(state);
        return state;
    }

    it("the opponent's projection carries no trace of the window", () => {
        const state = openWindow();
        expect(
            projectPublicState(state, 1, "p2").pendingChoices
        ).toBeUndefined();
    });

    it("the chooser's projection carries it, prompt and card included", () => {
        const choice = projectPublicState(openWindow(), 1, "p1")
            .pendingChoices?.[0];
        expect(choice).toMatchObject({
            kind: "miracle-reveal",
            playerId: "p1",
            cardInstanceId: "tide",
        });
    });

    it("solo mode: the seat the solo viewer follows is the chooser, both seats driven by one client", () => {
        const state = openWindow();
        const viewer = computeSoloViewerId({
            activePlayerId: state.activePlayerId,
            priorityPlayerId: state.priorityPlayerId ?? state.activePlayerId,
            phase: state.phase,
            pendingChoices: state.pendingChoices,
            playerIds: state.players.map((p) => p.id),
        });
        expect(viewer).toBe("p1");
        expect(
            projectPublicState(state, 1, viewer).pendingChoices?.[0].kind
        ).toBe("miracle-reveal");
        // The same client driving p2 in a later window sees p2's own choices:
        // the filter keys on the chooser, never on a fixed seat.
        const p2Window = drawSpellState({
            spellId: registerDrawSpell("test-miracle-wire-p2", 1, "opponent"),
            drawer: "p2",
        });
        resolveTopOfStack(p2Window);
        const p2Viewer = computeSoloViewerId({
            activePlayerId: p2Window.activePlayerId,
            priorityPlayerId:
                p2Window.priorityPlayerId ?? p2Window.activePlayerId,
            phase: p2Window.phase,
            pendingChoices: p2Window.pendingChoices,
            playerIds: p2Window.players.map((p) => p.id),
        });
        expect(p2Viewer).toBe("p2");
        expect(
            projectPublicState(p2Window, 1, p2Viewer).pendingChoices?.[0].kind
        ).toBe("miracle-reveal");
    });

    it("the window round-trips through serialize with its privacy flag", () => {
        const state = openWindow();
        const back = expandState(compactState(state));
        expect(back.pendingChoices?.[0]).toMatchObject({
            kind: "miracle-reveal",
            privateToChooser: true,
            cardInstanceId: "tide",
        });
    });
});

/** A one-site Effect Script host for the static validator. */
function host(effects: EffectOp[]) {
    return { id: "test-miracle-host", name: "Host", effects };
}

describe("castDuringResolution's Miracle extensions (validator)", () => {
    it("accepts source 'hand' with an alternative cost", () => {
        expect(
            validateEffectScript(
                host([
                    {
                        op: "castDuringResolution",
                        player: "controller",
                        card: { ref: "$c" },
                        source: "hand",
                        alternativeCost: { X: 1, U: 1 },
                    },
                ] as unknown as EffectOp[])
            ).filter((e) => !e.includes("$c"))
        ).toEqual([]);
    });

    it("refuses an alternative cost beside a free cast", () => {
        expect(
            validateEffectScript(
                host([
                    {
                        op: "castDuringResolution",
                        player: "controller",
                        card: { ref: "$c" },
                        source: "hand",
                        free: true,
                        alternativeCost: { U: 1 },
                    },
                ] as EffectOp[])
            ).some((e) => e.includes('"alternativeCost" is not valid'))
        ).toBe(true);
    });
});
