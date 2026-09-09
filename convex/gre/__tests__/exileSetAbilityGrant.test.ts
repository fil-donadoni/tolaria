// CR 607.2a / 113.1 / 613.1f — an `activated-grant` whose ABILITY SOURCE is a
// linked exile pile (issue #2943, ADR 0112).
//
// "Creatures you control with +1/+1 counters on them have all activated
// abilities of all creature cards exiled with this" is two independent halves:
// `applies` picks the RECIPIENTS (counter-gated) and `abilitiesOf` picks the
// ABILITIES (a set of cards that changes at instant speed). Both are re-read at
// every layer-6 derivation, which is what makes the clause live without a
// second liveness mechanism (ADR 0112 — the derivation IS the sweep since
// PRD #2064 S4).
//
// No card ships in this slice: the source is a fixture served through
// `withTemporaryDefinition`, so the catalogue stays frozen.
import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { getCardsExiledWith } from "../exileLinks";
import { syncLayer6 } from "../layer6";
import { getManaTapOptionsDetailed } from "../constants";
import type { CardInstanceState, GameState } from "../state";
import { buildSpellContext } from "../state";

const SORCERER = getCardByName("Prodigal Sorcerer").id;
const ELVES = getCardByName("Llanowar Elves").id;
const BEARS = getCardByName("Grizzly Bears").id;

const CAULDRON_ID = "fixture-exile-set-grant";

/** The fixture source: a colourless artifact whose only static effect is the
 *  #2943 shape — recipients gated on a `+1/+1` counter, abilities read off the
 *  cards exiled with it. */
const CAULDRON: CardDefinition = {
    id: CAULDRON_ID,
    name: "Fixture Soul Cauldron",
    rarity: "rare",
    types: ["Artifact"],
    subtypes: [],
    manaCost: { generic: 2 },
    staticEffects: [
        {
            kind: "activated-grant",
            // CR 122.1 — the recipient gate. Counter-gated on purpose: the
            // whole point of ADR 0112 is that a gate reading live state is
            // re-evaluated by the derivation, not frozen at attach time.
            applies: (target: PermanentView, source: PermanentView) =>
                target.controllerId === source.controllerId &&
                target.types.includes("Creature") &&
                (target.counters?.["+1/+1"] ?? 0) > 0,
            abilitiesOf: { exiledWithSource: true, types: ["Creature"] },
        },
    ],
};

function boardWithCauldron(opts: {
    /** Card ids to place in p1's exile, linked to the Cauldron. */
    exiled?: string[];
    /** Counters to put on the recipient creature. */
    counters?: Record<string, number>;
}): {
    state: GameState;
    cauldron: CardInstanceState;
    recipient: CardInstanceState;
} {
    const cauldron = makeInstance(BEARS, {
        id: "cauldron",
        controllerId: "p1",
        staticSeq: 1,
    });
    // The instance carries the FIXTURE definition id — `makeInstance` needs a
    // registered card to read characteristics from, and the fixture is served
    // only inside `withTemporaryDefinition`.
    cauldron.card = { id: CAULDRON_ID };
    cauldron.types = ["Artifact"];
    const recipient = makeInstance(BEARS, {
        id: "recipient",
        controllerId: "p1",
        staticSeq: 2,
        ...(opts.counters ? { counters: opts.counters } : {}),
    });
    const exile = (opts.exiled ?? []).map((cardId, i) =>
        makeInstance(cardId, {
            id: `exiled-${i}`,
            zone: "exile",
            controllerId: "p1",
            exiledBySourceId: "cauldron",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [cauldron, recipient], exile }),
            makePlayer("p2"),
        ],
    });
    return { state, cauldron, recipient };
}

/** Ability ids the recipient currently offers, engine-side. */
function offeredAbilityIds(card: CardInstanceState): string[] {
    return getEffectiveActivatedAbilities(card)
        .map((e) => e.ability.id)
        .sort();
}

describe("exile-set-driven activated-ability grant (CR 607.2a, issue #2943)", () => {
    it("grants every activated ability of every linked exiled card", () => {
        withTemporaryDefinition(CAULDRON, () => {
            const { state, recipient } = boardWithCauldron({
                exiled: [SORCERER, ELVES],
                counters: { "+1/+1": 1 },
            });
            syncLayer6(state);
            expect(offeredAbilityIds(recipient)).toEqual([
                "llanowar-elves-mana",
                "prodigal-sorcerer-zap",
            ]);
            // The row names the EXILED card as the granting def and declares
            // where the template lives — no fallback could have found it, the
            // exiled creatures declare no `grantTemplates` at all.
            expect(recipient.grantedActivatedAbilities).toEqual([
                expect.objectContaining({
                    sourceCardId: SORCERER,
                    abilityId: "prodigal-sorcerer-zap",
                    origin: "card-abilities",
                    auraId: "cauldron",
                }),
                expect.objectContaining({
                    sourceCardId: ELVES,
                    abilityId: "llanowar-elves-mana",
                    origin: "card-abilities",
                    auraId: "cauldron",
                }),
            ]);
        });
    });

    it("withholds the grant from a creature the counter gate excludes", () => {
        withTemporaryDefinition(CAULDRON, () => {
            const { state, recipient } = boardWithCauldron({
                exiled: [SORCERER],
            });
            syncLayer6(state);
            expect(offeredAbilityIds(recipient)).toEqual([]);
        });
    });

    it("follows the pile at instant speed — a card entering exile after the grant is picked up on the next derivation", () => {
        withTemporaryDefinition(CAULDRON, () => {
            const { state, recipient } = boardWithCauldron({
                exiled: [SORCERER],
                counters: { "+1/+1": 1 },
            });
            syncLayer6(state);
            expect(offeredAbilityIds(recipient)).toEqual([
                "prodigal-sorcerer-zap",
            ]);

            // A second card joins the linked pile mid-turn (CR 607.2a — a
            // second activation of the exiling ability).
            state.players[0].exile.push(
                makeInstance(ELVES, {
                    id: "exiled-late",
                    zone: "exile",
                    controllerId: "p1",
                    exiledBySourceId: "cauldron",
                })
            );
            syncLayer6(state);
            expect(offeredAbilityIds(recipient)).toEqual([
                "llanowar-elves-mana",
                "prodigal-sorcerer-zap",
            ]);

            // ...and leaving it takes the ability back off.
            state.players[0].exile = state.players[0].exile.filter(
                (c) => c.id !== "exiled-0"
            );
            syncLayer6(state);
            expect(offeredAbilityIds(recipient)).toEqual([
                "llanowar-elves-mana",
            ]);
        });
    });

    it("grants nothing when the pile is empty or unlinked", () => {
        withTemporaryDefinition(CAULDRON, () => {
            const { state, recipient } = boardWithCauldron({
                counters: { "+1/+1": 1 },
            });
            // A card in exile stamped by a DIFFERENT source is not in the pile
            // (CR 607.2a — the link is per source instance).
            state.players[0].exile.push(
                makeInstance(SORCERER, {
                    id: "someone-elses",
                    zone: "exile",
                    controllerId: "p1",
                    exiledBySourceId: "another-permanent",
                })
            );
            syncLayer6(state);
            expect(offeredAbilityIds(recipient)).toEqual([]);
        });
    });

    it("keeps the entry timestamp across re-derivations (CR 613.7)", () => {
        withTemporaryDefinition(CAULDRON, () => {
            const { state, recipient } = boardWithCauldron({
                exiled: [SORCERER],
                counters: { "+1/+1": 1 },
            });
            syncLayer6(state);
            const first = recipient.grantedActivatedAbilities?.[0]?.seq;
            expect(first).toBeDefined();
            // Ten more stable transitions must not re-stamp the grant — a
            // re-evaluation is not a new application (ADR 0112 boundary 3).
            for (let i = 0; i < 10; i++) syncLayer6(state);
            expect(recipient.grantedActivatedAbilities?.[0]?.seq).toBe(first);
        });
    });

    it("is removed by a LATER 'loses all abilities' and survives an EARLIER one (CR 613.1f)", () => {
        withTemporaryDefinition(CAULDRON, () => {
            const { state, recipient } = boardWithCauldron({
                exiled: [SORCERER],
                counters: { "+1/+1": 1 },
            });
            syncLayer6(state);
            const grantSeq = recipient.grantedActivatedAbilities?.[0]?.seq ?? 0;

            // A stripper whose timestamp PREDATES the grant leaves it alone.
            recipient.abilitiesSuppressedBy = [
                { sourceId: "stripper", seq: grantSeq - 1 },
            ];
            expect(offeredAbilityIds(recipient)).toEqual([
                "prodigal-sorcerer-zap",
            ]);

            // One that POSTDATES it takes it (Humility, then the grant).
            recipient.abilitiesSuppressedBy = [
                { sourceId: "stripper", seq: grantSeq + 1 },
            ];
            expect(offeredAbilityIds(recipient)).toEqual([]);
        });
    });

    it("makes a granted MANA ability visible to the auto-tap seam (CR 605.3a)", () => {
        withTemporaryDefinition(CAULDRON, () => {
            const { state, recipient } = boardWithCauldron({
                exiled: [ELVES],
                counters: { "+1/+1": 1 },
            });
            expect(getManaTapOptionsDetailed(recipient, "p1")).toEqual([]);
            syncLayer6(state);
            expect(
                getManaTapOptionsDetailed(recipient, "p1").map((o) => o.mana)
            ).toEqual([{ G: 1 }]);
        });
    });
});

describe("getCardsExiledWith is one authority (issue #2943)", () => {
    it("the SpellContext primitive reports exactly the pile the pure function names", () => {
        const cauldron = makeInstance(BEARS, {
            id: "cauldron",
            controllerId: "p1",
        });
        const mine = makeInstance(SORCERER, {
            id: "mine",
            zone: "exile",
            controllerId: "p1",
            exiledBySourceId: "cauldron",
        });
        const theirs = makeInstance(ELVES, {
            id: "theirs",
            zone: "exile",
            controllerId: "p2",
            ownerId: "p2",
            exiledBySourceId: "cauldron",
        });
        const other = makeInstance(ELVES, {
            id: "other",
            zone: "exile",
            controllerId: "p1",
            exiledBySourceId: "somewhere-else",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [cauldron],
                    exile: [mine, other],
                }),
                makePlayer("p2", { exile: [theirs] }),
            ],
        });

        const pure = getCardsExiledWith(state, "cauldron");
        expect(pure.map((e) => [e.card.id, e.ownerId])).toEqual([
            ["mine", "p1"],
            ["theirs", "p2"],
        ]);

        // CR 400.7 — the pile spans owners, and the primitive routes each card
        // back to the owner whose exile actually holds it.
        const ctx = buildSpellContext(state, {
            ...cauldron,
            zone: "stack",
            castById: "p1",
        });
        expect(
            ctx.getCardsExiledWith("cauldron").map((c) => [c.id, c.ownerId])
        ).toEqual([
            ["mine", "p1"],
            ["theirs", "p2"],
        ]);
    });
});
