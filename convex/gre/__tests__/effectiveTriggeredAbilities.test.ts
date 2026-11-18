// CR 603.2 — the trigger scan reads every permanent's triggered abilities at
// every event, so `effectiveTriggeredAbilities` hands back the definition's own
// `triggeredAbilities` when nothing is unioned onto them, and builds a fresh
// list only when a grant (CR 613.1f) or a live keyword adds one. The shared
// list is read-only: a union must never write into it.

import { describe, it, expect } from "vitest";
import { effectiveTriggeredAbilities } from "../copy";
import { getDefinition } from "../../cards";
import { goblinShrine } from "../../cards/sets/drk/red.cards";
import { FLANKING_KEYWORD } from "../../cards/abilities/flanking";
import { makeInstance } from "../../cards/__tests__/setup.helper";

const SHRINE = goblinShrine().id;

function printedTriggerIds(): string[] {
    return (getDefinition(SHRINE).triggeredAbilities ?? []).map((a) => a.id);
}

describe("effectiveTriggeredAbilities — the printed list, shared (CR 603.2)", () => {
    it("a permanent with only printed triggers gets its definition's own list back", () => {
        const shrine = makeInstance(SHRINE, { staticAbilities: [] });
        expect(effectiveTriggeredAbilities(shrine)).toBe(
            getDefinition(SHRINE).triggeredAbilities
        );
    });

    it("a live keyword trigger is unioned after the printed ones, leaving the definition's list as it was (CR 613.1f)", () => {
        const before = printedTriggerIds();
        expect(before.length).toBeGreaterThan(0);
        const shrine = makeInstance(SHRINE, {
            staticAbilities: [FLANKING_KEYWORD],
        });
        const abilities = effectiveTriggeredAbilities(shrine);
        expect(abilities).not.toBe(getDefinition(SHRINE).triggeredAbilities);
        expect(abilities.map((a) => a.id)).toEqual([...before, "flanking"]);
        expect(printedTriggerIds()).toEqual(before);
    });
});
