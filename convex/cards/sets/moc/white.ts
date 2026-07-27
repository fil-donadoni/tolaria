// MOC — white cards, split by colour per ADR 0043. The registry's
// `import * as moc from "./sets/moc"` resolves through moc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
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
//   - Backup 1: `backupTrigger(1, ["flying"])` — the SAME factory Consuming
//     Aetherborn (mom/black.ts) and Death-Greeter's Champion (moc/red.ts)
//     already prove, granting the card's own printed keyword to a non-self
//     target.
//   - The attack trigger: a `zone: "graveyard"` `targetRequirement` (CR
//     400.7, the Regrowth/thb-colorless-relic precedent) restricted to
//     nonland permanent cards via a POSITIVE type list (`PERMANENT_TYPES`
//     minus `"Land"`) rather than `excludeTypes` — a graveyard-zone
//     requirement's card-type gate is the requirement's own STRUCTURAL
//     `type` field (a plain OR-membership test, `gre/rules.ts`
//     `getLegalTargets`'s graveyard branch); `excludeTypes`'s registry
//     descriptor (`gre/targetFilters.ts`) only declares a `permanent` check,
//     never a `card` one, so it is silently a no-op for a graveyard target —
//     the Phelia "nonland permanent" idiom (`excludeTypes: "Land"`) does NOT
//     carry over to this zone. With a NEW `mvFilter.max: "sourcePower"`
//     dynamic cap (issue #1378) — the source's live effective power,
//     resolved at the SAME point `mvFilter`'s existing `"X"` sentinel already
//     is (`getLegalTargets` / `raiseTriggerTargetSelection`), locking the
//     value as the trigger is put on the stack (CR 603.3d) with no
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
// DIVERGENCE (Guard B, `.claude/rules/gre-development.md`): per CR 702.165c
// ("Backup confers only abilities that are actually printed below it") and
// the card's own Scryfall ruling, Backup 1's grant covers BOTH "Flying" AND
// the attack-triggered ability printed below the Backup line — a target
// creature that gets backed up should ALSO gain a copy of "whenever this
// creature attacks, return target nonland permanent card...". The engine's
// `grantAbility` Op (`convex/cards/types.ts`) can only grant a KEYWORD
// string or an activated-ability template — there is no shape yet for
// granting a full TRIGGERED ability, so `backupTrigger` below intentionally
// omits it (keyword-only grant: `["flying"]`). tracked-by: #1665
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
    // always, per CR 702.9, AND is what backupTrigger(1, [...]) grants a
    // non-self target — see the DIVERGENCE note above for why the attack
    // trigger is not also granted).
    staticAbilities: ["backup 1", "flying"],
    triggeredAbilities: [
        backupTrigger(1, ["flying"]),
        {
            id: "guardian-scalelord-attack",
            oracleText:
                "Whenever this creature attacks, return target nonland permanent card with mana value X or less from your graveyard to the battlefield, where X is this creature's power.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            // CR 603.3d — the target is chosen (and its mana-value ceiling
            // locked to this creature's THEN-current power, issue #1378) as
            // this trigger is put on the stack, not re-evaluated at
            // resolution.
            targetRequirement: {
                // "nonland permanent card" — a POSITIVE list (Land omitted),
                // not `excludeTypes` (see the module doc comment above: a
                // graveyard target's card-type gate ignores `excludeTypes`).
                type: PERMANENT_TYPES.filter((t) => t !== "Land"),
                zone: "graveyard",
                controller: "you",
                count: 1,
                mvFilter: { max: "sourcePower" },
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "battlefield" },
            ],
        },
    ],
};
