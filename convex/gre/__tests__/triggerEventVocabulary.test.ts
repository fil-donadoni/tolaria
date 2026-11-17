// The event vocabulary a declared trigger carries (issue #3516, PRD #3397).
//
// The walk is exercised end-to-end through real positions in
// `gre/ai/__tests__/verdictStackLowering.bot.test.ts`; what lives here is the
// shape a live game cannot produce but an authored spec or a future event
// field can — the fail-closed edges.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
    abilityReadsTriggerEvent,
    effectScriptReadsTriggerEvent,
    lowerTriggerEvent,
    rebuildTriggerEvent,
    triggerEventFingerprint,
} from "../triggerEventVocabulary";
import type { EffectOp, GameEvent } from "../../cards/types";

const PORTS = {
    object: (id: string) =>
        id === "1"
            ? ({
                  zone: "battlefield",
                  name: "Grizzly Bears",
                  seat: "me",
              } as const)
            : undefined,
    player: (id: string) => (id === "p1" ? ("me" as const) : undefined),
    target: () => undefined,
};

describe("the trigger event vocabulary is exhaustive over GameEvent (issue #3516)", () => {
    it("refuses a `residue` field by name rather than dropping it", () => {
        const outcome = lowerTriggerEvent(
            {
                type: "CARDS_EXILED",
                cards: [
                    { cardInstanceId: "1", fromZone: "library", ownerId: "p1" },
                ],
            } as unknown as GameEvent,
            PORTS
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.fields).toEqual(["cards"]);
    });

    it("refuses an `objectList` field that is present but not a list", () => {
        // An empty list would travel as a legitimate "no objects", which a
        // "damaged by" clause reads as a different board (CR 603.2).
        const outcome = lowerTriggerEvent(
            {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: "1",
            } as unknown as GameEvent,
            PORTS
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.fields).toEqual(["attackerIds"]);
    });

    it("refuses an object the ports cannot name, by field", () => {
        const outcome = lowerTriggerEvent(
            {
                type: "PERMANENT_ENTERED",
                instanceId: "99",
                controllerId: "p1",
                types: ["Creature"],
            } as unknown as GameEvent,
            PORTS
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.fields).toEqual(["instanceId"]);
    });

    it("round-trips an event whose every field the ports CAN name", () => {
        const outcome = lowerTriggerEvent(
            {
                type: "PERMANENT_ENTERED",
                instanceId: "1",
                controllerId: "p1",
                types: ["Creature"],
                wasCast: true,
            } as unknown as GameEvent,
            PORTS
        );
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const rebuilt = rebuildTriggerEvent(outcome.event, {
            object: () => "7",
            player: () => "q1",
            target: () => ({ type: "player", id: "q1" }),
        });
        expect(rebuilt).toEqual({
            type: "PERMANENT_ENTERED",
            instanceId: "7",
            controllerId: "q1",
            types: ["Creature"],
            wasCast: true,
        });
    });
});

/** A token that died in combat next to a partner that died with it: the dead
 *  creature is in no zone (CR 111.7) and the partner is named by its retired
 *  combat-record id (CR 506.4). Neither is an id `PORTS` can name. */
const TOKEN_DEATH = {
    type: "CREATURE_DIED",
    creatureInstanceId: "token-1",
    creatureControllerId: "p1",
    creatureOwnerId: "p1",
    creatureTypes: ["Creature"],
    damagedBySources: ["1"],
    creaturePower: 2,
    creatureToughness: 1,
    combatPartnerIds: ["164~left0"],
} as unknown as GameEvent;

describe("an event its ability cannot read is lowered without what the spec cannot name (issue #9868)", () => {
    it("CR 603.2 — refuses both fields by default, the fail-closed reading", () => {
        const outcome = lowerTriggerEvent(TOKEN_DEATH, PORTS);
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.fields).toEqual([
            "combatPartnerIds",
            "creatureInstanceId",
        ]);
    });

    it("CR 603.2 / CR 111.7 — omits them for an ability that reads nothing, keeps the rest, and rebuilds", () => {
        const outcome = lowerTriggerEvent(TOKEN_DEATH, PORTS, false);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.omitted).toEqual([
            "combatPartnerIds",
            "creatureInstanceId",
        ]);
        // `rebuildTriggerEvent` takes the event with the unread fields absent.
        const rebuilt = rebuildTriggerEvent(outcome.event, {
            object: () => "7",
            player: () => "q1",
            target: () => ({ type: "player", id: "q1" }),
        });
        expect(rebuilt).toEqual({
            type: "CREATURE_DIED",
            creatureControllerId: "q1",
            creatureOwnerId: "q1",
            creatureTypes: ["Creature"],
            damagedBySources: ["7"],
            creaturePower: 2,
            creatureToughness: 1,
        });
    });

    it("CR 603.2 — an event TYPE the vocabulary does not know blocks either way", () => {
        const outcome = lowerTriggerEvent(
            { type: "CAST" } as unknown as GameEvent,
            PORTS,
            false
        );
        expect(outcome).toEqual({ ok: false, fields: ["type"] });
    });

    it("fingerprints an unread event by type alone, so the omission cannot fail the rebuild check", () => {
        const ports = {
            object: (id: string) => `object:${id}`,
            player: (id: string) => `player:${id}`,
            target: () => "target",
        };
        expect(triggerEventFingerprint(TOKEN_DEATH, ports, false)).toBe(
            "CREATURE_DIED(unread)"
        );
        // …and a READ event still renders every field (the default).
        expect(triggerEventFingerprint(TOKEN_DEATH, ports)).toContain(
            "creatureInstanceId=object:token-1"
        );
    });
});

describe("which abilities can read their firing event (issue #9868)", () => {
    const op = (value: unknown) => value as EffectOp;
    const MAY_PAY_THEN_GAIN: EffectOp[] = [
        op({ op: "mayPay", player: "controller", bind: "$paid" }),
        op({
            op: "if",
            predicate: { binding: "$paid" },
            then: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ];

    it("a script with no `$event` read is not a reader — `$source` and bindings are not the event", () => {
        expect(effectScriptReadsTriggerEvent(MAY_PAY_THEN_GAIN)).toBe(false);
        expect(
            effectScriptReadsTriggerEvent([
                op({
                    op: "exileAndReturnTransformed",
                    target: { ref: "$source" },
                }),
            ])
        ).toBe(false);
        expect(abilityReadsTriggerEvent({ effects: MAY_PAY_THEN_GAIN })).toBe(
            false
        );
    });

    it("CR 603.2 — finds a `$event.<field>` ref wherever it is nested", () => {
        expect(
            effectScriptReadsTriggerEvent([
                op({
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "delayedTrigger",
                            capture: { $dead: { ref: "$event.card" } },
                        },
                    ],
                }),
            ])
        ).toBe(true);
    });

    it("CR 508.3b / CR 607.2a — the two selector sets the interpreter fills from the event are reads", () => {
        expect(
            effectScriptReadsTriggerEvent([
                op({ op: "forEach", select: { set: "eventAttackers" } }),
            ])
        ).toBe(true);
        expect(
            effectScriptReadsTriggerEvent([
                op({ op: "forEach", select: { set: "exiledWithSource" } }),
            ])
        ).toBe(true);
        expect(
            effectScriptReadsTriggerEvent([
                op({ op: "moveZone", target: { exiledWithSource: true } }),
            ])
        ).toBe(true);
    });

    it("CR 603.4 — an intervening-if, an imperative body, steps and modes are readers whatever the script says", () => {
        const effects = MAY_PAY_THEN_GAIN;
        expect(
            abilityReadsTriggerEvent({ effects, interveningIf: () => true })
        ).toBe(true);
        expect(abilityReadsTriggerEvent({ resolve: () => {} })).toBe(true);
        expect(abilityReadsTriggerEvent({ resolveSteps: [() => {}] })).toBe(
            true
        );
        expect(
            abilityReadsTriggerEvent({
                modes: [{ id: "m", label: "m", effects }],
            } as Parameters<typeof abilityReadsTriggerEvent>[0])
        ).toBe(true);
        // The Bot's reading of the ability is held to the same question.
        expect(
            abilityReadsTriggerEvent({
                effects,
                aiEffects: [op({ op: "destroy", target: { ref: "$event.x" } })],
            })
        ).toBe(true);
    });

    /** `effectScriptReadsTriggerEvent` knows the interpreter's event reads by
     *  NAME: the `$event.` ref and two selector sets. A fourth read added to
     *  the interpreter — or to any other engine module that resolves a script
     *  — would make an ability this module calls "not a reader" resolve off a
     *  field the lowering dropped. This census is what makes that a red test
     *  instead: a new `ctx.triggerEvent` read must be taught to
     *  `EVENT_READING_SCRIPT_WORDS` (or reached through a `$event.` ref)
     *  before the count below moves. */
    it("every `ctx.triggerEvent` read in the engine is one this module accounts for", () => {
        const root = join(__dirname, "..");
        const sources: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const path = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "__tests__") walk(path);
                } else if (
                    entry.name.endsWith(".ts") &&
                    !entry.name.includes(".test.")
                ) {
                    sources.push(path);
                }
            }
        };
        walk(root);
        const reads: Record<string, number> = {};
        for (const path of sources) {
            const count = (
                readFileSync(path, "utf8").match(/\bctx\.triggerEvent\b/g) ?? []
            ).length;
            if (count > 0) reads[relative(root, path)] = count;
        }
        // `resolveEventRef` (the `$event.` ref) + `selectForEachMembers`'
        // `eventAttackers` and `exiledWithSource`.
        expect(reads).toEqual({ "effects/interpreter.ts": 3 });
    });
});
