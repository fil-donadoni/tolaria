// mh1 — blue cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";

// Echo of Eons — {4}{U}{U} Sorcery. "Each player shuffles their hand and
// graveyard into their library, then draws seven cards." with Flashback {2}{U}
// (CR 702.34 — cast from the graveyard for the flashback cost, then exile it).
// This is Timetwister (CR 103.4 whole-table hand/graveyard reset) with a
// flashback back-half, and the marquee flashback play: pitch it, then flash it
// back for a two-mana Timetwister. Echo of Eons is on the stack while it
// resolves, so the graveyard shuffle doesn't sweep it; after resolution the
// flashback rider exiles it (exileOnResolve).
//
// NOT DSL-migratable (ADR 0045), re-assessed for #1264: the earlier "no
// shuffle-library Op / no per-player forEach" reasoning is stale — a
// `libraryLook` shuffle Op and a `forEach { set: "players" }` selector both
// exist now. The actual remaining gap: no Op moves a player's WHOLE hand or
// graveyard to their library in one shot — `moveZone` only relocates a single
// announced/forEach-selected OBJECT or a `choice`-picked card list, never an
// entire zone. Planned-migratable (blocked on a bulk zone-to-zone move Op)
// rather than a genuine protocol card. tracked-by: #1279. Identical body to
// lea/2ed Timetwister's resolve() (composed SpellContext zone primitives, no
// new primitive).
export const echoOfEons: CardDefinition = {
    id: "ff590af2-2d6c-4f16-a9b8-1a6dab6e9ad5",
    rarity: "mythic",
    name: "Echo of Eons",
    oracleText:
        "Each player shuffles their hand and graveyard into their library, then draws seven cards.\nFlashback {2}{U}",
    manaCost: { X: 4, U: 2 },
    types: ["Sorcery"],
    flashback: { X: 2, U: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.forEachPlayer((pid) => {
            ctx.moveZone(pid, "hand", "library");
            ctx.moveZone(pid, "graveyard", "library");
            ctx.shuffleLibrary(pid);
            ctx.drawCards(pid, 7);
        });
    },
};

// Force of Negation — {1}{U}{U} Instant. "If it's not your turn, you may exile a
// blue card from your hand rather than pay this spell's mana cost. Counter
// target noncreature spell. If that spell is countered this way, exile it
// instead of putting it into its owner's graveyard." (CR 118.9 alternative pitch
// cost — exile a blue card from hand, gated on not-your-turn; CR 701.5a counter;
// CR 114.1 noncreature spell target; CR 701.5a counter-to-exile.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// a `handCost.action: "exile"` leg with `condition: not-your-turn`. The
// "noncreature spell" restriction rides `spellExcludeTypeFilter: "Creature"` on
// the spell target (the Spell Pierce shape); the "exile it instead" rider is the
// already-censused `counter` Op's `destination: "exile"` (No More Lies /
// Memory Lapse family) — no new Op or TargetRequirement type (ADR 0045).
export const forceOfNegation: CardDefinition = {
    id: "e9be371c-c688-44ad-ab71-bd4c9f242d58", // MH1 52
    rarity: "rare",
    name: "Force of Negation",
    oracleText:
        "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
    manaCost: { X: 1, U: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellExcludeTypeFilter: "Creature",
    },
    alternativeCosts: [
        {
            id: "pitch-exile-blue",
            description: "Exile a blue card from your hand",
            condition: { kind: "not-your-turn" },
            handCost: {
                action: "exile",
                requirements: [{ filter: { color: "U" }, count: 1 }],
            },
        },
    ],
    effects: [{ op: "counter", target: { target: 0 }, destination: "exile" }],
};
