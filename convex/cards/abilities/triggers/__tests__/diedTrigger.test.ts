// Direct unit tests for the `diedTrigger` factory and the shared
// permanent-scope resolver. Exercises the scope vocabulary, filter wiring,
// CR 603.4 `condition`, CR 603.4 `interveningIf`, and the LKI payload
// handed to the resolve callback.

import { describe, expect, it, vi } from "vitest";
import { diedTrigger } from "../diedTrigger";
import { getAbilityEffectFn } from "../../../effectRegistry";
import { matchesPermanentScope } from "../shared";
import type {
    CardDefinition,
    CardType,
    CreatureDiedEvent,
    PermanentView,
    SpellContext,
} from "../../../types";
import {
    beginApplyingStaticEffects,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { withTemporaryDefinition } from "../../../registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { grizzlyBears } from "../../../sets/lea/index.cards";

// Conspiracy (MMQ) — "Creatures you control are the chosen type." (layer 4).
const CONSPIRACY_ID = "411c9f22-2df0-4a63-b2be-fa02612a6ef8";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeEvent(
    overrides: Partial<CreatureDiedEvent> = {}
): CreatureDiedEvent {
    return {
        type: "CREATURE_DIED",
        creatureInstanceId: "dead",
        creatureControllerId: "p2",
        creatureTypes: ["Creature"] as CardType[],
        damagedBySources: [],
        creaturePower: 2,
        creatureToughness: 2,
        ...overrides,
    };
}

describe("matchesPermanentScope (CR 109.2 / 109.4)", () => {
    const self = makeSelf({ id: "self", controllerId: "p1" });

    it("'self' matches only the source's own instance", () => {
        expect(
            matchesPermanentScope(
                "self",
                { instanceId: "self", controllerId: "p1" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "self",
                { instanceId: "other", controllerId: "p1" },
                self
            )
        ).toBe(false);
    });

    it("'yours' matches by controller equality", () => {
        expect(
            matchesPermanentScope(
                "yours",
                { instanceId: "x", controllerId: "p1" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "yours",
                { instanceId: "x", controllerId: "p2" },
                self
            )
        ).toBe(false);
    });

    it("'opponents' matches by controller inequality", () => {
        expect(
            matchesPermanentScope(
                "opponents",
                { instanceId: "x", controllerId: "p2" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "opponents",
                { instanceId: "x", controllerId: "p1" },
                self
            )
        ).toBe(false);
    });

    it("'any' always matches", () => {
        expect(
            matchesPermanentScope(
                "any",
                { instanceId: "self", controllerId: "p1" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "any",
                { instanceId: "x", controllerId: "p2" },
                self
            )
        ).toBe(true);
    });

    it("'another-yours' enforces same-controller AND self-exclusion (CR 109.2)", () => {
        expect(
            matchesPermanentScope(
                "another-yours",
                { instanceId: "self", controllerId: "p1" },
                self
            )
        ).toBe(false);
        expect(
            matchesPermanentScope(
                "another-yours",
                { instanceId: "ally", controllerId: "p1" },
                self
            )
        ).toBe(true);
        expect(
            matchesPermanentScope(
                "another-yours",
                { instanceId: "ally", controllerId: "p2" },
                self
            )
        ).toBe(false);
    });

    it("'any-other' enforces self-exclusion only (CR 109.2)", () => {
        expect(
            matchesPermanentScope(
                "any-other",
                { instanceId: "self", controllerId: "p1" },
                self
            )
        ).toBe(false);
        expect(
            matchesPermanentScope(
                "any-other",
                { instanceId: "x", controllerId: "p2" },
                self
            )
        ).toBe(true);
    });
});

describe("diedTrigger factory", () => {
    it("declares CREATURE_DIED as the event type", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: () => {},
        });
        expect(ability.event).toBe("CREATURE_DIED");
    });

    it("rejects events of other types via the type guard", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: () => {},
        });
        const phaseEvent = {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: "p1",
        };
        expect(ability.matches(phaseEvent, makeSelf())).toBe(false);
    });

    it("filters by PermanentFilter.types using the LKI snapshot", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            filter: { types: "Creature" },
            resolve: () => {},
        });
        expect(
            ability.matches(
                makeEvent({ creatureTypes: ["Creature"] }),
                makeSelf()
            )
        ).toBe(true);
        expect(
            ability.matches(
                makeEvent({ creatureTypes: ["Artifact"] as CardType[] }),
                makeSelf()
            )
        ).toBe(false);
    });

    it("respects `condition` (CR 603.4) and short-circuits on false", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            condition: (event) => event.damagedBySources.includes("self"),
            resolve: () => {},
        });
        expect(
            ability.matches(makeEvent({ damagedBySources: [] }), makeSelf())
        ).toBe(false);
        expect(
            ability.matches(
                makeEvent({ damagedBySources: ["self"] }),
                makeSelf()
            )
        ).toBe(true);
    });

    it("forwards `interveningIf` to the engine-level field (CR 603.4)", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            interveningIf: (event) => event.creaturePower >= 3,
            resolve: () => {},
        });
        expect(ability.interveningIf).toBeDefined();
        expect(
            ability.interveningIf!(makeEvent({ creaturePower: 2 }), makeSelf())
        ).toBe(false);
        expect(
            ability.interveningIf!(makeEvent({ creaturePower: 4 }), makeSelf())
        ).toBe(true);
    });

    it("delivers a flattened LKI payload (CR 603.10) to `resolve`", () => {
        const seen = vi.fn();
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: (_ctx, _event, dead) => seen(dead),
        });
        const event = makeEvent({
            creatureInstanceId: "victim",
            creatureControllerId: "p2",
            creatureTypes: ["Creature", "Artifact"] as CardType[],
            creatureSubtypes: ["Cat", "Construct"],
            damagedBySources: ["src"],
            creaturePower: 7,
            creatureToughness: 3,
        });
        ability.resolve!({} as SpellContext, event);
        expect(seen).toHaveBeenCalledWith({
            id: "victim",
            controllerId: "p2",
            types: ["Creature", "Artifact"],
            subtypes: ["Cat", "Construct"],
            lastKnownPower: 7,
            lastKnownToughness: 3,
            damagedBySources: ["src"],
            combatPartnerIds: [],
        });
    });

    it("surfaces combatPartnerIds from the event (CR 603.10, Abu Ja'far)", () => {
        const seen = vi.fn();
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "any",
            resolve: (_ctx, _event, dead) => seen(dead.combatPartnerIds),
        });
        ability.resolve!(
            {} as SpellContext,
            makeEvent({ combatPartnerIds: ["a", "b"] })
        );
        expect(seen).toHaveBeenCalledWith(["a", "b"]);
    });

    it("'self' scope fires on the source's own death (CR 603.10 LKI host)", () => {
        const ability = diedTrigger({
            id: "x",
            oracleText: "...",
            scope: "self",
            resolve: () => {},
        });
        const self = makeSelf({ id: "self" });
        expect(
            ability.matches(makeEvent({ creatureInstanceId: "self" }), self)
        ).toBe(true);
        expect(
            ability.matches(makeEvent({ creatureInstanceId: "other" }), self)
        ).toBe(false);
    });
});

describe("diedTrigger DSL support (ADR 0045)", () => {
    it("builds an effects[]-based ability when `effects` is given (no `resolve`)", () => {
        const ability = diedTrigger({
            id: "dsl-ability",
            oracleText: "test",
            scope: "any",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        });
        expect(ability.effects).toEqual([
            { op: "gainLife", player: "controller", amount: 1 },
        ]);
        expect(ability.resolve).toBeUndefined();
    });

    it("wires the effects[] script to the real interpreter compile seam (getAbilityEffectFn)", () => {
        const ability = diedTrigger({
            id: "dsl-compiles",
            oracleText: "test",
            scope: "any",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        });
        // Same seam the stack-resolution engine uses for ability effect sites.
        expect(typeof getAbilityEffectFn(ability)).toBe("function");
    });

    it("builds a resolve-based ability when `resolve` is given (no `effects`)", () => {
        const ability = diedTrigger({
            id: "resolve-ability",
            oracleText: "test",
            scope: "any",
            resolve: () => {},
        });
        expect(ability.resolve).toBeDefined();
        expect(ability.effects).toBeUndefined();
    });

    it("throws when neither `effects` nor `resolve` is given", () => {
        expect(() =>
            diedTrigger({
                id: "broken-ability",
                oracleText: "test",
                scope: "any",
            } as Parameters<typeof diedTrigger>[0])
        ).toThrow(/effects\[\] or resolve/);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Subtype-filtered, batched death triggers through the REAL trigger scan
// (issue #3719 — "Whenever one or more other Cats you control die", Ajani,
// Nacatl Pariah). Every test kills through the battlefield-departure funnel
// (`removePermanentTo`) and reads what `collectTriggers` puts on the stack
// over the `pendingEvents` that funnel queued — never a hand-built event.
// ─────────────────────────────────────────────────────────────────────────

const CAT_WATCH_ID = "test-3719-cat-watcher";
const CAT_ID = "test-3719-cat";

/** A watcher carrying "Whenever [one or more] other Cats you control die,
 *  draw a card." — batched or not. */
function catWatcher(oncePerEventBatch: boolean): CardDefinition {
    return {
        ...grizzlyBears(),
        id: CAT_WATCH_ID,
        name: "Cat Watcher",
        subtypes: ["Human"],
        triggeredAbilities: [
            diedTrigger({
                id: "cat-watcher-dies",
                oracleText:
                    "Whenever one or more other Cats you control die, draw a card.",
                scope: "another-yours",
                filter: { subtypes: "Cat" },
                oncePerEventBatch,
                effects: [{ op: "draw", player: "controller", count: 1 }],
            }),
        ],
    };
}

const CAT: CardDefinition = {
    ...grizzlyBears(),
    id: CAT_ID,
    name: "Test Cat",
    subtypes: ["Cat", "Warrior"],
};

function withCatCards<T>(oncePerEventBatch: boolean, fn: () => T): T {
    return withTemporaryDefinition(catWatcher(oncePerEventBatch), () =>
        withTemporaryDefinition(CAT, fn)
    );
}

function catBoard(extra: CardInstanceState[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(CAT_WATCH_ID, {
                        id: "watcher",
                        controllerId: "p1",
                    }),
                    ...extra,
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function watcherFirings(state: GameState): number {
    return collectTriggers(state, state.pendingEvents ?? []).filter(
        (item) => item.triggeredAbilityId === "cat-watcher-dies"
    ).length;
}

describe("diedTrigger subtype filter — last-known subtypes (CR 603.10a, CR 603.2, issue #3719)", () => {
    it("fires for a dying Cat and not for a dying Bear", () => {
        withCatCards(false, () => {
            const state = catBoard([
                makeInstance(CAT_ID, { id: "cat", controllerId: "p1" }),
                makeInstance(grizzlyBears().id, {
                    id: "bear",
                    controllerId: "p1",
                }),
            ]);
            removePermanentTo(state, "bear", "graveyard");
            expect(watcherFirings(state)).toBe(0);

            state.pendingEvents = [];
            removePermanentTo(state, "cat", "graveyard");
            expect(watcherFirings(state)).toBe(1);
        });
    });

    it("reads the subtype a CONTINUOUS effect granted at the moment of death (CR 603.10a / 613.1d)", () => {
        withCatCards(false, () => {
            // Conspiracy naming Cat: every creature p1 controls is a Cat
            // (layer 4). The Bear is a Cat only while on the battlefield.
            const conspiracy = makeInstance(CONSPIRACY_ID, {
                id: "consp",
                controllerId: "p1",
            });
            conspiracy.chosenSubtypes = ["Cat"];
            const bear = makeInstance(grizzlyBears().id, {
                id: "bear",
                controllerId: "p1",
            });
            const state = catBoard([conspiracy, bear]);
            beginApplyingStaticEffects(state, conspiracy);
            expect(bear.subtypes).toEqual(["Cat"]);

            removePermanentTo(state, "bear", "graveyard");
            const died = (state.pendingEvents ?? []).find(
                (e) => e.type === "CREATURE_DIED"
            ) as CreatureDiedEvent;
            expect(died.creatureSubtypes).toEqual(["Cat"]);
            expect(watcherFirings(state)).toBe(1);
        });
    });

    it("still filters a Cat TOKEN that has ceased to exist before the scan (CR 111.7)", () => {
        withCatCards(false, () => {
            const state = catBoard([
                makeInstance(CAT_ID, {
                    id: "cat-token",
                    controllerId: "p1",
                    isToken: true,
                }),
            ]);
            removePermanentTo(state, "cat-token", "graveyard");
            // CR 111.7 / 704.5d — the token ceases to exist in the graveyard;
            // the trigger reads the event's snapshot, never the zone.
            state.players[0].graveyard = state.players[0].graveyard.filter(
                (c) => c.id !== "cat-token"
            );
            expect(watcherFirings(state)).toBe(1);
        });
    });
});

describe('diedTrigger oncePerEventBatch — "one or more … die" (CR 603.2c, issue #3719)', () => {
    function threeCats(): CardInstanceState[] {
        return [0, 1, 2].map((i) =>
            makeInstance(CAT_ID, { id: `cat${i}`, controllerId: "p1" })
        );
    }

    it("collapses three simultaneous Cat deaths to ONE trigger, and fires three without the flag", () => {
        const fire = (batched: boolean) =>
            withCatCards(batched, () => {
                const state = catBoard(threeCats());
                // One event (a board wipe): every death lands in the same
                // `pendingEvents` batch before the scan runs.
                for (const id of ["cat0", "cat1", "cat2"]) {
                    removePermanentTo(state, id, "graveyard", "destroy");
                }
                return watcherFirings(state);
            });
        expect(fire(true)).toBe(1);
        expect(fire(false)).toBe(3);
    });

    it("fires once PER death when the Cats die one at a time", () => {
        withCatCards(true, () => {
            const state = catBoard(threeCats());
            let total = 0;
            for (const id of ["cat0", "cat1", "cat2"]) {
                state.pendingEvents = [];
                removePermanentTo(state, id, "graveyard");
                total += watcherFirings(state);
            }
            expect(total).toBe(3);
        });
    });

    it("forwards the flag onto the built ability", () => {
        expect(catWatcher(true).triggeredAbilities![0].oncePerEventBatch).toBe(
            true
        );
        expect(
            catWatcher(false).triggeredAbilities![0].oncePerEventBatch
        ).toBeUndefined();
    });
});
