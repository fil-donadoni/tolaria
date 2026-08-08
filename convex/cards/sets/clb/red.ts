// clb — red cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).
import type { CardDefinition } from "../../types";
import { SKELETON_TOKEN } from "../../sharedTokens";

// Delayed Blast Fireball — {1}{R}{R} Instant. "Delayed Blast Fireball deals 2
// damage to each opponent and each creature they control. If this spell was
// cast from exile, it deals 5 damage to each opponent and each creature they
// control instead. Foretell {4}{R}{R}." (CR 702.143 Foretell.) BLOCKED:
// Foretell is `status: "planned"` in `mechanicsRegistry.ts` — no
// foretell-exile-from-hand zone/timing, no later-turn foretell-cost cast
// path, and no "was this spell cast from exile" resolve-time condition. The
// card's own damage amount is conditioned on Foretell, so a partial
// hand-cast-only implementation would misrepresent the oracle text. Do not
// invent a name or paper over the gap with `resolve()`.
// tracked-by: #925
// export const delayedBlastFireball: CardDefinition = {
//     id: "400c76c6-f677-4e7e-87ad-2e526d4b498a",
//     name: "Delayed Blast Fireball",
//     rarity: "rare",
//     oracleText:
//         "Delayed Blast Fireball deals 2 damage to each opponent and each creature they control. If this spell was cast from exile, it deals 5 damage to each opponent and each creature they control instead.\nForetell {4}{R}{R} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
//     manaCost: { X: 1, R: 2 },
//     types: ["Instant"],
// };

// Gut, True Soul Zealot — {2}{R} Legendary Creature — Goblin Shaman, 2/2
// (CLB 180, issue #2373, Vintage Cube). "Whenever you attack, you may
// sacrifice another creature or an artifact. If you do, create a 4/1 black
// Skeleton creature token with menace that's tapped and attacking. Choose a
// Background (You can have a Background as a second commander.)"
//
// "Choose a Background" (CR 903.14, deckbuilding-only text) is explicitly OUT
// OF SCOPE: this engine has no Commander/Background deckbuilding surface
// (2-player/solo constructed only, CLAUDE.md § Out of Scope) and the clause
// produces zero in-game battlefield behavior — omitted with no stub/marker,
// same treatment the issue's own Agent Brief specifies.
//
// Attack trigger (CR 508.1): "whenever you attack" is the Adeline/Guide-of-
// Souls shape (`sets/mid/white.ts`) — `event: "ATTACKERS_DECLARED"`,
// `matches` on `event.attackingPlayerId === self.controllerId` (fires once
// per combat regardless of whether Gut itself is among the attackers — CR
// ruling 2022-06-10 "Gut doesn't have to be among the attacking creatures"),
// not the "this creature attacks" `attackerIds.includes(self.id)` variant.
//
// "You may sacrifice ANOTHER creature or an artifact. If you do, ..." — NOT a
// CR 603.3c reflexive triggered ability, despite the shape's surface
// resemblance to Minsc & Boo's "Sacrifice a creature. WHEN YOU DO, ..."
// (`sets/clb/multicolor.ts`). The CR glossary defines a reflexive triggered
// ability's second sentence as starting "When," "Whenever," or "At" — Gut's
// says "If you do," which stays part of the SAME resolving ability (no new
// stack object, no response window between the sacrifice and the token
// entering — CR 608.2b sequencing within one resolution). This is the
// established "you may sacrifice X. If you do, Y" template already shipped
// on Witherbloom Charm (`sets/sos/multicolor.ts`) and DRK's colorless.ts
// land: an OPTIONAL `choice(kind: "sacrifice-permanents")` with `count: {
// min: 0, max: 1 }` (the "you may…" shape, issue #677) routed through the
// unified `sacrificeChoice` layer (never a per-card auto-pick, see
// `convex/gre/sacrificeChoice.ts`), a `sacrifice` Op consuming the pick, then
// an inline `if picksNonEmpty` gate on the token creation — no
// `reflexiveTrigger` wrapper.
//
// "ANOTHER creature or an artifact" (CR 602.1 "another" excludes the
// source) — ruling 2022-06-10 clarifies "another" scopes ONLY the creature
// leg ("If Gut somehow becomes an artifact, you may sacrifice it to its own
// ability"), so the filter is `(Creature AND not self) OR (Artifact)`, not a
// blanket self-exclusion. Expressed as `filter.any` with `excludeSource`
// on ONLY the Creature clause. `EffectCardFilter.excludeSource` did not
// exist before this card: the `choice` Op's battlefield filter had no way to
// say "another" at all (unlike `TargetRequirement.excludeSource` / the
// `forEach { set: "permanents" }` selector's own flag, issue #1957) — added
// as the third generalization of that exact primitive (ADR 0045 "generalize,
// don't add"), propagated by `toPermanentFilter` onto `PermanentFilter.
// excludeInstanceIds` and validator-gated to `zone: "battlefield"` only
// (`convex/gre/effects/validate.ts`), mirroring `hasAbility`/`isAttacking`/
// `controlledSinceTurnStart`'s existing battlefield-only opt-in shape.
//
// Tapped-and-attacking Skeleton token (CR 508.4): `EffectTokenSpec.
// entersTapped`/`.entersAttacking`, the Adeline/Human-token shape — spread
// onto the shared `SKELETON_TOKEN` spec (`sharedTokens.ts`) rather than
// baked into it, so a future non-attacking Skeleton producer isn't forced to
// inherit them.
//
// DIVERGENCE (tracked-by: #1865): the token always attacks the DEFENDING
// PLAYER, never a planeswalker they control — the SAME pre-existing,
// already-tracked engine gap `TokenSpec.entersAttacking`'s own doc comment
// flags (Adeline hits it identically). In this two-player engine "the
// defending player" is unambiguous, so "attacking that player" is satisfied
// by construction; the planeswalker branch stays out of scope for this card,
// tracked by the existing #1865, not a new issue.
export const gutTrueSoulZealot: CardDefinition = {
    id: "3d8ca18d-9099-4f1e-95c1-f04da58a26bd", // CLB 180
    rarity: "uncommon",
    name: "Gut, True Soul Zealot",
    oracleText:
        "Whenever you attack, you may sacrifice another creature or an artifact. If you do, create a 4/1 black Skeleton creature token with menace that's tapped and attacking.\nChoose a Background (You can have a Background as a second commander.)",
    manaCost: { X: 2, R: 1 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Goblin", "Shaman"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "gut-true-soul-zealot-attack-sacrifice",
            oracleText:
                "Whenever you attack, you may sacrifice another creature or an artifact. If you do, create a 4/1 black Skeleton creature token with menace that's tapped and attacking.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackingPlayerId === self.controllerId,
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: {
                        any: [
                            { type: "Creature", excludeSource: true },
                            { type: "Artifact" },
                        ],
                    },
                    count: { min: 0, max: 1 },
                    prompt: "Sacrifice another creature or an artifact (Gut, True Soul Zealot)?",
                    bind: "$sacPick",
                },
                {
                    op: "sacrifice",
                    permanents: { ref: "$sacPick" },
                },
                {
                    op: "if",
                    predicate: { picksNonEmpty: { ref: "$sacPick" } },
                    then: [
                        {
                            op: "createToken",
                            token: {
                                ...SKELETON_TOKEN,
                                entersTapped: true,
                                entersAttacking: true,
                            },
                            controller: "controller",
                        },
                    ],
                },
            ],
        },
    ],
};
