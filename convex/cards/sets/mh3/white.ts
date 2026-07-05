// mh3 — white cards (ADR 0043 colour split).

// TODO(tracked-by: tolaria#917) — Phelia, Exuberant Shepherd: "Whenever
// Phelia attacks, exile up to one other target nonland permanent. At the
// beginning of the next end step, return that card to the battlefield under
// its owner's control. If it entered under your control, put a +1/+1
// counter on Phelia." Blocked: the exile-then-return-under-owner's-control
// flicker with a conditional "if it entered under your control" follow-up
// needs a `delayedTrigger` extension that branches on the returned
// permanent's post-return controller vs. its owner — not modeled by the
// current `delayedTrigger` body vocabulary. Stop-and-issue per
// gre-development.md rather than a `resolve()` workaround.
// export const pheliaExuberantShepherd: CardDefinition = {
//     id: "55707746-da6e-46e5-a5ca-7ac843fdc38e",
//     name: "Phelia, Exuberant Shepherd",
//     rarity: "rare",
//     manaCost: { X: 1, W: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Dog"],
//     power: 2,
//     toughness: 2,
// };

export {};
