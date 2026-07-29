// Issue #1880 — the CLIENT mana mirrors must see a GRANTED mana ability
// (CR 113.1 / 611.1b), and must see it through the WIRE REDUCER.
//
// The engine's probes (`convex/gre/constants.ts`) are covered by
// `convex/gre/__tests__/grantedActivatedAbilities.test.ts`. These are the
// three client functions the board's tap affordances actually call —
// `hasManaAbility`, `getActivatedManaMenuEntry`, `getManaChoices` in
// `src/lib/card-utils.ts` — which are separate implementations from the
// engine ones of the same name. Every assertion here is driven on the output
// of `projectPublicState` (a hand-built instance would mask a field the wire
// drops: `grantedActivatedAbilities` rides across only because `slimCard` is
// a spread).

import { describe, it, expect } from "vitest";
import {
    getActivatedManaColor,
    getActivatedManaMenuEntry,
    getManaChoices,
    hasManaAbility,
} from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import type { SlimCardInstance } from "@convex/gameProjections";
import { registerTokenDefinition } from "@convex/cards";
import type { ActivatedAbility } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import type { GameState } from "@convex/gre/state";
import { forest } from "@convex/cards/sets/lea/colorless";

// Distinct ids from the GRE-side suite: the two files register into the same
// process-wide registry when vitest reuses a worker.
const FIXED_TEMPLATE_ID = "client-1880-add-c";
const FIXED_TEMPLATE: ActivatedAbility = {
    id: FIXED_TEMPLATE_ID,
    oracleText: "{T}: Add {C}.",
    cost: { tap: true },
    useStack: false,
    manaProduced: { C: 1 },
};

const COSTED_TEMPLATE_ID = "client-1880-pay-1-add-w";
const COSTED_TEMPLATE: ActivatedAbility = {
    id: COSTED_TEMPLATE_ID,
    oracleText: "{1}, {T}: Add {W}.",
    cost: { tap: true, mana: { X: 1 } },
    useStack: false,
    manaProduced: { W: 1 },
};

const GRANTER_ID = "client-1880-granter";
registerTokenDefinition({
    id: GRANTER_ID,
    name: "Test Client Mana Granter",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    grantTemplates: [FIXED_TEMPLATE, COSTED_TEMPLATE],
});

/** A vanilla creature: no printed mana ability, no basic land subtype. */
const BEAR_ID = "client-1880-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: "Test Client Recipient",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

/** Builds a board with `cardId` on p1's battlefield carrying `grants`, then
 *  returns BOTH the projected wire instance and the projected players list
 *  (the shape `getManaChoices` takes). */
function projected(
    cardId: string,
    grants: { sourceCardId: string; abilityId: string }[]
): {
    card: CardInstance;
    players: { id: string; battlefield: CardInstance[] }[];
    state: GameState;
} {
    const instance = makeInstance(cardId, {
        id: "granted-source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...(grants.length > 0 ? { grantedActivatedAbilities: grants } : {}),
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [instance] }),
            makePlayer("p2"),
        ],
    });
    const wire = projectPublicState(state, 1, "p1");
    const players = wire.players.map((p) => ({
        id: p.id,
        battlefield: p.battlefield as unknown as CardInstance[],
    }));
    const card = wire.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "granted-source") as SlimCardInstance;
    return { card: card as unknown as CardInstance, players, state };
}

const fixedGrant = [{ sourceCardId: GRANTER_ID, abilityId: FIXED_TEMPLATE_ID }];
const costedGrant = [
    { sourceCardId: GRANTER_ID, abilityId: COSTED_TEMPLATE_ID },
];

describe("client mana mirrors see a granted mana ability through projectPublicState (issue #1880)", () => {
    it("hasManaAbility is false for the ungranted control and true once granted", () => {
        expect(hasManaAbility(projected(BEAR_ID, []).card)).toBe(false);
        expect(hasManaAbility(projected(BEAR_ID, fixedGrant).card)).toBe(true);
    });

    it("getActivatedManaMenuEntry surfaces the granted ability's id + oracle text", () => {
        expect(
            getActivatedManaMenuEntry(projected(BEAR_ID, []).card)
        ).toBeNull();
        expect(
            getActivatedManaMenuEntry(projected(BEAR_ID, fixedGrant).card)
        ).toEqual({ id: FIXED_TEMPLATE_ID, oracleText: "{T}: Add {C}." });
    });

    it("getActivatedManaColor reads the granted fixed output (the board's tap cue)", () => {
        expect(getActivatedManaColor(projected(BEAR_ID, []).card)).toBeNull();
        expect(getActivatedManaColor(projected(BEAR_ID, fixedGrant).card)).toBe(
            "C"
        );
    });

    it("getManaChoices prompts when a grant adds a SECOND option next to the intrinsic one (CR 305.6)", () => {
        // A plain Forest has exactly one option — no picker.
        const plain = projected(forest.id, []);
        expect(getManaChoices(plain.card, plain.players)).toBeNull();

        // Granted "{1}, {T}: Add {W}" → the granted {W} AND the Forest's {G}.
        const granted = projected(forest.id, costedGrant);
        expect(getManaChoices(granted.card, granted.players)).toEqual([
            { W: 1 },
            { G: 1 },
        ]);
    });

    it("a granted fixed ability on a non-land stays a single, prompt-free option", () => {
        const { card, players } = projected(BEAR_ID, fixedGrant);
        expect(getManaChoices(card, players)).toBeNull();
    });
});
