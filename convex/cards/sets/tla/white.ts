// TLA — white cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Aang's Iceberg — {2}{W} Enchantment (Vintage Cube FREE: ETB/dies/attack
// triggers, issue #679). "Flash. When this enchantment enters, exile up to
// one other target nonland permanent until this enchantment leaves the
// battlefield. Waterbend {3}: Sacrifice this enchantment. If you do, scry 2."
//
// O-Ring idiom (precedent: Portable Hole, afr/white.ts; Banishing Light,
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
// SIMPLIFICATION (flagged, CR 702.155-style alternate-cost mechanic):
// "Waterbend {3}" — tapping artifacts/creatures to help pay part of a cost —
// is not modelled (no such cost-payment primitive exists yet); the ability is
// implemented as a plain {3} generic cost. The golden path (sacrifice this,
// scry 2) is faithful. Scry composes shipped primitives, no dedicated Op
// (precedent: Preordain, m11/blue.ts).
const aangsIcebergHoldsSomething = (
    _event: unknown,
    self: { id: string },
    state?: { exileHeld?: ReadonlyArray<{ sourceId: string }> }
): boolean => !!state?.exileHeld?.some((b) => b.sourceId === self.id);

const AANGS_ICEBERG_ID = "720fbd87-b1c1-4b3b-97a1-46b943b115e3";

export const aangsIceberg: CardDefinition = {
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
            // Boomerang idiom, ons/blue.ts); `excludeSource` drops Aang's
            // Iceberg itself ("other"); `count 0..1` = "up to one". Any
            // controller's permanent is eligible (no controller restriction).
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: { min: 0, max: 1 },
                excludeTypes: "Land",
                excludeSource: true,
            },
            // NOT DSL-migratable (ADR 0045): the registered `exile` Op is a
            // plain `ctx.exile(target)` (CR 701.13) with no O-Ring
            // leaves-battlefield-return bookkeeping. This closure needs
            // `ctx.exileWithAttachments`, which stamps the `exileHeld`
            // bundle (`sourceId`, `returnTapped`, `includeAttachments`) the
            // paired `leftTrigger` below reads back via
            // `returnExiledForSource` — no Op wraps that primitive today.
            // Blocked on: an `exileWithAttachments`/O-Ring Op (not yet
            // planned/censused); mirrors the identical, already-unmigrated
            // Portable Hole (afr/white.ts) / Banishing Light (jou/white.ts)
            // precedent this card's header comment cites. Planned-migratable
            // if the class is ever worth unblocking, not protocol-permanent.
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return; // "up to one": none chosen / CR 608.2b none legal
                ctx.exileWithAttachments(target.id, {
                    sourceId: ctx.sourceInstanceId,
                    returnTapped: false,
                    includeAttachments: false,
                });
            },
        }),
        leftTrigger({
            id: "aangs-iceberg-return",
            oracleText:
                "When this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            condition: aangsIcebergHoldsSomething,
            // NOT DSL-migratable (ADR 0045): the effect acts on the very
            // object that just left the battlefield ("return THAT card") —
            // its identity/owner is available only via `leftTrigger`'s
            // `resolve(ctx, event, leaving)` last-known-information payload.
            // `TriggeredAbility.effects` does not thread the firing
            // event/leaving object into the script (see the field doc on
            // `TriggeredAbility.effects`), so a trigger reading LKI stays
            // imperative. Blocked on: LKI/`$event` surfacing in trigger
            // `effects[]` (not planned as a general grammar extension — see
            // Sacred Ground, sth/white.ts, for the identical case). Mirrors
            // every existing `leftTrigger` card reading `leaving.id` /
            // `leaving.ownerId` (Personal Incarnation's `pinc-ltb`,
            // lea/white.ts; Portable Hole's `portable-hole-return`,
            // afr/white.ts).
            resolve: (ctx: SpellContext) => {
                ctx.returnExiledForSource(ctx.sourceInstanceId);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "aangs-iceberg-waterbend",
            oracleText:
                "Waterbend {3}: Sacrifice this enchantment. If you do, scry 2.",
            cost: { mana: { X: 3 } },
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
};
