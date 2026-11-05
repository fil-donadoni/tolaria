// TLA — white cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, PERMANENT_TYPES } from "../../types";
import type { EffectTokenSpec, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { waterbendCost } from "../../abilities/waterbend";

// Aang's Iceberg — {2}{W} Enchantment (Vintage Cube FREE: ETB/dies/attack
// triggers, issue #679). "Flash. When this enchantment enters, exile up to
// one other target nonland permanent until this enchantment leaves the
// battlefield. Waterbend {3}: Sacrifice this enchantment. If you do, scry 2."
//
// O-Ring idiom (precedent: Portable Hole, afr/white.cards.ts; Banishing Light,
// jou/white.ts). TARGETING (CR 603.3d, issue #1193): "up to one other target
// nonland permanent" is a REAL target chosen when the ETB trigger is put on
// the stack — declared as a `targetRequirement` on the TriggeredAbility
// (`raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes it subject to hexproof / protection / ward and
// fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. The leave trigger drives the
// return via the shipped exile-and-return bundle (`exileWithAttachments` /
// `returnExiledForSource`, host-only since Aang's Iceberg's own ability
// doesn't carry attachments along).
//
// "Waterbend {3}" is `waterbendCost` (CR 701.67a). Scry composes shipped
// primitives, no dedicated Op (precedent: Preordain, m11/blue.cards.ts).
const aangsIcebergHoldsSomething = (
    _event: unknown,
    self: { id: string },
    state?: { exileHeld?: ReadonlyArray<{ sourceId: string }> }
): boolean => !!state?.exileHeld?.some((b) => b.sourceId === self.id);

const AANGS_ICEBERG_ID = "720fbd87-b1c1-4b3b-97a1-46b943b115e3";

export const aangsIceberg = defineCard(() => ({
    id: AANGS_ICEBERG_ID,
    name: "Aang's Iceberg",
    rarity: "rare",
    oracleText:
        "Flash\nWhen this enchantment enters, exile up to one other target nonland permanent until this enchantment leaves the battlefield.\nWaterbend {3}: Sacrifice this enchantment. If you do, scry 2. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    staticAbilities: ["flash"],
    triggeredAbilities: [
        enteredTrigger({
            id: "aangs-iceberg-exile",
            oracleText:
                "When this enchantment enters, exile up to one other target nonland permanent until this enchantment leaves the battlefield.",
            scope: "self",
            // CR 603.3d — "up to one OTHER target nonland permanent": a real
            // target chosen when the trigger is put on the stack (not a
            // resolution-time choice), so it is subject to hexproof /
            // protection / ward and fires "becomes the target" triggers.
            // `type: PERMANENT_TYPES minus Land` = "nonland permanent" (the
            // Boomerang idiom, ons/blue.cards.ts); `excludeSource` drops Aang's
            // Iceberg itself ("other"); `count 0..1` = "up to one". Any
            // controller's permanent is eligible (no controller restriction).
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: { min: 0, max: 1 },
                excludeTypes: "Land",
                excludeSource: true,
            },
            // CR 701.13 / ADR 0028 — host-only exile ("up to one": if no target
            // is chosen, `{ target: 0 }` resolves to nothing and the Op no-ops,
            // CR 608.2b), keyed to `$source`; the paired leftTrigger returns it.
            // Op defaults includeAttachments/returnTapped false (host-only).
            effects: [{ op: "exileWithAttachments", target: { target: 0 } }],
        }),
        leftTrigger({
            id: "aangs-iceberg-return",
            oracleText:
                "When this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            condition: aangsIcebergHoldsSomething,
            // CR 603.7a / ADR 0028 — return the bundle keyed to `$source`. The
            // Op needs only `ctx.sourceInstanceId` (which `effects[]` provides),
            // NOT the leaving object's LKI, so it migrates cleanly.
            effects: [{ op: "returnExiledForSource" }],
        }),
    ],
    activatedAbilities: [
        {
            id: "aangs-iceberg-waterbend",
            oracleText:
                "Waterbend {3}: Sacrifice this enchantment. If you do, scry 2.",
            cost: waterbendCost(3),
            useStack: true,
            // NOT DSL-migratable (ADR 0045): step 1 alone (`ctx.sacrifice`)
            // maps onto the registered `sacrifice` Op, but `effects[]` is a
            // single ordered list for the whole ability — it cannot be
            // migrated piecemeal while step 2 stays blocked. Step 2's scry
            // drives a `kind: "partition"` `requestChoice` (submit = only the
            // BOTTOM-bound ids; the kept top cards stay in their existing
            // order, unreordered). The registered `scryReorder` Op instead
            // raises a `kind: "order-top"` choice, whose submit contract
            // requires EVERY looked-at card to be placed (both the kept-on-
            // top order AND the bottomed remainder) or the engine throws
            // ("order-top must place every looked-at card once",
            // pendingChoiceSubmit.ts) — an observably different choice
            // protocol, not a pure-refactor swap: the existing per-card test
            // submits only the bottomed id and would need editing to satisfy
            // `order-top`'s full-cover requirement, which the playbook
            // forbids (never edit a test to make a migration pass). Blocked
            // on: a `partition`-kind choice Op (not censused/planned) —
            // `scryReorder` is a genuine behavior change here, not a like-
            // for-like skin.
            resolveSteps: [
                (ctx: SpellContext) => {
                    ctx.sacrifice(ctx.sourceInstanceId);
                },
                (ctx: SpellContext) => {
                    const me = ctx.controller;
                    const topIds = ctx.peekLibraryTop(me, 2);
                    if (topIds.length === 0) return;
                    const toBottom = ctx.requestChoice({
                        playerId: me,
                        choiceId: `aangs-iceberg-scry-${ctx.sourceInstanceId}`,
                        kind: "partition",
                        zone: "library",
                        candidateIds: topIds,
                        count: { min: 0, max: topIds.length },
                        prompt: "Scry 2 — choose any number of cards to put on the bottom (the rest stay on top).",
                    });
                    if (toBottom === undefined) return; // suspended on the scry choice
                    const bottomSet = new Set(toBottom);
                    const keptTop = topIds.filter((id) => !bottomSet.has(id));
                    const all = ctx.peekLibraryTop(me, Number.MAX_SAFE_INTEGER);
                    const topSet = new Set(topIds);
                    const middle = all.filter((id) => !topSet.has(id));
                    ctx.reorderLibraryTop(me, [
                        ...keptTop,
                        ...middle,
                        ...toBottom,
                    ]);
                },
            ],
        },
    ],
}));

// Appa, Steadfast Guardian — {2}{W}{W} Legendary Creature, 3/4, flash, flying.
// CR 701.65a, issue #3551 — the enter trigger airbends every announced permanent
// (`count: { min: 0 }`, CR 601.2c: "any number of" accepts zero); `forEach
// { set: "targets" }` reads an open-ended count no positional slot can. The cast
// trigger reads the zone off the SPELL_CAST event (CR 601.2a), so a spell cast
// off airbend, or off any other exile permission, makes an Ally.
const APPA_STEADFAST_GUARDIAN_ID = "829d91e9-4878-4e55-a262-ac0d55b65d4e";
/** "1/1 white Ally creature token" — pinned to its TLA token print. */
const ALLY_TOKEN: EffectTokenSpec = {
    name: "Ally",
    types: ["Creature"],
    subtypes: ["Ally"],
    power: 1,
    toughness: 1,
    colors: ["W"],
    imagePrintId: "f842c52a-04b6-4625-ba58-45b043ada340",
};
//
// compiler-gap: "When {self} enters, airbend any number of other target nonland permanents you control." (#2693)
// compiler-gap: "Whenever you cast a spell from exile, create a 1/1 white Ally creature token." (#2693)
export const appaSteadfastGuardian = defineCard(() => ({
    id: APPA_STEADFAST_GUARDIAN_ID,
    name: "Appa, Steadfast Guardian",
    rarity: "mythic",
    oracleText:
        "Flash\nFlying\nWhen Appa enters, airbend any number of other target nonland permanents you control. (Exile them. While each one is exiled, its owner may cast it for {2} rather than its mana cost.)\nWhenever you cast a spell from exile, create a 1/1 white Ally creature token.",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Bison", "Ally"],
    power: 3,
    toughness: 4,
    staticAbilities: ["flash", "flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "appa-steadfast-guardian-airbend",
            oracleText:
                "When Appa enters, airbend any number of other target nonland permanents you control.",
            scope: "self",
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: { min: 0 },
                excludeTypes: "Land",
                controller: "you",
                excludeSource: true,
            },
            effects: [
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [{ op: "airbend", target: { ref: "$each" } }],
                },
            ],
        }),
        spellCastTrigger({
            id: "appa-steadfast-guardian-ally",
            oracleText:
                "Whenever you cast a spell from exile, create a 1/1 white Ally creature token.",
            scope: "you",
            condition: (event) => event.spellCastFromZone === "exile",
            effects: [
                {
                    op: "createToken",
                    token: ALLY_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
        }),
    ],
}));
