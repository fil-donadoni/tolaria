import { compileCard } from "./convex/oracle/compile";
const cards = [
    {
        oracleId: "a8b93d4d-bb67-4063-ac6d-7775be1b1f10",
        name: "Captain's Maneuver",
        manaCost: "{X}{R}{W}",
        typeLine: "Instant",
        oracleText:
            "The next X damage that would be dealt to target creature, planeswalker, or player this turn is dealt to another target creature, planeswalker, or player instead.",
    },
    {
        oracleId: "924bf3bb-9f06-4a2c-a17f-3fe11551bcf2",
        name: "Divine Light",
        manaCost: "{W}",
        typeLine: "Sorcery",
        oracleText:
            "Prevent all damage that would be dealt this turn to creatures you control.",
    },
];
for (const c of cards) {
    const out = compileCard(c as any);
    console.log("===", c.name, out.state);
    console.log(JSON.stringify(out, null, 1).slice(0, 1600));
}
