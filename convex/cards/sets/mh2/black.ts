// mh2 — black cards (ADR 0043 colour split).
import type { CardDefinition, EffectOp } from "../../types";

// Archon of Cruelty — {6}{B}{B} Creature Archon, 6/6, flying (Vintage Cube
// FREE: edict/discard/hand-disruption, issue #682). "Flying. Whenever this
// creature enters or attacks, target opponent sacrifices a creature or
// planeswalker of their choice, discards a card, and loses 3 life. You draw
// a card and gain 3 life." `TriggeredAbility` carries no `targetRequirement`
// (only `CardDefinition`/`ActivatedAbility` do, ADR 0002 precedent), so
// "target opponent" resolves directly through the `"opponent"`
// `EffectPlayerRef` (CR 102.2) — deterministic in this engine's 2-player-only
// scope (no real choice needed to identify who "the opponent" is). Two
// `TriggeredAbility` entries (enters / attacks) share the identical effect
// list: `choice(sacrifice-permanents)` + `sacrifice` for the
// creature-or-planeswalker pick, `choice(discard-hand)` + `discard` for the
// forced discard (CR 701.9a — unspecified "discards a card" is that player's
// own choice), then `loseLife`/`draw`/`gainLife`.
const archonOfCrueltyTriggerEffects: EffectOp[] = [
    {
        op: "choice",
        kind: "sacrifice-permanents",
        player: "opponent",
        zone: "battlefield",
        filter: { type: ["Creature", "Planeswalker"] },
        count: 1,
        prompt: "Sacrifice a creature or planeswalker of your choice.",
        bind: "$sac",
    },
    { op: "sacrifice", permanents: { ref: "$sac" } },
    {
        op: "choice",
        kind: "discard-hand",
        player: "opponent",
        zone: "hand",
        count: 1,
        prompt: "Discard a card.",
        bind: "$disc",
    },
    { op: "discard", player: "opponent", cards: { ref: "$disc" } },
    { op: "loseLife", player: "opponent", amount: 3 },
    { op: "draw", player: "controller", count: 1 },
    { op: "gainLife", player: "controller", amount: 3 },
];

export const archonOfCruelty: CardDefinition = {
    id: "1be9d9a4-d7ee-4854-abc2-85cabf993ec9",
    name: "Archon of Cruelty",
    rarity: "mythic",
    oracleText:
        "Flying\nWhenever this creature enters or attacks, target opponent sacrifices a creature or planeswalker of their choice, discards a card, and loses 3 life. You draw a card and gain 3 life.",
    manaCost: { X: 6, B: 2 },
    types: ["Creature"],
    subtypes: ["Archon"],
    power: 6,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "archon-of-cruelty-enters",
            oracleText:
                "Whenever this creature enters, target opponent sacrifices a creature or planeswalker of their choice, discards a card, and loses 3 life. You draw a card and gain 3 life.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id,
            effects: archonOfCrueltyTriggerEffects,
        },
        {
            id: "archon-of-cruelty-attacks",
            oracleText:
                "Whenever this creature attacks, target opponent sacrifices a creature or planeswalker of their choice, discards a card, and loses 3 life. You draw a card and gain 3 life.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: archonOfCrueltyTriggerEffects,
        },
    ],
};

// Grief — {2}{B}{B} Creature Elemental Incarnation, 3/2, menace (Vintage Cube
// edict/discard/hand-disruption, issue #682). "Menace. When this creature
// enters, target opponent reveals their hand. You choose a nonland card from
// it. That player discards that card. Evoke—Exile a black card from your
// hand." Blocked: keyword **Evoke** (CR 702.74) is `status: "planned"` in
// mechanicsRegistry.ts, and there is no `CardDefinition` alternative-cost
// shape for it at all — Evoke is integral to how Grief is played (the whole
// point is the free hand-disruption evoke line), so shipping only the
// hard-cast body would misrepresent the card (never ship partial). See
// issue #931 (split from #682).
// tracked-by: #900, #931
// export const grief: CardDefinition = {
//     id: "e6befbc4-1320-4f26-bd9f-b1814fedda10",
//     name: "Grief",
//     rarity: "mythic",
//     manaCost: { X: 2, B: 2 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 3,
//     toughness: 2,
// };

// TODO(issue #676 stub — "as an additional cost, sacrifice a creature or
// discard a card" is a CASTER-CHOSEN alternative additional cost;
// `CardDefinition.additionalCosts` only models ONE fixed leg at a time
// (sacrificeFilter XOR exileFilter XOR payXLife XOR payLife XOR
// xFromOpponentGraveyard) — there's no "pick cost A or cost B" shape. Stop-
// and-issue per gre-development.md; tracked stub.
// export const boneShards: CardDefinition = {
//     id: "1ee98955-4c47-4d45-9377-608dfa755337",
//     name: "Bone Shards",
//     rarity: "common",
//     manaCost: { B: 1 },
//     types: ["Sorcery"],
// };

// TODO(issue #676 stub — Overload, CR 702.96, is `planned` in
// mechanicsRegistry.ts: no alternative-cost "change target to each"
// primitive exists, and Damn's overload mode (destroy each creature) is half
// the card. Stop-and-issue; tracked stub.
// export const damn: CardDefinition = {
//     id: "efeae088-9ac5-4d2f-a15c-d8675a471ac5",
//     name: "Damn",
//     rarity: "rare",
//     manaCost: { B: 2 },
//     types: ["Sorcery"],
// };

// STOP-AND-ISSUE (tracked-by: #1156) — Dauthi Voidwalker: "Shadow. If a card
// would be put into an opponent's graveyard from anywhere, instead exile it
// with a void counter on it. {T}, Sacrifice this creature: Choose an exiled
// card an opponent owns with a void counter on it. You may play it this turn
// without paying its mana cost. Activate only as a sorcery." The FIRST
// ability's replacement clause SHIPPED via #1145: the `"graveyard-bound"`
// `ReplacementEventKind` + apply-loop hook
// (`gre/replacements.ts::applyGraveyardBoundReplacements`), scoped to an
// OPPONENT's graveyard and tagging the redirected card with a `void` counter
// — fully implemented and tested
// (`gre/__tests__/graveyardBoundReplacement.test.ts`). Still missing: the
// SECOND ability, which needs three new pieces of engine surface with no
// existing precedent — an exile-zone filtered choice kind ("choose an exiled
// card an opponent owns with a void counter"), a free-cast primitive ("play
// it without paying its mana cost" — `SpellContext.grantCastFromExile` grants
// CAST PERMISSION only, no cost waiver), and an "activate only as a sorcery"
// timing restriction on `ActivatedAbility` (no such field exists today). See
// #1156 for the full design notes. Vintage Cube FREE tranche, issue #686.
// Whole card left as one stub (never ship partial, Grief/Evoke precedent in
// this same file) — the first ability alone is not the full printed card.
// export const dauthiVoidwalker: CardDefinition = {
//     id: "dce5db87-4a78-4b8d-b5c2-918ccd1ba4e3", // MH2 81
//     name: "Dauthi Voidwalker",
//     rarity: "rare",
//     manaCost: { B: 2 },
//     types: ["Creature"],
//     subtypes: ["Dauthi", "Rogue"],
//     power: 3,
//     toughness: 2,
//     staticAbilities: ["shadow"],
// };
