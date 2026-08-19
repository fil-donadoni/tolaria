// war — black card tests.
//
// Bolas's Citadel introduces three engine capabilities at once (issue #2398),
// so it earns the full regime rather than riding the DSL smoke sweep:
//
//   * the CONTROLLER-ONLY continuous look at the top of the library
//     (CR 401.5, `looksAtLibraryTop`) — asymmetric, unlike the existing
//     both-seats reveal, so the wire assertions below check BOTH viewpoints;
//   * cast-from-top-of-library permission (CR 601.3e-analog,
//     `castsSpellsFromTopOfLibrary`) — the spell twin of Courser of Kruphix's
//     land permission, position-strict at index 0;
//   * a WHOLESALE mana-cost substitution (CR 118.9-analog / 119.4 / 107.3b,
//     `manaCostReplacement: "life-equal-to-mana-value"`) — the first cost in
//     the engine whose life amount is DERIVED from the card being cast.
//
// The drain clause reuses shipped shapes ({T} + a filtered sacrifice cost +
// the `loseLife` Op) and is covered here only for the one thing that IS new:
// `sacrificeFilterCount`, generalizing the single-permanent sacrifice cost.

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type StackItem,
} from "../../../../gre/state";
import {
    canCastSpellsFromTopOfLibrary,
    isCastableLibraryTopSpell,
    libraryTopCastLifeCost,
    getLegalActions,
} from "../../../../gre/rules";
import {
    computeLibraryTopLookedAtPlayers,
    computeLibraryTopRevealedPlayers,
} from "../../../../gre/libraryReveal";
import { buildActivationSacrificeSelection } from "../../../../gre/activationCostPicks";
import { applySacrificeSelection } from "../../../../gre/sacrificeChoice";
import { projectPublicState } from "../../../../gameProjections";
import { locateCastSource, castRawManaCost } from "../../../../game";
import { makeInstance } from "../../../__tests__/setup";
import { citadelBoard } from "./citadelBoard";
import { bolassCitadel } from "../black";
import { forest, mountain } from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import { fireball } from "../../lea/red";

describe("Bolas's Citadel — cast-from-top permission (CR 601.3e-analog)", () => {
    it("canCastSpellsFromTopOfLibrary is held only by the Citadel's controller", () => {
        const state = citadelBoard([grizzlyBears.id]);
        expect(
            canCastSpellsFromTopOfLibrary(state, getPlayer(state, "p1"))
        ).toBeDefined();
        expect(
            canCastSpellsFromTopOfLibrary(state, getPlayer(state, "p2"))
        ).toBeUndefined();
    });

    it("the permission ends the instant the Citadel leaves the battlefield", () => {
        const state = citadelBoard([grizzlyBears.id]);
        getPlayer(state, "p1").battlefield = [];
        expect(
            canCastSpellsFromTopOfLibrary(state, getPlayer(state, "p1"))
        ).toBeUndefined();
        expect(
            isCastableLibraryTopSpell(state, getPlayer(state, "p1"), "p1-lib-0")
        ).toBe(false);
    });

    it("isCastableLibraryTopSpell accepts index 0 but NOT a spell deeper in the library (CR 400.2)", () => {
        const state = citadelBoard([grizzlyBears.id, fireball.id]);
        const p1 = getPlayer(state, "p1");
        expect(isCastableLibraryTopSpell(state, p1, "p1-lib-0")).toBe(true);
        expect(isCastableLibraryTopSpell(state, p1, "p1-lib-1")).toBe(false);
    });

    it("isCastableLibraryTopSpell rejects a LAND on top (CR 305.9 — a land is played, never cast)", () => {
        const state = citadelBoard([forest.id]);
        expect(
            isCastableLibraryTopSpell(state, getPlayer(state, "p1"), "p1-lib-0")
        ).toBe(false);
    });

    it("getLegalActions offers 'cast' for the top spell and 'play' for a top land", () => {
        const spellBoard = citadelBoard([grizzlyBears.id]);
        const p1 = getPlayer(spellBoard, "p1");
        expect(getLegalActions(spellBoard, p1, p1.library[0])).toContain(
            "cast"
        );

        const landBoard = citadelBoard([forest.id]);
        const lp1 = getPlayer(landBoard, "p1");
        expect(getLegalActions(landBoard, lp1, lp1.library[0])).toContain(
            "play"
        );
    });

    it("offers no 'cast' without a Citadel on the battlefield", () => {
        const state = citadelBoard([grizzlyBears.id], false);
        const p1 = getPlayer(state, "p1");
        expect(getLegalActions(state, p1, p1.library[0])).not.toContain("cast");
    });
});

describe("Bolas's Citadel — life instead of mana (CR 118.9-analog / 119.4 / 107.3b)", () => {
    it("charges life equal to the card's mana value", () => {
        const state = citadelBoard([grizzlyBears.id]);
        const p1 = getPlayer(state, "p1");
        // Grizzly Bears is {1}{G} — mana value 2.
        expect(libraryTopCastLifeCost(state, p1, p1.library[0])).toBe(2);
    });

    it("counts {X} as 0 off the stack (CR 107.3b)", () => {
        const state = citadelBoard([fireball.id]);
        const p1 = getPlayer(state, "p1");
        // Fireball is {X}{R} — mana value 1 with X treated as 0.
        expect(libraryTopCastLifeCost(state, p1, p1.library[0])).toBe(1);
    });

    it("is 0 without the permission (a card in hand pays its printed cost)", () => {
        const state = citadelBoard([grizzlyBears.id], false);
        const p1 = getPlayer(state, "p1");
        expect(libraryTopCastLifeCost(state, p1, p1.library[0])).toBe(0);
    });

    it("locateCastSource resolves the top card to the LIBRARY zone and castRawManaCost zeroes the mana", () => {
        const state = citadelBoard([grizzlyBears.id]);
        const p1 = getPlayer(state, "p1");
        const source = locateCastSource(state, p1, "p1-lib-0");
        expect(source.zone).toBe("library");
        expect(source.card?.id).toBe("p1-lib-0");
        expect(castRawManaCost(state, source.card!, source.zone)).toEqual({});
    });

    it("a card in HAND is unaffected — still located in hand, still pays its printed mana cost", () => {
        const state = citadelBoard([]);
        const p1 = getPlayer(state, "p1");
        const inHand = makeInstance(grizzlyBears.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "p1-hand-0",
            zone: "hand",
        });
        p1.hand.push(inHand);
        const source = locateCastSource(state, p1, "p1-hand-0");
        expect(source.zone).toBe("hand");
        expect(castRawManaCost(state, source.card!, source.zone)).toEqual({
            X: 1,
            G: 1,
        });
    });

    it("CR 119.4 — the cast is legal at exactly enough life and illegal below it", () => {
        const exact = citadelBoard([grizzlyBears.id], true, { life: 2 });
        const p1 = getPlayer(exact, "p1");
        expect(getLegalActions(exact, p1, p1.library[0])).toContain("cast");

        const short = citadelBoard([grizzlyBears.id], true, { life: 1 });
        const sp1 = getPlayer(short, "p1");
        expect(getLegalActions(short, sp1, sp1.library[0])).not.toContain(
            "cast"
        );
    });
});

describe("Bolas's Citadel — top-of-library look is controller-only (CR 401.5)", () => {
    it("the controller may look; the reveal set stays empty (it is not a public reveal)", () => {
        const state = citadelBoard([grizzlyBears.id]);
        expect(computeLibraryTopLookedAtPlayers(state).has("p1")).toBe(true);
        expect(computeLibraryTopLookedAtPlayers(state).has("p2")).toBe(false);
        expect(computeLibraryTopRevealedPlayers(state).size).toBe(0);
    });

    it("WIRE — the top card crosses to its controller and to NOBODY else", () => {
        const state = citadelBoard([grizzlyBears.id, fireball.id]);

        const own = projectPublicState(state, 1, "p1");
        const ownLib = own.players.find((p) => p.id === "p1")!.library;
        expect(ownLib.known.map((k) => k.index)).toEqual([0]);
        expect(ownLib.known[0].card.card.id).toBe(grizzlyBears.id);
        // The affordance rides the same card object (CR 601.3e-analog).
        expect(ownLib.known[0].card.legalActions).toContain("cast");

        const theirs = projectPublicState(state, 1, "p2");
        const theirLib = theirs.players.find((p) => p.id === "p1")!.library;
        expect(theirLib.known).toEqual([]);
        expect(theirLib.count).toBe(2);
    });

    it("WIRE — the look follows the POSITION: after a draw the NEW top card is the visible one (CR 401.6)", () => {
        const state = citadelBoard([grizzlyBears.id, fireball.id]);
        const p1 = getPlayer(state, "p1");
        p1.hand.push(p1.library.shift()!);

        const own = projectPublicState(state, 1, "p1");
        const ownLib = own.players.find((p) => p.id === "p1")!.library;
        expect(ownLib.known.map((k) => k.card.card.id)).toEqual([fireball.id]);
    });

    it("WIRE — no Citadel, no visibility and no affordance", () => {
        const state = citadelBoard([grizzlyBears.id], false);
        const own = projectPublicState(state, 1, "p1");
        expect(own.players.find((p) => p.id === "p1")!.library.known).toEqual(
            []
        );
    });
});

describe("Bolas's Citadel — {T}, Sacrifice ten nonland permanents (CR 602.1 / 118.5)", () => {
    /** `count` nonland permanents plus `lands` lands under p1, alongside the
     *  Citadel itself (which is a legal victim — it is a nonland permanent). */
    function boardWith(nonlands: number, lands: number) {
        const state = citadelBoard([]);
        const p1 = getPlayer(state, "p1");
        for (let i = 0; i < nonlands; i++) {
            p1.battlefield.push(
                makeInstance(grizzlyBears.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                    id: `bear-${i}`,
                })
            );
        }
        for (let i = 0; i < lands; i++) {
            p1.battlefield.push(
                makeInstance(mountain.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                    id: `mtn-${i}`,
                })
            );
        }
        return state;
    }

    const drain = bolassCitadel.activatedAbilities![0];

    it("the production selection builder owes exactly ten picks", () => {
        const state = boardWith(12, 4);
        const p1 = getPlayer(state, "p1");
        const selection = buildActivationSacrificeSelection(
            state,
            drain,
            p1.battlefield.find((c) => c.id === "citadel")!,
            p1,
            "Bolas's Citadel"
        )!;
        expect(selection.requirements).toHaveLength(1);
        expect(selection.requirements[0].count).toBe(10);
        // CR 205 — lands never qualify, however many are on the battlefield.
        expect(selection.requirements[0].filter.excludeTypes).toBe("Land");
    });

    it("resolving the ability drains each opponent for 10 (CR 119.3)", () => {
        const state = boardWith(10, 0);
        const p1 = getPlayer(state, "p1");
        const source = p1.battlefield.find((c) => c.id === "citadel")!;

        // Pay the cost exactly as the mutation does: tap the source, then run
        // the player-chosen sacrifice through the unified layer.
        source.isTapped = true;
        const selection = buildActivationSacrificeSelection(
            state,
            drain,
            source,
            p1,
            "Bolas's Citadel"
        )!;
        selection.picked = p1.battlefield
            .filter((c) => !c.types.includes("Land") && c.id !== "citadel")
            .slice(0, 10)
            .map((c) => c.id);
        applySacrificeSelection(state, selection);
        expect(getPlayer(state, "p1").battlefield).toHaveLength(1);

        // `abilityId` is what makes a stack item an ACTIVATED ability rather
        // than a spell (`resolveTopOfStack`); the source permanent stays on
        // the battlefield.
        const item: StackItem = {
            ...(source as CardInstanceState),
            castById: "p1",
            abilityId: drain.id,
            targets: [],
        };
        state.stack.push(item);
        resolveTopOfStack(state);

        expect(getPlayer(state, "p2").life).toBe(10);
        expect(getPlayer(state, "p1").life).toBe(20);
    });
});
