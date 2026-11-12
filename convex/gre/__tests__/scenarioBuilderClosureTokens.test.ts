/**
 * Lowering a board that holds a token built inside a `resolve()` closure
 * (CR 111.3): the token catalogue's static walk never sees such a spec,
 * so `specFromState` must still name it — through the art-stripped shape when
 * a catalogued shape matches, else through its raw `token:` definition id —
 * and the rebuilt scenario must re-create the same token, CR 604.3
 * characteristic-defining ability included.
 */
import { describe, expect, it } from "vitest";
import { buildStateFromScenario, specFromState } from "../scenarioBuilder";
import { makeState } from "../../cards/__tests__/setup.helper";
import { constructArtifactsYouControlToken } from "../../cards/sharedTokens";
import { findTokenSpec, listTokenCatalogue } from "../../cards/tokenCatalogue";
import { tokenDefinitionId } from "../../cards";
import { createTokenPermanents } from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import type { GameState } from "../state";
import type { TokenSpec } from "../../cards/types";

/** The three `resolve()` producers of the CDA Construct, each pinning its own
 *  printing's token art (Urza, Lord High Artificer / Urza's Saga / Karn,
 *  Scion of Urza). */
const CONSTRUCT_PRINTS = [
    ["Urza, Lord High Artificer", "85f212cd-4fc6-42fe-b268-22d8e3b2b7eb"],
    ["Urza's Saga", "a7caaf39-8f16-4f1d-bee6-a45674306319"],
    ["Karn, Scion of Urza", "c5eafa38-5333-4ef2-9661-08074c580a32"],
] as const;

/** A board with two Moxen for `me`, then `spec` created as a real token. */
function boardWithToken(spec: TokenSpec): GameState {
    const state = buildStateFromScenario(makeState(), {
        cards: [
            { name: "Mox Pearl", owner: "me", zone: "battlefield" },
            { name: "Sol Ring", owner: "me", zone: "battlefield" },
        ],
    });
    createTokenPermanents(state, spec, state.players[0].id);
    return state;
}

function onlyToken(state: GameState) {
    const tokens = state.players[0].battlefield.filter((c) => c.isToken);
    expect(tokens).toHaveLength(1);
    return tokens[0];
}

function lower(state: GameState) {
    return specFromState(state, { mySeatId: state.players[0].id });
}

describe("specFromState — tokens created inside resolve() closures (CR 111.3)", () => {
    for (const [producer, printId] of CONSTRUCT_PRINTS) {
        it(`lowers and rebuilds ${producer}'s Construct with its CR 604.3 artifact-count CDA`, () => {
            const state = boardWithToken(
                constructArtifactsYouControlToken(printId)
            );
            // Two Moxen + the Construct itself (an artifact).
            expect(getEffectivePower(state, onlyToken(state))).toBe(3);

            const { spec, dropped } = lower(state);
            expect(dropped.filter((d) => d.includes("Construct"))).toEqual([]);
            const entry = spec.cards.find((c) => c.token === true);
            expect(entry).toBeDefined();

            const rebuilt = buildStateFromScenario(makeState(), spec);
            const construct = onlyToken(rebuilt);
            expect(getEffectivePower(rebuilt, construct)).toBe(3);
            expect(getEffectiveToughness(rebuilt, construct)).toBe(3);
        });
    }

    it("lowers a pinned-art variant of a catalogued shape to the catalogue key, not a raw id", () => {
        const wasp = findTokenSpec("Wasp");
        expect(wasp).toBeDefined();
        const pinned: TokenSpec = {
            ...wasp!,
            imagePrintId: "00000000-0000-4000-8000-000000000001",
        };
        expect(
            listTokenCatalogue().some(
                (e) => e.defId === tokenDefinitionId(pinned)
            )
        ).toBe(false);

        const { spec } = lower(boardWithToken(pinned));

        expect(spec.cards.find((c) => c.token === true)?.name).toBe("Wasp");
    });

    it("lowers an uncatalogued shape to its raw token id and rebuilds the identical definition", () => {
        const golem: TokenSpec = {
            name: "Closure Golem",
            types: ["Artifact", "Creature"],
            subtypes: ["Golem"],
            power: 3,
            toughness: 2,
            colors: ["U"],
            staticAbilities: ["trample"],
        };
        const defId = tokenDefinitionId(golem);
        const state = boardWithToken(golem);

        const { spec } = lower(state);
        const entry = spec.cards.find((c) => c.token === true);
        expect(entry?.name).toBe(defId);

        const rebuilt = onlyToken(buildStateFromScenario(makeState(), spec));
        expect((rebuilt.card as { id: string }).id).toBe(defId);
        expect(rebuilt.power).toBe(3);
        expect(rebuilt.toughness).toBe(2);
        expect(rebuilt.staticAbilities).toEqual(["trample"]);
    });
});
