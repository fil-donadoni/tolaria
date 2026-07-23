// City's Blessing designation (Ascend, CR 702.131 — issue #1460, ADR 0071).
// Covers the three CR clauses:
//   702.131a — the PERMANENT form: a continuous check granting the blessing to
//              a player controlling an Ascend permanent and ten+ permanents.
//   702.131b — MONOTONIC: once obtained, the blessing is NEVER lost; dropping
//              below ten permanents does not revoke it.
//   702.131c — the INSTANT/SORCERY form: checked ONCE, on resolution.
// Plus the wire-format assertion (the designation must survive
// `projectPublicState` / `projectFullState` to reach the client tile) and the
// declarative `hasCityBlessing` Effect Script predicate.
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardDefinition, CardType } from "../../cards/types";
import { buildSpellContext, resolveTopOfStack } from "../state";
import { checkStateBasedActions } from "../sba";
import {
    CITY_BLESSING_THRESHOLD,
    countControlledPermanents,
    grantCityBlessing,
    grantCityBlessingIfThreshold,
    hasCityBlessing,
} from "../cityBlessing";
import { makePlayer, makeState, pushSpell } from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import { projectFullState, projectPublicState } from "../../gameProjections";
import { runEffectScript } from "../effects/interpreter";
import { validateEffectScript } from "../effects/validate";

/** A vanilla battlefield permanent controlled by `controllerId`. */
function permanent(
    id: string,
    controllerId: string,
    staticAbilities: string[] = []
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power: 1,
        toughness: 1,
        staticAbilities,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
    };
}

/** Builds a state where `p1` controls `count` permanents, the first of which
 *  carries `ascend` when `withAscend` is set. */
function stateWithPermanents(
    count: number,
    withAscend: boolean,
    controllerId = "p1"
): GameState {
    const battlefield: CardInstanceState[] = [];
    for (let i = 0; i < count; i++) {
        battlefield.push(
            permanent(
                `perm-${i}`,
                controllerId,
                withAscend && i === 0 ? ["ascend"] : []
            )
        );
    }
    return makeState({
        players: [makePlayer(controllerId, { battlefield }), makePlayer("p2")],
    });
}

describe("City's Blessing — storage & threshold (CR 702.131, issue #1460)", () => {
    it("no one has the city's blessing at the start of the game", () => {
        const state = makeState();
        expect(state.cityBlessingIds).toBeUndefined();
        expect(hasCityBlessing(state, "p1")).toBe(false);
        expect(hasCityBlessing(state, "p2")).toBe(false);
    });

    it("counts permanents by controllerId across every battlefield", () => {
        // A permanent p1 CONTROLS but that sits on p2's battlefield array still
        // counts for p1 ("permanents you control", CR 702.131).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [permanent("a", "p1"), permanent("b", "p1")],
                }),
                makePlayer("p2", {
                    battlefield: [permanent("c", "p1"), permanent("d", "p2")],
                }),
            ],
        });
        expect(countControlledPermanents(state, "p1")).toBe(3);
        expect(countControlledPermanents(state, "p2")).toBe(1);
    });

    it("grantCityBlessing is idempotent and never duplicates a player", () => {
        const state = makeState();
        expect(grantCityBlessing(state, "p1")).toBe(true);
        expect(grantCityBlessing(state, "p1")).toBe(false);
        expect(state.cityBlessingIds).toEqual(["p1"]);
    });

    it("is NON-exclusive — both players can hold it at once", () => {
        const state = makeState();
        grantCityBlessing(state, "p1");
        grantCityBlessing(state, "p2");
        expect(hasCityBlessing(state, "p1")).toBe(true);
        expect(hasCityBlessing(state, "p2")).toBe(true);
    });

    it("the threshold check needs ten or more permanents", () => {
        expect(CITY_BLESSING_THRESHOLD).toBe(10);
        const nine = stateWithPermanents(9, false);
        expect(grantCityBlessingIfThreshold(nine, "p1")).toBe(false);
        expect(hasCityBlessing(nine, "p1")).toBe(false);

        const ten = stateWithPermanents(10, false);
        expect(grantCityBlessingIfThreshold(ten, "p1")).toBe(true);
        expect(hasCityBlessing(ten, "p1")).toBe(true);
    });
});

describe("Ascend — permanent form, continuous (CR 702.131a)", () => {
    it("grants the blessing through the SBA sweep at ten permanents", () => {
        const state = stateWithPermanents(10, true);
        expect(hasCityBlessing(state, "p1")).toBe(false);
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);
    });

    it("does NOT grant below ten permanents", () => {
        const state = stateWithPermanents(9, true);
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(false);
    });

    it("does NOT grant to a player with ten permanents but no Ascend", () => {
        const state = stateWithPermanents(12, false);
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(false);
    });

    it("grants only to the Ascend permanent's CONTROLLER, not the opponent", () => {
        const state = stateWithPermanents(10, true);
        // p2 controls nothing; the sweep must not spill the blessing over.
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);
        expect(hasCityBlessing(state, "p2")).toBe(false);
    });

    it("re-checks continuously — crossing the threshold later still grants", () => {
        const state = stateWithPermanents(9, true);
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(false);
        // Tenth permanent arrives; the next stable point grants.
        state.players[0].battlefield.push(permanent("perm-late", "p1"));
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);
    });
});

describe("City's Blessing is never lost (CR 702.131b)", () => {
    it("survives dropping below ten permanents", () => {
        const state = stateWithPermanents(10, true);
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);

        // Board wipe: everything leaves, including the Ascend permanent.
        state.players[0].battlefield = [];
        checkStateBasedActions(state);
        expect(countControlledPermanents(state, "p1")).toBe(0);
        // "You have the city's blessing for the rest of the game."
        expect(hasCityBlessing(state, "p1")).toBe(true);
    });

    it("survives losing the Ascend permanent itself while keeping ten others", () => {
        const state = stateWithPermanents(11, true);
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);
        // Remove the Ascend permanent (index 0) — the designation stays.
        state.players[0].battlefield.shift();
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);
    });
});

describe("Ascend — instant/sorcery form, once on resolution (CR 702.131c)", () => {
    const ASCEND_SPELL_ID = "test-ascend-spell-1460";
    const ascendSpell: CardDefinition = {
        id: ASCEND_SPELL_ID,
        name: "Ascend Test Sorcery",
        types: ["Sorcery"] as CardType[],
        subtypes: [],
        manaCost: {},
        staticAbilities: ["ascend"],
        effects: [],
    } as unknown as CardDefinition;
    registerTokenDefinition(ascendSpell);

    it("grants the blessing when the spell resolves with ten permanents", () => {
        const state = stateWithPermanents(10, false);
        pushSpell(state, ASCEND_SPELL_ID, "p1");
        expect(hasCityBlessing(state, "p1")).toBe(false);
        resolveTopOfStack(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);
    });

    it("does NOT grant when the spell resolves below ten permanents", () => {
        const state = stateWithPermanents(9, false);
        pushSpell(state, ASCEND_SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(hasCityBlessing(state, "p1")).toBe(false);
    });

    it("is checked ONCE — reaching ten permanents later does not retro-grant", () => {
        const state = stateWithPermanents(9, false);
        pushSpell(state, ASCEND_SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(hasCityBlessing(state, "p1")).toBe(false);
        // The board later crosses the threshold, but the spell has already
        // resolved and no Ascend PERMANENT is in play — no blessing.
        state.players[0].battlefield.push(permanent("perm-late", "p1"));
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(false);
    });

    // CR 702.131c — Ascend is the FIRST spell ability of an instant/sorcery
    // that has it, so the blessing is granted BEFORE the rest of the spell's
    // text. Every real Ascend instant/sorcery reads the blessing in its own
    // later clauses (Golden Demise: "if you have the city's blessing, instead
    // only creatures your opponents control get -2/-2"; Secrets of the Golden
    // City: "draw three instead of two"). A probe with `effects: []` cannot
    // observe the ordering — these two DO: they gate on the blessing from
    // INSIDE their own resolution, and fail if the grant runs afterwards.
    const ORDERING_SPELL_ID = "test-ascend-ordering-1460";
    registerTokenDefinition({
        id: ORDERING_SPELL_ID,
        name: "Ascend Ordering Test Sorcery",
        types: ["Sorcery"] as CardType[],
        subtypes: [],
        manaCost: {},
        staticAbilities: ["ascend"],
        effects: [
            {
                op: "if",
                predicate: { hasCityBlessing: "controller" },
                then: [{ op: "gainLife", player: "controller", amount: 5 }],
                else: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ],
    } as unknown as CardDefinition);

    it("grants the blessing BEFORE its own Effect Script runs", () => {
        const state = stateWithPermanents(10, false);
        const before = state.players[0].life;
        pushSpell(state, ORDERING_SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);
        // The `then` branch — the spell's own text saw the blessing.
        expect(state.players[0].life).toBe(before + 5);
    });

    it("takes the else branch below the threshold (no blessing to see)", () => {
        const state = stateWithPermanents(9, false);
        const before = state.players[0].life;
        pushSpell(state, ORDERING_SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(hasCityBlessing(state, "p1")).toBe(false);
        expect(state.players[0].life).toBe(before + 1);
    });

    // The `resolveSteps` loop is a SEPARATE dispatch path in
    // `resolveTopOfStackInner` (it pops + finalizes on its own), so it needs
    // its own ordering assertion.
    const ORDERING_STEPS_ID = "test-ascend-ordering-steps-1460";
    registerTokenDefinition({
        id: ORDERING_STEPS_ID,
        name: "Ascend Ordering Steps Sorcery",
        types: ["Sorcery"] as CardType[],
        subtypes: [],
        manaCost: {},
        staticAbilities: ["ascend"],
        resolveSteps: [
            (ctx: {
                controller: string;
                hasCityBlessing: (playerId: string) => boolean;
                gainLife: (playerId: string, amount: number) => void;
            }) => {
                ctx.gainLife(
                    ctx.controller,
                    ctx.hasCityBlessing(ctx.controller) ? 5 : 1
                );
            },
        ],
    } as unknown as CardDefinition);

    it("grants the blessing BEFORE its `resolveSteps` run", () => {
        const state = stateWithPermanents(10, false);
        const before = state.players[0].life;
        pushSpell(state, ORDERING_STEPS_ID, "p1");
        resolveTopOfStack(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);
        expect(state.players[0].life).toBe(before + 5);
    });
});

describe("hasCityBlessing Effect Script predicate (issue #1460)", () => {
    function runIf(state: GameState, controllerId: string) {
        const item = pushSpell(state, "test-ascend-spell-1460", controllerId);
        const ctx = buildSpellContext(state, item);
        runEffectScript(ctx, [
            {
                op: "if",
                predicate: { hasCityBlessing: "controller" },
                then: [{ op: "gainLife", player: "controller", amount: 5 }],
                else: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ]);
        state.stack.pop();
    }

    it("takes the `then` branch when the controller has the blessing", () => {
        const state = makeState();
        grantCityBlessing(state, "p1");
        const before = state.players[0].life;
        runIf(state, "p1");
        expect(state.players[0].life).toBe(before + 5);
    });

    it("takes the `else` branch when the controller does not", () => {
        const state = makeState();
        const before = state.players[0].life;
        runIf(state, "p1");
        expect(state.players[0].life).toBe(before + 1);
    });

    it("passes the static validator as a frozen predicate form", () => {
        const errors = validateEffectScript({
            id: "test-ascend-validate-1460",
            name: "Ascend Validate Probe",
            effects: [
                {
                    op: "if",
                    predicate: { hasCityBlessing: "controller" },
                    then: [{ op: "gainLife", player: "controller", amount: 1 }],
                },
            ],
        } as unknown as Parameters<typeof validateEffectScript>[0]);
        expect(errors).toEqual([]);
    });

    it("rejects a malformed hasCityBlessing predicate", () => {
        const errors = validateEffectScript({
            id: "test-ascend-validate-bad-1460",
            name: "Ascend Validate Bad Probe",
            effects: [
                {
                    op: "if",
                    // Not a player ref — the frozen grammar takes only an
                    // EffectPlayerRef ("controller" / "opponent" / a ref).
                    predicate: { hasCityBlessing: "everyone" },
                    then: [{ op: "gainLife", player: "controller", amount: 1 }],
                },
            ],
        } as unknown as Parameters<typeof validateEffectScript>[0]);
        expect(errors.length).toBeGreaterThan(0);
    });

    it("exposes the designation through SpellContext.hasCityBlessing", () => {
        const state = makeState();
        grantCityBlessing(state, "p2");
        const item = pushSpell(state, "test-ascend-spell-1460", "p1");
        const ctx = buildSpellContext(state, item);
        expect(ctx.hasCityBlessing("p1")).toBe(false);
        expect(ctx.hasCityBlessing("p2")).toBe(true);
    });
});

describe("City's Blessing crosses the wire (client surface)", () => {
    it("survives projectPublicState and projectFullState", () => {
        const state = stateWithPermanents(10, true);
        checkStateBasedActions(state);
        expect(hasCityBlessing(state, "p1")).toBe(true);

        // The board tile (`PlayerCityBlessingTile`) reads `cityBlessingIds` off
        // the PROJECTED state — a projection that dropped the field would leave
        // the designation invisible client-side even though the GRE is correct.
        const publicState = projectPublicState(state, 1, "p2");
        expect(publicState.cityBlessingIds).toEqual(["p1"]);
        // Re-run the SAME designation read the client tile performs, against
        // the PROJECTED state (the projection slims players/stack; a dropped
        // top-level field would show up right here).
        expect(publicState.cityBlessingIds?.includes("p1")).toBe(true);
        expect(publicState.cityBlessingIds?.includes("p2")).toBe(false);

        const fullState = projectFullState(state, 1);
        expect(fullState.cityBlessingIds).toEqual(["p1"]);
    });

    it("projects both holders when both players have the blessing", () => {
        const state = makeState();
        grantCityBlessing(state, "p1");
        grantCityBlessing(state, "p2");
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.cityBlessingIds).toEqual(["p1", "p2"]);
    });
});
