// Issue #2943 — an ability-COPY grant (CR 607.2a) must survive the wire AND be
// resolvable by the CLIENT ability views.
//
// The engine half is `convex/gre/__tests__/exileSetAbilityGrant.test.ts`. What
// is separate here is that both client views used to hand-roll
// `getDefinition(grant.sourceCardId).grantTemplates?.find(...)` and drop a miss
// SILENTLY (`return null` / `continue`). A Cauldron grant names an exiled
// CREATURE card, which declares no `grantTemplates` at all, so the engine
// offered the ability and the client rendered nothing for it.
//
// Every assertion is driven on the output of `projectPublicState`: a
// hand-built instance would mask a field the wire drops, and the new `origin`
// discriminator rides across only because `slimCard` is a spread.

import { describe, it, expect } from "vitest";
import { getAbilityOracleText, getDisplayAbilities } from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName, registerTokenDefinition } from "@convex/cards";
import type { PermanentView } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { syncLayer6 } from "@convex/gre/layer6";

const SORCERER = getCardByName("Prodigal Sorcerer").id;
const BEARS = getCardByName("Grizzly Bears").id;

// A distinct id from the GRE-side suite's fixture: both files register into the
// same process-wide registry when vitest reuses a worker.
const CAULDRON_ID = "client-2943-exile-set-granter";
registerTokenDefinition({
    id: CAULDRON_ID,
    name: "Test Client Soul Cauldron",
    rarity: "common",
    manaCost: { generic: 2 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "activated-grant",
            applies: (target: PermanentView, source: PermanentView) =>
                target.controllerId === source.controllerId &&
                target.types.includes("Creature") &&
                (target.counters?.["+1/+1"] ?? 0) > 0,
            abilitiesOf: { exiledWithSource: true, types: ["Creature"] },
        },
    ],
});

/** The REAL board — a Cauldron applying to a countered Bear with Prodigal
 *  Sorcerer in its linked exile pile — derived by the engine and then pushed
 *  through the wire reducer. Hand-writing the grant row instead would prove
 *  nothing: `layer6DerivedFields` drops any source-borne row the live
 *  derivation does not reproduce, which is exactly the drop this test exists
 *  to notice. */
function projectedRecipient(): CardInstance {
    const cauldron = makeInstance(BEARS, {
        id: "cauldron",
        controllerId: "p1",
        ownerId: "p1",
        staticSeq: 1,
    });
    cauldron.card = { id: CAULDRON_ID };
    cauldron.types = ["Artifact"];
    const bear = makeInstance(BEARS, {
        id: "recipient",
        controllerId: "p1",
        ownerId: "p1",
        staticSeq: 2,
        counters: { "+1/+1": 1 },
    });
    const exiled = makeInstance(SORCERER, {
        id: "exiled-sorcerer",
        zone: "exile",
        controllerId: "p1",
        ownerId: "p1",
        exiledBySourceId: "cauldron",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [cauldron, bear],
                exile: [exiled],
            }),
            makePlayer("p2"),
        ],
    });
    syncLayer6(state);
    const wire = projectPublicState(state, 1, "p1");
    return wire.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "recipient") as unknown as CardInstance;
}

describe("ability-copy grant on the client (CR 607.2a, issue #2943)", () => {
    it("carries the origin discriminator across the wire", () => {
        const card = projectedRecipient();
        expect(card.grantedActivatedAbilities).toEqual([
            expect.objectContaining({
                sourceCardId: SORCERER,
                abilityId: "prodigal-sorcerer-zap",
                origin: "card-abilities",
                auraId: "cauldron",
            }),
        ]);
    });

    it("renders the granted ability in the zoom panel's ability list", () => {
        const card = projectedRecipient();
        const shown = getDisplayAbilities(BEARS, card).activated;
        expect(shown).toEqual([
            {
                id: "prodigal-sorcerer-zap",
                oracleText:
                    "{T}: Prodigal Sorcerer deals 1 damage to any target.",
                state: "granted",
            },
        ]);
    });

    it("resolves the granted ability's oracle text on the stack", () => {
        const card = projectedRecipient();
        expect(
            getAbilityOracleText(
                BEARS,
                "prodigal-sorcerer-zap",
                card.grantedActivatedAbilities
            )
        ).toBe("{T}: Prodigal Sorcerer deals 1 damage to any target.");
    });

    it("resolves NOTHING for a grant whose origin names the other list", () => {
        // The discriminator is load-bearing, not decorative: the same pair with
        // no `origin` means `grantTemplates[]`, which Prodigal Sorcerer has
        // none of. A fallback between the two lists would resolve this — and
        // would equally resolve a typo'd template id by accident.
        const card = projectedRecipient();
        const asTemplate = (card.grantedActivatedAbilities ?? []).map((g) => ({
            ...g,
            origin: undefined,
        }));
        expect(
            getAbilityOracleText(BEARS, "prodigal-sorcerer-zap", asTemplate)
        ).toBeNull();
        expect(
            getDisplayAbilities(BEARS, {
                ...card,
                grantedActivatedAbilities: asTemplate,
            }).activated
        ).toEqual([]);
    });
});
