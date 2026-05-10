import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JSONTree } from "react-json-tree";
import { usePageVisible } from "~/hooks/usePageVisible";
import {
    PLAYER_COLORS,
    getOrCreateClientId,
    getStoredPlayerName,
    storeSession,
} from "~/lib/session";
import DebugButton from "./debug-button";

const theme = {
    scheme: "tolaria",
    base00: "transparent",
    base01: "#383830",
    base02: "#49483e",
    base03: "#75715e",
    base04: "#a59f85",
    base05: "#f8f8f2",
    base06: "#f5f4f1",
    base07: "#f9f8f5",
    base08: "#f92672",
    base09: "#fd971f",
    base0A: "#f4bf75",
    base0B: "#a6e22e",
    base0C: "#a1efe4",
    base0D: "#66d9ef",
    base0E: "#ae81ff",
    base0F: "#cc6633",
};

type PresetScenario = {
    label: string;
    cards: {
        name: string;
        owner: "me" | "opp";
        zone?: "hand" | "battlefield" | "graveyard";
        tapped?: boolean;
        /** Number of copies to place in the zone. Default 1. */
        count?: number;
        /** Marked damage (CR 120.3) on a battlefield creature. */
        damageMarked?: number;
    }[];
    phase: string;
    landCount: number;
    libraryCount?: number;
};

const PRESET_SCENARIOS: PresetScenario[] = [
    {
        label: "Regeneration ({G}: regenerate enchanted creature, CR 701.15a)",
        cards: [
            // Regeneration in hand, attach to my Grizzly Bears, then have
            // the opponent throw a Lightning Bolt at it. Activating {G}
            // before the Bolt resolves stacks a regen shield: the Bolt's
            // lethal damage is replaced by heal+tap, the bear stays in play.
            {
                name: "Regeneration",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Twiddle (toggle tap state on artifact/creature/land, CR 701.20)",
        cards: [
            // Twiddle the opponent's tapped land to untap it (the only useful
            // mode is forced; pre-modal-cast infra). Verify the bear in play
            // also becomes a legal target.
            {
                name: "Twiddle",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const },
            { name: "Mountain", owner: "opp" as const, tapped: true },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Unsummon (return target creature to its owner's hand, CR 701.10)",
        cards: [
            // Bounce the opponent's bear back to their hand. After resolution
            // the bear should leave the battlefield and reappear in opp.hand
            // as a fresh card (no marked damage, untapped, no summoning sick).
            {
                name: "Unsummon",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Damage marked overlay (red badge above P/T, CR 120.3)",
        cards: [
            // Each creature has different marked-damage state to exercise the
            // overlay UI: no badge (0 / undefined), small (1), and near-lethal
            // (toughness-1). Cleared at CLEANUP per CR 514.2.
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                damageMarked: 1,
            },
            {
                name: "Hill Giant",
                owner: "me" as const,
                damageMarked: 2,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
            },
            {
                name: "Serra Angel",
                owner: "opp" as const,
                damageMarked: 3,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Regrowth (target card from your graveyard, CR 400.7 / 608.2b)",
        cards: [
            // Cast Regrowth on your own graveyard to recur a Lightning Bolt;
            // the opponent's bear in their graveyard is NOT a legal target
            // (controller: 'you' filter).
            {
                name: "Regrowth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Sinkhole (destroy target land, CR 701.7)",
        cards: [
            // Sinkhole costs {B}{B}{1}: three Swamps cover the cost. Two
            // legal targets in play — opponent's Mountain and Forest — to
            // exercise the Land target picker. The opponent's Grizzly Bears
            // is NOT a legal target (Sinkhole reads "target land"), so
            // clicking it during target selection should be rejected.
            {
                name: "Sinkhole",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Volcanic Eruption (X target Mountains; X dmg to each creature/player, CR 107.3 / 205.3 / 614.5)",
        cards: [
            // Volcanic Eruption costs {X}{U}{U}{U}. With six Islands the
            // caster can pay X=3 and still cast — pick three of the four
            // opponent Mountains, then watch the eruption: three Mountains
            // hit graveyards and 3 damage goes to every creature and player.
            // Plateau is "Land — Mountain Plains" so it's a legal target too,
            // exercising the subtype filter (CR 205.3). Savannah Lions
            // (2 toughness) dies; Serra Angel (4 toughness, flying) survives
            // — flying does NOT save anything here (CR 120.3).
            {
                name: "Volcanic Eruption",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 6 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
            { name: "Plateau", owner: "opp" as const },
            { name: "Savannah Lions", owner: "opp" as const },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Celestial Prism + Rod of Ruin + Copper Tablet (artifact suite)",
        cards: [
            // Three colorless artifacts in play. Celestial Prism fixes mana
            // for any color. Rod of Ruin pings any target for {3}{T}. Copper
            // Tablet inflicts 1 dmg to each player at every upkeep.
            { name: "Celestial Prism", owner: "me" as const },
            { name: "Rod of Ruin", owner: "me" as const },
            { name: "Copper Tablet", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Zombie Master (other Zombies have swampwalk + {B}: regen)",
        cards: [
            // Master + two Scathe Zombies. Each Zombie keeps its base 2/2
            // (no pt-buff in oracle) but gains swampwalk and a {B}:
            // Regenerate ability granted by the Master. Activate {B} on a
            // Zombie before opp's Wrath of God to shield it. Master itself
            // does NOT have the regen ability or swampwalk (predicate
            // excludes self).
            { name: "Zombie Master", owner: "me" as const },
            { name: "Scathe Zombies", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 4 },
            { name: "Swamp", owner: "opp" as const },
            {
                name: "Wrath of God",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "opp" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Lord of Atlantis (other Merfolk +1/+1, islandwalk; lord)",
        cards: [
            // Lord + two Merfolk of the Pearl Trident → both Merfolk become
            // 2/2 with islandwalk; if opp controls an Island, neither can be
            // blocked. Lord stays 2/2 (excludes self).
            { name: "Lord of Atlantis", owner: "me" as const },
            {
                name: "Merfolk of the Pearl Trident",
                owner: "me" as const,
                count: 2,
            },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Island", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Ice Storm + Stream of Life + Ley Druid + Wall of Brambles",
        cards: [
            // Ice Storm in hand to destroy a target Land. Stream of Life
            // payable for X = 4 (4 life back). Ley Druid taps a tapped land.
            // Wall of Brambles holds the line on defense.
            { name: "Ice Storm", owner: "me" as const, zone: "hand" as const },
            {
                name: "Stream of Life",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Ley Druid", owner: "me" as const },
            { name: "Wall of Brambles", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 5 },
            { name: "Mountain", owner: "opp" as const, tapped: true },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Goblin King (other Goblins +1/+1, mountainwalk; lord)",
        cards: [
            // King + two Mons's Goblin Raiders. Raiders become 2/2 with
            // mountainwalk; if opp controls a Mountain, the rats can't be
            // blocked. King stays 2/2 (excludes self).
            { name: "Goblin King", owner: "me" as const },
            { name: "Mons's Goblin Raiders", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Keldon Warlord (P/T = other creatures you control)",
        cards: [
            // Lone Warlord = 0/0 dies to SBA. Add three creatures and it
            // becomes 3/3.
            { name: "Keldon Warlord", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Goblin Balloon Brigade ({R}: gain flying eot — temp keyword)",
        cards: [
            // Activate {R} to gain flying for the turn — verify it expires at
            // CLEANUP. Try to attack over Wall of Swords (which has flying).
            { name: "Goblin Balloon Brigade", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Wall of Swords", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Orcish Artillery ({T}: 2 dmg target + 3 self-damage)",
        cards: [
            // Tap Orcish Artillery to ping a creature for 2 — taking 3 to the
            // face yourself. Hill Giant (3 toughness) survives the 2 damage.
            { name: "Orcish Artillery", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Shatter / Stone Rain / Tunnel (destroy-target shorthand cycle)",
        cards: [
            // Three target-destroy spells in hand. Cast Shatter on Sol Ring,
            // Stone Rain on a Plains, Tunnel on Wall of Swords. Verify the
            // type / subtype filters at target selection.
            { name: "Shatter", owner: "me" as const, zone: "hand" as const },
            { name: "Stone Rain", owner: "me" as const, zone: "hand" as const },
            { name: "Tunnel", owner: "me" as const, zone: "hand" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
            { name: "Sol Ring", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const },
            { name: "Wall of Swords", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Burrowing + Uthden Troll (mountainwalk + regen)",
        cards: [
            // Cast Burrowing on Uthden Troll: 2/2 with mountainwalk + {R}
            // regen. Hard to block and hard to kill once the opp has any
            // Mountain in play.
            { name: "Burrowing", owner: "me" as const, zone: "hand" as const },
            { name: "Uthden Troll", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Plague Rats (P/T scales with copies on the battlefield)",
        cards: [
            // Three Rats across both sides — each one is a 3/3 by CDA.
            { name: "Plague Rats", owner: "me" as const },
            { name: "Plague Rats", owner: "opp" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Drudge Skeletons + Wall of Bone + Will-o'-the-Wisp ({B} regen)",
        cards: [
            // All three black self-regen creatures plus a Lightning Bolt
            // at one of them — activate {B} regen in response to absorb the
            // damage. Will-o'-the-Wisp's flying makes it harder to block.
            { name: "Drudge Skeletons", owner: "me" as const },
            { name: "Wall of Bone", owner: "me" as const },
            { name: "Will-o'-the-Wisp", owner: "me" as const },
            { name: "Swamp", owner: "me" as const, count: 3 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Mind Twist (target player discards X cards at random)",
        cards: [
            // p2 hand stocked with 4 cards. Pay X = 3, watch the seeded PRNG
            // mill three of them into the graveyard.
            { name: "Mind Twist", owner: "me" as const, zone: "hand" as const },
            { name: "Swamp", owner: "me" as const, count: 5 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Hill Giant",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "opp" as const, zone: "hand" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Raise Dead (return Creature card from your graveyard to hand)",
        cards: [
            // Two creatures in your graveyard, one in opponent's. Targeting
            // is restricted to your own graveyard via the 'you' filter.
            { name: "Raise Dead", owner: "me" as const, zone: "hand" as const },
            { name: "Swamp", owner: "me" as const },
            {
                name: "Hypnotic Specter",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Scathe Zombies",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Unholy Strength + Weakness (mirror Aura buff cycle)",
        cards: [
            // Unholy Strength on your bear (+2/+1 → 4/3). Weakness on opp's
            // Hill Giant (-2/-1 → 1/2). Demonstrates symmetric pt-buff auras.
            {
                name: "Unholy Strength",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Weakness", owner: "me" as const, zone: "hand" as const },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Cursed Land + Warp Artifact (Aura upkeep ping cycle)",
        cards: [
            // Two black "ping at upkeep" auras on different host types: a
            // land and an artifact. Each host's controller takes 1 damage at
            // their upkeep. Combined with Karma-style pressure they stack up.
            {
                name: "Cursed Land",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Warp Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 5 },
            { name: "Mountain", owner: "opp" as const },
            { name: "Sol Ring", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Flight + Jump (grant flying — Aura permanent, instant temporary)",
        cards: [
            // Flight in hand (permanent grant via aura) and Jump in hand
            // (instant grant for the rest of the turn). Cast both on Grizzly
            // Bears to verify the keyword stacks (one persistent, one expiring
            // at CLEANUP).
            { name: "Flight", owner: "me" as const, zone: "hand" as const },
            { name: "Jump", owner: "me" as const, zone: "hand" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Pirate Ship (can't attack unless defender controls Island; {T}: 1 dmg)",
        cards: [
            // p2 controls an Island so the attack restriction is satisfied —
            // Pirate Ship can swing for 4. Also exercise the {T} ping at any
            // target. With p2's Island removed, attacking is illegal.
            { name: "Pirate Ship", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Island", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Prodigal Sorcerer ({T}: 1 dmg to any target — original Tim)",
        cards: [
            // Tap Tim to ping a 1-toughness creature off the battlefield.
            // Repeats every untap step; Hypnotic Specter (2/2) survives one
            // ping but not two.
            { name: "Prodigal Sorcerer", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Hypnotic Specter", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Feedback (1 dmg to host enchantment's controller at upkeep)",
        cards: [
            // Attach Feedback to the opponent's Bad Moon. Each of their
            // upkeeps queues 1 damage to them — slow burn, doesn't tick on
            // your upkeep.
            { name: "Feedback", owner: "me" as const, zone: "hand" as const },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Bad Moon", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Crusade (white creatures get +1/+1, CR 611 layer 7c)",
        cards: [
            // Both controllers' white creatures benefit from the buff. White
            // Knight (WW) attacks for 3 with first strike + pro-black; Savannah
            // Lions become 3/2; opponent's Serra Angel becomes 5/5 flying.
            // Grizzly Bears (green) is unaffected — verifies color filter.
            { name: "Crusade", owner: "me" as const, zone: "hand" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Savannah Lions", owner: "me" as const },
            { name: "White Knight", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Serra Angel", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Death Ward (regenerate target creature, CR 701.15a)",
        cards: [
            // Counter a Wrath of God: cast Death Ward on Grizzly Bears in
            // response, then resolve Wrath. The shielded bear taps and stays;
            // the other creature dies normally.
            { name: "Death Ward", owner: "me" as const, zone: "hand" as const },
            { name: "Plains", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const },
            {
                name: "Wrath of God",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "opp" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Holy Strength + Lance (Aura buffs and first-strike grant)",
        cards: [
            // Cast both auras on Grizzly Bears: +1/+2 from Holy Strength makes
            // it a 3/4, Lance grants first strike. Block a 5/5 Earth Elemental
            // and watch the bear deal 3 first-strike damage before being
            // killed back — but it lives if shielded by extra toughness.
            {
                name: "Holy Strength",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Lance", owner: "me" as const, zone: "hand" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Earth Elemental", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Consecrate Land (enchanted land is indestructible, CR 702.12)",
        cards: [
            // Attach Consecrate Land to one of your Plains, then cast
            // Armageddon: every other land hits the graveyard, the protected
            // Plains stays. Verifies the new indestructible primitive.
            {
                name: "Consecrate Land",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 3 },
            {
                name: "Armageddon",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "opp" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Farmstead (host's controller gains 2 life at upkeep, CR 603.6a)",
        cards: [
            // Attach Farmstead to your Plains. End the turn: at the start of
            // your next upkeep the trigger queues and resolves into +2 life.
            // The opponent's upkeep does NOT fire it — host belongs to you.
            { name: "Farmstead", owner: "me" as const, zone: "hand" as const },
            { name: "Plains", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Karma (deal damage = Swamps to each player at upkeep)",
        cards: [
            // Karma punishes Swamp-heavy decks. Opponent controls 4 Swamps;
            // each of their upkeeps queues a 4-damage trigger to themselves.
            // You control 0 — your upkeep fires a 0-damage no-op.
            { name: "Karma", owner: "me" as const, zone: "hand" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Swamp", owner: "opp" as const, count: 4 },
            { name: "Hypnotic Specter", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Sea Serpent vs Sinkhole (CR 508.1c attack + CR 603.8 state trigger)",
        cards: [
            // Two-step exercise covering both Sea Serpent abilities:
            //  1. Attack: defender controls an Island, so Sea Serpent CAN
            //     legally attack (CR 508.1c). Declare it as attacker to
            //     verify the restriction's positive case.
            //  2. State trigger: pass priority back to the opponent, who
            //     casts Sinkhole on the only Island we control. After
            //     Sinkhole resolves we control 0 Islands — the next stable
            //     checkpoint scans state triggers (CR 117.5 + 603.8) and
            //     queues the sacrifice on the stack. Resolving it sends
            //     Sea Serpent to the graveyard.
            { name: "Sea Serpent", owner: "me" as const },
            { name: "Island", owner: "me" as const },
            { name: "Island", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 2 },
            {
                name: "Sinkhole",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
];

type DebugPanelProps = {
    gameId: Id<"games">;
    showAllCards: boolean;
    onToggleShowAllCards: () => void;
    debugAllActions: boolean;
    onToggleDebugAllActions: () => void;
    onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
};

export default function DebugPanel({
    gameId,
    showAllCards,
    onToggleShowAllCards,
    debugAllActions,
    onToggleDebugAllActions,
    onSwitchGame,
}: DebugPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [showScenarios, setShowScenarios] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const pageVisible = usePageVisible();

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (
                panelRef.current &&
                !panelRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown);
        return () =>
            document.removeEventListener("pointerdown", handlePointerDown);
    }, [isOpen]);
    const state = useQuery(
        api.game.getFullState,
        isOpen && pageVisible ? { gameId } : "skip"
    );
    const game = useQuery(
        api.game.getGame,
        isOpen && pageVisible ? { gameId } : "skip"
    );
    const undo = useMutation(api.game.debugUndo);
    const resetGame = useMutation(api.game.debugResetGame);
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const createSoloGame = useMutation(api.game.createSoloGame);

    const handleNewSolo = async () => {
        // Reuse the deck of the first player in the current game so the user
        // doesn't have to round-trip through the lobby just to restart.
        const sourceDeck = game?.players[0]?.deck;
        if (!sourceDeck) return;
        const name = getStoredPlayerName().trim() || "Player";
        const baseId = getOrCreateClientId();
        const p1Id = `${baseId}-p1`;
        const p2Id = `${baseId}-p2`;
        const newId = await createSoloGame({
            name: `${name}'s solo game`,
            player1: {
                id: p1Id,
                name: `${name} (P1)`,
                bgColor: PLAYER_COLORS[0],
                deck: sourceDeck,
            },
            player2: {
                id: p2Id,
                name: `${name} (P2)`,
                bgColor: PLAYER_COLORS[1],
                deck: sourceDeck,
            },
        });
        storeSession(newId, p1Id);
        onSwitchGame(newId, p1Id);
    };

    return (
        <div
            ref={panelRef}
            className="fixed top-1/2 right-4 -translate-y-1/2 z-50 font-mono text-xs"
        >
            <div className="rounded-lg border border-white/10 bg-black/90 shadow-2xl backdrop-blur">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex w-full items-center justify-between px-3 py-2 text-white/70 hover:text-white"
                >
                    <span className="font-semibold">Debug</span>
                    <span>{isOpen ? "\u25B2" : "\u25BC"}</span>
                </button>

                {isOpen && (
                    <div className="border-t border-white/10">
                        <div className="flex flex-wrap gap-2 px-3 py-2 border-b border-white/10">
                            {state && state.seq > 0 && (
                                <DebugButton onClick={() => undo({ gameId })}>
                                    Undo
                                </DebugButton>
                            )}
                            <DebugButton onClick={onToggleShowAllCards}>
                                {showAllCards ? "Hide cards" : "Show all cards"}
                            </DebugButton>
                            <DebugButton onClick={onToggleDebugAllActions}>
                                {debugAllActions ? "Rules on" : "All actions"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => setShowScenarios(!showScenarios)}
                            >
                                Scenarios
                            </DebugButton>
                            <DebugButton
                                onClick={() => resetGame({ gameId })}
                                variant="danger"
                            >
                                Reset Game
                            </DebugButton>
                            <DebugButton onClick={handleNewSolo}>
                                {game?.solo ? "Restart Solo" : "New Solo Game"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => {
                                    localStorage.clear();
                                    sessionStorage.clear();
                                    window.location.reload();
                                }}
                                variant="danger"
                            >
                                Clear Storage
                            </DebugButton>
                        </div>

                        {showScenarios && (
                            <div className="px-3 py-2 border-b border-white/10 flex flex-col gap-1">
                                <span className="text-white/40 text-[10px] uppercase tracking-wide">
                                    Load scenario
                                </span>
                                {PRESET_SCENARIOS.map((scenario) => (
                                    <DebugButton
                                        key={scenario.label}
                                        onClick={() =>
                                            setupScenario({
                                                gameId,
                                                cards: scenario.cards,
                                                phase: scenario.phase,
                                                landCount: scenario.landCount,
                                                libraryCount:
                                                    scenario.libraryCount,
                                            })
                                        }
                                    >
                                        {scenario.label}
                                    </DebugButton>
                                ))}
                            </div>
                        )}

                        <div className="max-h-[70vh] w-100 overflow-auto px-2 py-1">
                            {state ? (
                                <JSONTree
                                    data={state}
                                    theme={theme}
                                    invertTheme={false}
                                    shouldExpandNodeInitially={(
                                        _keyPath,
                                        _data,
                                        level
                                    ) => level < 2}
                                />
                            ) : (
                                <span className="text-white/40">
                                    Loading...
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
