// Last-known copiable values (ADR 0086) — the store that lets a NON-TARGETED
// "create a token that's a copy of it" survive its source leaving the
// battlefield.
//
//   CR 608.2h — "If the effect requires information from a specific object,
//   including the source of the ability itself … if it's no longer in that
//   zone, the effect uses the object's last known information."
//   CR 111.12 — "If an effect instructs a player to create a token that is a
//   copy of a nonexistent object, no token is created … This does not apply to
//   an effect that would use the last known information of an object."
//
// The rule NOT covered by the store, asserted here as a regression: an
// announced TARGET that has left is illegal under CR 608.2b and the copy
// fizzles (Dance of Many). That is a different rule and stays unchanged.

import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type StackItem,
} from "../state";
import { applyCopy, presentedDefId } from "../copy";
import { turnFaceDown } from "../faceDown";
import { checkTokenExistenceSBA } from "../sba";
import { finalizeCleanup } from "../phases";
import { compactState, expandState } from "../serialize";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { projectPublicState } from "../../gameProjections";
import {
    FACE_DOWN_CARD_ID,
    registerTokenDefinition,
} from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears, savannahLions } from "../../cards/sets/lea";
import { crusade, serraAngel } from "../../cards/sets/lea/white";

/** A board with `battlefield` under p1 and a resolving spell to hang a
 *  `SpellContext` off. Returns the context plus the live state. */
function boardWith(battlefield: CardInstanceState[]) {
    const state = makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
    const item = pushSpell(state, grizzlyBears.id, "p1");
    return { state, ctx: buildSpellContext(state, item) };
}

function tokenOnBattlefield(
    state: ReturnType<typeof makeState>,
    id: string | undefined
): CardInstanceState {
    const found = state.players[0].battlefield.find((c) => c.id === id);
    expect(found).toBeDefined();
    return found!;
}

describe("last known copiable values (CR 608.2h / 111.12, ADR 0086)", () => {
    it("creates the token from LKI when the named source has already left the battlefield", () => {
        const source = makeInstance(serraAngel.id, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const { state, ctx } = boardWith([source]);

        removePermanentTo(state, "src", "graveyard");
        expect(state.players[0].battlefield).toHaveLength(0);

        const tokenId = ctx.createTokenCopyOf("src", "p1", undefined, {
            lastKnownCopiable: true,
        });
        const token = tokenOnBattlefield(state, tokenId);
        expect(presentedDefId(token)).toBe(serraAngel.id);
        expect(token.power).toBe(4);
        expect(token.toughness).toBe(4);
        expect(token.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "vigilance"])
        );
    });

    it("copies a Clone as what it HAD BECOME, not as the printed card revertCopy restored on the way out", () => {
        // The case that justifies a store rather than a graveyard lookup:
        // `revertCopy` runs at the departure funnel (CR 707.2 — the copy effect
        // lasts only while the object is on the battlefield), so the card in
        // the graveyard is the printed Grizzly Bears.
        const original = makeInstance(serraAngel.id, {
            id: "orig",
            controllerId: "p1",
            ownerId: "p1",
        });
        const clone = makeInstance(grizzlyBears.id, {
            id: "clone",
            controllerId: "p1",
            ownerId: "p1",
        });
        applyCopy(clone, original);
        const { state, ctx } = boardWith([original, clone]);

        removePermanentTo(state, "clone", "graveyard");
        const inGraveyard = state.players[0].graveyard.find(
            (c) => c.id === "clone"
        )!;
        expect(presentedDefId(inGraveyard)).toBe(grizzlyBears.id);

        const tokenId = ctx.createTokenCopyOf("clone", "p1", undefined, {
            lastKnownCopiable: true,
        });
        const token = tokenOnBattlefield(state, tokenId);
        expect(presentedDefId(token)).toBe(serraAngel.id);
        expect(token.power).toBe(4);
    });

    it("survives the CR 704.5d token sweep that removes the source token's instance from state", () => {
        const { state, ctx } = boardWith([]);
        const [sourceTokenId] = ctx.createToken(
            {
                name: "Bear Cub",
                types: ["Creature"],
                subtypes: ["Bear"],
                power: 3,
                toughness: 3,
                staticAbilities: ["trample"],
            },
            "p1"
        );
        removePermanentTo(state, sourceTokenId, "graveyard");
        checkTokenExistenceSBA(state);
        // CR 704.5d — the token now exists in NO zone at all.
        for (const p of state.players) {
            for (const zone of [
                p.battlefield,
                p.graveyard,
                p.exile,
                p.hand,
            ] as CardInstanceState[][]) {
                expect(zone.some((c) => c.id === sourceTokenId)).toBe(false);
            }
        }

        const tokenId = ctx.createTokenCopyOf(sourceTokenId, "p1", undefined, {
            lastKnownCopiable: true,
        });
        const token = tokenOnBattlefield(state, tokenId);
        expect(token.power).toBe(3);
        expect(token.toughness).toBe(3);
        expect(token.staticAbilities).toContain("trample");
        expect(token.subtypes).toContain("Bear");
    });

    it("copies the BASE power/toughness, not the anthem-buffed effective values (CR 707.2 — 'other effects are not copied')", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const anthem = makeInstance(crusade.id, {
            id: "anthem",
            controllerId: "p1",
            ownerId: "p1",
        });
        const { state, ctx } = boardWith([lion, anthem]);
        // The anthem is live while the lion is on the battlefield.
        expect(getEffectivePower(state, lion)).toBe(savannahLions.power! + 1);

        removePermanentTo(state, "lion", "graveyard");
        const tokenId = ctx.createTokenCopyOf("lion", "p1", undefined, {
            lastKnownCopiable: true,
        });
        const token = tokenOnBattlefield(state, tokenId);
        // Layer 1 is the printed body …
        expect(token.power).toBe(savannahLions.power);
        expect(token.toughness).toBe(savannahLions.toughness);
        // … and the still-live anthem applies to the NEW token on top of it,
        // once — not twice, which is what copying the buffed value would give.
        expect(getEffectivePower(state, token)).toBe(savannahLions.power! + 1);
        expect(getEffectiveToughness(state, token)).toBe(
            savannahLions.toughness! + 1
        );
    });

    it("copies the FACE-DOWN body of a face-down permanent, not the card CR 708.9 reveals as it leaves", () => {
        const morph = makeInstance(serraAngel.id, {
            id: "morph",
            controllerId: "p1",
            ownerId: "p1",
        });
        turnFaceDown(morph, "morph");
        const { state, ctx } = boardWith([morph]);

        removePermanentTo(state, "morph", "graveyard");
        // CR 708.9 — the departing permanent was revealed on the way out.
        const revealed = state.players[0].graveyard.find(
            (c) => c.id === "morph"
        )!;
        expect(presentedDefId(revealed)).toBe(serraAngel.id);

        const tokenId = ctx.createTokenCopyOf("morph", "p1", undefined, {
            lastKnownCopiable: true,
        });
        const token = tokenOnBattlefield(state, tokenId);
        // CR 707.2 — a face-down permanent's copiable values ARE the 2/2
        // colourless nameless body.
        expect(presentedDefId(token)).toBe(FACE_DOWN_CARD_ID);
        expect(token.power).toBe(2);
        expect(token.toughness).toBe(2);
    });

    it("inherits the 'except it's N/N' stamp a copy effect left on the departed object (CR 707.3)", () => {
        const original = makeInstance(serraAngel.id, {
            id: "orig",
            controllerId: "p1",
            ownerId: "p1",
        });
        const eternalized = makeInstance(grizzlyBears.id, {
            id: "etb",
            controllerId: "p1",
            ownerId: "p1",
        });
        // The real Eternalize shape: the copy effect's own "except it's N/N"
        // clause, stamped by `applyCopy` as `copyExcept`. 7/7 rather than
        // Serra Angel's printed 4/4 so the assertion can only pass by reading
        // the exception.
        applyCopy(eternalized, original, {
            basePower: 7,
            baseToughness: 7,
        });
        const { state, ctx } = boardWith([original, eternalized]);

        removePermanentTo(state, "etb", "graveyard");
        const tokenId = ctx.createTokenCopyOf("etb", "p1", undefined, {
            lastKnownCopiable: true,
        });
        const token = tokenOnBattlefield(state, tokenId);
        expect(token.power).toBe(7);
        expect(token.toughness).toBe(7);
    });

    it("REGRESSION (CR 608.2b, Dance of Many): a caller that does NOT opt in still fizzles when its source has left", () => {
        const source = makeInstance(serraAngel.id, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const { state, ctx } = boardWith([source]);
        removePermanentTo(state, "src", "graveyard");
        // The store HAS the entry — the opt-out is what makes the copy fizzle,
        // not an absent snapshot.
        expect(state.lastKnownCopiable?.["src"]).toBeDefined();
        expect(ctx.createTokenCopyOf("src", "p1")).toBeUndefined();
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

describe("LKI copiable store — CR 514 pruning on a two-turn window (ADR 0086)", () => {
    function stateWithDepartureOnTurn(turn: number) {
        const source = makeInstance(serraAngel.id, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            turn,
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "src", "graveyard");
        return state;
    }

    it("keeps an entry through the departure turn's own cleanup and the next turn's", () => {
        const state = stateWithDepartureOnTurn(5);
        finalizeCleanup(state);
        expect(state.lastKnownCopiable?.["src"]).toBeDefined();
        state.turn = 6;
        finalizeCleanup(state);
        expect(state.lastKnownCopiable?.["src"]).toBeDefined();
    });

    it("a 'next upkeep' delayed trigger (turn N+2) still resolves the copy, and the entry is dropped only at that turn's cleanup", () => {
        const state = stateWithDepartureOnTurn(5);
        // Turn N+1 ends.
        state.turn = 6;
        finalizeCleanup(state);
        // Turn N+2's upkeep: the longest-lived referent the engine can produce.
        state.turn = 7;
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        const tokenId = ctx.createTokenCopyOf("src", "p1", undefined, {
            lastKnownCopiable: true,
        });
        expect(tokenId).toBeDefined();
        expect(presentedDefId(tokenOnBattlefield(state, tokenId))).toBe(
            serraAngel.id
        );
        // …and only THEN does the window close.
        finalizeCleanup(state);
        expect(state.lastKnownCopiable?.["src"]).toBeUndefined();
    });

    it("drops the whole key once the last entry ages out, so an idle game stores nothing", () => {
        const state = stateWithDepartureOnTurn(1);
        state.turn = 3;
        finalizeCleanup(state);
        expect(state.lastKnownCopiable).toBeUndefined();
    });

    it("prunes idempotently across the extra cleanup step CR 514.3a can start", () => {
        const state = stateWithDepartureOnTurn(5);
        state.turn = 6;
        finalizeCleanup(state);
        finalizeCleanup(state);
        expect(state.lastKnownCopiable?.["src"]).toBeDefined();
    });
});

describe("LKI copiable store — persistence and wire format", () => {
    function stateWithEntry() {
        const source = makeInstance(serraAngel.id, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        source.copyExcept = { basePower: 4, baseToughness: 4 };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "src", "graveyard");
        return state;
    }

    it("round-trips a non-empty store through compact/expand", () => {
        const state = stateWithEntry();
        const restored = expandState(compactState(state));
        expect(restored.lastKnownCopiable?.["src"]).toEqual({
            defId: serraAngel.id,
            copyExcept: { basePower: 4, baseToughness: 4 },
            turn: state.turn,
        });
    });

    it("stores the definition id as a cardPool INDEX, never a raw uuid in the hottest row (issue #1780)", () => {
        const compact = compactState(stateWithEntry()) as Record<
            string,
            unknown
        >;
        const entry = (
            compact.lastKnownCopiable as Record<string, { d: unknown }>
        )["src"];
        expect(typeof entry.d).toBe("number");
        expect((compact.cardPool as string[])[entry.d as number]).toBe(
            serraAngel.id
        );
        expect(JSON.stringify(compact.lastKnownCopiable)).not.toContain(
            serraAngel.id
        );
    });

    it("crosses projectPublicState UNREDACTED, deliberately (ADR 0074 — the client Brain simulates the same copy)", () => {
        const state = stateWithEntry();
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.lastKnownCopiable?.["src"]).toEqual(
            state.lastKnownCopiable!["src"]
        );
    });
});

// ---------------------------------------------------------------------------
// Full path: the demoable line of play. A creature whose own trigger says
// "create a token that's a copy of it" is removed in response to that trigger,
// and the token is created anyway (CR 608.2h + CR 111.12) — through the
// `createTokenCopy` Op, which is what decides the effect NAMES its source
// rather than targeting it.
// ---------------------------------------------------------------------------

const SELF_COPY_TRIGGER_ID = "lki-self-copy-trigger";
const SELF_COPY_CREATURE_ID = "test-lki-self-copier";
registerTokenDefinition({
    id: SELF_COPY_CREATURE_ID,
    name: SELF_COPY_CREATURE_ID,
    rarity: "common",
    manaCost: { G: 2 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 3,
    toughness: 3,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        {
            id: SELF_COPY_TRIGGER_ID,
            oracleText:
                "When this creature enters, create a token that's a copy of it.",
            event: "PERMANENT_ENTERED",
            // The test pushes this trigger onto the stack by hand, so the
            // natural scan must never fire it a second time off the token the
            // Op creates. `matches` is what the scan consults (`triggers.ts`).
            matches: () => false,
            effects: [
                {
                    op: "createTokenCopy",
                    source: { ref: "$source" },
                    controller: "controller",
                },
            ],
        },
    ],
});

const TARGETED_COPY_ID = "test-lki-targeted-copier";
registerTokenDefinition({
    id: TARGETED_COPY_ID,
    name: TARGETED_COPY_ID,
    rarity: "common",
    manaCost: { U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "createTokenCopy",
            source: { target: 0 },
            controller: "controller",
        },
    ],
});

function selfCopyTriggerOnStack(
    state: ReturnType<typeof makeState>,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "lki-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: SELF_COPY_TRIGGER_ID,
        triggerSourceId: source.id,
        // The trigger's own firing event. Required by the resolution dispatch
        // (`resolveTopOfStackInner` routes on `triggeredAbilityId && cardDef &&
        // triggerEvent`) — without it the item falls through to the ordinary
        // permanent-spell tail.
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            cardId: presentedDefId(source),
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

describe("createTokenCopy Op — LKI source (CR 608.2h / 111.12, ADR 0086)", () => {
    it("still creates the token when the trigger's own source was removed in response", () => {
        const self = makeInstance(SELF_COPY_CREATURE_ID, {
            id: "self1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [self] }),
                makePlayer("p2"),
            ],
        });
        selfCopyTriggerOnStack(state, self);
        // Removal resolves first — the source is gone before its own trigger.
        // Bounced rather than destroyed on purpose: a card in the HAND is in a
        // hidden zone (CR 400.2) that no copy lookup may search, so the token
        // can only come from the LKI store.
        removePermanentTo(state, "self1", "hand");

        resolveTopOfStack(state);

        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        expect(presentedDefId(tokens[0])).toBe(SELF_COPY_CREATURE_ID);
        expect(tokens[0].power).toBe(3);
        expect(tokens[0].staticAbilities).toContain("trample");
    });

    it("uses the LKI values, not the printed card revertCopy left in the graveyard", () => {
        // A Clone that had become the self-copier: it presents the copied def
        // (so the trigger is ITS trigger, CR 707.2), and `revertCopy` puts the
        // printed Grizzly Bears in the graveyard on the way out. A
        // graveyard-sourced read would build a 2/2 Bear; only the LKI store
        // still knows it was a 3/3 trampling Beast.
        const printedSource = makeInstance(SELF_COPY_CREATURE_ID, {
            id: "printed",
            controllerId: "p1",
            ownerId: "p1",
        });
        const clone = makeInstance(grizzlyBears.id, {
            id: "self2",
            controllerId: "p1",
            ownerId: "p1",
        });
        applyCopy(clone, printedSource);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [printedSource, clone] }),
                makePlayer("p2"),
            ],
        });
        selfCopyTriggerOnStack(state, clone);
        removePermanentTo(state, "self2", "graveyard");
        expect(
            presentedDefId(
                state.players[0].graveyard.find((c) => c.id === "self2")!
            )
        ).toBe(grizzlyBears.id);

        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(presentedDefId(token)).toBe(SELF_COPY_CREATURE_ID);
        expect(token.power).toBe(3);
        expect(token.staticAbilities).toContain("trample");
    });

    it("REGRESSION (CR 608.2h, Eternalize): a source recovered from EXILE copies THE CARD, not the permanent's last known values", () => {
        // CR 702.129a — an ability whose own activation cost exiled the card
        // from the graveyard expects to find it in exile, and does: "a copy of
        // this card" is the CARD, whose copiable values are its printed ones
        // (CR 707.2). The store must lose there even though the same instance
        // id has an entry from when the permanent died, or eternalizing a card
        // that had been a Clone would resurrect the cloned identity.
        const printedSource = makeInstance(SELF_COPY_CREATURE_ID, {
            id: "printed-e",
            controllerId: "p1",
            ownerId: "p1",
        });
        const clone = makeInstance(grizzlyBears.id, {
            id: "self3",
            controllerId: "p1",
            ownerId: "p1",
        });
        applyCopy(clone, printedSource);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [printedSource, clone] }),
                makePlayer("p2"),
            ],
        });
        selfCopyTriggerOnStack(state, clone);
        removePermanentTo(state, "self3", "graveyard");
        expect(state.lastKnownCopiable?.["self3"]?.defId).toBe(
            SELF_COPY_CREATURE_ID
        );
        // The activation cost moves it graveyard → exile.
        const idx = state.players[0].graveyard.findIndex(
            (c) => c.id === "self3"
        );
        const [card] = state.players[0].graveyard.splice(idx, 1);
        card.zone = "exile";
        state.players[0].exile.push(card);

        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(presentedDefId(token)).toBe(grizzlyBears.id);
    });

    it("REGRESSION (CR 608.2b): an announced TARGET that has left still fizzles through the Op", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, TARGETED_COPY_ID, "p1", [
            { type: "permanent", id: "tgt" },
        ]);
        removePermanentTo(state, "tgt", "graveyard");
        expect(state.lastKnownCopiable?.["tgt"]).toBeDefined();

        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(0);
    });
});
