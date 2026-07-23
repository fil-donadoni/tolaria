// ONE — per-card behavior tests for multicolor cards in
// `convex/cards/sets/one/multicolor.ts` (set split by colour, ADR 0043).
//
// Atraxa's ETB uses `revealAndCategorize`, an Op the catalogue-wide
// auto-generated smoke test explicitly SKIPS (it suspends on a live
// categorized look-distribute pick), so per
// `.claude/rules/gre-development.md` § DSL-first authoring the card earns a
// hand-written test. The Op's own mechanics are pinned in
// `convex/gre/effects/__tests__/interpreter.test.ts` and
// `convex/gre/__tests__/categorizedPick.test.ts`; what THIS file proves is
// that Atraxa's own script wires them to the right oracle text — ten cards,
// one per card type, optional, random bottom, public reveal — and that the
// categorized pick survives the wire projection the client actually reads.

import { describe, it, expect } from "vitest";
import { atraxaGrandUnifier } from "../multicolor";
import { grizzlyBears } from "../../lea/green";
import { swamp } from "../../lea/colorless";
import { lightningBolt } from "../../lea/red";
import { blackLotus } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

/** Atraxa on the battlefield with `library` (top-first) under her, then her
 *  ETB trigger collected and put on the stack. */
function atraxaEntering(library: { id: string; defId: string }[]): GameState {
    const atraxa = makeInstance(atraxaGrandUnifier.id, {
        id: "atraxa",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [atraxa],
                library: library.map((c) =>
                    makeInstance(c.defId, {
                        id: c.id,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
    const triggers = collectTriggers(state, [
        {
            type: "PERMANENT_ENTERED",
            instanceId: "atraxa",
            controllerId: "p1",
            cardId: atraxaGrandUnifier.id,
            types: ["Creature"],
        },
    ]);
    expect(triggers).toHaveLength(1);
    state.stack.push(...triggers);
    return state;
}

function answer(state: GameState, picks: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

describe("Atraxa, Grand Unifier (ONE, {3}{G}{W}{U}{B} — CR 701.20a reveal + CR 401.4)", () => {
    it("is a 7/7 legendary Phyrexian Angel with all four printed keywords", () => {
        expect(atraxaGrandUnifier.manaCost).toEqual({
            X: 3,
            W: 1,
            U: 1,
            B: 1,
            G: 1,
        });
        expect(atraxaGrandUnifier.types).toEqual(["Creature"]);
        expect(atraxaGrandUnifier.supertypes).toEqual(["Legendary"]);
        expect(atraxaGrandUnifier.subtypes).toEqual(["Phyrexian", "Angel"]);
        expect(atraxaGrandUnifier.power).toBe(7);
        expect(atraxaGrandUnifier.toughness).toBe(7);
        expect(atraxaGrandUnifier.staticAbilities).toEqual([
            "flying",
            "vigilance",
            "deathtouch",
            "lifelink",
        ]);
    });

    it("is authored as an Effect Script — no resolve() escape hatch (ADR 0045)", () => {
        const ability = atraxaGrandUnifier.triggeredAbilities![0];
        expect(ability.resolve).toBeUndefined();
        expect(ability.resolveSteps).toBeUndefined();
        const op = ability.effects![0];
        expect(op.op).toBe("revealAndCategorize");
        expect(op).toMatchObject({
            look: 10, // "the top ten cards"
            reveal: "window", // "REVEAL"
            optional: true, // "you MAY put"
            randomBottom: true, // "on the bottom ... in a random order"
        });
    });

    it("categorizes by CARD TYPE, per CR 205.2a rather than the printed reminder list", () => {
        const op = atraxaGrandUnifier.triggeredAbilities![0].effects![0];
        // The reminder text lists eight types because it predates the
        // Tribal → Kindred rename; reminder text is not rules text (CR 207.2)
        // and the ability says "for each card type".
        expect(
            (op as { categories: { label: string }[] }).categories.map(
                (c) => c.label
            )
        ).toEqual([
            "Artifact",
            "Battle",
            "Creature",
            "Enchantment",
            "Instant",
            "Kindred",
            "Land",
            "Planeswalker",
            "Sorcery",
        ]);
    });

    it("ETB: reveals the top ten and keeps one card of each type, bottoming the rest", () => {
        // Top ten: two creatures, two lands, an instant and an artifact, then
        // four more creatures. Only ONE of each type may be kept.
        const state = atraxaEntering([
            { id: "bear1", defId: grizzlyBears.id },
            { id: "swamp1", defId: swamp.id },
            { id: "bolt1", defId: lightningBolt.id },
            { id: "lotus1", defId: blackLotus.id },
            { id: "bear2", defId: grizzlyBears.id },
            { id: "swamp2", defId: swamp.id },
            { id: "bear3", defId: grizzlyBears.id },
            { id: "bear4", defId: grizzlyBears.id },
            { id: "bear5", defId: grizzlyBears.id },
            { id: "bear6", defId: grizzlyBears.id },
            // The eleventh card is never revealed and must stay on top.
            { id: "deep", defId: grizzlyBears.id },
        ]);

        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        // Exactly the top TEN are revealed — never the eleventh.
        expect(head.candidateIds).toHaveLength(10);
        expect(head.candidateIds).not.toContain("deep");
        // Four types are represented (creature / land / instant / artifact),
        // so at most four cards are keepable — not nine (the category count).
        expect(head.count).toEqual({ min: 0, max: 4 });

        answer(state, ["bear1", "swamp1", "bolt1", "lotus1"]);

        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id).sort()).toEqual([
            "bear1",
            "bolt1",
            "lotus1",
            "swamp1",
        ]);
        // The six unkept revealed cards went to the BOTTOM, under the
        // untouched eleventh card — which is still on top.
        expect(p1.library[0].id).toBe("deep");
        expect(p1.library).toHaveLength(7);
    });

    it("refuses a second card of the same type (one per card type, CR 608.2b)", () => {
        const state = atraxaEntering([
            { id: "bear1", defId: grizzlyBears.id },
            { id: "bear2", defId: grizzlyBears.id },
            { id: "swamp1", defId: swamp.id },
        ]);
        resolveTopOfStack(state);
        expect(() => answer(state, ["bear1", "bear2"])).toThrow(
            /different category/
        );
        // One creature plus one land is the legal shape.
        answer(state, ["bear1", "swamp1"]);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "bear1",
            "swamp1",
        ]);
    });

    it("keeps nothing when the controller declines — the whole window is bottomed", () => {
        const state = atraxaEntering([
            { id: "bear1", defId: grizzlyBears.id },
            { id: "swamp1", defId: swamp.id },
        ]);
        resolveTopOfStack(state);
        answer(state, []);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("resolves with no prompt at all when the library is empty (CR 608.2b)", () => {
        const state = atraxaEntering([]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("wire format: the projected choice carries the categories and the revealed window", () => {
        // The client gates its clicks off the PROJECTED choice. A `categories`
        // list dropped by the projection would leave the picker unable to tell
        // a legal keep from an illegal one — the exact reducer-drop bug class
        // `.claude/rules/gre-development.md` § Frontend wiring analysis names.
        const state = atraxaEntering([
            { id: "bear1", defId: grizzlyBears.id },
            { id: "swamp1", defId: swamp.id },
            { id: "bolt1", defId: lightningBolt.id },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        const byLabel = new Map(
            head.categories!.map((c) => [c.label, c.cardIds])
        );
        expect(byLabel.get("Creature")).toEqual(["bear1"]);
        expect(byLabel.get("Land")).toEqual(["swamp1"]);
        expect(byLabel.get("Instant")).toEqual(["bolt1"]);
        expect(byLabel.get("Planeswalker")).toEqual([]);
        // The revealed window is exposed face-up to the chooser only.
        expect(projected.players[0].libraryPeek!.map((c) => c.id)).toEqual([
            "bear1",
            "swamp1",
            "bolt1",
        ]);
        // The opponent's view never gets the peek.
        const opponentView = projectPublicState(state, 1, "p2");
        expect(opponentView.players[0].libraryPeek).toBeUndefined();
    });
});
