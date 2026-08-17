// CARDS_EXILED event (issue #1558, CR 400.1 / 603.3b / 608.2i) — batching
// semantics at the emission plumbing in state.ts. The official Laelia, the
// Blade Reforged ruling: "This ability triggers only once for each time
// cards are put into exile this way, no matter how many cards were exiled at
// the same time." This suite proves the CHOKE POINT gets that right — one
// event per exile OCCURRENCE, never one per card — independent of any
// consuming card. Laelia's own trigger-side consumer behavior (scope,
// fromZone filtering, the self-feeding attack->exile->counter loop) is
// exercised separately in
// `convex/cards/sets/c21/__tests__/red.test.ts`.
import { describe, it, expect, beforeAll } from "vitest";
import type { CardInstanceState } from "../state";
import {
    buildSpellContext,
    exileWithAttachments,
    flushPendingEvents,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, GameEvent } from "../../cards/types";
import { makePlayer, makeState, pushSpell } from "../../cards/__tests__/setup";

const OWN_GRAVEYARD_REDIRECTOR_ID = "test-cards-exiled-own-graveyard-bound";
const P1_SORCERY_ID = "test-cards-exiled-p1-sorcery";

// "If a card would be put into YOUR graveyard from anywhere, exile that card
// instead" (Yawgmoth's Will's shape, mirrors graveyardBoundReplacement.test.ts).
const ownGraveyardRedirector: CardDefinition = {
    id: OWN_GRAVEYARD_REDIRECTOR_ID,
    name: "Test CARDS_EXILED Own-Graveyard Redirector",
    rarity: "common",
    types: ["Artifact"],
    replacementEffects: [
        {
            id: "test-cards-exiled-own-graveyard-redirect",
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

const p1Sorcery: CardDefinition = {
    id: P1_SORCERY_ID,
    name: "Test CARDS_EXILED P1 Sorcery",
    rarity: "common",
    types: ["Sorcery"],
};

beforeAll(() => {
    registerTokenDefinition(ownGraveyardRedirector);
    registerTokenDefinition(p1Sorcery);
});

function redirector(id: string, controllerId: string): CardInstanceState {
    return {
        id,
        card: { id: OWN_GRAVEYARD_REDIRECTOR_ID },
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
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

function cardsExiledEvents(
    events: GameEvent[]
): Extract<GameEvent, { type: "CARDS_EXILED" }>[] {
    return events.filter(
        (e): e is Extract<GameEvent, { type: "CARDS_EXILED" }> =>
            e.type === "CARDS_EXILED"
    );
}

describe("CARDS_EXILED emission (issue #1558, CR 400.1 / 603.3b / 608.2i)", () => {
    it("millCards batches 3 simultaneously-redirected mills into ONE CARDS_EXILED event, not 3", () => {
        const library = [
            bystanderCard("c1", "p1", "library"),
            bystanderCard("c2", "p1", "library"),
            bystanderCard("c3", "p1", "library"),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library,
                    battlefield: [redirector("src1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, OWN_GRAVEYARD_REDIRECTOR_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.millCards("p1", 3);
        expect(state.players[0].exile).toHaveLength(3);
        expect(state.players[0].graveyard).toHaveLength(0);
        const exiledEvents = cardsExiledEvents(flushPendingEvents(state));
        expect(exiledEvents).toHaveLength(1);
        expect(exiledEvents[0].cards).toHaveLength(3);
        expect(
            exiledEvents[0].cards.map((c) => c.cardInstanceId).sort()
        ).toEqual(["c1", "c2", "c3"]);
        for (const c of exiledEvents[0].cards) {
            expect(c.fromZone).toBe("library");
            expect(c.ownerId).toBe("p1");
        }
    });

    it("millCards emits NOTHING when no cards are redirected (plain mill to graveyard)", () => {
        const library = [bystanderCard("c1", "p1", "library")];
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.millCards("p1", 1);
        expect(cardsExiledEvents(flushPendingEvents(state))).toHaveLength(0);
    });

    it("exileWithAttachments batches a host + its Aura into ONE CARDS_EXILED event (CR 701.13)", () => {
        const host: CardInstanceState = {
            id: "host",
            card: { id: "def-host" },
            types: ["Creature"],
            subtypes: [],
            power: 2,
            toughness: 2,
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const aura: CardInstanceState = {
            id: "aura",
            card: { id: "def-aura" },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
            attachedTo: "host",
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        exileWithAttachments(state, "host", {
            sourceId: "source",
            returnTapped: false,
        });
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "aura",
            "host",
        ]);
        const exiledEvents = cardsExiledEvents(flushPendingEvents(state));
        expect(exiledEvents).toHaveLength(1);
        expect(
            exiledEvents[0].cards.map((c) => c.cardInstanceId).sort()
        ).toEqual(["aura", "host"]);
        for (const c of exiledEvents[0].cards) {
            expect(c.fromZone).toBe("battlefield");
            expect(c.ownerId).toBe("p1");
        }
    });

    it("ctx.exile emits a single-card CARDS_EXILED entry with fromZone battlefield", () => {
        const host: CardInstanceState = {
            id: "host",
            card: { id: "def-host" },
            types: ["Creature"],
            subtypes: [],
            power: 1,
            toughness: 1,
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host] }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.exile({ type: "permanent", id: "host" });
        const exiledEvents = cardsExiledEvents(flushPendingEvents(state));
        expect(exiledEvents).toHaveLength(1);
        expect(exiledEvents[0].cards).toEqual([
            {
                cardInstanceId: "host",
                cardId: "def-host",
                fromZone: "battlefield",
                ownerId: "p1",
            },
        ]);
    });

    it("ctx.exileFaceDown (the impulse-draw primitive) emits a single-card CARDS_EXILED entry with fromZone library", () => {
        const library = [bystanderCard("top", "p1", "library")];
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        const stackItem = pushSpell(state, P1_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        ctx.exileFaceDown("p1", "top", "library", "p1");
        const exiledEvents = cardsExiledEvents(flushPendingEvents(state));
        expect(exiledEvents).toHaveLength(1);
        expect(exiledEvents[0].cards).toEqual([
            {
                cardInstanceId: "top",
                cardId: "def-top",
                fromZone: "library",
                ownerId: "p1",
            },
        ]);
    });
});
