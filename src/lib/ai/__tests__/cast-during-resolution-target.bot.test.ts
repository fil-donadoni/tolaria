// The Bot must ANSWER the target pick of a spell it casts during a resolution
// when that target is NOT a permanent (issue #9148; CR 601.2c, CR 608.2g).
//
// `castDuringResolution`'s target step raises a `choose-damage-target` whose
// `candidateIds` hold every non-player legal target of the cast spell — a
// graveyard card (Raise Dead), a spell on the stack (Counterspell). The Bot's
// pool read battlefields only, so it found nothing, submitted `[]`, and the
// `choice` ladder escalated to a stall (Crabomination, the reported shape).
//
// Two layers, each over the real reducers:
//   - the SEARCH picks the valued target (the blade `must` entries, run here
//     through `runBladeScenario`);
//   - the LIVE Bot view (`projectPublicState` -> `buildBotView`) offers the
//     non-battlefield candidates and routes the pick to the search, and its
//     fallback answers with a legal id — never `[]`, never `none`.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { buildBladeState } from "@convex/gre/ai/blade/build";
import { findBladeScenario } from "@convex/gre/ai/blade/registry";
import { runBladeScenario } from "@convex/gre/ai/blade/runner";
import type { BladeScenario } from "@convex/gre/ai/blade/types";
import { chooseOwedChoiceAction } from "../brain";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";

const GRAVEYARD =
    "cast during resolution: Raise Dead off Chandra returns the best creature card";
const STACK =
    "cast during resolution: Counterspell off Chandra counters the bigger spell";

function entry(label: string): BladeScenario {
    const scenario = findBladeScenario(label);
    if (!scenario) throw new Error(`no blade entry "${label}"`);
    return scenario;
}

describe.each([
    ["graveyard card", GRAVEYARD],
    ["spell on the stack", STACK],
])("free cast targeting a %s (issue #9148)", (_zone, label) => {
    it("the position owes the free cast's target pick", () => {
        const head = buildBladeState(entry(label)).pendingChoices?.[0];
        expect(head?.kind).toBe("choose-damage-target");
        expect(head?.choiceId.startsWith("cdr:target")).toBe(true);
    });

    it("the search picks the valued target on every seed", () => {
        const result = runBladeScenario(entry(label));
        expect(result.ok, result.failureMessage).toBe(true);
    });

    it("the live Bot view searches it and its fallback submits a legal id", () => {
        const state = buildBladeState(entry(label));
        const head = state.pendingChoices![0];
        const botId = head.playerId;
        const view = buildBotView(projectPublicState(state, 1, botId), botId);
        expect(view.owedInput?.kind).toBe("choice");
        const ladder = escalationLadder("choice", view);
        const action = ladder[0].action;
        expect(action.kind).toBe("resolution-choice");
        if (action.kind !== "resolution-choice") throw new Error("kind");
        expect(action.cardInstanceIds).toHaveLength(1);
        expect(head.candidateIds).toContain(action.cardInstanceIds[0]);
    });
});

describe("choose-damage-target fallback with no candidate (issue #9148, #2497)", () => {
    it("returns none rather than an empty answer the server rejects", () => {
        const action = chooseOwedChoiceAction({
            kind: "choose-damage-target",
            searchable: true,
            min: 1,
            max: 1,
            candidates: [],
        });
        expect(action).toEqual({ kind: "none" });
    });
});
