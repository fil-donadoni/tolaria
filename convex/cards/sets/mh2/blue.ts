// mh2 — blue cards (ADR 0043 colour split).

// TODO(issue #900 stub — Evoke itself SHIPPED (#900: `CardDefinition.evoke` +
// `evokeTrigger`, see Solitude/Grief in this same set for the working shape).
// Subtlety's OWN remaining gap is different: "choose up to one target
// creature spell or planeswalker spell. Its owner puts it on top or bottom of
// their library" targets a SPELL ON THE STACK from a TRIGGERED ability's
// resolution — `TriggeredAbility` carries no `targetRequirement` (ADR 0002;
// only `CardDefinition`/`ActivatedAbility` do) and `SpellContext.requestChoice`
// has no stack-zone kind (`zone: "battlefield" | "hand" | "library" |
// "graveyard"` only) — there is no way to raise a mid-resolution choice over
// the stack today. Stop-and-issue per gre-development.md; tracked stub.
// export const subtlety: CardDefinition = {
//     id: "701256d5-1389-48b7-9581-d6037209bd06",
//     name: "Subtlety",
//     rarity: "mythic",
//     manaCost: { X: 2, U: 2 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 3,
//     toughness: 3,
// };

// Lose Focus — {1}{U} Instant. "Replicate {U} (When you cast this spell,
// copy it for each time you paid its replicate cost. You may choose new
// targets for the copies.) Counter target spell unless its controller pays
// {2}." Blocked: Replicate (CR 702.56) is `status: "planned"` in
// mechanicsRegistry.ts — no alternate-cast-with-copies primitive exists yet
// (distinct from CR 706 copy-a-spell: replicate copies are paid for and
// created AT CAST TIME, not via a resolution-time copy effect). The
// counter-unless-pay half is otherwise free (same shape as Force Spike,
// leg/blue.ts) — only the keyword blocks it. Stop-and-issue per
// gre-development.md; tracked stub.
// tracked-by: #930
// export const loseFocus: CardDefinition = {
//     id: "985bdb0c-ce6c-4506-8163-76f3b2fdf5fb",
//     name: "Lose Focus",
//     rarity: "common",
//     manaCost: { X: 1, U: 1 },
//     types: ["Instant"],
// };

export {};
