// WOE — colourless cards (ADR 0043 colour-split test files). Agatha's Soul
// Cauldron (issue #2945, parent PRD #1324): the FIRST real consumer of both
// engine slices this card was blocked on — the exile-set-driven
// activated-ability grant (issue #2943, CR 607.2a) and the activation-scoped
// `mana-substitution` static (issue #2944, CR 609.4b) — plus its own `{T}`
// ability and the CR 603.12 reflexive trigger nested in it.
//
// Both slices already own their own engine-level suites against fixtures
// (`gre/__tests__/exileSetAbilityGrant.test.ts`,
// `gre/__tests__/manaSubstitutionScope.test.ts`). What is asserted HERE is the
// thing neither of them can: that the SHIPPED definition wires the two clauses
// to each other — the pile the `{T}` ability links is the pile the grant reads,
// and the granted ability's coloured pip is one the scope actually reaches.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    getAbilityManaSubstitutions,
    getPlayer,
    resolveTopOfStack,
} from "../../../../gre/state";
import { getEffectiveActivatedAbilities } from "../../../../gre/activatedAbilities";
import { getCardsExiledWith } from "../../../../gre/exileLinks";
import { syncLayer6 } from "../../../../gre/layer6";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { agathasSoulCauldron } from "../colorless";

const CAULDRON = agathasSoulCauldron.id;
const EXILE_ABILITY = "agathas-soul-cauldron-exile";
/** `{B}: This creature gets +1/+1 until end of turn.` — a creature card whose
 *  activated ability carries a COLOURED pip, so the grant and the fixing are
 *  observable on the same activation. */
const SHADE = getCardByName("Frozen Shade").id;
const SHADE_PUMP = "frozen-shade-pump";
const BEARS = getCardByName("Grizzly Bears").id;
/** A noncreature card, for the reflexive trigger's negative case. */
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id;

/** p1 controls the Cauldron and a creature; `graveyard` seeds p2's graveyard
 *  (the Oracle says "a graveyard", so the opponent's is the interesting one —
 *  CR 400.7, the exiled card stays in ITS owner's exile). */
function board(opts: {
    counters?: Record<string, number>;
    graveyard?: Array<{ id: string; cardId: string }>;
}): {
    state: GameState;
    cauldron: CardInstanceState;
    creature: CardInstanceState;
} {
    const cauldron = makeInstance(CAULDRON, {
        id: "cauldron",
        controllerId: "p1",
        staticSeq: 1,
    });
    const creature = makeInstance(BEARS, {
        id: "creature",
        controllerId: "p1",
        staticSeq: 2,
        ...(opts.counters ? { counters: opts.counters } : {}),
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [cauldron, creature] }),
            makePlayer("p2", {
                graveyard: (opts.graveyard ?? []).map((g) =>
                    makeInstance(g.cardId, {
                        id: g.id,
                        zone: "graveyard",
                        controllerId: "p2",
                        ownerId: "p2",
                    })
                ),
            }),
        ],
    });
    return { state, cauldron, creature };
}

/** Pushes the Cauldron's `{T}` ability on the stack with its cost assumed paid
 *  and resolves it (the ADR 0043 set-test convention). */
function activateExile(
    state: GameState,
    cauldron: CardInstanceState,
    graveyardCardId: string
): void {
    state.stack.push({
        ...cauldron,
        zone: "stack",
        castById: cauldron.controllerId,
        abilityId: EXILE_ABILITY,
        targets: [
            { type: "graveyard-card", id: graveyardCardId, playerId: "p2" },
        ],
    });
    resolveTopOfStack(state);
}

function offeredAbilityIds(card: CardInstanceState): string[] {
    return getEffectiveActivatedAbilities(card)
        .map((e) => e.ability.id)
        .sort();
}

describe("Agatha's Soul Cauldron — {T} exile (CR 701.13 / 607.2a, issue #2945)", () => {
    it("exiles the targeted graveyard card and LINKS it to the Cauldron", () => {
        const { state, cauldron } = board({
            graveyard: [{ id: "gy-shade", cardId: SHADE }],
        });
        activateExile(state, cauldron, "gy-shade");

        // CR 400.7 — the card is in ITS OWNER's exile, not the activator's.
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["gy-shade"]);
        // CR 607.2a — the link the second clause's selector reads back.
        expect(
            getCardsExiledWith(state, "cauldron").map((e) => e.card.id)
        ).toEqual(["gy-shade"]);
    });

    it("fires the reflexive trigger for a CREATURE card, which takes its own target (CR 603.12)", () => {
        const { state, cauldron, creature } = board({
            graveyard: [{ id: "gy-shade", cardId: SHADE }],
        });
        // A SECOND creature, so the trigger's target is a real choice rather
        // than the sole-legal-target auto-selection of CR 603.3d — the
        // announcement is the seam the client actually walks.
        getPlayer(state, "p1").battlefield.push(
            makeInstance(BEARS, { id: "other", controllerId: "p1" })
        );
        activateExile(state, cauldron, "gy-shade");

        // A SEPARATE stack object — the counter target is announced now,
        // knowing what was exiled, not at activation.
        const reflexive = state.stack.find((s) => s.reflexiveTrigger);
        expect(reflexive).toBeDefined();
        expect(creature.counters?.["+1/+1"] ?? 0).toBe(0);

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "permanent", id: "creature" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);

        expect(creature.counters?.["+1/+1"]).toBe(1);
    });

    it("fires NO reflexive trigger when the exiled card is not a creature card", () => {
        const { state, cauldron } = board({
            graveyard: [{ id: "gy-bolt", cardId: LIGHTNING_BOLT }],
        });
        activateExile(state, cauldron, "gy-bolt");

        // The exile still happened and still linked — only the counter clause
        // is gated on the card's type.
        expect(getCardsExiledWith(state, "cauldron")).toHaveLength(1);
        expect(state.stack.some((s) => s.reflexiveTrigger)).toBe(false);
    });
});

describe("Agatha's Soul Cauldron — ability copy (CR 607.2a / 613.1f, issue #2945)", () => {
    it("grants the exiled creature's activated ability to a creature with a +1/+1 counter", () => {
        const { state, cauldron, creature } = board({
            counters: { "+1/+1": 1 },
            graveyard: [{ id: "gy-shade", cardId: SHADE }],
        });
        activateExile(state, cauldron, "gy-shade");
        syncLayer6(state);

        expect(offeredAbilityIds(creature)).toEqual([SHADE_PUMP]);
        expect(creature.grantedActivatedAbilities).toEqual([
            expect.objectContaining({
                sourceCardId: SHADE,
                abilityId: SHADE_PUMP,
                origin: "card-abilities",
                auraId: "cauldron",
            }),
        ]);
    });

    it("withholds the grant from a creature with NO +1/+1 counter, and hands it over when one arrives", () => {
        const { state, cauldron, creature } = board({
            graveyard: [{ id: "gy-shade", cardId: SHADE }],
        });
        activateExile(state, cauldron, "gy-shade");
        syncLayer6(state);
        expect(offeredAbilityIds(creature)).toEqual([]);

        // The gate is live because layer 6 is DERIVED wholesale at every stable
        // transition (ADR 0112), which is what `syncLayer6` stands in for here.
        // In a real game a mid-turn counter also has to reach
        // `recomputeContinuousEffects`, and THAT is what the card's
        // `dependsOnCounters: true` enrols it in (issue #1711) — asserted
        // catalogue-wide by `counterGatedStatics.test.ts`, not here.
        creature.counters = { "+1/+1": 1 };
        syncLayer6(state);
        expect(offeredAbilityIds(creature)).toEqual([SHADE_PUMP]);
    });

    it("grants nothing while the linked pile is empty", () => {
        const { state, creature } = board({ counters: { "+1/+1": 1 } });
        syncLayer6(state);
        expect(offeredAbilityIds(creature)).toEqual([]);
    });
});

describe("Agatha's Soul Cauldron — the fixing reaches the ability it granted (CR 609.4b / 602.1)", () => {
    it("lets a creature you control pay the granted {B} with any colour", () => {
        const { state, cauldron, creature } = board({
            counters: { "+1/+1": 1 },
            graveyard: [{ id: "gy-shade", cardId: SHADE }],
        });
        activateExile(state, cauldron, "gy-shade");
        syncLayer6(state);

        const subs = getAbilityManaSubstitutions(state, "p1", creature);
        expect(subs).toContainEqual({ from: "G", to: "B" });
    });

    it("withholds it from a creature the OPPONENT controls, granted ability or not", () => {
        const { state } = board({ counters: { "+1/+1": 1 } });
        const theirs = makeInstance(BEARS, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
            counters: { "+1/+1": 1 },
        });
        getPlayer(state, "p2").battlefield.push(theirs);
        syncLayer6(state);

        expect(getAbilityManaSubstitutions(state, "p1", theirs)).toEqual([]);
    });
});
