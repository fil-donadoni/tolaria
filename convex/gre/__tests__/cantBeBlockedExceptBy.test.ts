// CR 509.1b (issue #8168) — "can't be blocked this turn except by <filter>": the
// `exceptBy` parameter of the `restrictCombat` Op, and the shared Gingerbrute
// token that prints it (CR 202.1b for its specified mana cost).
import { beforeAll, describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import {
    preloadDefinitions,
    tokenDefinitionId,
    tryGetDefinition,
} from "../../cards/registry";
import { FOOD_TOKEN, GINGERBRUTE_TOKEN } from "../../cards/sharedTokens";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { validateBlockerEligibility } from "../combat";
import {
    validateEffectScript,
    type EffectScriptHost,
} from "../effects/validate";
import { finalizeCleanup } from "../phases";
import { compactState, expandState } from "../serialize";
import { resolveTopOfStack } from "../state";
import type { GameState } from "../state";

const creature = (slug: string, keywords: string[] = []): CardDefinition => ({
    id: `test-except-by-${slug}`,
    name: `Test Except By ${slug}`,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: keywords,
});
const ATTACKER = creature("attacker");
const HASTY = creature("hasty", ["haste"]);
const PLAIN = creature("plain");
const FLYER = creature("flyer", ["flying"]);

const HASTE_ONLY: EffectOp = {
    op: "restrictCombat",
    restriction: "cant-be-blocked",
    target: { target: 0 },
    exceptBy: { hasAbility: "haste" },
};
const FLYING_ONLY: EffectOp = {
    ...HASTE_ONLY,
    exceptBy: { hasAbility: "flying" },
} as EffectOp;

const host = (effects: EffectOp[]) =>
    ({ id: "t", name: "t", effects }) as unknown as EffectScriptHost;

function script(id: string, effects: EffectOp[]): string {
    const def: CardDefinition = {
        id,
        name: id,
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Instant"],
        effects,
    };
    preloadDefinitions([def]);
    return id;
}

beforeAll(() => preloadDefinitions([ATTACKER, HASTY, PLAIN, FLYER]));

function board(): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(ATTACKER.id, {
                        id: "a",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HASTY.id, {
                        id: "hasty",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(PLAIN.id, {
                        id: "plain",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(FLYER.id, {
                        id: "flyer",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

function eligible(state: GameState, blockerId: string): boolean {
    const attacker = state.players[0].battlefield.find((c) => c.id === "a")!;
    const defenders = state.players[1].battlefield;
    const blocker = defenders.find((c) => c.id === blockerId)!;
    return validateBlockerEligibility(attacker, blocker, defenders, state)
        .eligible;
}

function resolve(state: GameState, id: string, effects: EffectOp[]): void {
    pushSpell(state, script(id, effects), "p1", [
        { type: "permanent", id: "a" },
    ]);
    resolveTopOfStack(state);
}

describe("restrictCombat exceptBy (CR 509.1b)", () => {
    it("admits only a blocker matching the filter", () => {
        const state = board();
        expect(eligible(state, "plain")).toBe(true);
        resolve(state, "test-except-by-haste", [HASTE_ONLY]);
        expect(eligible(state, "hasty")).toBe(true);
        expect(eligible(state, "plain")).toBe(false);
    });

    it("reads the blocker's live abilities at the declaration", () => {
        const state = board();
        resolve(state, "test-except-by-live", [HASTE_ONLY]);
        const plain = state.players[1].battlefield.find(
            (c) => c.id === "plain"
        )!;
        plain.staticAbilities = [...plain.staticAbilities, "haste"];
        expect(eligible(state, "plain")).toBe(true);
    });

    it("different grants are cumulative: every filter must pass", () => {
        const state = board();
        resolve(state, "test-except-by-both", [HASTE_ONLY, FLYING_ONLY]);
        expect(eligible(state, "hasty")).toBe(false);
        expect(eligible(state, "flyer")).toBe(false);
    });

    it("a repeated identical grant is recorded once", () => {
        const state = board();
        resolve(state, "test-except-by-repeat", [HASTE_ONLY, HASTE_ONLY]);
        const a = state.players[0].battlefield.find((c) => c.id === "a")!;
        expect(a.cantBeBlockedExceptByThisTurn).toEqual([
            { requireAbility: "haste" },
        ]);
    });

    it("ends at cleanup (CR 514.2)", () => {
        const state = board();
        resolve(state, "test-except-by-cleanup", [HASTE_ONLY]);
        finalizeCleanup(state);
        expect(eligible(state, "plain")).toBe(true);
    });

    it("survives the persisted round trip", () => {
        const state = board();
        resolve(state, "test-except-by-roundtrip", [HASTE_ONLY]);
        expect(eligible(expandState(compactState(state)), "plain")).toBe(false);
    });

    it("survives projection (wire format)", () => {
        const state = board();
        resolve(state, "test-except-by-wire", [HASTE_ONLY]);
        const projected = projectPublicState(state, 0, "p2");
        expect(
            projected.players[0].battlefield.find((c) => c.id === "a")!
                .cantBeBlockedExceptByThisTurn
        ).toEqual([{ requireAbility: "haste" }]);
    });

    it("the validator accepts it on cant-be-blocked only", () => {
        expect(validateEffectScript(host([HASTE_ONLY]))).toEqual([]);
        expect(
            validateEffectScript(
                host([{ ...HASTE_ONLY, restriction: "cant-block" } as EffectOp])
            )
        ).not.toEqual([]);
    });

    it("the validator refuses a filter field no live blocker can honour", () => {
        expect(
            validateEffectScript(
                host([
                    {
                        ...HASTE_ONLY,
                        exceptBy: { manaCostEquals: { generic: 1 } },
                    } as EffectOp,
                ])
            )
        ).not.toEqual([]);
    });
});

describe("Gingerbrute token (CR 111.3, CR 202.1b)", () => {
    const CREATE: EffectOp[] = [
        {
            op: "createToken",
            token: GINGERBRUTE_TOKEN,
            controller: "controller",
        },
    ] as EffectOp[];

    it("is a valid createToken spec", () => {
        expect(validateEffectScript(host(CREATE))).toEqual([]);
    });

    it("created by the Op, its {1} ability bars a blocker without haste", () => {
        const state = board();
        pushSpell(state, script("test-except-by-create", CREATE), "p1");
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find(
            (c) => c.isToken && c.staticAbilities.includes("haste")
        )!;
        expect(
            tryGetDefinition((token.card as { id: string }).id)!.manaCost
        ).toEqual({
            generic: 1,
        });
        resolveActivated(state, token, "gingerbrute-token-evasion");
        const defenders = state.players[1].battlefield;
        const check = (blockerId: string) =>
            validateBlockerEligibility(
                token,
                defenders.find((c) => c.id === blockerId)!,
                defenders,
                state
            ).eligible;
        expect(check("plain")).toBe(false);
        expect(check("hasty")).toBe(true);
    });

    it("decodes from its id alone with cost, keyword, abilities and art", () => {
        // A name no test registers: a server-side `createToken` of the same id
        // would answer from the registry and never reach the decoder.
        const def = tryGetDefinition(
            tokenDefinitionId({
                ...GINGERBRUTE_TOKEN,
                name: "Gingerbrute Cold Decode",
            } as Parameters<typeof tokenDefinitionId>[0])
        )!;
        expect(def.manaCost).toEqual({ generic: 1 });
        expect(def.types).toEqual(["Artifact", "Creature"]);
        expect(def.subtypes).toEqual(["Food", "Golem"]);
        expect(def.staticAbilities).toEqual(["haste"]);
        expect(def.imagePrintId).toBe(GINGERBRUTE_TOKEN.imagePrintId);
        expect(def.activatedAbilities?.map((a) => a.id)).toEqual([
            "gingerbrute-token-evasion",
            "gingerbrute-token-sacrifice-gain-life",
        ]);
        expect(def.activatedAbilities?.[0].effects?.[0]).toMatchObject({
            op: "restrictCombat",
            exceptBy: { hasAbility: "haste" },
        });
    });

    it("leaves a token with no specified cost byte-identical", () => {
        const id = tokenDefinitionId(
            FOOD_TOKEN as Parameters<typeof tokenDefinitionId>[0]
        );
        expect(id.split("|").length).toBe(16);
        expect(tryGetDefinition(id)!.manaCost).toEqual({});
    });
});
