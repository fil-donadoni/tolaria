// The ADVENTURE cast mode, end to end (CR 715, ADR 0120).
//
// The seam this file exists to prove is the CENSUS going PRE-commit. Every
// other cast mode in `CAST_MODE_CENSUS` describes the object AFTER it reaches
// the stack, and a stamp is enough for those. CR 715.3a does not work that way:
// "when casting an adventurer card as an Adventure, ONLY the alternative
// characteristics are evaluated to see if it can be cast", and timing,
// affordability and targeting all run BEFORE a stack item exists. A stamp
// applied at commit arrives too late to make an instant-speed Petty Theft legal
// — the affordance never appears, the mutation never sees the announcement, and
// nothing anywhere is red.
//
// So the assertions below walk the whole path in the order a real cast does:
// legality (`getLegalActions`) → the announcement's subject and requirement
// (`castSubjectDefinition` / `castAdjustedTargetRequirement`, the decision
// `announceCast` makes) → the stack item (`applyCastModeCharacteristics`, what
// all four commit sites call) → the WIRE (`projectPublicState`, which is all the
// client ever sees) → resolution (CR 715.3d) → the cast from exile afterwards.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { castAdjustedTargetRequirement } from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    adventureCastOptionFor,
    castAsAdventure,
    revertAdventureIdentity,
    wasCastAsAdventure,
} from "../adventure";
import {
    applyCastModeCharacteristics,
    castSubjectDefinition,
    castSubjectView,
} from "../castMode";
import { castOptionAlternativeCosts } from "../castPermissions";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import {
    getLegalActions,
    getLegalTargets,
    targetingSourceFromCard,
} from "../rules";
import { resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState, StackItem } from "../state";

const BORROWER = getCardByName("Brazen Borrower").id;
const ISLAND = getCardByName("Island").id;
const HILL_GIANT = getCardByName("Hill Giant").id;
const FOREST = getCardByName("Forest").id;

/** p1 holds Brazen Borrower with `islands` Islands; p2 has a Hill Giant and a
 *  Forest. `active` decides whose turn it is — p2's turn is where CR 715.3a
 *  bites, since neither half is castable at sorcery speed there. */
function position(islands: number, active: "p1" | "p2" = "p1"): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(BORROWER, {
                        id: "borrower",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: islands }, (_, i) =>
                    makeInstance(ISLAND, {
                        id: `island${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HILL_GIANT, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(FOREST, {
                        id: "their-forest",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: active,
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const handCard = (state: GameState): CardInstanceState =>
    state.players[0].hand.find((c) => c.id === "borrower")!;

const adventureIdFor = (state: GameState): string =>
    adventureCastOptionFor(handCard(state))!.id;

/** The stack item a committed Adventure cast produces — built the way every
 *  commit site in `game.ts` builds one (spread the card out of its zone, stamp,
 *  push), so this is the real object and not a hand-written stand-in. */
function pushAdventure(state: GameState, targetId: string): StackItem {
    const player = state.players[0];
    const altCostId = adventureIdFor(state);
    const card = player.hand.splice(
        player.hand.findIndex((c) => c.id === "borrower"),
        1
    )[0];
    const item: StackItem = {
        ...card,
        zone: "stack",
        castById: "p1",
        targets: [{ type: "permanent", id: targetId }],
    };
    applyCastModeCharacteristics(NO_BOARD_LAYER_VIEW, item, altCostId);
    state.stack.push(item);
    return item;
}

describe("CR 715.3 — the Adventure is offered as a cast option", () => {
    it("appears in the cast-option list the gate, the picker and the Bot share", () => {
        const state = position(2);
        const options = castOptionAlternativeCosts(
            state,
            state.players[0],
            handCard(state)
        );
        const adventure = options.find((o) => o.id.startsWith("adventure:"));
        expect(adventure).toBeDefined();
        // The cost IS the inset half's printed cost, not a discount.
        expect(adventure!.mana).toEqual({ X: 1, U: 1 });
        expect(adventure!.description).toContain("Petty Theft");
    });

    it("is NOT offered by a card with no inset spell", () => {
        const state = position(2);
        const plain = makeInstance(HILL_GIANT, {
            id: "plain",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        expect(adventureCastOptionFor(plain)).toBeUndefined();
    });
});

describe("CR 715.3a — only the ALTERNATIVE characteristics decide legality", () => {
    it("makes the card castable at instant speed on the opponent's turn", () => {
        // Brazen Borrower is a Creature: at sorcery speed only. Petty Theft is
        // an Instant. "Cast" must be offered on p2's turn — and it is offered
        // for the Adventure alone, which is what the per-option timing gate in
        // `announceCast` then enforces.
        const state = position(2, "p2");
        expect(
            getLegalActions(state, state.players[0], handCard(state))
        ).toContain("cast");
    });

    it("does NOT make the card castable when the ADVENTURE cannot be cast", () => {
        // Same off-turn window, but the opponent controls no nonland permanent,
        // so Petty Theft has no legal target (CR 601.2c) and the creature half
        // is sorcery-speed. Neither option is legal, and the two must not lend
        // each other legality.
        const state = position(2, "p2");
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id === "their-forest"
        );
        expect(
            getLegalActions(state, state.players[0], handCard(state))
        ).not.toContain("cast");
    });

    it("does NOT make the card castable when the Adventure is unaffordable", () => {
        const state = position(0, "p2");
        expect(
            getLegalActions(state, state.players[0], handCard(state))
        ).not.toContain("cast");
    });

    it("leaves the printed cast legal in the caster's own sorcery window", () => {
        const state = position(3, "p1");
        expect(
            getLegalActions(state, state.players[0], handCard(state))
        ).toContain("cast");
    });

    it("names the TWIN as the announcement's subject and requirement", () => {
        // This IS the decision `announceCast` makes: the target requirement it
        // announces against comes from `castAdjustedTargetRequirement` applied
        // to the cast SUBJECT. Fed the printed card instead, a Petty Theft cast
        // would announce no targets at all and resolve into nothing.
        const state = position(2);
        const parent = getCardByName("Brazen Borrower");
        const subject = castSubjectDefinition(parent, adventureIdFor(state))!;
        expect(subject.name).toBe("Petty Theft");
        const requirement = castAdjustedTargetRequirement(
            subject,
            undefined,
            false,
            false,
            false
        );
        expect(requirement?.controller).toBe("opponent");
        expect(requirement?.excludeTypes).toEqual(["Land"]);
    });

    it("offers only the opponent's NONLAND permanents as targets", () => {
        const state = position(2);
        const subject = castSubjectDefinition(
            getCardByName("Brazen Borrower"),
            adventureIdFor(state)
        )!;
        const legal = getLegalTargets(
            state,
            subject.targetRequirement!,
            // The SUBJECT view, not the printed card: CR 715.3a evaluates the
            // Adventure's characteristics, and protection / ward read the
            // source's colours and types off exactly this object.
            targetingSourceFromCard(
                castSubjectView(handCard(state), adventureIdFor(state)),
                true
            ),
            "p1"
        );
        expect(legal.map((t) => t.id)).toEqual(["giant"]);
    });

    it("keeps the PRINTED cast's subject identical for every other card", () => {
        // The census widening must be inert for the whole rest of the
        // catalogue: `subject` is the identity for every mode but this one.
        const bolt = getCardByName("Lightning Bolt");
        expect(castSubjectDefinition(bolt, undefined)).toBe(bolt);
        expect(castSubjectDefinition(bolt, "some-alt-cost")).toBe(bolt);
    });
});

describe("CR 715.3b — on the stack the spell has ONLY the alternative characteristics", () => {
    it("swaps the stack item's identity to the twin and keeps the front id", () => {
        const state = position(2);
        const item = pushAdventure(state, "giant");
        expect((item.card as { id: string }).id).toBe(`${BORROWER}#adventure`);
        expect(item.adventureOf).toBe(BORROWER);
        expect(wasCastAsAdventure(item)).toBe(true);
        expect(item.types).toEqual(["Instant"]);
        expect(item.subtypes).toEqual(["Adventure"]);
        expect(item.power).toBeUndefined();
        expect(item.toughness).toBeUndefined();
        // A 3/1 flier's keywords must not ride onto an Instant.
        expect(item.staticAbilities).toEqual([]);
    });

    it("SURFACE: the projected stack row resolves to Petty Theft", () => {
        // The client renders a stack row by resolving `card.card.id` through
        // `tryGetDefinition` (`src/components/board/stack-row.tsx`). The
        // projection is all it ever sees, so a projection that restored the
        // printed id would show a 3/1 Faerie Rogue on the stack for a spell
        // that is an Instant — and every server-side test here would still pass.
        const state = position(2);
        pushAdventure(state, "giant");
        const projected = projectPublicState(state, 1, "p1");
        const row = projected.stack[0];
        expect((row.card as { id: string }).id).toBe(`${BORROWER}#adventure`);
        expect(row.types).toEqual(["Instant"]);
        // Public information (CR 715.3b), so the OPPONENT sees the same thing —
        // unlike a face-down morph, whose real id the projection strips.
        const theirs = projectPublicState(state, 1, "p2");
        expect((theirs.stack[0].card as { id: string }).id).toBe(
            `${BORROWER}#adventure`
        );
    });

    it("is idempotent — a re-walked commit path cannot lose the front id", () => {
        const state = position(2);
        const item = pushAdventure(state, "giant");
        castAsAdventure(item);
        expect(item.adventureOf).toBe(BORROWER);
        expect((item.card as { id: string }).id).toBe(`${BORROWER}#adventure`);
    });
});

describe("CR 715.4 — off the stack, the card has its normal characteristics", () => {
    it("reverts identity, types and P/T", () => {
        const state = position(2);
        const item = pushAdventure(state, "giant");
        revertAdventureIdentity(item);
        expect((item.card as { id: string }).id).toBe(BORROWER);
        expect(item.adventureOf).toBeUndefined();
        expect(item.types).toEqual(["Creature"]);
        expect(item.subtypes).toEqual(["Faerie", "Rogue"]);
        expect(item.power).toBe(3);
        expect(item.toughness).toBe(1);
        expect(item.staticAbilities).toEqual(["flash", "flying"]);
    });

    it("is a no-op on an object never cast as an Adventure", () => {
        const plain = makeInstance(HILL_GIANT, { id: "plain" });
        const before = structuredClone(plain);
        revertAdventureIdentity(plain);
        expect(plain).toEqual(before);
    });
});

describe("CR 715.3d — a RESOLVED Adventure is exiled, not put into the graveyard", () => {
    it("bounces its target, exiles itself, and grants the cast from exile", () => {
        const state = position(2);
        pushAdventure(state, "giant");
        resolveTopOfStack(state);

        // The Adventure did what it says.
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "their-forest",
        ]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["giant"]);

        // "Instead of putting [it] into its owner's graveyard as it resolves,
        // its controller exiles it."
        expect(state.players[0].graveyard).toHaveLength(0);
        const exiled = state.players[0].exile;
        expect(exiled).toHaveLength(1);
        expect(exiled[0].zone).toBe("exile");
        // CR 715.4 — what sits in exile is the adventurer CARD, never the twin.
        expect((exiled[0].card as { id: string }).id).toBe(BORROWER);
        expect(exiled[0].adventureOf).toBeUndefined();
        // "For as long as that card remains exiled, that player may play it" —
        // an OPEN-ENDED grant, so no turn bound.
        expect(exiled[0].castableFromExileBy).toBe("p1");
        expect(exiled[0].castableFromExileUntilTurn).toBeUndefined();
        // "It can't be cast as an Adventure this way."
        expect(exiled[0].castFromExileNotAsAdventure).toBe(true);
    });

    it("offers the CREATURE cast from exile and withholds the Adventure", () => {
        const state = position(4);
        pushAdventure(state, "giant");
        resolveTopOfStack(state);
        const exiled = state.players[0].exile[0];
        // The permission is real: with four Islands the 3/1 is castable.
        expect(getLegalActions(state, state.players[0], exiled)).toContain(
            "cast"
        );
        // …and the Adventure option is gone, on the PERMISSION rather than on
        // the zone — `castFromExileNotAsAdventure` is what withdraws it, so a
        // DIFFERENT effect granting a cast from exile could still allow it.
        expect(adventureCastOptionFor(exiled)).toBeUndefined();
        expect(
            castOptionAlternativeCosts(
                state,
                state.players[0],
                exiled,
                "exile"
            ).some((o) => o.id.startsWith("adventure:"))
        ).toBe(false);
    });

    it("sends a COUNTERED Adventure to the graveyard as the adventurer card", () => {
        // The counter edge case, and the reason 715.3d lives at the resolution
        // site rather than on the object: a countered spell never resolves, so
        // it takes the ordinary path — and CR 715.4 puts the CREATURE half
        // there, not the twin.
        const state = position(2);
        pushAdventure(state, "giant");
        // Fizzle it by removing the only legal target (CR 608.2b).
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "giant"
        );
        resolveTopOfStack(state);

        expect(state.players[0].exile).toHaveLength(0);
        const graveyard = state.players[0].graveyard;
        expect(graveyard).toHaveLength(1);
        expect((graveyard[0].card as { id: string }).id).toBe(BORROWER);
        expect(graveyard[0].types).toEqual(["Creature"]);
        expect(graveyard[0].adventureOf).toBeUndefined();
    });
});
