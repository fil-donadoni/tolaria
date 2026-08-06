// Token entry emits PERMANENT_ENTERED (issue #2300, CR 111.1 / 603.6a).
//
// A token IS a permanent, so a token entering the battlefield fires every
// enters-the-battlefield trigger exactly like a printed permanent's entry.
// Before this fix `createTokenPermanents` emitted only the batched
// `TOKENS_CREATED` event, so the whole catalogue of ETB triggers (the shared
// `enteredTrigger` factory plus every raw `PERMANENT_ENTERED` declaration) was
// blind to tokens — Thopter Foundry's Thopter never woke Sword of the Meek.
//
// The tests below are derived from the producer/consumer census, one test per
// row, INCLUDING the must-NOT rows (CR 614 exile redirect, Arboria's nontoken
// carve-out, scenario placement) — a test suite written from the
// implementation would inherit the implementation's assumptions and could not
// falsify them.

import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    createTokenPermanents,
    processPendingActionTriggers,
    resolveTopOfStack,
    getPlayer,
    type GameState,
    type CardInstanceState,
    type StackItem,
} from "../state";
import { collectTriggers } from "../triggers";
import { buildStateFromScenario } from "../scenarioBuilder";
import { registerTokenDefinition } from "../../cards";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import { spreadingPlague } from "../../cards/sets/inv/black";
import { titaniasSong } from "../../cards/sets/atq/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardDefinition, GameEvent, TokenSpec } from "../../cards/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A plain 1/1 blue creature token — the Thopter shape, minus the art. */
const THOPTER: TokenSpec = {
    name: "Thopter",
    types: ["Artifact", "Creature"],
    subtypes: ["Thopter"],
    power: 1,
    toughness: 1,
    colors: ["U"],
    staticAbilities: ["flying"],
};

/** A noncreature token (CR 111.1 — still a permanent, still enters). */
const TREASURE: TokenSpec = {
    name: "Treasure",
    types: ["Artifact"],
    subtypes: ["Treasure"],
};

/** Watcher: "Whenever another creature you control enters, you gain 1 life."
 *  The Guide of Souls shape — the shared `enteredTrigger` factory, whose
 *  `matches` reads ONLY the event payload. Life gain is the observable proof
 *  the trigger actually RESOLVED, not merely matched. */
const CREATURE_WATCHER_ID = "test-2300-creature-watcher";
registerTokenDefinition({
    id: CREATURE_WATCHER_ID,
    name: "Test Creature Watcher",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "test-2300-creature-watcher-trigger",
            oracleText:
                "Whenever another creature you control enters, you gain 1 life.",
            scope: "another-yours",
            filter: { types: "Creature" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
} satisfies CardDefinition);

/** Watcher: "Whenever a creature enters, you gain 1 life." — scope `any`, so
 *  BOTH players' copies fire off one entry. Used for the APNAP row. */
const ANY_WATCHER_ID = "test-2300-any-watcher";
registerTokenDefinition({
    id: ANY_WATCHER_ID,
    name: "Test Any Watcher",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "test-2300-any-watcher-trigger",
            oracleText: "Whenever a creature enters, you gain 1 life.",
            scope: "any",
            filter: { types: "Creature" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
} satisfies CardDefinition);

/** Watcher keyed on the EFFECTIVE 1/1 snapshot the event carries — the Sword
 *  of the Meek matcher, reduced to its P/T clause (CR 603.2 / 613.4). */
const ONE_ONE_WATCHER_ID = "test-2300-one-one-watcher";
registerTokenDefinition({
    id: ONE_ONE_WATCHER_ID,
    name: "Test 1/1 Watcher",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "test-2300-one-one-watcher-trigger",
            oracleText:
                "Whenever a 1/1 creature you control enters, gain 1 life.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.controllerId === self.controllerId &&
                event.types.includes("Creature") &&
                event.power === 1 &&
                event.toughness === 1,
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
} satisfies CardDefinition);

/** An anthem (CR 613.4 layer 7c): "Creatures you control get +1/+1." A 1/1
 *  token created while this is out is EFFECTIVELY 2/2 at the moment of entry. */
const ANTHEM_ID = "test-2300-anthem";
registerTokenDefinition({
    id: ANTHEM_ID,
    name: "Test Anthem",
    rarity: "common",
    manaCost: { W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId,
            power: 1,
            toughness: 1,
        },
    ],
} satisfies CardDefinition);

/** CR 614 — "If a permanent would enter, exile it instead." Deliberately
 *  UNLIKE Containment Priest, which exempts tokens: this one catches them, so
 *  it can prove a redirected token announces no entry. */
const EXILER_ID = "test-2300-etb-exiler";
registerTokenDefinition({
    id: EXILER_ID,
    name: "Test ETB Exiler",
    rarity: "rare",
    manaCost: { W: 2 },
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "test-2300-etb-exiler-replacement",
            oracleText: "If a permanent would enter, exile it instead.",
            eventKind: "enters-battlefield",
            appliesTo: (event) => event.kind === "enters-battlefield",
            replace: (event) => {
                if (event.kind !== "enters-battlefield") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, destination: "exile" },
                };
            },
        },
    ],
} satisfies CardDefinition);

/** A printed GREEN 3/4 Beast — the copy SOURCE, so the token-copy row can
 *  assert the event describes the COPIED characteristics and not the 0/0
 *  placeholder; also the "shares no color" bystander for Spreading Plague. */
const BEAST_ID = "test-2300-beast";
registerTokenDefinition({
    id: BEAST_ID,
    name: "Test Beast",
    rarity: "common",
    manaCost: { G: 3 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 3,
    toughness: 4,
} satisfies CardDefinition);

/** A printed BLUE 1/1 — shares blue with the Thopter token. */
const ONE_ONE_BLUE_ID = "test-2300-blue-one-one";
registerTokenDefinition({
    id: ONE_ONE_BLUE_ID,
    name: "Test Blue One One",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 1,
    toughness: 1,
} satisfies CardDefinition);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const enteredEvents = (state: GameState) =>
    (state.pendingEvents ?? []).filter((e) => e.type === "PERMANENT_ENTERED");

const tokensCreatedEvents = (state: GameState) =>
    (state.pendingEvents ?? []).filter((e) => e.type === "TOKENS_CREATED");

/** Battlefield with `defIds` under p1 and `p2DefIds` under p2. */
function boardWith(defIds: string[], p2DefIds: string[] = []): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: defIds.map((id, i) =>
                    makeInstance(id, {
                        id: `p1-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2", {
                battlefield: p2DefIds.map((id, i) =>
                    makeInstance(id, {
                        id: `p2-${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                    })
                ),
            }),
        ],
    });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("token entry emits PERMANENT_ENTERED (CR 111.1 / 603.6a, issue #2300)", () => {
    it("a creature token entering fires a 'whenever a creature you control enters' trigger", () => {
        const state = boardWith([CREATURE_WATCHER_ID]);
        createTokenPermanents(state, THOPTER, "p1", 1);

        expect(enteredEvents(state)).toHaveLength(1);
        const [event] = enteredEvents(state);
        expect(event).toMatchObject({
            type: "PERMANENT_ENTERED",
            controllerId: "p1",
            power: 1,
            toughness: 1,
        });
        expect(event.type === "PERMANENT_ENTERED" && event.types).toEqual([
            "Artifact",
            "Creature",
        ]);

        // …and it reaches the stack through the engine's real trigger scan.
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "test-2300-creature-watcher-trigger"
        );
    });

    it("fires ONCE PER TOKEN while TOKENS_CREATED stays ONCE PER CALL", () => {
        const state = boardWith([CREATURE_WATCHER_ID]);
        createTokenPermanents(state, THOPTER, "p1", 3);

        // The load-bearing asymmetry: three entries, one creation batch.
        expect(enteredEvents(state)).toHaveLength(3);
        expect(tokensCreatedEvents(state)).toHaveLength(1);
        expect(tokensCreatedEvents(state)[0]).toMatchObject({
            type: "TOKENS_CREATED",
            count: 3,
        });

        // Three distinct instances, not the same id announced three times.
        const ids = new Set(
            enteredEvents(state).map((e) =>
                e.type === "PERMANENT_ENTERED" ? e.instanceId : ""
            )
        );
        expect(ids.size).toBe(3);

        // The watcher fires three times (CR 603.2 — one trigger per event).
        const triggers = collectTriggers(state, state.pendingEvents ?? []);
        expect(
            triggers.filter(
                (t) =>
                    t.triggeredAbilityId ===
                    "test-2300-creature-watcher-trigger"
            )
        ).toHaveLength(3);
    });

    it("a NONCREATURE token still announces its entry, with no P/T snapshot", () => {
        const state = boardWith([]);
        createTokenPermanents(state, TREASURE, "p1", 1);

        expect(enteredEvents(state)).toHaveLength(1);
        const [event] = enteredEvents(state);
        // CR 208.1 — only creatures have power/toughness, so the snapshot the
        // emitter takes for creatures is absent here (not 0).
        expect(event).not.toHaveProperty("power");
        expect(event).not.toHaveProperty("toughness");
    });

    it("MUST NOT announce a token a CR 614 replacement redirected to exile", () => {
        const state = boardWith([EXILER_ID, CREATURE_WATCHER_ID]);
        createTokenPermanents(state, THOPTER, "p1", 2);

        // Both tokens were CREATED (TOKENS_CREATED counts the request, CR
        // 111.1) but neither ENTERED the battlefield, so no ETB trigger sees
        // them.
        expect(tokensCreatedEvents(state)).toHaveLength(1);
        expect(enteredEvents(state)).toHaveLength(0);
        expect(getPlayer(state, "p1").exile).toHaveLength(2);
        expect(
            getPlayer(state, "p1").battlefield.filter((c) => c.isToken)
        ).toHaveLength(0);

        processPendingActionTriggers(state);
        expect(
            state.stack.filter(
                (s) =>
                    s.triggeredAbilityId ===
                    "test-2300-creature-watcher-trigger"
            )
        ).toHaveLength(0);
    });

    it("snapshots EFFECTIVE P/T: a 1/1 token under an anthem is not a 1/1 (CR 603.2 / 613.4)", () => {
        const withoutAnthem = boardWith([ONE_ONE_WATCHER_ID]);
        createTokenPermanents(withoutAnthem, THOPTER, "p1", 1);
        expect(enteredEvents(withoutAnthem)[0]).toMatchObject({
            power: 1,
            toughness: 1,
        });
        expect(
            collectTriggers(withoutAnthem, withoutAnthem.pendingEvents ?? [])
        ).toHaveLength(1);

        const withAnthem = boardWith([ONE_ONE_WATCHER_ID, ANTHEM_ID]);
        createTokenPermanents(withAnthem, THOPTER, "p1", 1);
        // The token is SPEC'd 1/1 but enters as an effective 2/2, so the
        // "a 1/1 creature enters" condition must NOT be satisfied.
        expect(enteredEvents(withAnthem)[0]).toMatchObject({
            power: 2,
            toughness: 2,
        });
        expect(
            collectTriggers(withAnthem, withAnthem.pendingEvents ?? [])
        ).toHaveLength(0);
    });

    it("announces layer-4 GRANTED types: a Treasure entering under Titania's Song is an artifact CREATURE (CR 613.1d)", () => {
        // Pins the ORDERING of the emit against `applyExistingGrantsTo` /
        // `applySourceStaticEffects` in `createTokenPermanents`. Unlike the
        // anthem case above — layer 7d is a LIVE battlefield scan, already
        // visible the instant the token is pushed — a layer-4 `type-add`
        // MATERIALIZES onto `token.types`, and `emitPermanentEntered` reads
        // that array twice: for the payload AND for the `includes("Creature")`
        // gate that decides whether P/T is snapshotted at all. Emit before the
        // grant passes and the Treasure announces a bare `["Artifact"]` with
        // no P/T, and every "whenever a creature enters" trigger silently
        // stops seeing it. Titania's Song (`sets/atq/green.ts`) is the shipped
        // instance of that shape.
        const state = boardWith([titaniasSong.id, CREATURE_WATCHER_ID]);
        createTokenPermanents(state, TREASURE, "p1", 1);

        expect(enteredEvents(state)).toHaveLength(1);
        const [event] = enteredEvents(state);
        expect(event.type === "PERMANENT_ENTERED" && event.types).toEqual([
            "Artifact",
            "Creature",
        ]);
        // The Creature gate opened, so the P/T snapshot ran: CR 604.3 / 613.4a
        // — the Song's CDA sets P/T to the Treasure's mana value (0).
        expect(event).toMatchObject({ power: 0, toughness: 0 });

        // …and it reaches the stack through the engine's real trigger scan:
        // `enteredTrigger`'s `matches` reads ONLY the event payload, so a
        // missing "Creature" in `types` is the difference between the trigger
        // firing and not existing.
        processPendingActionTriggers(state);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            "test-2300-creature-watcher-trigger",
        ]);
    });

    it("MUST NOT set Arboria's qualifying-action flag (CR 508.1c — a token does not count)", () => {
        const state = boardWith([]);
        createTokenPermanents(state, THOPTER, "p1", 1);
        // `emitPermanentEntered` carves tokens out of the nontoken-only
        // qualifying action; routing tokens through it must not regress that.
        expect(getPlayer(state, "p1").qualifyingActionThisTurn).toBeUndefined();
    });

    it("carries neither wasCast nor wasPlayed (CR 111.1 — a token is neither)", () => {
        const state = boardWith([]);
        createTokenPermanents(state, THOPTER, "p1", 1);
        const [event] = enteredEvents(state);
        expect(event).not.toHaveProperty("wasCast");
        expect(event).not.toHaveProperty("wasPlayed");
    });

    it("orders simultaneous entries APNAP when both players hold a trigger (CR 603.3b)", () => {
        const state = boardWith([ANY_WATCHER_ID], [ANY_WATCHER_ID]);
        expect(state.activePlayerId).toBe("p1");
        createTokenPermanents(state, THOPTER, "p1", 1);

        processPendingActionTriggers(state);
        // Both watchers fire off the one entry. APNAP (CR 603.3b): the ACTIVE
        // player's trigger goes on the stack first, so it sits on the BOTTOM
        // and resolves LAST.
        expect(state.stack).toHaveLength(2);
        expect(state.stack.map((s) => s.controllerId)).toEqual(["p1", "p2"]);
    });
});

describe("token COPY entry announces the copied characteristics (CR 707.2, issue #2300)", () => {
    it("announces the COPIED types and P/T, never the 0/0 'Copy' placeholder", () => {
        const state = boardWith([BEAST_ID]);
        const source = getPlayer(state, "p1").battlefield[0];
        const item: StackItem = {
            ...makeInstance(BEAST_ID, {
                id: "copier",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            targets: [],
        };
        const ctx = buildSpellContext(state, item);

        const tokenId = ctx.createTokenCopyOf(source.id, "p1");
        expect(tokenId).toBeDefined();

        expect(enteredEvents(state)).toHaveLength(1);
        const [event] = enteredEvents(state);
        expect(event).toMatchObject({
            type: "PERMANENT_ENTERED",
            instanceId: tokenId,
            controllerId: "p1",
            // The placeholder is a 0/0 named "Copy"; the real copy is 3/4.
            power: 3,
            toughness: 4,
        });

        // The announced entry must be emitted exactly once — the deferral
        // suppresses the placeholder's own emit rather than adding a second.
        expect(enteredEvents(state)).toHaveLength(1);
    });

    it("a token copy of a 1/1 satisfies a 'a 1/1 creature enters' condition", () => {
        const state = boardWith([ONE_ONE_WATCHER_ID]);
        // Create a plain 1/1 Thopter, then copy it.
        const [thopterId] = createTokenPermanents(state, THOPTER, "p1", 1);
        state.pendingEvents = undefined; // isolate the copy's own entry

        const item: StackItem = {
            ...makeInstance(ONE_ONE_WATCHER_ID, {
                id: "copier",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            targets: [],
        };
        const ctx = buildSpellContext(state, item);
        ctx.createTokenCopyOf(thopterId, "p1");

        expect(enteredEvents(state)).toHaveLength(1);
        expect(enteredEvents(state)[0]).toMatchObject({
            power: 1,
            toughness: 1,
        });
        expect(collectTriggers(state, state.pendingEvents ?? [])).toHaveLength(
            1
        );
    });
});

describe("scenario placement stays inert (ADR 0044, issue #2300)", () => {
    it("loading a scenario that places tokens fires no ETB trigger and queues no entry event", () => {
        const base = boardWith([]);
        const built = buildStateFromScenario(base, {
            cards: [
                { name: "Thopter", token: true, owner: "me", count: 2 },
                // A REAL catalogued "whenever a creature enters" listener —
                // a scenario spec can only name registry cards, and using the
                // real one makes the "no trigger" assertion non-vacuous.
                {
                    name: "Spreading Plague",
                    owner: "me",
                    zone: "battlefield",
                },
            ],
        });

        // A scenario PLACES a board; it never plays one out.
        expect(built.pendingEvents ?? []).toHaveLength(0);
        expect(built.stack).toHaveLength(0);
        expect(collectTriggers(built, built.pendingEvents ?? [])).toHaveLength(
            0
        );
        // …and the tokens really are there (the assertion above would pass
        // vacuously on an empty board).
        expect(
            built.players[0].battlefield.filter(
                (c: CardInstanceState) => c.isToken
            )
        ).toHaveLength(2);
    });
});

// Guards the census's own premise: no PERMANENT_ENTERED consumer may need a
// registry hop the synthesized token definition can't serve. `emitPermanentEntered`
// stamps `cardId` from the instance's `card.id`, which for a token is its
// SYNTHESIZED definition id — the census found exactly one consumer that
// resolves it (Spreading Plague, via `ctx.getColors`), so it must resolve.
describe("a token's announced cardId resolves in the registry (issue #2300 census)", () => {
    it("names the synthesized token definition, which is registered before the entry", () => {
        const state = boardWith([]);
        createTokenPermanents(state, THOPTER, "p1", 1);
        const [event] = enteredEvents(state) as Extract<
            GameEvent,
            { type: "PERMANENT_ENTERED" }
        >[];
        expect(event.cardId).toBeDefined();
        const token = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === event.instanceId
        )!;
        expect((token.card as { id: string }).id).toBe(event.cardId);
    });

    it("Spreading Plague — the one consumer that resolves the entrant's DEFINITION — reads a token's colors correctly", () => {
        // The census's single RISKY row (`convex/cards/sets/inv/black.ts:1151`):
        // its `resolve` calls `ctx.getColors` on the ENTERING permanent, which
        // falls back to `tryGetDefinition(cardId)?.manaCost`. For a token that
        // id is SYNTHESIZED — this proves the lookup resolves and yields the
        // spec's colors (CR 110.5), rather than throwing or reading colorless.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(spreadingPlague.id, {
                            id: "plague",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        // A blue creature already out — shares blue with the
                        // entering Thopter, so it must be destroyed.
                        makeInstance(ONE_ONE_BLUE_ID, {
                            id: "blue-bystander",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        // A green creature — shares nothing, must survive.
                        makeInstance(BEAST_ID, {
                            id: "green-bystander",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        createTokenPermanents(state, THOPTER, "p1", 1);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        const bf = getPlayer(state, "p1").battlefield.map((c) => c.id);
        expect(bf).not.toContain("blue-bystander");
        expect(bf).toContain("green-bystander");
    });
});
