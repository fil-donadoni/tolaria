// MOC — white cards, split by colour per ADR 0043. The registry's
// `import * as moc from "./sets/moc"` resolves through moc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, TriggeredAbility } from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { backupTrigger } from "../../abilities/triggers/backupTrigger";

// Guardian Scalelord — {4}{W} Creature — Dragon, 3/4 (MOC 16, Vintage Cube
// pool). "Backup 1 (When this creature enters, put a +1/+1 counter on target
// creature. If that's another creature, it gains the following abilities
// until end of turn.)\nFlying\nWhenever this creature attacks, return target
// nonland permanent card with mana value X or less from your graveyard to
// the battlefield, where X is this creature's power." Backup (CR 702.165)
// shipped in #1315; the remaining blocker — the attack trigger's "mana value
// X or less, where X is this creature's power" restriction — is issue #1378:
// a target-requirement mana-value ceiling capped by the announcing SOURCE'S
// CURRENT effective power (CR 613 layer 7c), not a literal or the ability's
// own `{X}`.
//
// DSL-first (ADR 0045):
//   - Backup 1: `backupTrigger(1, ["flying"], ["guardian-scalelord-attack"])`
//     — the SAME factory Consuming Aetherborn (mom/black.ts) and
//     Death-Greeter's Champion (moc/red.ts) already prove, granting the card's
//     own printed abilities to a non-self target: here BOTH the keyword and
//     (issue #1665) the attack trigger printed below the Backup line.
//   - The attack trigger: a `zone: "graveyard"` `targetRequirement` (CR
//     400.7, the Regrowth/thb-colorless-relic precedent) restricted to
//     nonland permanent cards via `type: PERMANENT_TYPES` + `excludeTypes:
//     "Land"` — the Phelia idiom (`excludeTypes` is now checked for a CARD
//     candidate too, not just `permanent` — see the `excludeTypesDescriptor`
//     fix in `gre/targetFilters.ts`, issue #1378 review follow-up: a POSITIVE
//     type list alone would wrongly admit a dual-typed land, e.g. a land
//     Creature, since the graveyard branch's OWN structural `type` field is a
//     plain OR-membership test with no negation). With a NEW `mvFilter.max:
//     "sourcePower"` dynamic cap (issue #1378) — the source's live effective
//     power, resolved at the SAME point `mvFilter`'s existing `"X"` sentinel
//     already is (`getLegalTargets` / `raiseTriggerTargetSelection`), locking
//     the value as the trigger is put on the stack (CR 603.3d) with no
//     resolution-time re-check, mirroring Ward / Backup's own
//     `targetIsAnother` convention. The reanimation itself is the existing
//     `moveZone` Op's target-shape (CR 400.7, issue #839) — the same
//     `{ op: "moveZone", target: { target: 0 }, to: "battlefield" }` Raise
//     Dead / Resurrection already use.
//
// Also closes a pre-existing frontend gap while wiring this card's
// clickability (`.claude/rules/gre-development.md` § Frontend wiring
// analysis): `src/lib/graveyard-targets.ts`'s `matchesGraveyardTarget` never
// checked `PendingTarget.mvFilter` at all, so EVERY existing mvFilter-
// restricted graveyard target (Sevinne's Reclamation `c19/white.ts`,
// sos/multicolor.ts, ulg/black.ts) silently offered every graveyard card as
// clickable regardless of mana value, relying solely on the server's
// `selectTarget` rejection after the fact. Fixed catalogue-wide (not just
// for this card) in the same change.
//
// CR 702.165c (issue #1665) — Backup 1's grant covers EVERY non-backup ability
// printed below the Backup line, so a backed-up OTHER creature gains BOTH
// "Flying" AND a copy of the attack trigger. The `grantAbility` Op's third
// payload (`grantedTriggeredId`, issue #1665) names a template on this card's
// `triggeredGrantTemplates[]` — the SAME `attackTrigger` object this card also
// prints on itself, so the granted copy is provably identical to the printed
// one and can never drift. `effectiveTriggeredAbilities` (`gre/copy.ts`) unions
// it into the recipient's triggers, so it fires off the RECIPIENT: its
// `matches(event, self)` reads the recipient's own id, and the trigger's
// `mvFilter: { max: "sourcePower" }` resolves against the RECIPIENT's live
// effective power (`raiseTriggerTargetSelection` reads `item.triggerSourceId`,
// the permanent carrying the ability) — exactly what "this creature's power"
// means on a granted copy.
// The attack-triggered ability printed below Guardian Scalelord's Backup line
// — ONE object used in BOTH slots: `triggeredAbilities[]` (the card's own
// printed trigger) and `triggeredGrantTemplates[]` (the copy Backup 1 hands to
// another creature, CR 702.165c). Sharing the object is what makes the granted
// copy identical by construction; `triggeredGrantTemplates` is scanned only for
// permanents that hold a matching `grantedTriggeredAbilities` entry, so listing
// it there does not make the source fire it twice.
const guardianScalelordAttackTrigger: TriggeredAbility = {
    id: "guardian-scalelord-attack",
    oracleText:
        "Whenever this creature attacks, return target nonland permanent card with mana value X or less from your graveyard to the battlefield, where X is this creature's power.",
    event: "ATTACKERS_DECLARED",
    matches: (event, self) =>
        event.type === "ATTACKERS_DECLARED" &&
        event.attackerIds.includes(self.id),
    // CR 603.3d — the target is chosen (and its mana-value ceiling locked to
    // this creature's THEN-current power, issue #1378) as this trigger is put
    // on the stack, not re-evaluated at resolution.
    targetRequirement: {
        // "nonland permanent card" — the Phelia idiom: the full permanent-type
        // list PLUS `excludeTypes: "Land"` (see the module doc comment above
        // for why a positive list alone is insufficient for a dual-typed card).
        type: [...PERMANENT_TYPES],
        excludeTypes: "Land",
        zone: "graveyard",
        controller: "you",
        count: 1,
        mvFilter: { max: "sourcePower" },
    },
    effects: [{ op: "moveZone", target: { target: 0 }, to: "battlefield" }],
};

export const guardianScalelord: CardDefinition = {
    id: "94716d24-e8c6-4cd2-a3ac-20cdb929bfd4", // MOC 16
    name: "Guardian Scalelord",
    rarity: "rare",
    oracleText:
        "Backup 1 (When this creature enters, put a +1/+1 counter on target creature. If that's another creature, it gains the following abilities until end of turn.)\nFlying\nWhenever this creature attacks, return target nonland permanent card with mana value X or less from your graveyard to the battlefield, where X is this creature's power.",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 3,
    toughness: 4,
    // CR 702.165c — "backup 1" is board-visible reminder data; "flying" is
    // (one of) the card's OWN printed abilities (both applies to itself
    // always, per CR 702.9, AND is one of the two abilities backupTrigger(1,
    // ["flying"], ["guardian-scalelord-attack"]) grants a non-self target —
    // the other being the attack trigger below).
    staticAbilities: ["backup 1", "flying"],
    triggeredAbilities: [
        backupTrigger(1, ["flying"], [guardianScalelordAttackTrigger.id]),
        guardianScalelordAttackTrigger,
    ],
    // CR 702.165c — the template Backup 1 grants (`grantedTriggeredId`), the
    // very same printed trigger above.
    triggeredGrantTemplates: [guardianScalelordAttackTrigger],
};
