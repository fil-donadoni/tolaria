import { it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const cards: [string, string, string, string, string, string][] = [
    [
        "Jackal Pup",
        "{R}",
        "Creature — Jackal",
        "Whenever this creature is dealt damage, it deals that much damage to you.",
        "2",
        "1",
    ],
    [
        "Phyrexian Negator",
        "{1}{B}{B}",
        "Creature — Horror",
        "Trample\nWhenever this creature is dealt damage, sacrifice that many permanents.",
        "5",
        "5",
    ],
    [
        "Goblin Lackey",
        "{R}",
        "Creature — Goblin",
        "Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto the battlefield.",
        "1",
        "1",
    ],
    [
        "Goblin Vandal",
        "{1}{R}",
        "Creature — Goblin",
        "Whenever this creature attacks and isn't blocked, you may pay {R}. If you do, destroy target artifact defending player controls and this creature assigns no combat damage this turn.",
        "2",
        "2",
    ],
    [
        "Murk Dwellers",
        "{3}{B}",
        "Creature — Zombie",
        "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.",
        "2",
        "2",
    ],
    [
        "Spectral Bears",
        "{1}{G}",
        "Creature — Bear Spirit",
        "Whenever this creature attacks, if defending player controls no black nontoken permanents, it doesn't untap during your next untap step.",
        "3",
        "3",
    ],
    [
        "Dragon Breath",
        "{1}{R}",
        "Enchantment — Aura",
        "Enchant creature\nEnchanted creature has haste.\nWhen a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield attached to that creature.",
        "",
        "",
    ],
    [
        "Phyrexian Devourer",
        "{6}",
        "Artifact Creature — Phyrexian Construct",
        "When this creature's power is 7 or greater, sacrifice it.\nWhenever you exile a card with this creature, put X +1/+1 counters on it, where X is the exiled card's mana value.",
        "1",
        "1",
    ],
];
it("probe", () => {
    for (const [
        name,
        manaCost,
        typeLine,
        oracleText,
        power,
        toughness,
    ] of cards) {
        const out = compileCard(
            oracleCard({
                name,
                manaCost,
                typeLine,
                oracleText,
                power: power || undefined,
                toughness: toughness || undefined,
            })
        );
        console.log(
            "PROBE",
            name,
            out.state,
            JSON.stringify(
                out.state === "unparsed"
                    ? out.gaps
                    : ((out as any).reason ??
                          JSON.stringify((out as any).reasons)),
                null,
                0
            )
        );
    }
});
