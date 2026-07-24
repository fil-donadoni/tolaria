// MH3 — green behavior tests (ADR 0043 colour split).
//
// Malevolent Rumble — {1}{G} Sorcery (issue #1531/#1525). Its `digToHand`
// leg has its OWN permanent interpreter coverage (per-Op regime, ADR 0045,
// `convex/gre/effects/__tests__/interpreter.test.ts`), but the catalogue's
// auto-generated canned-scenario smoke sweep (`effectScriptSmoke.test.ts`)
// explicitly SKIPS every `digToHand` card — it suspends on a live
// look-distribute pick the generator can't drive — so (per Reviving Vapors'
// own precedent, `convex/cards/sets/inv/__tests__/multicolor.test.ts`) this
// is the card-level proof the script is wired correctly end to end: the
// permanent filter picks out only permanent-typed cards from the revealed
// window, the rest (incl. filtered-out nonpermanents) go to the graveyard,
// and the Eldrazi Spawn token is created alongside.

import { describe, it, expect } from "vitest";
import { malevolentRumble } from "../green";
import { island } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, registerTokenDefinition } from "../../..";

// Two throwaway nonpermanent library-filler defs (mirrors Reviving Vapors'
// `REVIVING_VAPORS_MV4_ID` pattern) — proves the filter actually EXCLUDES
// nonpermanent cards from hand-eligibility rather than accepting anything.
const TEST_INSTANT_ID = "test-malevolent-rumble-instant";
registerTokenDefinition({
    id: TEST_INSTANT_ID,
    name: TEST_INSTANT_ID,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Instant"],
});
const TEST_SORCERY_ID = "test-malevolent-rumble-sorcery";
registerTokenDefinition({
    id: TEST_SORCERY_ID,
    name: TEST_SORCERY_ID,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Sorcery"],
});

// Answers the head `pendingChoices` "look-distribute" entry (CR 608.2)
// keeping the given card instance ids and resumes resolution — mirrors
// Reviving Vapors' own `submitChoice` helper.
function submitChoice(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

const libOf = (ids: [string, string][]) =>
    ids.map(([cid, defId]) =>
        makeInstance(defId, {
            id: cid,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Malevolent Rumble (CR 401.4 reveal/dig, CR 707.2 token, issue #1531)", () => {
    it("reveals the top four, keeps the chosen permanent to hand, bins the rest, and creates the Eldrazi Spawn", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf([
                        ["keepLand", island.id], // permanent — chosen
                        ["burnSpell", TEST_INSTANT_ID], // nonpermanent
                        ["someSorcery", TEST_SORCERY_ID], // nonpermanent
                        ["otherLand", island.id], // permanent — NOT chosen
                        ["untouched", island.id], // never enters the look window
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, malevolentRumble.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the dig pick

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        // The FULL revealed window (candidateIds) — all 4 looked-at cards —
        // but `eligibleIds` narrows hand-eligibility to the two permanents
        // (issue #1266's filtered-eligibility shape).
        expect(head.candidateIds).toEqual([
            "keepLand",
            "burnSpell",
            "someSorcery",
            "otherLand",
        ]);
        expect(head.eligibleIds).toEqual(["keepLand", "otherLand"]);
        expect(head.destination).toBe("graveyard");

        submitChoice(state, ["keepLand"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);

        // (a) the chosen permanent went to hand.
        expect(state.players[0].hand.map((c) => c.id)).toContain("keepLand");
        // (b) the rest of the revealed window — incl. the filtered-out
        // nonpermanents AND the unchosen permanent — went to the graveyard.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["burnSpell", "someSorcery", "otherLand"])
        );
        // The 5th library card never entered the look window — untouched.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "untouched",
        ]);

        // (c) one 0/1 colorless Eldrazi Spawn token was created on the
        // controller's battlefield.
        const token = state.players[0].battlefield.find(
            (c) => c.isToken === true
        );
        expect(token).toBeDefined();
        expect(token!.types).toEqual(["Creature"]);
        expect(token!.subtypes).toEqual(["Eldrazi", "Spawn"]);
        expect(token!.power).toBe(0);
        expect(token!.toughness).toBe(1);
        expect(token!.controllerId).toBe("p1");
        const tokenDef = getDefinition(token!.card.id as string);
        expect(tokenDef.manaCost).toEqual({}); // no colored pips — colorless
        expect(tokenDef.activatedAbilities?.[0].oracleText).toBe(
            "Sacrifice this token: Add {C}."
        );
    });

    it("wire format: hand/graveyard/token outcome survives projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf([
                        ["keepLand", island.id],
                        ["burnSpell", TEST_INSTANT_ID],
                        ["someSorcery", TEST_SORCERY_ID],
                        ["otherLand", island.id],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, malevolentRumble.id, "p1");
        resolveTopOfStack(state); // suspends
        submitChoice(state, ["keepLand"]);

        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].hand.some((c) => c?.id === "keepLand")
        ).toBe(true);
        expect(projected.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["burnSpell", "someSorcery", "otherLand"])
        );
        const projectedToken = projected.players[0].battlefield.find(
            (c) => c.isToken === true
        );
        expect(projectedToken).toBeDefined();
        expect(projectedToken!.subtypes).toEqual(["Eldrazi", "Spawn"]);
        expect(projectedToken!.power).toBe(0);
        expect(projectedToken!.toughness).toBe(1);
    });
});
