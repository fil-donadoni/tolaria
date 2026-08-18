// Graveyard-bound replacement effects (CR 614, issue #1145).
//
// CR 614.1a — "Some replacement effects modify how an event affects an
// object ... 'If a card would be put into your graveyard from anywhere,
// exile it instead' redirects a zone-change event". No shipped
// `ReplacementEventKind` covered a card entering a graveyard from ANYWHERE
// (mill, discard, a spell finishing/being countered, a permanent
// dying/being sacrificed) — only the narrower `"discard"` (hand only) and
// `"destroy"` (battlefield only) pre-images existed. This suite exercises
// the new `"graveyard-bound"` kind end to end at every named chokepoint
// (`gre-development.md` / issue #1145): mill, discard-resolution, the
// SBA/sacrifice/destroy battlefield-departure path (`removePermanentTo`),
// a spell finishing resolution, a countered spell, and the generic
// `moveZone`/`moveCardById` primitives — using two synthetic permanents
// shaped exactly like the two cards this capability unblocks (Yawgmoth's
// Will: own-graveyard/all-cards/turn-scoped; Dauthi Voidwalker: an
// opponent's-graveyard/all-cards/indefinite, tagging a void counter) so the
// capability is proven before either card ships.
import { describe, it, expect, beforeAll } from "vitest";
import type { CardInstanceState } from "../state";
import {
    buildSpellContext,
    discardToGraveyard,
    flushPendingEvents,
    resolveTopOfStack,
} from "../state";
import { checkZeroToughnessSBA } from "../sba";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { makePlayer, makeState, pushSpell } from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";

// "If a card would be put into YOUR graveyard from anywhere, exile that
// card instead" (Yawgmoth's Will's shape) — owner-scoped, self only.
const OWN_GRAVEYARD_REDIRECTOR_ID = "test-graveyard-bound-own";
// "If a card would be put into an OPPONENT's graveyard from anywhere,
// instead exile it with a void counter on it" (Dauthi Voidwalker's shape)
// — opponent-scoped, tags a counter.
const OPPONENT_GRAVEYARD_REDIRECTOR_ID = "test-graveyard-bound-opponent";
// Plain, behaviorless sorceries registered purely so `pushSpell` (which
// resolves ids through the real card registry) has something to push and
// `resolveTopOfStack` has a non-permanent to route through
// `finalizeSpellResolution`'s graveyard-bound chokepoint.
const P1_SORCERY_ID = "test-graveyard-bound-p1-sorcery";
const P2_SORCERY_ID = "test-graveyard-bound-p2-sorcery";

const ownGraveyardRedirector: CardDefinition = {
    id: OWN_GRAVEYARD_REDIRECTOR_ID,
    name: "Test Own-Graveyard Redirector",
    rarity: "common",
    types: ["Artifact"],
    replacementEffects: [
        {
            id: "test-own-graveyard-redirect",
            oracleText:
                "If a card would be put into your graveyard from anywhere, exile that card instead.",
            eventKind: "graveyard-bound",
            appliesTo: (event, self) => {
                if (event.kind !== "graveyard-bound") return false;
                return event.ownerId === self.controllerId;
            },
            replace: (event) => {
                if (event.kind !== "graveyard-bound") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, destination: "exile" },
                };
            },
        },
    ],
};

const opponentGraveyardRedirector: CardDefinition = {
    id: OPPONENT_GRAVEYARD_REDIRECTOR_ID,
    name: "Test Opponent-Graveyard Redirector",
    rarity: "common",
    types: ["Creature"],
    subtypes: ["Rogue"],
    power: 3,
    toughness: 2,
    replacementEffects: [
        {
            id: "test-opponent-graveyard-redirect",
            oracleText:
                "If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.",
            eventKind: "graveyard-bound",
            appliesTo: (event, self) => {
                if (event.kind !== "graveyard-bound") return false;
                return event.ownerId !== self.controllerId;
            },
            replace: (event) => {
                if (event.kind !== "graveyard-bound") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        destination: "exile",
                        tagCounters: { void: 1 },
                    },
                };
            },
        },
    ],
};

// Self-referential "would be put into a graveyard from anywhere ... shuffle
// it into its owner's library instead" (Blightsteel Colossus's shape, issue
// #2106) — `appliesFromAnyZone: true` opts this into the zone-agnostic
// self-lookup `collectReplacements` runs for graveyard-bound events, in
// addition to its normal battlefield scan.
const SELF_ANY_ZONE_REDIRECTOR_ID = "test-graveyard-bound-self-any-zone";

const selfAnyZoneRedirector: CardDefinition = {
    id: SELF_ANY_ZONE_REDIRECTOR_ID,
    name: "Test Self Any-Zone Redirector",
    rarity: "common",
    types: ["Creature"],
    subtypes: [],
    power: 1,
    toughness: 1,
    replacementEffects: [
        {
            id: "test-self-any-zone-redirect",
            oracleText:
                "If this card would be put into a graveyard from anywhere, shuffle it into its owner's library instead.",
            eventKind: "graveyard-bound",
            appliesFromAnyZone: true,
            appliesTo: (event, self) => {
                if (event.kind !== "graveyard-bound") return false;
                return event.cardInstanceId === self.id;
            },
            replace: (event) => {
                if (event.kind !== "graveyard-bound") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, destination: "library" },
                };
            },
        },
    ],
};

const p1Sorcery: CardDefinition = {
    id: P1_SORCERY_ID,
    name: "Test P1 Sorcery",
    rarity: "common",
    types: ["Sorcery"],
};
const p2Sorcery: CardDefinition = {
    id: P2_SORCERY_ID,
    name: "Test P2 Sorcery",
    rarity: "common",
    types: ["Sorcery"],
};

beforeAll(() => {
    registerTokenDefinition(ownGraveyardRedirector);
    registerTokenDefinition(opponentGraveyardRedirector);
    registerTokenDefinition(selfAnyZoneRedirector);
    registerTokenDefinition(p1Sorcery);
    registerTokenDefinition(p2Sorcery);
});

function redirector(
    id: string,
    defId: string,
    controllerId: string
): CardInstanceState {
    return {
        id,
        card: { id: defId },
        types:
            defId === OPPONENT_GRAVEYARD_REDIRECTOR_ID
                ? ["Creature"]
                : ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
    };
}

/** Builds a `SELF_ANY_ZONE_REDIRECTOR_ID` instance in an arbitrary zone
 *  (the self-referential redirect must apply off the battlefield, unlike
 *  `redirector` above which is always battlefield-bound). */
function selfAnyZoneCard(
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return {
        id,
        card: { id: SELF_ANY_ZONE_REDIRECTOR_ID },
        types: ["Creature"],
        subtypes: [],
        power: 1,
        toughness: 1,
        staticAbilities: [],
        controllerId: ownerId,
        ownerId,
        zone,
        isTapped: false,
    };
}

function bystanderCard(
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Sorcery"],
        subtypes: [],
        staticAbilities: [],
        controllerId: ownerId,
        ownerId,
        zone,
        isTapped: false,
    };
}

describe("graveyard-bound replacement (CR 614, issue #1145)", () => {
    it("redirects a discard (hand -> graveyard) to exile for the OWN-graveyard scope, but still emits CARD_DISCARDED", () => {
        const hand = [bystanderCard("c1", "p1", "hand")];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand,
                    battlefield: [
                        redirector("src1", OWN_GRAVEYARD_REDIRECTOR_ID, "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const moved = discardToGraveyard(state, "p1", "c1");
        expect(moved).toBe(true);
        const p1 = state.players[0];
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile).toHaveLength(1);
        expect(p1.exile[0].id).toBe("c1");
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "CARD_DISCARDED")).toBe(true);
    });

    it("does NOT redirect an opponent's discard under the OWN-graveyard scope", () => {
        const hand = [bystanderCard("c1", "p2", "hand")];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        redirector("src1", OWN_GRAVEYARD_REDIRECTOR_ID, "p1"),
                    ],
                }),
                makePlayer("p2", { hand }),
            ],
        });
        discardToGraveyard(state, "p2", "c1");
        expect(state.players[1].graveyard).toHaveLength(1);
        expect(state.players[1].exile).toHaveLength(0);
    });

    it("redirects a mill (library -> graveyard) to exile and suppresses CARD_MILLED", () => {
        const library = [bystanderCard("c1", "p1", "library")];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library,
                    battlefield: [
                        redirector("src1", OWN_GRAVEYARD_REDIRECTOR_ID, "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, OWN_GRAVEYARD_REDIRECTOR_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.millCards("p1", 1);
        const p1 = state.players[0];
        expect(p1.library).toHaveLength(0);
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile).toHaveLength(1);
        expect(p1.exile[0].id).toBe("c1");
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "CARD_MILLED")).toBe(false);
    });

    it("redirects a SBA battlefield death (0 toughness) to exile and suppresses CREATURE_DIED", () => {
        const dying: CardInstanceState = {
            id: "victim",
            card: { id: "def-victim" },
            types: ["Creature"],
            subtypes: [],
            power: 1,
            toughness: 0,
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        redirector("src1", OWN_GRAVEYARD_REDIRECTOR_ID, "p1"),
                        dying,
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        checkZeroToughnessSBA(state);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "victim")).toBe(false);
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile.some((c) => c.id === "victim")).toBe(true);
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "CREATURE_DIED")).toBe(false);
    });

    it("redirects an opponent's resolving sorcery (stack -> graveyard) to exile under the OPPONENT-graveyard scope, tagging a void counter", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        redirector(
                            "dauthi",
                            OPPONENT_GRAVEYARD_REDIRECTOR_ID,
                            "p1"
                        ),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, P2_SORCERY_ID, "p2");
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.graveyard).toHaveLength(0);
        expect(p2.exile).toHaveLength(1);
        expect(p2.exile[0].counters).toEqual({ void: 1 });
    });

    it("does NOT redirect the redirector's OWN controller's resolving sorcery under the OPPONENT-graveyard scope", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        redirector(
                            "dauthi",
                            OPPONENT_GRAVEYARD_REDIRECTOR_ID,
                            "p1"
                        ),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, P1_SORCERY_ID, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("redirects a countered spell (SpellContext.counter's default graveyard destination) to exile", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        redirector(
                            "dauthi",
                            OPPONENT_GRAVEYARD_REDIRECTOR_ID,
                            "p1"
                        ),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const target = pushSpell(state, P2_SORCERY_ID, "p2");
        const counterer = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, counterer);
        ctx.counter({ type: "spell", id: target.id });
        const p2 = state.players[1];
        expect(p2.graveyard).toHaveLength(0);
        expect(p2.exile.some((c) => c.id === target.id)).toBe(true);
        expect(p2.exile.find((c) => c.id === target.id)?.counters).toEqual({
            void: 1,
        });
    });

    it("redirects a generic moveZone/moveCardById library->graveyard move (self-mill effects) to exile", () => {
        const library = [bystanderCard("c1", "p1", "library")];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library,
                    battlefield: [
                        redirector("src1", OWN_GRAVEYARD_REDIRECTOR_ID, "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, OWN_GRAVEYARD_REDIRECTOR_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.moveCardById("p1", "c1", "library", "graveyard");
        const p1 = state.players[0];
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile.some((c) => c.id === "c1")).toBe(true);
    });

    it("wire format: the exile redirect + tagged counter survive projectPublicState for both viewers", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        redirector(
                            "dauthi",
                            OPPONENT_GRAVEYARD_REDIRECTOR_ID,
                            "p1"
                        ),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, P2_SORCERY_ID, "p2");
        resolveTopOfStack(state);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const p2Slim = projected.players.find((p) => p.id === "p2")!;
            expect(p2Slim.exile).toHaveLength(1);
            expect(p2Slim.exile[0].counters).toEqual({ void: 1 });
        }
    });
});

// CR 614.1a self-referential "would be put into a graveyard from anywhere
// ... shuffle it into its owner's library instead" (Blightsteel Colossus's
// shape, issue #2106). Unlike the two redirectors above, this effect must
// keep applying while its OWN card is off the battlefield (mid mill/
// discard/library-move) — `collectReplacements`'s normal battlefield scan
// cannot see it there, so `ReplacementEffect.appliesFromAnyZone` opts it
// into a second, zone-agnostic lookup keyed on the event's own
// `cardInstanceId` (never a battlefield-wide scan, so it cannot leak onto a
// different card).
describe("graveyard-bound self-referential replacement — applies from any zone (CR 614.1a, issue #2106)", () => {
    it("redirects a mill (library -> graveyard) to the owner's library and suppresses CARD_MILLED — the card is NOT on the battlefield", () => {
        const library = [selfAnyZoneCard("self1", "p1", "library")];
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.millCards("p1", 1);
        const p1 = state.players[0];
        expect(p1.library.some((c) => c.id === "self1")).toBe(true);
        expect(p1.graveyard).toHaveLength(0);
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "CARD_MILLED")).toBe(false);
    });

    it("redirects a discard (hand -> graveyard) to the owner's library — the card is NOT on the battlefield, CARD_DISCARDED still fires", () => {
        const hand = [selfAnyZoneCard("self1", "p1", "hand")];
        const state = makeState({
            players: [makePlayer("p1", { hand }), makePlayer("p2")],
        });
        const moved = discardToGraveyard(state, "p1", "self1");
        expect(moved).toBe(true);
        const p1 = state.players[0];
        expect(p1.library.some((c) => c.id === "self1")).toBe(true);
        expect(p1.graveyard).toHaveLength(0);
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "CARD_DISCARDED")).toBe(true);
    });

    it("redirects a battlefield death (0 toughness) to the owner's library and suppresses CREATURE_DIED — found via the ordinary battlefield scan (no double-apply)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        selfAnyZoneCard("self1", "p1", "battlefield"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        state.players[0].battlefield[0].toughness = 0;
        checkZeroToughnessSBA(state);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "self1")).toBe(false);
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.library.filter((c) => c.id === "self1")).toHaveLength(1);
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "CREATURE_DIED")).toBe(false);
    });

    it("redirects a generic moveZone/moveCardById library->graveyard move (self-mill effects) to the library", () => {
        const library = [selfAnyZoneCard("self1", "p1", "library")];
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.moveCardById("p1", "self1", "library", "graveyard");
        const p1 = state.players[0];
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.library.filter((c) => c.id === "self1")).toHaveLength(1);
    });

    it("does not leak the redirect onto bystander cards milled in the same batch, with the redirected card in the MIDDLE of the batch (review round 1, issue #2106)", () => {
        // The redirect card sits in the MIDDLE of a 3-card mill window
        // (c1, self1, c2), with a 4th card (c3) sitting just OUTSIDE that
        // window. Before the fix, `millCards` shuffled the library
        // mid-loop the instant self1's redirect landed it back in the
        // library — re-randomizing what "the live top" meant for every
        // later iteration in the SAME call, so c3 (never part of the top-3
        // window) could get swept into the graveyard instead of c2, and
        // self1 could get re-picked and re-shuffled a second time. Deferring
        // the shuffle to once, after the whole 3-card batch is resolved,
        // keeps the receding-top semantics correct for c2 and leaves c3
        // untouched.
        const library = [
            bystanderCard("c1", "p1", "library"),
            selfAnyZoneCard("self1", "p1", "library"),
            bystanderCard("c2", "p1", "library"),
            bystanderCard("c3", "p1", "library"),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        const milled = ctx.millCards("p1", 3);
        const p1 = state.players[0];

        // Exactly the two genuine bystanders in the 3-card window reached
        // the graveyard, in mill order — self1 was redirected, not milled.
        expect(milled).toEqual(["c1", "c2"]);
        expect(p1.graveyard.map((c) => c.id)).toEqual(["c1", "c2"]);
        // self1 landed back in the library (shuffled once, not repeatedly)
        // and c3 — never part of the 3-card mill window — is untouched by
        // the mill and still present.
        expect(p1.library).toHaveLength(2);
        expect(p1.library.some((c) => c.id === "self1")).toBe(true);
        expect(p1.library.some((c) => c.id === "c3")).toBe(true);
        const events = flushPendingEvents(state);
        const milledEvents = events.filter((e) => e.type === "CARD_MILLED");
        expect(milledEvents).toHaveLength(2);
        expect(
            milledEvents.some(
                (e) => e.type === "CARD_MILLED" && e.cardInstanceId === "self1"
            )
        ).toBe(false);
    });

    it("surveil-to-graveyard (orderTop) redirects mid-batch without corrupting the kept-on-top card, redirect in the MIDDLE of the graveyard leg (review round 1, issue #2106)", () => {
        // k1 is the KEPT card (must stay on top per CR 701.25); the
        // graveyard-bound leg is [b1, self1, b2] — the redirect sits in the
        // MIDDLE. Before the fix, self1's redirect shuffled the WHOLE
        // library mid-loop (while k1 was still physically sitting in it),
        // so the later "the kept cards are exactly the top storedTop.length
        // of the library" assumption broke and orderTop threw
        // "Card k1 not in kept top of library".
        const library = [
            bystanderCard("k1", "p1", "library"),
            bystanderCard("b1", "p1", "library"),
            selfAnyZoneCard("self1", "p1", "library"),
            bystanderCard("b2", "p1", "library"),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx1 = buildSpellContext(state, stackItem);
        expect(ctx1.orderTop("p1", 4, { destination: "graveyard" })).toBe(
            false
        );
        const choice = state.pendingChoices![0];
        stackItem.collectedChoices = {
            [`${choice.step}:${choice.choiceId}`]: ["k1"],
            [`${choice.step}:${choice.choiceId}:second`]: ["b1", "self1", "b2"],
        };
        expect(() => {
            const ctx2 = buildSpellContext(state, stackItem);
            expect(ctx2.orderTop("p1", 4, { destination: "graveyard" })).toBe(
                true
            );
        }).not.toThrow();

        const p1 = state.players[0];
        // k1 stays on top, exactly as CR 701.25 requires — Blightsteel's own
        // redirect shuffled the REST of the library, never the kept card.
        expect(p1.library[0]?.id).toBe("k1");
        expect(p1.graveyard.map((c) => c.id).sort()).toEqual(["b1", "b2"]);
        expect(p1.graveyard.some((c) => c.id === "self1")).toBe(false);
        expect(p1.library.some((c) => c.id === "self1")).toBe(true);
        expect(p1.library).toHaveLength(2);
    });
});

// Yawgmoth's Will's redirect clause is TURN-SCOPED, not permanent-bound: the
// sorcery itself resolves and leaves the stack, so there is no battlefield
// permanent left behind to carry a continuous `replacementEffects[]` entry.
// `SpellContext.armGraveyardRedirectThisTurn` arms a transient grant on
// `state.graveyardBoundRedirectThisTurn` instead (consulted by
// `applyGraveyardBoundReplacements` after the permanent-bound loop, mirroring
// `destroyReplacementShields`), cleared at CLEANUP. Proven here with NO
// redirector permanent on the battlefield at all.
describe("graveyard-bound turn-scoped redirect grant (CR 614/514.2, Yawgmoth's Will shape, issue #1145)", () => {
    it("redirects the granted owner's discard to exile with no battlefield permanent present", () => {
        const hand = [bystanderCard("c1", "p1", "hand")];
        const state = makeState({
            players: [makePlayer("p1", { hand }), makePlayer("p2")],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.armGraveyardRedirectThisTurn("p1");
        expect(state.graveyardBoundRedirectThisTurn).toEqual([
            { ownerId: "p1" },
        ]);
        discardToGraveyard(state, "p1", "c1");
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].exile.some((c) => c.id === "c1")).toBe(true);
    });

    it("does NOT redirect a different player's card under someone else's turn-scoped grant", () => {
        const hand = [bystanderCard("c1", "p2", "hand")];
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand })],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.armGraveyardRedirectThisTurn("p1");
        discardToGraveyard(state, "p2", "c1");
        expect(state.players[1].graveyard).toHaveLength(1);
        expect(state.players[1].exile).toHaveLength(0);
    });

    it("no-ops for X <= 0-equivalent absence — a state with no grant leaves graveyard-bound events untouched", () => {
        const hand = [bystanderCard("c1", "p1", "hand")];
        const state = makeState({
            players: [makePlayer("p1", { hand }), makePlayer("p2")],
        });
        discardToGraveyard(state, "p1", "c1");
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].exile).toHaveLength(0);
    });
});
