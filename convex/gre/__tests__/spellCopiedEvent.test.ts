// SPELL_COPIED — "a player copies a spell" (CR 707.10 + CR 603.2).
//
// The event behind the "or copy" half of Magecraft (Witherbloom Apprentice,
// Sedgemoor Witch): a copy of a spell isn't cast (CR 707.10), so `SPELL_CAST`
// can never see one.
//
// PRODUCER CENSUS. Every site that puts a spell onto the stack, classified emit
// / must-not-emit. Each row has a test below, the must-NOT rows included.
//
//  | #  | Site                                                       | Emits |
//  |----|------------------------------------------------------------|-------|
//  | 1  | `commitCast` → stack (`gre/castCommit.ts`, real cast)      | no    |
//  | 2  | `commitCast` → during resolution (`castChosenSpell`)       | no    |
//  | 3  | `castFaceDown` (`gre/state.ts`)                            | no    |
//  | 4  | Search sandboxes (`search.ts`, `applyMove.ts`) — `.bot`    | no    |
//  | 5  | AI probe cast (`gre/ai/dominance.ts`)                      | no    |
//  | 6  | `cloneSpellOntoStack` ← cast-copy trigger (Storm)          | YES   |
//  | 7  | `cloneSpellOntoStack` ← `copyStackItem` (Fork)             | YES   |
//  | 8  | `cloneSpellOntoStack` ← `copyResolvingSpell` (Chain …)     | YES   |
//  | 9  | `cloneSpellOntoStack` refusing an ability                  | no    |
//
// Rows 1, 2, 4 and 5 reach only `emitSpellCastEvent`; rows 6–8 are the three
// producers of the clone helper, which is the ONE emit site. Observed through
// the trigger scan, never `state.pendingEvents`: the queue is drained on the way
// out of every resolution, so asserting on it would pass vacuously.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    emitSpellCastEvent,
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
    type StackItem,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions, registerTokenDefinition } from "../../cards";
import { spellCastTrigger } from "../../cards/abilities/triggers/spellCastTrigger";
import type { CardDefinition, SpellCopiedEvent } from "../../cards/types";
import {
    fork,
    giantGrowth,
    grizzlyBears,
    lightningBolt,
} from "../../cards/sets/lea/index.cards";
import { chainLightning } from "../../cards/sets/leg/red.cards";
import { emptyTheWarrens, grapeshot } from "../../cards/sets/tsp/red.cards";
import { saprolingInfestation } from "../../cards/sets/inv/green.cards";
import { witherbloomApprentice } from "../../cards/sets/stx/multicolor.cards";
import { sedgemoorWitch } from "../../cards/sets/stx/black.cards";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([witherbloomApprentice(), sedgemoorWitch()]);

/** Watches every copy and nothing else, so a row's count cannot be confused
 *  with a cast trigger. */
const COPY_WATCHER_ID = "test:spell-copied-watcher";
const copyWatcher: CardDefinition = {
    id: COPY_WATCHER_ID,
    rarity: "common",
    name: "Copy Watcher",
    manaCost: {},
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "copy-watch",
            oracleText: "Whenever a player copies a spell, you gain 1 life.",
            event: "SPELL_COPIED",
            matches: (event) => event.type === "SPELL_COPIED",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
};
registerTokenDefinition(copyWatcher);

/** Watches every CAST and nothing else — the existing `SPELL_CAST` listener
 *  shape a copy must not start firing. */
const CAST_WATCHER_ID = "test:spell-cast-only-watcher";
const castWatcher: CardDefinition = {
    id: CAST_WATCHER_ID,
    rarity: "common",
    name: "Cast Watcher",
    manaCost: {},
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "cast-watch",
            oracleText: "Whenever a player casts a spell, you gain 1 life.",
            scope: "any",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ],
};
registerTokenDefinition(castWatcher);

/** Casts a card from hand through a real choke point (Illusionary Mask's face
 *  down cast, a resolving spell's `castChosenSpell`). */
const FACE_DOWN_CASTER_ID = "test:spell-copied-face-down-caster";
registerTokenDefinition({
    id: FACE_DOWN_CASTER_ID,
    rarity: "common",
    name: "Face-Down Caster",
    manaCost: {},
    types: ["Sorcery"],
    resolve: (ctx) => ctx.castFaceDown("hand-bears"),
});
const DURING_RESOLUTION_CASTER_ID = "test:spell-copied-resolution-caster";
registerTokenDefinition({
    id: DURING_RESOLUTION_CASTER_ID,
    rarity: "common",
    name: "Resolution Caster",
    manaCost: {},
    types: ["Sorcery"],
    resolve: (ctx) =>
        ctx.castChosenSpell("p1", "free-spell", "p1", {
            targets: [{ type: "player", id: "p2" }],
        }),
});
/** Copies its target, whatever that is — reaches the clone helper's refusal,
 *  which the real copy cards' target requirements never let through. */
const BLIND_COPIER_ID = "test:spell-copied-blind-copier";
registerTokenDefinition({
    id: BLIND_COPIER_ID,
    rarity: "common",
    name: "Blind Copier",
    manaCost: {},
    types: ["Sorcery"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx) => {
        const target = ctx.targets?.[0];
        if (target?.type === "spell") ctx.copyStackItem(target.id);
    },
});

function on(pid: "p1" | "p2", cardId: string, id: string) {
    return makeInstance(cardId, {
        id,
        controllerId: pid,
        ownerId: pid,
    });
}

const inHand = (pid: "p1" | "p2", cardId: string, id: string) =>
    makeInstance(cardId, { id, controllerId: pid, ownerId: pid, zone: "hand" });

const RED = (n: number) => ({ W: 0, U: 0, B: 0, R: n, G: 0, C: 0 });

const triggersOn = (state: GameState, abilityId: string) =>
    state.stack.filter((s) => s.triggeredAbilityId === abilityId);

const copyEvents = (state: GameState) =>
    triggersOn(state, "copy-watch").map(
        (s) => s.triggerEvent as SpellCopiedEvent
    );

const magecraftTriggers = (state: GameState) =>
    triggersOn(state, "witherbloom-apprentice-magecraft");

const copiesOnStack = (state: GameState) =>
    state.stack.filter((s) => s.isCopy && !s.triggeredAbilityId);

function realCast(
    state: GameState,
    pid: "p1" | "p2",
    id: string,
    targetType: PendingTarget["targetType"],
    selected: PendingTarget["selected"]
): void {
    finalizeTargetSelection(
        state,
        { playerId: pid, cardInstanceId: id, targetType, count: 1, selected },
        pid
    );
}

function resolveWholeStack(state: GameState): void {
    for (let step = 0; step < 64 && state.stack.length > 0; step++) {
        const before = state.stack.length;
        const top = state.stack[before - 1]?.id;
        resolveTopOfStack(state);
        if (
            state.stack.length === before &&
            state.stack[before - 1]?.id === top
        ) {
            break;
        }
    }
}

function castTallies(state: GameState, pid: "p1" | "p2") {
    const p = getPlayer(state, pid);
    return {
        table: state.spellsCastThisTurn ?? 0,
        perTurn: p.spellsCastThisTurn ?? 0,
        types: p.spellTypesCastThisTurn ?? {},
        lifetime: p.spellsCastThisGame ?? 0,
    };
}

describe("SPELL_COPIED — must-NOT rows: casting is not copying (CR 601.2i)", () => {
    it("row 1: a real cast through `commitCast` emits nothing", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", COPY_WATCHER_ID, "watcher")],
                    hand: [inHand("p1", lightningBolt().id, "bolt")],
                    manaPool: RED(1),
                }),
                makePlayer("p2"),
            ],
        });
        realCast(state, "p1", "bolt", "any", [{ type: "player", id: "p2" }]);
        expect(state.stack.some((s) => s.id === "bolt")).toBe(true);
        expect(copyEvents(state)).toEqual([]);
    });

    it("row 2: a spell cast during resolution (`castChosenSpell`) emits nothing", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", COPY_WATCHER_ID, "watcher")],
                    hand: [inHand("p1", lightningBolt().id, "free-spell")],
                    manaPool: RED(1),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, DURING_RESOLUTION_CASTER_ID, "p1");
        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === "free-spell")).toBe(true);
        expect(copyEvents(state)).toEqual([]);
    });

    it("row 3: a face-down cast emits nothing", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", COPY_WATCHER_ID, "watcher")],
                    hand: [inHand("p1", grizzlyBears().id, "hand-bears")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, FACE_DOWN_CASTER_ID, "p1");
        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === "hand-bears")).toBe(true);
        expect(copyEvents(state)).toEqual([]);
    });

    it("row 5: the AI probe casts through `emitSpellCastEvent` and never reaches the clone helper", () => {
        // The probe's state is thrown away, so its only observable contract is
        // which choke point it calls; the choke point itself is row 1's subject.
        const source = readFileSync(
            join(process.cwd(), "convex/gre/ai/dominance.ts"),
            "utf8"
        );
        expect(source).toContain("emitSpellCastEvent(probe, stackItem)");
        expect(source).not.toContain("SPELL_COPIED");
        expect(source).not.toContain("cloneSpellOntoStack");
    });

    it("row 9: the clone helper refuses an ability, and emits nothing", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", COPY_WATCHER_ID, "watcher")],
                }),
                makePlayer("p2"),
            ],
        });
        const ability: StackItem = {
            ...pushSpell(state, lightningBolt().id, "p2"),
            abilityId: "some-ability",
        };
        state.stack[state.stack.length - 1] = ability;
        pushSpell(state, BLIND_COPIER_ID, "p1", [
            { type: "spell", id: ability.id },
        ]);
        resolveTopOfStack(state);
        expect(copiesOnStack(state)).toEqual([]);
        expect(copyEvents(state)).toEqual([]);
    });

    it("a copy of a permanent spell emits like every other copy", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", COPY_WATCHER_ID, "watcher")],
                }),
                makePlayer("p2"),
            ],
        });
        const bears = pushSpell(state, grizzlyBears().id, "p2");
        pushSpell(state, BLIND_COPIER_ID, "p1", [
            { type: "spell", id: bears.id },
        ]);
        resolveTopOfStack(state);
        expect(copiesOnStack(state)).toHaveLength(1);
        expect(copyEvents(state)).toEqual([
            expect.objectContaining({
                copierId: "p1",
                originalSpellInstanceId: bears.id,
                fromCastCopyTrigger: false,
            }),
        ]);
    });
});

describe("SPELL_COPIED — one event per copy at the clone choke point (CR 707.10)", () => {
    it("row 6: a storm spell's N copies emit N events, each marked as a cast-copy copy", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", COPY_WATCHER_ID, "watcher")],
                }),
                makePlayer("p2"),
            ],
        });
        state.spellsCastThisTurn = 2; // two spells before this one = 2 copies
        const warrens = pushSpell(state, emptyTheWarrens().id, "p1");
        emitSpellCastEvent(state, warrens);
        resolveTopOfStack(state); // the storm trigger: both copies, no prompt

        const events = copyEvents(state);
        expect(events).toHaveLength(2);
        expect(events.map((e) => e.spellInstanceId).sort()).toEqual(
            copiesOnStack(state)
                .map((c) => c.id)
                .sort()
        );
        for (const event of events) {
            expect(event.copierId).toBe("p1");
            expect(event.originalSpellInstanceId).toBe(warrens.id);
            expect(event.fromCastCopyTrigger).toBe(true);
        }
    });

    it("row 7: Fork emits one event carrying the copier, both ids and the copy's OWN colour", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", COPY_WATCHER_ID, "watcher")],
                }),
                makePlayer("p2", {
                    battlefield: [on("p2", grizzlyBears().id, "bears")],
                }),
            ],
        });
        const growth = pushSpell(state, giantGrowth().id, "p2", [
            { type: "permanent", id: "bears" },
        ]);
        pushSpell(state, fork().id, "p1", [{ type: "spell", id: growth.id }]);
        resolveTopOfStack(state);

        const [copy] = copiesOnStack(state);
        expect(copyEvents(state)).toEqual([
            {
                type: "SPELL_COPIED",
                copierId: "p1", // Fork's controller, not the original's caster
                spellInstanceId: copy.id,
                originalSpellInstanceId: growth.id,
                spellCardId: giantGrowth().id,
                spellTypes: ["Instant"],
                spellSubtypes: [],
                spellColors: ["R"], // "except that the copy is red"
                fromCastCopyTrigger: false,
            },
        ]);
    });

    it("row 8: `copyResolvingSpell` names a NON-caster copier (Chain Lightning's damaged player)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", COPY_WATCHER_ID, "watcher")],
                }),
                makePlayer("p2", { manaPool: RED(2) }),
            ],
        });
        const chain = pushSpell(state, chainLightning().id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true }); // pays {R}{R}
        applyMayPaySubmit(state, { playerId: "p2", accept: true }); // may copy

        const events = copyEvents(state);
        expect(events).toHaveLength(1);
        expect(events[0].copierId).toBe("p2");
        expect(events[0].originalSpellInstanceId).toBe(chain.id);
        expect(events[0].fromCastCopyTrigger).toBe(false);
    });
});

describe("SPELL_COPIED — a copy is not a cast (CR 707.10)", () => {
    it("a copy fires no cast listener, no SPELL_KICKED, and moves no tally", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        on("p1", CAST_WATCHER_ID, "cast-watcher"),
                        on("p1", COPY_WATCHER_ID, "copy-watcher"),
                        on("p1", saprolingInfestation().id, "infest"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const bolt = pushSpell(state, lightningBolt().id, "p2", [
            { type: "player", id: "p1" },
        ]);
        bolt.kickerPayments = { kicker: 1 };
        pushSpell(state, fork().id, "p1", [{ type: "spell", id: bolt.id }]);
        const before = {
            p1: castTallies(state, "p1"),
            p2: castTallies(state, "p2"),
        };

        resolveTopOfStack(state);

        expect(copyEvents(state)).toHaveLength(1); // the copy did happen …
        expect(triggersOn(state, "cast-watch")).toEqual([]); // … and is no cast
        expect(triggersOn(state, "saproling-infestation-kicked")).toEqual([]);
        expect({
            p1: castTallies(state, "p1"),
            p2: castTallies(state, "p2"),
        }).toEqual(before);
    });
});

describe("Witherbloom Apprentice — Magecraft is one ability on two events (CR 603.2 / 707.10)", () => {
    function apprenticeBoard(extra: {
        p1Hand?: ReturnType<typeof inHand>[];
        p2Hand?: ReturnType<typeof inHand>[];
    }) {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        on("p1", witherbloomApprentice().id, "apprentice"),
                    ],
                    hand: extra.p1Hand ?? [],
                    manaPool: RED(4),
                }),
                makePlayer("p2", {
                    hand: extra.p2Hand ?? [],
                    manaPool: RED(4),
                }),
            ],
        });
    }

    it("casting an instant triggers once: each opponent loses 1, you gain 1", () => {
        const state = apprenticeBoard({
            p1Hand: [inHand("p1", lightningBolt().id, "bolt")],
        });
        realCast(state, "p1", "bolt", "any", [{ type: "player", id: "p1" }]);
        expect(magecraftTriggers(state)).toHaveLength(1);
        expect(magecraftTriggers(state)[0].triggerEvent?.type).toBe(
            "SPELL_CAST"
        );
        resolveTopOfStack(state);
        expect(getPlayer(state, "p2").life).toBe(19);
        expect(getPlayer(state, "p1").life).toBe(21);
    });

    it("a creature spell does not trigger it (the instant-or-sorcery filter)", () => {
        const state = apprenticeBoard({});
        const bears = pushSpell(state, grizzlyBears().id, "p1");
        emitSpellCastEvent(state, bears);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p2").life).toBe(20);
    });

    it("Forking your own instant triggers for the Fork cast AND again for the copy", () => {
        const state = apprenticeBoard({
            p1Hand: [
                inHand("p1", lightningBolt().id, "bolt"),
                inHand("p1", fork().id, "fork"),
            ],
        });
        realCast(state, "p1", "bolt", "any", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state); // bolt's cast trigger
        expect(getPlayer(state, "p2").life).toBe(19);

        realCast(state, "p1", "fork", "spell", [{ type: "spell", id: "bolt" }]);
        expect(magecraftTriggers(state)[0].triggerEvent?.type).toBe(
            "SPELL_CAST"
        );
        resolveTopOfStack(state); // Fork's cast trigger
        expect(getPlayer(state, "p2").life).toBe(18);

        resolveTopOfStack(state); // Fork resolves: the copy, its retarget prompt
        const copyTriggers = magecraftTriggers(state);
        expect(copyTriggers).toHaveLength(1);
        expect(copyTriggers[0].triggerEvent?.type).toBe("SPELL_COPIED");

        // CR 707.10c — the retarget is answered with the trigger above the copy:
        // it lands on the copy and leaves the trigger alone.
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("copy-retarget");
        finalizeTargetSelection(
            state,
            { ...pt, selected: [{ type: "player", id: "p1" }] },
            "p1"
        );
        expect(state.pendingTarget).toBeUndefined();
        expect(
            state.stack.find((s) => s.id === pt.cardInstanceId)?.targets
        ).toEqual([{ type: "player", id: "p1" }]);
        expect(magecraftTriggers(state)).toHaveLength(1);

        resolveWholeStack(state);
        // 3 Magecraft drains, the original Bolt at p2, the copy redirected at p1.
        expect(getPlayer(state, "p2").life).toBe(20 - 3 - 3);
        expect(getPlayer(state, "p1").life).toBe(20 + 3 - 3);
    });

    it("an opponent Forking your spell does not trigger YOUR Magecraft: the copy is theirs", () => {
        const state = apprenticeBoard({
            p2Hand: [inHand("p2", fork().id, "fork")],
        });
        const bolt = pushSpell(state, lightningBolt().id, "p1", [
            { type: "player", id: "p2" },
        ]);
        pushSpell(state, fork().id, "p2", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(copiesOnStack(state)).toHaveLength(1);
        expect(magecraftTriggers(state)).toEqual([]);
    });

    it("a storm spell with N copies yields N+1 triggers, with no retarget to answer", () => {
        const state = apprenticeBoard({});
        state.spellsCastThisTurn = 2;
        const warrens = pushSpell(state, emptyTheWarrens().id, "p1");
        emitSpellCastEvent(state, warrens);
        processPendingActionTriggers(state);
        // The cast half: one Magecraft trigger, beside the storm trigger.
        expect(magecraftTriggers(state)).toHaveLength(1);
        resolveWholeStack(state);
        expect(getPlayer(state, "p2").life).toBe(20 - 3);
        expect(getPlayer(state, "p1").life).toBe(20 + 3);
    });

    it("a TARGETED storm spell also yields N+1, through N suspended retarget prompts", () => {
        const state = apprenticeBoard({});
        state.spellsCastThisTurn = 2;
        const shot = pushSpell(state, grapeshot().id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, shot);
        let answered = 0;
        for (let step = 0; step < 64 && state.stack.length > 0; step++) {
            const pt = state.pendingTarget;
            if (pt) {
                finalizeTargetSelection(
                    state,
                    { ...pt, selected: [{ type: "player", id: "p2" }] },
                    "p1"
                );
                answered++;
            }
            resolveTopOfStack(state);
        }
        expect(answered).toBe(2);
        // 3 drains + 3 Grapeshots, all at p2.
        expect(getPlayer(state, "p2").life).toBe(20 - 3 - 3);
        expect(getPlayer(state, "p1").life).toBe(20 + 3);
    });
});

describe("Sedgemoor Witch — the Magecraft Pest (CR 603.2 / 707.10 / 111.1)", () => {
    it("declares Menace and Ward, and a copy makes the shared Pest token", () => {
        const def = sedgemoorWitch();
        expect(def.staticAbilities).toContain("menace");
        expect(def.staticAbilities).toContain("ward—pay 3 life");

        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on("p1", def.id, "witch")],
                }),
                makePlayer("p2"),
            ],
        });
        const bolt = pushSpell(state, lightningBolt().id, "p2", [
            { type: "player", id: "p2" },
        ]);
        pushSpell(state, fork().id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        state.pendingTarget = undefined;

        const triggers = triggersOn(state, "sedgemoor-witch-magecraft");
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggerEvent?.type).toBe("SPELL_COPIED");
        resolveTopOfStack(state);

        const pest = getPlayer(state, "p1").battlefield.find((c) => c.isToken);
        expect(pest).toMatchObject({
            power: 1,
            toughness: 1,
            subtypes: ["Pest"],
        });
    });
});

describe("spellCastTrigger's alsoOnCopy guards its own contract", () => {
    it.each([
        ["resolve", { resolve: () => undefined }],
        ["condition", { effects: [], condition: () => true }],
        ["interveningIf", { effects: [], interveningIf: () => true }],
    ])("refuses %s, which reads cast-only event fields", (_name, extra) => {
        expect(() =>
            spellCastTrigger({
                id: "probe",
                oracleText: "probe",
                scope: "you",
                alsoOnCopy: true,
                ...extra,
            })
        ).toThrow(/alsoOnCopy/);
    });

    it('refuses scope "self": no "when you copy this spell" trigger exists', () => {
        expect(() =>
            spellCastTrigger({
                id: "probe",
                oracleText: "probe",
                scope: "self",
                alsoOnCopy: true,
                effects: [],
            })
        ).toThrow(/alsoOnCopy/);
    });
});
