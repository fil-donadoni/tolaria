// Devastation Tide, exactly as the compiler emits it: the miracle timing proofs
// run on the compiled card, not a lookalike.
//
// Not a `describe` file — vitest's include glob is `*.test.ts`, so this is a
// plain module the test files import.

import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import type { OracleCard } from "../types";

const DEVASTATION_TIDE: OracleCard = {
    oracleId: "4245ee98-2d4c-49d1-8d07-80760cae2bf9",
    name: "Devastation Tide",
    manaCost: "{3}{U}{U}",
    typeLine: "Sorcery",
    oracleText:
        "Return all nonland permanents to their owners' hands.\nMiracle {1}{U} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)",
    layout: "normal",
};

export function compiledDevastationTide(): CardDefinition {
    const outcome = compileCard(DEVASTATION_TIDE);
    if (outcome.state === "unparsed")
        throw new Error(
            `Devastation Tide unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition as unknown as CardDefinition;
}
