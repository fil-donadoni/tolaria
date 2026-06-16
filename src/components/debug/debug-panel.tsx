import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JSONTree } from "react-json-tree";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { usePageVisible } from "~/hooks/usePageVisible";
import { storeSession } from "~/lib/session";
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
        /** Place face down (CR 708.2): a 2/2 colourless vanilla creature whose
         *  real identity is hidden from the opponent. Battlefield only. */
        faceDown?: boolean;
    }[];
    phase: string;
    landCount: number;
    libraryCount?: number;
};

const PRESET_SCENARIOS: PresetScenario[] = [
    {
        // Beta-original cards (ADR 0014): cards first printed in LEB with no
        // Alpha counterpart. Volcanic Island is the tenth ABUR dual ({T}: add
        // {U} or {R}); Circle of Protection: Black is the missing CoP. Tap a
        // Volcanic Island for {U}/{R}, then activate CoP: Black ({1}) targeting
        // the opponent's black Hypnotic Specter to prevent its damage to you.
        label: "Beta-original: Volcanic Island + Circle of Protection: Black",
        cards: [
            { name: "Volcanic Island", owner: "me" as const, count: 2 },
            { name: "Circle of Protection: Black", owner: "me" as const },
            { name: "Hypnotic Specter", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Face-down permanents (CR 708.2, ADR 0013). Each side has a creature
        // placed face down: it reads as a 2/2 colourless nameless vanilla
        // creature. You see your own face-down card's true identity; the
        // opponent's face-down creature shows only the generic 2/2 placeholder.
        // (No cast path or turn-up yet — those are separate slices.)
        label: "Face-down permanents: hidden-identity 2/2 (CR 708.2)",
        cards: [
            { name: "Shivan Dragon", owner: "me" as const, faceDown: true },
            { name: "Serra Angel", owner: "opp" as const, faceDown: true },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Illusionary Mask masked-cast (CR 708.2, ADR 0013, #123). Activate
        // the Mask, spend {X} colourless, and choose an eligible creature from
        // hand (mana value ≤ X) to cast it face down as a 2/2. Only eligible
        // creatures are clickable: with 2 Mountains, X=2 makes Grizzly Bears
        // (mv 2) eligible but not Shivan Dragon (mv 6). The chosen creature
        // resolves into a face-down permanent the opponent sees as a 2/2.
        label: "Illusionary Mask: cast a creature face down ({X} → 2/2)",
        cards: [
            { name: "Illusionary Mask", owner: "me" as const },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Shivan Dragon",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Face-down turn-up (CR 708.9, ADR 0013, #124). Your face-down creature
        // is really a Hill Giant (3/3) but reads as a 2/2. The moment it would
        // deal/be dealt damage or become tapped it turns face up and acts as
        // the real 3/3. Move to combat and attack: it taps to attack → turns
        // up → deals 3 (not 2). Or tap it with Icy Manipulator to reveal it.
        label: "Face-down turn-up: attack/tap reveals the real creature (#124)",
        cards: [
            { name: "Hill Giant", owner: "me" as const, faceDown: true },
            { name: "Icy Manipulator", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Pile combat (CR 509.2 variant, ADR 0012). Raging River is on your
        // battlefield with two attackers. Move to combat and attack with both:
        // the trigger asks the opponent to divide their non-flying creatures
        // into a "left" and "right" pile (select the left pile), then asks you
        // to label your attackers (select the "left" attackers). A labelled
        // attacker can then be blocked only by flying creatures or creatures in
        // the matching pile.
        label: "Raging River: left/right pile combat (divide → label → block restriction)",
        cards: [
            { name: "Raging River", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const },
            { name: "Mesa Pegasus", owner: "opp" as const }, // flying — blocks any pile
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Text-changing effect (CR 612, layer 3). Cast Magical Hack ({U}) and
        // pick a basic land type: on your Forest, change it to Island and it
        // taps for {U} instead of {G}; on Shanodin Dryads (forestwalk), change
        // Forest → Island and its evasion now keys off the opponent's Island
        // (move to combat and attack — the Dryads become unblockable). The
        // change lasts indefinitely and ends if the object changes zones.
        label: "Magical Hack: text-change a land type (Forest → Island mana + landwalk)",
        cards: [
            {
                name: "Magical Hack",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Shanodin Dryads", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 1 },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Island", owner: "opp" as const, count: 1 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Color-word text change (CR 612, layer 3). Cast Sleight of Mind ({U})
        // and pick a color: on Black Knight (protection from white), change
        // white → blue and Savannah Lions can no longer be blocked/targeted as
        // before — protection now keys off blue. On Circle of Protection: White,
        // change white → red and its "{1}: prevent a white source" ability now
        // targets red sources instead. The change lasts indefinitely and ends
        // if the object changes zones. It never changes the object's own color.
        label: "Sleight of Mind: text-change a color word (protection-from + Circle of Protection)",
        cards: [
            {
                name: "Sleight of Mind",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Black Knight", owner: "opp" as const },
            { name: "Circle of Protection: White", owner: "me" as const },
            { name: "Savannah Lions", owner: "me" as const },
            { name: "Mons's Goblin Raiders", owner: "opp" as const },
            { name: "Island", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // AI debug: the bot ("opp" = p2) holds Braingeyser (target player draws
        // X) and Giant Growth (target ANY creature +3/+3) with the mana to cast
        // them, plus a creature on each side. Pass your turn → on the bot's turn
        // it decides; watch the floating "AI trace" box (left) to see which
        // targets it weighs and the per-term eval. The diagnostic: if "→ your
        // creature" and "→ its creature" show the same power terms, or
        // Braingeyser → you vs → itself show the same hand terms, the effect was
        // not simulated.
        label: "AI debug: bot holds Braingeyser + Giant Growth (watch AI trace box on bot's turn)",
        cards: [
            {
                name: "Braingeyser",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Giant Growth",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "opp" as const, count: 4 },
            { name: "Forest", owner: "opp" as const, count: 1 },
            // Two DIFFERENT creatures so the Giant Growth target labels are
            // distinguishable in the trace ("→ Grizzly Bears" = bot's own,
            // "→ Hill Giant" = yours, the tempting wrong target).
            { name: "Grizzly Bears", owner: "opp" as const }, // bot's own creature
            { name: "Hill Giant", owner: "me" as const }, // your creature (tempting wrong target)
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W29: Copy permanent — Clone / Copy Artifact / Vesuvan + Gaea's Liege (CR 707)",
        cards: [
            // Cast Clone ({3}{U}) and choose to enter as a copy of the Serra
            // Angel — the copy gains flying + vigilance and is 4/4. Copy
            // Artifact ({1}{U}) copies the Helm of Chatzuk and stays an
            // enchantment too. Vesuvan Doppelganger ({3}{U}{U}) copies a
            // creature but stays blue and re-copies each upkeep. Gaea's Liege
            // is on the battlefield: its P/T equals the Forests you control
            // (3 here), and its {T} turns the Mountain into a Forest, bumping
            // it to 4/4. Five Islands cover the blue spells.
            { name: "Clone", owner: "me" as const, zone: "hand" as const },
            {
                name: "Copy Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Vesuvan Doppelganger",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Gaea's Liege", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "me" as const, count: 1 },
            { name: "Island", owner: "me" as const, count: 5 },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Helm of Chatzuk", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W28: Banding — Benalish Hero + bear band, redistribute damage (CR 702.21)",
        cards: [
            // Move to combat and attack. Use the band panel to group Benalish
            // Hero (banding) with the Grizzly Bears: the band is blocked as a
            // group, and because a banding creature is involved YOU divide the
            // blocker's combat damage among the band members (CR 702.21k) —
            // pile it on the 1/1 Hero to save the bear. Helm of Chatzuk can
            // grant banding to another attacker ({1}, {T}). The opposing
            // 3/3 is the blocker.
            { name: "Benalish Hero", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Mesa Pegasus", owner: "me" as const },
            { name: "Helm of Chatzuk", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 1 },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W27: Copy spell — Fork (copy instant/sorcery, copy is red, CR 707.10)",
        cards: [
            // Cast Lightning Bolt at the opponent, then in response cast Fork
            // ({R}{R}) targeting it. The copy is red and you may choose new
            // targets (e.g. redirect to a creature). Three Mountains cover
            // Bolt ({R}) + Fork ({R}{R}). A Grizzly Bears gives the copy an
            // alternative target to redirect onto.
            { name: "Fork", owner: "me" as const, zone: "hand" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W26: Mana substitution — Sunglasses of Urza (W pays R, CR 609.4b)",
        cards: [
            // Sunglasses lets white mana pay red costs. Tap the Plains for {W},
            // then cast Lightning Bolt ({R}) — the white mana covers the red
            // pip. Remove Sunglasses and the substitution is gone.
            { name: "Sunglasses of Urza", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W26: Graveyard self-reanimate — Nether Shadow (3+ creatures above, CR 603.6e)",
        cards: [
            // Nether Shadow sits at the bottom of the graveyard with three
            // creature cards stacked above it. Pass to your next upkeep: the
            // graveyard trigger offers to return it (it has haste).
            {
                name: "Nether Shadow",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
                count: 3,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W26: Aura retarget — Kudzu (tap host → destroy + reattach, CR 701.20a)",
        cards: [
            // Cast Kudzu on one Forest, then tap that Forest: Kudzu destroys it
            // and you choose the other Forest to move the Aura onto. With only
            // one land left, declining (or no target) sends Kudzu to the yard.
            { name: "Kudzu", owner: "me" as const, zone: "hand" as const },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
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
        label: "Tap-for-mana triggers — Mana Flare + Manabarbs + Wild Growth",
        cards: [
            // Mana Flare doubles each land's first color. Manabarbs pings the
            // tapper. Wild Growth attached to a Forest gives +{G} on that
            // host's mana tap. Tap any Forest to see all three fire.
            { name: "Mana Flare", owner: "me" as const },
            { name: "Manabarbs", owner: "me" as const },
            {
                name: "Wild Growth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W25b: Counter-unless-pay + draw-skip — Power Sink + Island Sanctuary",
        cards: [
            {
                name: "Power Sink",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Island Sanctuary",
                owner: "me" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Plains", owner: "me" as const },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W25a: Mass forced-attack — Siren's Call + False Orders",
        cards: [
            {
                name: "Siren's Call",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "False Orders",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Savannah Lions", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Wall of Swords", owner: "me" as const },
            { name: "Island", owner: "opp" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W24: Cost modifier + keyword removal — Gloom, Forcefield, Animate Wall, Earthbind",
        cards: [
            { name: "Gloom", owner: "me" as const },
            { name: "Forcefield", owner: "me" as const },
            {
                name: "Animate Wall",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Earthbind",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Wall of Swords", owner: "me" as const },
            { name: "Serra Angel", owner: "opp" as const },
            {
                name: "Savannah Lions",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Warp Artifact — Aura on opponent's artifact (CR 303.4 cross-board attach)",
        cards: [
            // Warp Artifact in hand (cost {B}{B}) targeting an opponent-owned
            // Sol Ring. Cast attaches the aura under my control while the
            // host stays on the opponent's battlefield (CR 303.4). On the
            // opponent's next upkeep the trigger deals 1 damage to them
            // (CR 603.6a). Verifies cross-board aura targeting AND visual
            // attachment when host and aura sit on opposite sides.
            {
                name: "Warp Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Sol Ring", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "SPELL_CAST trigger — Verduran + Sphere cycle + Soul Net",
        cards: [
            // Verduran on the battlefield. Cast Castle (enchantment) → may-pay
            // prompts to draw a card. Crystal Rod fires on any blue spell
            // → may pay {1} for 1 life. Soul Net fires on creature death.
            { name: "Verduran Enchantress", owner: "me" as const },
            { name: "Ivory Cup", owner: "me" as const },
            { name: "Soul Net", owner: "me" as const },
            { name: "Castle", owner: "me" as const, zone: "hand" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        label: "Aura pumps — Firebreathing + Holy Armor",
        cards: [
            // Firebreathing on a Mountain caster's bear: spend {R} to pump
            // +1/+0 EOT. Holy Armor adds passive +0/+2 and a {1}{W} pump for
            // +0/+3 EOT — both modifications stack with the static buff.
            {
                name: "Firebreathing",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Holy Armor",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Reach blocks flier — Giant Spider + Web",
        cards: [
            // Opponent attacks with Shivan Dragon (flying). Giant Spider
            // (innate reach) blocks legally; Web attached to a vanilla
            // Grizzly Bears also lets it block by granting reach + 0/+2.
            { name: "Giant Spider", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Web", owner: "me" as const, zone: "hand" as const },
            { name: "Forest", owner: "me" as const, count: 1 },
            { name: "Shivan Dragon", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Psychic Venom — 2 dmg on host land tap (PERMANENT_TAPPED)",
        cards: [
            // Psychic Venom in hand → attach to opponent's Mountain. Every
            // time they tap that land (mana or otherwise) the trigger pings
            // them for 2.
            {
                name: "Psychic Venom",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Upkeep tax — Power Leak + Power Surge + Pestilence",
        cards: [
            // Three upkeep-driven enchantments: Power Leak attached to one of
            // my own enchantments forces a {U}-or-1-life choice each turn;
            // Power Surge pings the active player for each of their untapped
            // lands; Pestilence demands {B} or sacrifice + can be activated
            // for symmetric 1-damage sweeps.
            {
                name: "Power Leak",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Castle", owner: "me" as const },
            { name: "Power Surge", owner: "me" as const },
            { name: "Pestilence", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Sacrifice-counter — Lifeforce / Deathgrip",
        cards: [
            // Lifeforce ({G}, sac: counter Black). Deathgrip ({B}, sac:
            // counter Green). Opponent has Dark Ritual + Llanowar Elves to
            // try one of each color.
            { name: "Lifeforce", owner: "me" as const },
            { name: "Deathgrip", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Dark Ritual",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Llanowar Elves",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "opp" as const, count: 2 },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Northern Paladin — {W}{W}, {T}: destroy target black creature",
        cards: [
            // Tap the Paladin to wipe an opposing Black creature.
            // Hypnotic Specter is the canonical LEA Black target.
            { name: "Northern Paladin", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Hypnotic Specter", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Arrows showcase — target arrows for stack items",
        cards: [
            // Sandbox per visualizzare le frecce di targeting:
            // - Lightning Bolt (R, any target) → cast su creatura, player o spell
            // - Counterspell (UU) → cast su un'altra spell sulla pila
            // - Disenchant (1W) → cast su artefatto/incantesimo opp
            // - Northern Paladin (T) → triggered ability che bersaglia creatura nera
            // Mana abbondante per concatenare casts e osservare piu frecce.
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Counterspell",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Northern Paladin", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Hypnotic Specter", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Sol Ring", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Block restrictions — Invisibility / Fear / Ironclaw / Dwarven Warriors",
        cards: [
            // Wave 2 block-restriction sweep.
            // - Invisibility on my Grizzly Bears: only Walls can block.
            // - Fear on my Hypnotic Specter: only black/artifact can block.
            // - Ironclaw Orcs: can't block creatures with power ≥ 2.
            // - Dwarven Warriors: tap → target ≤2 power creature is
            //   unblockable EOT.
            {
                name: "Invisibility",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Fear", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hypnotic Specter", owner: "me" as const },
            { name: "Dwarven Warriors", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 1 },
            { name: "Ironclaw Orcs", owner: "opp" as const },
            { name: "Wall of Water", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Damage prevention shields — Samite Healer / Conservator",
        cards: [
            // Wave 3 prevent-N-to-target.
            // - Samite Healer: tap to drop a 1-damage shield on any target
            //   (creature or player). Opponent's Lightning Bolt is reduced
            //   by 1 (3 → 2 damage).
            // - Conservator: {3}, tap to drop a 2-damage shield on
            //   yourself. Reduces a Bolt to 1.
            // Stack the shields and watch them combine on the same target.
            { name: "Samite Healer", owner: "me" as const },
            { name: "Conservator", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "The Hive — {5}, {T}: create a 1/1 flying Wasp token",
        cards: [
            // Wave 4 token creation.
            // - The Hive: tap + 5 mana → create a Wasp (1/1 flying Insect
            //   artifact creature token).
            // - 7 lands so the activation is one-tap (5 generic + tap cost).
            // - Wall of Wood gives the opponent a non-flying ground blocker
            //   that can't reach a Wasp; Giant Spider (reach) can.
            // Repeated activations stack Wasps; killing a Wasp shows the
            // CR 704.5d cease-to-exist SBA — the token leaves play and
            // doesn't appear in the graveyard.
            { name: "The Hive", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Mountain", owner: "me" as const, count: 3 },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Wall of Wood", owner: "opp" as const },
            { name: "Giant Spider", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Winter Orb — land-only cap, untap-pick prompt (CR 502.1, ADR 0005)",
        cards: [
            // Winter Orb in play caps land untaps at one per untap step
            // (modern Oracle, ADR 0004). The active player has three
            // tapped lands + a tapped Grizzly Bears: at the next untap
            // step the engine enqueues an `untap-pick` PendingChoice
            // ({ min: 0, max: 1 }, filter: { types: "Land" }) routed to
            // the active player. The Bears (non-land) untap normally,
            // demonstrating the Oracle fix. Click any tapped land to
            // commit the pick + auto-untap; click "Skip untap" to
            // exercise the ADR 0003 tactical zero-branch (CR 701.39 —
            // the cap is permissive). End your turn to drive into the
            // opponent's turn and back into your UNTAP step to see the
            // prompt fire end-to-end.
            { name: "Winter Orb", owner: "me" as const },
            { name: "Plains", owner: "me" as const, tapped: true, count: 3 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Smoke — creature-only cap, untap-pick prompt (CR 502.1, ADR 0005)",
        cards: [
            // Smoke in play caps creature untaps at one per untap step
            // (modern Oracle). The active player has three tapped Grizzly
            // Bears + three tapped Plains: at the next untap step the
            // engine enqueues an `untap-pick` PendingChoice
            // ({ min: 0, max: 1 }, filter: { types: "Creature" }) routed
            // to the active player. The Plains (non-creature) untap
            // normally, demonstrating that Smoke binds Creatures only.
            // Click any tapped bear to commit the pick + auto-untap;
            // click "Skip untap" to exercise the ADR 0003 tactical
            // zero-branch (CR 701.39 — the cap is permissive). End your
            // turn to drive into the opponent's turn and back into your
            // UNTAP step to see the prompt fire end-to-end.
            { name: "Smoke", owner: "me" as const },
            { name: "Plains", owner: "me" as const, tapped: true, count: 3 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
                count: 3,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Meekstone — power-keyed hard skip (CR 502.1 + 613 layer 7c, ADR 0005)",
        cards: [
            // Meekstone in play: a `untapRestriction` with filter
            // { types: "Creature", powerAtLeast: 3 } and maxUntap: 0. The
            // active player has a tapped Sengir Vampire (4/4, effective
            // power ≥3 — stays tapped), a tapped Shivan Dragon (5/5 —
            // stays tapped), and two tapped Grizzly Bears (2/2 — both
            // untap normally). No untap-pick prompt is enqueued: cap=0
            // hard-skips the matching set and the dispatcher auto-resolves
            // straight to UPKEEP. Unholy Strength is in hand so the user
            // can cast it on a Grizzly Bears (+2/+1 → effective 4/3) to
            // verify the layer 7c interaction: pre-buff the bear untaps;
            // post-buff it stays tapped under Meekstone. End your turn to
            // drive into the opponent's turn and back into your UNTAP
            // step to see the gating fire end-to-end.
            { name: "Meekstone", owner: "me" as const },
            { name: "Sengir Vampire", owner: "me" as const, tapped: true },
            { name: "Shivan Dragon", owner: "me" as const, tapped: true },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
                count: 2,
            },
            {
                name: "Unholy Strength",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Winter Orb + Smoke — multi-restriction FIFO (CR 502.1, ADR 0005)",
        cards: [
            // Both restrictions in play: Winter Orb caps Land untaps at
            // one, Smoke caps Creature untaps at one. The dispatcher
            // fires two independent prompts in FIFO order — active
            // player's battlefield first, then opponent's — so with both
            // sources on the active side the first prompt is Winter Orb
            // (Land), the second is Smoke (Creature). Picks are
            // independent: untapping one Land does NOT consume the
            // Creature cap. Use this to verify ADR 0005 multi-restriction
            // sequencing: pick a land → commit → second prompt appears →
            // pick a bear → commit → UPKEEP.
            { name: "Winter Orb", owner: "me" as const },
            { name: "Smoke", owner: "me" as const },
            { name: "Plains", owner: "me" as const, tapped: true, count: 3 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
                count: 3,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Meekstone + Smoke — hard-skip ∩ cap filter overlap (CR 502.1)",
        cards: [
            // Meekstone (maxUntap:0, Creature power≥3) + Smoke (maxUntap:1,
            // Creature). The intersection step vetoes high-power creatures
            // from Smoke's eligible set. Expected golden path: Smoke prompt
            // offers only the power-2 Grizzly Bears; the power-4 Sengir
            // Vampire stays tapped regardless of the pick. Skip leaves
            // everything tapped. End turn to see the interaction fire again.
            { name: "Meekstone", owner: "me" as const },
            { name: "Smoke", owner: "me" as const },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
            },
            {
                name: "Sengir Vampire",
                owner: "me" as const,
                tapped: true,
            },
            { name: "Plains", owner: "me" as const, tapped: true, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Skip / restrict untap step — Basalt Monolith / Mana Vault / Meekstone / Smoke / Stasis / Paralyze (CR 502.1)",
        cards: [
            // Gap J showcase. Basalt Monolith and Mana Vault enter tapped and
            // demonstrate the per-permanent `does-not-untap` keyword: pass to
            // upkeep on the owner's next turn — neither artifact untaps from
            // the step. Mana Vault adds a may-pay {4} upkeep to untap and a
            // draw-step 1-damage ping if it's still tapped.
            //
            // Meekstone is also in play: the opponent's Sengir Vampire (4/4,
            // power ≥3) stays tapped after combat; Grizzly Bears (2/2) untap
            // normally. Smoke (Players can't untap more than one creature)
            // means the opponent only untaps one creature even if multiple
            // are tapped.
            //
            // Stasis is in hand for the user to cast and see "Players skip
            // their untap steps" + sacrifice-unless-{U} upkeep tax. Paralyze
            // (in hand) targets the opposing Vampire to tap it + grant
            // does-not-untap; their upkeep prompts pay {4} to untap.
            {
                name: "Basalt Monolith",
                owner: "me" as const,
                tapped: true,
            },
            { name: "Mana Vault", owner: "me" as const, tapped: true },
            { name: "Meekstone", owner: "me" as const },
            { name: "Smoke", owner: "me" as const },
            { name: "Stasis", owner: "me" as const, zone: "hand" as const },
            { name: "Paralyze", owner: "me" as const, zone: "hand" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                tapped: true,
            },
            {
                name: "Sengir Vampire",
                owner: "opp" as const,
                tapped: true,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Replacement effects (CR 614) — Lich / Personal Incarnation / Veteran Bodyguard / Library of Leng",
        cards: [
            // Lich on the battlefield: caster's life is 0, "don't lose game"
            // active, lifegain → draw, damage triggers sacrifice clause.
            // Personal Incarnation on the battlefield: redirects all damage
            // to its owner onto itself. Veteran Bodyguard: redirects from
            // unblocked attackers as long as untapped. Library of Leng:
            // discard → top of library.
            //
            // Mind Twist in hand to exercise discard replacement, Stream of
            // Life in hand to exercise lifegain → draw, Reverse Damage /
            // Jade Monolith / Simulacrum in hand to test the transient
            // redirection layer + the per-turn damage tally.
            { name: "Lich", owner: "me" as const },
            { name: "Personal Incarnation", owner: "me" as const },
            { name: "Veteran Bodyguard", owner: "me" as const },
            { name: "Library of Leng", owner: "me" as const },
            { name: "Jade Monolith", owner: "me" as const },
            {
                name: "Mind Twist",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Stream of Life",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Reverse Damage",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Simulacrum",
                owner: "me" as const,
                zone: "hand" as const,
            },
            // Some sacrificial fodder for Lich's damage trigger.
            { name: "Grizzly Bears", owner: "me" as const, count: 3 },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Swamp", owner: "me" as const, count: 4 },
            { name: "Forest", owner: "me" as const, count: 4 },
            // Opp side: a couple of attackers to test redirection in combat.
            { name: "Shivan Dragon", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Reanimation — Resurrection / Animate Dead (CR 400.7, CR 303.4i)",
        cards: [
            // Resurrection in hand ({2}{W}) — target your own dead Sengir
            // Vampire to bring it back to your battlefield at full P/T.
            //
            // Animate Dead in hand ({1}{B}) — target opp's dead Shivan Dragon
            // to reanimate it UNDER YOUR CONTROL with -1/-0 (CR 303.4i). The
            // aura attaches to the reanimated dragon; destroying the aura
            // later fires the LTB-trigger and sacrifices the dragon (CR
            // 603.10 last-known-info via attachedToBeforeLeave).
            //
            // Use the Debug panel to destroy the aura after reanimation to
            // see the LTB-trigger sacrifice in action.
            {
                name: "Resurrection",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Animate Dead",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Sengir Vampire",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Shivan Dragon",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
            { name: "Plains", owner: "me" as const, count: 3 },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Upkeep pay-or-else — Phantasmal Forces / Force of Nature / Wanderlust (CR 603.6a, 117.3a)",
        cards: [
            // Phantasmal Forces on battlefield ({3}{U}, 4/1 flying) — at start
            // of each your upkeep, may-pay {U} else sacrifice itself.
            //
            // Force of Nature on battlefield ({2}{G}{G}{G}{G}, 8/8 trample) —
            // at start of each your upkeep, may-pay {G}{G}{G}{G} else takes
            // 8 damage from itself (you lose 8 life).
            //
            // Wanderlust in hand ({1}{G}{G} aura) — attach to either creature.
            // At controller's upkeep, the aura deals 1 damage to the host's
            // controller (you).
            //
            // Pass to upkeep to trigger all three may-pay prompts in
            // sequence. Decline to see the consequences chain.
            {
                name: "Phantasmal Forces",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Force of Nature",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Wanderlust",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 6 },
            { name: "Island", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Additional cost — Sacrifice ({B} instant, sac creature for B mana = MV)",
        cards: [
            // Sacrifice in hand ({B} instant). Cast it: the engine prompts
            // you to pick a creature to sacrifice (additional cost). After
            // sac, you gain B mana equal to that creature's MV. Use the
            // floating mana for another spell same turn.
            {
                name: "Sacrifice",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Shivan Dragon",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Layer 4 type-add — Animate Artifact + Mana Vault",
        cards: [
            // Animate Artifact in hand ({3}{U} aura). Cast on Mana Vault
            // (mv 1) — Mana Vault becomes a 1/1 artifact creature. Then
            // try to block / attack with it to see the type-add land in
            // the combat layer.
            {
                name: "Animate Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Mana Vault",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Island", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "MV-target — Spell Blast (counter spell with mv = X)",
        cards: [
            // Spell Blast in hand ({X}{U}) — chooses X at announcement,
            // then target a stack spell whose mana value equals X.
            //
            // Have Lightning Bolt and Braingeyser in hand to cast as targets.
            // Announce Bolt (mv 1) → respond with Spell Blast X=1: legal.
            // Try Spell Blast X=2 against Bolt: rejected by mvFilter.
            // Cast Braingeyser with X=4 (mv 6) → Spell Blast X=6 counters.
            {
                name: "Spell Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Braingeyser",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 8 },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Animate-land — Living Lands + Kormus Bell (lands become creatures)",
        cards: [
            {
                name: "Living Lands",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Kormus Bell",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Swamp", owner: "opp" as const, count: 3 },
            { name: "Island", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Subtype-set — Evil Presence + Conversion (land type change)",
        cards: [
            // Evil Presence in hand ({B} aura on land). Cast on opponent's
            // Mountain — it becomes a Swamp and produces {B} instead of {R}.
            // Conversion on battlefield — all Mountains become Plains.
            // After Conversion enters, tap a Mountain: {W}, not {R}.
            {
                name: "Evil Presence",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Conversion",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 3 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Activation timing (CR 602.5) — Instill Energy + Blessing",
        cards: [
            // Goblin King's grizzly partner here, attached by both auras.
            // Cast Instill Energy on the bear: it gains haste + {0} untap
            // once-per-turn restricted to controller's turn. Cast Blessing
            // on the same bear: {W} pumps +1/+1 EOT (unrestricted).
            //
            // Try activating Instill Energy's {0} twice — second activation
            // rejected. Pass priority to opp; their priority window doesn't
            // allow activating {0}. Pass turn — counter resets, can
            // re-activate next turn.
            {
                name: "Instill Energy",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Blessing",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Modal spells (CR 700.2) — Healing Salve / Blue & Red Elemental Blast",
        cards: [
            // Healing Salve in hand ({W}) — modal: gain 3 life OR prevent
            // next 3 damage to any target this turn.
            //
            // Blue Elemental Blast in hand ({U}) — modal: counter target red
            // spell OR destroy target red permanent.
            //
            // Red Elemental Blast in hand ({R}) — modal: counter target blue
            // spell OR destroy target blue permanent.
            //
            // Opp has Merfolk (blue) and Shivan Dragon (red) on the board for
            // the destroy modes; cast Lightning Bolt to test counter modes.
            {
                name: "Healing Salve",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Blue Elemental Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Red Elemental Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Shivan Dragon",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Merfolk of the Pearl Trident",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Cross-player choice — Demonic Hordes (opp picks your land to sacrifice)",
        cards: [
            // Demonic Hordes on battlefield ({3}{B}{B}, 5/5 Demon). Activated
            // {T}: destroy target land — target any land in play. Upkeep
            // trigger may-pay {B}{B}{B}; on decline: Hordes taps and your
            // OPPONENT (the viewer auto-switches in solo) picks one of YOUR
            // lands to sacrifice.
            //
            // Pass to upkeep, decline the {B}{B}{B}, and watch the choice
            // prompt route to the opp viewer with click-routing on YOUR
            // battlefield (controller's zone). Lands are filtered.
            {
                name: "Demonic Hordes",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 5 },
            { name: "Forest", owner: "me" as const, count: 1 },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Demonic Tutor — search your library, pick a card (CR 701.19)",
        cards: [
            // Cast Demonic Tutor ({1}{B}). It requests a `search-library`
            // choice (count=1): your library is exposed face-up in a grid so
            // each card is individually selectable. Click one (emerald ring),
            // press Done, and it goes to hand before the library shuffles.
            {
                name: "Demonic Tutor",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        // ~30-card library so the search grid shows many cards at once — the
        // exact case the old fan layout collapsed into one unselectable strip.
        libraryCount: 30,
    },
    {
        label: "Lord of the Pit — upkeep sacrifice-or-7dmg (CR 603.6a)",
        cards: [
            {
                name: "Lord of the Pit",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Ankh of Mishra + Dingus Egg — land ETB/LTB damage",
        cards: [
            {
                name: "Ankh of Mishra",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Dingus Egg",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Forest", owner: "opp" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, zone: "hand" as const },
            { name: "Stone Rain", owner: "me" as const, zone: "hand" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        label: "Fog — prevent all combat damage (CR 615)",
        cards: [
            { name: "Fog", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 0,
    },
    {
        label: "Terror — destroy nonartifact, nonblack creature (CR 701.7)",
        cards: [
            { name: "Terror", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Juggernaut", owner: "opp" as const },
            { name: "Black Knight", owner: "opp" as const },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Cleanup discard — CR 514.1 (with optional Library of Leng for the unlimited path)",
        cards: [
            // 9 cards in hand on END_STEP: passing priority cycles into
            // CLEANUP and prompts the active player to discard 2. Drop a
            // Library of Leng in (also in hand) to verify the "no maximum
            // hand size" clause suppresses the prompt entirely; cast it
            // first, then pass through end of turn.
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
                count: 3,
            },
            {
                name: "Giant Growth",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Healing Salve",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Dark Ritual",
                owner: "me" as const,
                zone: "hand" as const,
                count: 1,
            },
            {
                name: "Library of Leng",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 4 },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "END_STEP",
        landCount: 0,
    },
    {
        label: "Disrupting Scepter — {3},{T}: target player discards (CR 701.8)",
        cards: [
            { name: "Disrupting Scepter", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Pending choice deselect — Library of Leng cleanup discard 2 (ADR 0007)",
        cards: [
            // 9-card hand at END_STEP: passing priority enters CLEANUP and
            // enqueues a discard-hand pending choice with count 2. Exercises
            // the client-buffered Skip/Done flow (ADR 0007) — click two
            // cards, deselect one, pick a different one, click Done.
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
                count: 3,
            },
            {
                name: "Giant Growth",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Healing Salve",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Dark Ritual",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "END_STEP",
        landCount: 0,
    },
    {
        label: "Rock Hydra + Gauntlet — counters, replacement, mana bonus (W23)",
        cards: [
            { name: "Rock Hydra", owner: "me" as const },
            { name: "Gauntlet of Might", owner: "me" as const },
            {
                name: "Mons's Goblin Raiders",
                owner: "me" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 6 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Living Artifact — vitality counters + upkeep life (W23)",
        cards: [
            { name: "Sol Ring", owner: "me" as const },
            { name: "Living Artifact", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Orcish Oriflamme — attacking creatures you control get +1/+0 (CR 508.1)",
        cards: [
            { name: "Orcish Oriflamme", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Savannah Lions", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Time Vault — skip-turn ↔ extra-turn cycle (CR 614.10 + 500.7)",
        cards: [
            { name: "Time Vault", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, count: 2 },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Fastbond — multiple land drops + self-damage (W16)",
        cards: [
            { name: "Fastbond", owner: "me" as const },
            {
                name: "Forest",
                owner: "me" as const,
                zone: "hand" as const,
                count: 4,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Mana Short — tap lands + drain mana pool (CR 106.4)",
        cards: [
            {
                name: "Mana Short",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Forest", owner: "opp" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Drain Power — tap lands + steal mana (CR 106.4)",
        cards: [
            {
                name: "Drain Power",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Disintegrate — exile-on-death + regen blocked (W16)",
        cards: [
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Drudge Skeletons", owner: "opp" as const },
            {
                name: "Disintegrate",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Dragon Whelp — 4-activation sacrifice risk (W15)",
        cards: [
            { name: "Dragon Whelp", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 5 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Lure — force all blockers (CR 509.1c block-requirement)",
        cards: [
            {
                name: "Lure",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Natural Selection + Glasses of Urza (peek/reorder/reveal, CR 401.4)",
        cards: [
            {
                name: "Natural Selection",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const },
            {
                name: "Glasses of Urza",
                owner: "me" as const,
            },
            { name: "Grizzly Bears", owner: "opp" as const },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Counterspell",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 5,
    },
    {
        label: "Cockatrice + Thicket Basilisk (combat kill, CR 509.1h)",
        cards: [
            { name: "Cockatrice", owner: "me" as const },
            { name: "Thicket Basilisk", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 5 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
            { name: "Wall of Bone", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Mobile Touch Test — activated abilities + multi-action hand",
        cards: [
            { name: "Prodigal Sorcerer", owner: "me" as const },
            { name: "Royal Assassin", owner: "me" as const },
            { name: "Icy Manipulator", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const },
            { name: "Plains", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                tapped: true,
            },
            { name: "Sol Ring", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Lace cycle (color-change layer 5, CR 305.7)",
        cards: [
            { name: "Purelace", owner: "me" as const, zone: "hand" },
            { name: "Deathlace", owner: "me" as const, zone: "hand" },
            {
                name: "Llanowar Elves",
                owner: "opp" as const,
            },
            { name: "Lightning Bolt", owner: "opp" as const, zone: "hand" },
            { name: "Swamp", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
            { name: "White Knight", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        // Runtime-granted keyword in the live oracle text (#156, CR 702.13c).
        // Lord of Atlantis grants islandwalk to OTHER Merfolk via a layer-7c
        // static effect, so Merfolk of the Pearl Trident — a vanilla creature
        // with no native keywords — gains islandwalk on its instance. Hover /
        // long-press the Merfolk: its abilities panel shows "[+] Islandwalk"
        // in green. Remove the Lord (e.g. via a bounce) and it disappears.
        label: "Granted landwalk in oracle text (Lord of Atlantis → Merfolk)",
        cards: [
            { name: "Lord of Atlantis", owner: "me" as const },
            { name: "Merfolk of the Pearl Trident", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 3 },
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
    const [scenarioFilter, setScenarioFilter] = useState("");
    const [verbose, setVerbose] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState(false);
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

    const prevStateRef = useRef<typeof state>(undefined);
    useEffect(() => {
        if (!verbose || !state) return;
        const prev = prevStateRef.current;
        prevStateRef.current = state;
        if (!prev) {
            console.log("[GRE:verbose] initial state", state);
            return;
        }
        const delta: Record<string, unknown> = {};
        if (prev.phase !== state.phase)
            delta.phase = `${prev.phase} → ${state.phase}`;
        if (prev.turn !== state.turn)
            delta.turn = `${prev.turn} → ${state.turn}`;
        if (prev.activePlayerId !== state.activePlayerId)
            delta.activePlayer = state.activePlayerId;
        if (prev.priorityPlayerId !== state.priorityPlayerId)
            delta.priority = state.priorityPlayerId;
        if (
            JSON.stringify(prev.pendingChoices) !==
            JSON.stringify(state.pendingChoices)
        )
            delta.pendingChoices = state.pendingChoices;
        if (
            JSON.stringify(prev.pendingUntapStep) !==
            JSON.stringify(state.pendingUntapStep)
        )
            delta.pendingUntapStep = state.pendingUntapStep;
        if (JSON.stringify(prev.stack) !== JSON.stringify(state.stack))
            delta.stack = state.stack;
        if (Object.keys(delta).length > 0)
            console.log("[GRE:verbose] state changed", delta);
    }, [verbose, state]);
    const game = useQuery(
        api.game.getGame,
        isOpen && pageVisible ? { gameId } : "skip"
    );
    const resetGame = useMutation(api.game.debugResetGame);
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const user = useCurrentUser();

    const handleNewSolo = async () => {
        // Reuse the deck of the first player in the current game so the user
        // doesn't have to round-trip through the lobby just to restart.
        const sourceDeck = game?.players[0]?.deck;
        if (!sourceDeck) return;
        if (!user) return;
        const p1Id = `${user._id}-p1`;
        const newId = await createSoloGame({
            name: `${user.nickname}'s solo game`,
            deck: sourceDeck,
        });
        storeSession(newId, p1Id);
        onSwitchGame(newId, p1Id);
    };

    const handleNewVsAi = async () => {
        // One-click vs-AI game reusing the current first player's deck (ADR 0001,
        // issue #109). The human plays the `-p1` seat; the bot drives `-p2`.
        const sourceDeck = game?.players[0]?.deck;
        if (!sourceDeck) return;
        if (!user) return;
        const p1Id = `${user._id}-p1`;
        const newId = await createSoloGame({
            name: `${user.nickname} vs AI`,
            deck: sourceDeck,
            vsAi: true,
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
                                {game?.solo && !game?.vsAi
                                    ? "Restart Solo"
                                    : "New Solo Game"}
                            </DebugButton>
                            <DebugButton onClick={handleNewVsAi}>
                                {game?.vsAi
                                    ? "Restart vs AI"
                                    : "New vs-AI Game"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => {
                                    if (state) {
                                        navigator.clipboard.writeText(
                                            JSON.stringify(state, null, 2)
                                        );
                                        setCopyFeedback(true);
                                        setTimeout(
                                            () => setCopyFeedback(false),
                                            1500
                                        );
                                    }
                                }}
                            >
                                {copyFeedback ? "Copied!" : "Copy State"}
                            </DebugButton>
                            <DebugButton onClick={() => setVerbose((v) => !v)}>
                                {verbose ? "Verbose ON" : "Verbose"}
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
                                <input
                                    type="text"
                                    value={scenarioFilter}
                                    onChange={(e) =>
                                        setScenarioFilter(e.target.value)
                                    }
                                    placeholder="Search scenarios…"
                                    className="w-full px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40"
                                    autoFocus
                                />
                                <div className="max-h-62.5 overflow-y-auto flex flex-col gap-1">
                                    {PRESET_SCENARIOS.filter((s) =>
                                        s.label
                                            .toLowerCase()
                                            .includes(
                                                scenarioFilter.toLowerCase()
                                            )
                                    ).map((scenario) => (
                                        <DebugButton
                                            key={scenario.label}
                                            onClick={() =>
                                                setupScenario({
                                                    gameId,
                                                    cards: scenario.cards,
                                                    phase: scenario.phase,
                                                    landCount:
                                                        scenario.landCount,
                                                    libraryCount:
                                                        scenario.libraryCount,
                                                })
                                            }
                                        >
                                            {scenario.label}
                                        </DebugButton>
                                    ))}
                                </div>
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
