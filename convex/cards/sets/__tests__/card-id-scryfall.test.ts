// Regression guard for the new-card pipeline.
//
// A CardDefinition's `id` is NOT a freshly generated UUID — it is the card's
// `identifiers.scryfallId` from the set's MTGJSON file (`data/json/<SET>.json`).
// That id is what maps a card to its art and resolves it in the registry, so an
// invented UUID silently breaks the image and any scryfall-keyed lookup.
//
// Historically the `/new-card` skill told the author to `crypto.randomUUID()`,
// which produced a handful of bogus ids (Aladdin's Lamp in arn, Ornithopter and
// Yotian Soldier in atq). This test fails the gate the moment a card id is not a
// real Scryfall id from its set JSON — see `.claude/skills/new-card/skill.md`.
//
// Only sets that ship a MTGJSON file under `data/json/` are guarded. `leb`
// (Beta) has no JSON in-repo and is intentionally skipped.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { CardDefinition } from "../../types";
import * as lea from "../lea";
import * as arn from "../arn";
import * as atq from "../atq";

const here = dirname(fileURLToPath(import.meta.url));
const jsonDir = join(here, "../../../../data/json");

interface MtgJsonCard {
    identifiers?: { scryfallId?: string };
}

function scryfallIds(setCode: string): Set<string> {
    const raw = readFileSync(
        join(jsonDir, `${setCode.toUpperCase()}.json`),
        "utf8"
    );
    const parsed = JSON.parse(raw) as { data: { cards: MtgJsonCard[] } };
    return new Set(
        parsed.data.cards
            .map((c) => c.identifiers?.scryfallId)
            .filter((id): id is string => typeof id === "string")
    );
}

function isCardDefinition(value: unknown): value is CardDefinition {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "name" in value &&
        "types" in value
    );
}

function definitions(mod: Record<string, unknown>): CardDefinition[] {
    return Object.values(mod).filter(isCardDefinition);
}

const GUARDED_SETS: { code: string; mod: Record<string, unknown> }[] = [
    { code: "lea", mod: lea },
    { code: "arn", mod: arn },
    { code: "atq", mod: atq },
];

describe("card id == identifiers.scryfallId from set MTGJSON", () => {
    for (const { code, mod } of GUARDED_SETS) {
        it(`${code}: every CardDefinition id is a real Scryfall id`, () => {
            const ids = scryfallIds(code);
            const offenders = definitions(mod)
                .filter((card) => !ids.has(card.id))
                .map((card) => `${card.name} (${card.id})`);
            expect(offenders).toEqual([]);
        });
    }
});
