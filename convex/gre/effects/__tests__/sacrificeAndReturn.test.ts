// `sacrificeAndReturn` — the Op's permanent test (CR 701.21a, CR 608.2b,
// CR 400.7, issue #7206; Goblin Welder). Driven through the real entry point:
// the spell is pushed and resolved by `resolveTopOfStack`. The wire-format
// assertion reads the swap back through `projectPublicState`; the group-walk
// cases pin the `zoneOwnerOfPriorPermanentController` binding the Op pairs with.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import type { TargetSelection } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import type { GameState } from "../../state";
import { validateEffectScript } from "../validate";
import { projectPublicState } from "../../../gameProjections";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../rules";
import { zoneOwnedByPriorPlayerTarget } from "../../targetGroupWalk";

// Two real artifact cards (Drafna's Restoration fixtures).
const ARTIFACT_A = "64975352-8d35-4d02-94ac-fa0c6ee12409";
const ARTIFACT_B = "07793a71-1106-4303-b620-e403bd378020";

const SCRIPT: EffectOp[] = [
    {
        op: "sacrificeAndReturn",
        sacrificed: { target: 0 },
        returned: { target: 1 },
    },
];

const GRAVEYARD_GROUP = {
    type: "Artifact",
    count: 1,
    zone: "graveyard",
    controller: "any",
    zoneOwnerOfPriorPermanentController: true,
} as const;

function spellDef(effects: EffectOp[] = SCRIPT): CardDefinition {
    return {
        id: "test-sacrifice-and-return",
        name: "Swap Probe",
        rarity: "common",
        oracleText: "",
        manaCost: { R: 1 },
        types: ["Instant"],
        targetRequirement: { type: "Artifact", count: 1, controller: "any" },
        additionalTargetRequirements: [GRAVEYARD_GROUP],
        effects,
    } as CardDefinition;
}

/** p2 controls `onBoard` (also theirs); p2's graveyard holds `inYard`. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(ARTIFACT_A, {
                        id: "onBoard",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
                graveyard: [
                    makeInstance(ARTIFACT_B, {
                        id: "inYard",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "graveyard",
                    }),
                ],
            }),
        ],
    });
}

const TARGETS: TargetSelection[] = [
    { type: "permanent", id: "onBoard" },
    { type: "graveyard-card", id: "inYard", playerId: "p2" },
];

function resolveWith(state: GameState, targets = TARGETS): GameState {
    const def = spellDef();
    withTemporaryDefinition(def, () => {
        pushSpell(state, def.id, "p1", targets);
        resolveTopOfStack(state);
    });
    return state;
}

const p = (state: GameState, id: string) =>
    state.players.find((x) => x.id === id)!;
const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe("sacrificeAndReturn (CR 701.21a, CR 608.2b)", () => {
    it("validates", () => {
        expect(validateEffectScript(spellDef())).toEqual([]);
    });

    it("rejects the same slot for both halves", () => {
        const errors = validateEffectScript(
            spellDef([
                {
                    op: "sacrificeAndReturn",
                    sacrificed: { target: 0 },
                    returned: { target: 0 },
                },
            ])
        );
        expect(errors.join("\n")).toMatch(/different target slots/);
    });

    it("both targets legal: the artifact goes to the graveyard and the card returns", () => {
        const state = resolveWith(board());
        expect(ids(p(state, "p2").battlefield)).toEqual(["inYard"]);
        expect(ids(p(state, "p2").graveyard)).toEqual(["onBoard"]);
        // Wire format: the swap survives the public projection.
        const view = projectPublicState(state, 1, "p1");
        const p2 = view.players.find((x) => x.id === "p2")!;
        expect(p2.battlefield.map((c) => c.id)).toEqual(["inYard"]);
        expect(p2.graveyard.map((c) => c.id)).toEqual(["onBoard"]);
    });

    it("the artifact left the battlefield: the graveyard card stays put (CR 608.2b all-or-nothing)", () => {
        const state = board();
        // Gone before resolution — the legality gate blanks slot 0.
        p(state, "p2").battlefield = [];
        resolveWith(state);
        expect(ids(p(state, "p2").battlefield)).toEqual([]);
        expect(ids(p(state, "p2").graveyard)).toEqual(["inYard"]);
    });

    it("the card left the graveyard: the artifact is NOT sacrificed", () => {
        const state = board();
        p(state, "p2").graveyard = [];
        resolveWith(state);
        expect(ids(p(state, "p2").battlefield)).toEqual(["onBoard"]);
    });
});

describe("zoneOwnerOfPriorPermanentController (CR 601.2c, CR 404.1)", () => {
    const prior: TargetSelection[] = [{ type: "permanent", id: "onBoard" }];

    it("lowers the earlier permanent's CONTROLLER into zoneOwnerId", () => {
        const state = board();
        // Control differs from ownership: p1 owns it, p2 controls it.
        const perm = p(state, "p2").battlefield[0];
        perm.ownerId = "p1";
        const group = zoneOwnedByPriorPlayerTarget(
            GRAVEYARD_GROUP,
            prior,
            state
        );
        expect(group.zoneOwnerId).toBe("p2");
    });

    it("offers only the controller's graveyard", () => {
        const state = board();
        p(state, "p1").graveyard = [
            makeInstance(ARTIFACT_B, {
                id: "theirs",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
        ];
        const group = zoneOwnedByPriorPlayerTarget(
            GRAVEYARD_GROUP,
            prior,
            state
        );
        const offered = getLegalTargets(
            state,
            group,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(offered.map((t) => t.id)).toEqual(["inYard"]);
    });

    it("fails closed with no permanent among the earlier picks", () => {
        const state = board();
        const group = zoneOwnedByPriorPlayerTarget(GRAVEYARD_GROUP, [], state);
        expect(group.zoneOwnerId).toBe("");
        expect(
            getLegalTargets(state, group, NO_TARGETING_SOURCE, "p1")
        ).toEqual([]);
    });
});
