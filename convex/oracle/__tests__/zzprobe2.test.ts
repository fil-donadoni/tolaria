import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";
it("p", () => {
    const out: any = compileCard(
        oracleCard({
            name: "Jackal Pup",
            manaCost: "{R}",
            typeLine: "Creature — Jackal",
            oracleText:
                "Whenever this creature is dealt damage, it deals that much damage to you.",
            power: "2",
            toughness: "1",
            oracleId: "3707ab74-9aec-4d30-86e0-ffa5f72d5b4f",
        })
    );
    writeFileSync(process.env.OUT!, JSON.stringify(out.definition, null, 4));
});
