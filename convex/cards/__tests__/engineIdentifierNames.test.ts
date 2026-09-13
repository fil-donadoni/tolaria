// Catalogue-wide guard: NO CARD NAME MAY APPEAR IN AN ENGINE IDENTIFIER
// (issue #1918; the rule itself is issue #1917 and
// `.claude/rules/gre-development.md` § Naming).
//
// An engine identifier takes its name from the MECHANIC, never from the card
// that happened to introduce it — so the second card of the same class hooks
// onto it without renaming anything. `islandSanctuaryProtection` is a key the
// next "can only be attacked by creatures with flying" card cannot use without
// a sweep; `playerAttackRequirements` is one it can.
//
// The rule is worth a guard rather than a convention because it is
// MECHANICALLY VERIFIABLE: card names are enumerable (1819 `CardDefinition`s
// today), engine identifiers are enumerable, and the check is containment. The
// hand audit of 2026-07-29 was true for 2026-07-29 only.
//
// Sibling in form to `mechanicsRegistry.test.ts` (Guard A) /
// `divergenceMarkers.test.ts` (Guard B) / `drawPrimitiveGuard.test.ts`: a
// catalogue-wide sweep against a narrow allowlist whose every entry is
// asserted to still be load-bearing, so it empties out instead of rotting.
//
// SURFACES (issue #1918). Four declaration sites, five identifier sets:
//   1. `GameState` keys              — `convex/gre/state.ts`
//   2. `PlayerState` keys            — `convex/gre/state.ts`
//   3. `CardInstanceState` keys      — `convex/gre/state.ts`
//   4. Effect Script Op names        — `EFFECT_OP_REGISTRY` (runtime)
//   5. `SpellContext` members        — `convex/cards/types.ts`
// The three type surfaces are read from SOURCE through the TypeScript AST
// (`scripts/lib/identity-test-classifier.ts` precedent) rather than a runtime
// key list, because a type has no runtime keys and because the AST sees the
// REQUIRED members too — `PERSISTED_OPTIONAL_KEYS` is exhaustive over the
// OPTIONAL ones only. Those serialize tuples are still used, as a
// self-check that the AST extraction actually found `GameState` (below).
//
// DIRECTION OF CONTAINMENT: identifier ⊃ normalised card name, never the
// reverse. That is what keeps the Op `animate` from being flagged by the card
// "Animate Wall" while still flagging a hypothetical `animateWallCounter`.
//
// This file reads SOURCE TEXT under Node's `fs`/`path` (same as its sibling
// guards) — a `.test.ts` file is never bundled into the deployed Convex
// function set, so the V8-isolate "no Node builtins" rule does not apply.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { getAllCards } from "..";
import { EFFECT_OP_REGISTRY } from "../mechanicsRegistry";
import { PERSISTED_OPTIONAL_KEYS, TRANSIENT_KEYS } from "../../gre/serialize";

const STATE_TS = path.resolve("convex/gre/state.ts");
const TYPES_TS = path.resolve("convex/cards/types.ts");

/** Card name → comparison form: lowercase, non-alphanumerics dropped.
 *  "Island Sanctuary" → `islandsanctuary`, "Gaze of Pain" → `gazeofpain`. An
 *  identifier goes through the same funnel, so `gazeOfPainActiveThisTurn` →
 *  `gazeofpainactivethisturn` ⊃ `gazeofpain`. */
const normalise = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Minimum normalised card-name length considered. Measured against the
 *  current catalogue: at 4 the only new pairs are pure English substrings —
 *  "Bind" inside `recallCapturedBinding`/`captureBinding` and "Rout" inside
 *  `revealTopAndRoute` — and NO true positive appears below 5. Raising it
 *  further buys nothing (5, 6 and 7 differ only by the rules-vocabulary names
 *  exempted below) while losing real short card names. */
const MIN_NAME_LENGTH = 5;

/** Card names that are ALSO ordinary rules vocabulary: a keyword ability, a
 *  keyword action, a basic land type or a plain English verb the engine is
 *  entitled to use. Dropped from the corpus entirely — one row per word with
 *  the vocabulary it collides with, not one row per (surface, identifier)
 *  pair, because the collision is a property of the WORD.
 *
 *  The cost is known and accepted: an identifier genuinely named after the
 *  card "Flash" would not be caught. A name only belongs here when the engine
 *  would use the word with no card in existence. */
const RULES_VOCABULARY_NAMES: ReadonlyArray<{
    readonly card: string;
    readonly vocabulary: string;
}> = [
    { card: "Island", vocabulary: "basic land type (CR 205.3i)" },
    { card: "Forest", vocabulary: "basic land type (CR 205.3i)" },
    { card: "Mountain", vocabulary: "basic land type (CR 205.3i)" },
    { card: "Plains", vocabulary: "basic land type (CR 205.3i)" },
    { card: "Swamp", vocabulary: "basic land type (CR 205.3i)" },
    {
        card: "Flash",
        vocabulary:
            "keyword ability flash (CR 702.8), and flashback (CR 702.34)",
    },
    { card: "Overload", vocabulary: "keyword ability overload (CR 702.96)" },
    {
        card: "Regeneration",
        vocabulary: "keyword action regenerate (CR 701.15)",
    },
    { card: "Sacrifice", vocabulary: "keyword action sacrifice (CR 701.17)" },
    {
        card: "Blessing",
        vocabulary: "the city's blessing, granted by ascend (CR 702.131)",
    },
    {
        card: "Recall",
        vocabulary:
            "plain English verb — `recallCapturedBinding` recalls a binding, not the card",
    },
];

/** Per-(surface, identifier, card) exemption for an identifier that IS named
 *  after its card and has not been renamed yet. Every row carries the open
 *  tracking issue that renames it; the well-formedness test below fails on a
 *  row that no longer matches anything, so this list can only shrink. It is
 *  pre-populated deliberately: landing the guard BEFORE the rename sweep
 *  (issue #1917) is what makes it impossible for that sweep to stop halfway. */
const ALLOWLIST: ReadonlyArray<{
    readonly surface: string;
    readonly identifier: string;
    readonly card: string;
    readonly issue: number;
}> = [
    {
        surface: "GameState key",
        identifier: "camouflageCombat",
        card: "Camouflage",
        issue: 1917,
    },
    {
        surface: "GameState key",
        identifier: "meleeCombat",
        card: "Melee",
        issue: 1917,
    },
    {
        surface: "GameState key",
        identifier: "islandSanctuaryProtection",
        card: "Island Sanctuary",
        issue: 1917,
    },
    {
        surface: "GameState key",
        identifier: "gazeOfPainActiveThisTurn",
        card: "Gaze of Pain",
        issue: 1917,
    },
    {
        surface: "GameState key",
        identifier: "highTideThisTurn",
        card: "High Tide",
        issue: 1917,
    },
    {
        surface: "Op",
        identifier: "setIslandSanctuaryProtection",
        card: "Island Sanctuary",
        issue: 1917,
    },
    {
        surface: "SpellContext member",
        identifier: "setIslandSanctuaryProtection",
        card: "Island Sanctuary",
        issue: 1917,
    },
    {
        surface: "SpellContext member",
        identifier: "markGazeOfPainActive",
        card: "Gaze of Pain",
        issue: 1917,
    },
    {
        surface: "SpellContext member",
        identifier: "applyCamouflagePileBlocks",
        card: "Camouflage",
        issue: 1917,
    },
    {
        surface: "SpellContext member",
        identifier: "addHighTide",
        card: "High Tide",
        issue: 1917,
    },
];

/** Top-level member names of an `interface X {}` / `type X = {}` declaration,
 *  read from source through the TypeScript AST. Nested object types are NOT
 *  descended into — a nested member is not an addressable engine identifier
 *  on this surface, and a brace counter would mis-read the block comments
 *  these declarations are full of. */
function declarationMemberNames(file: string, declName: string): string[] {
    const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false
    );
    const names: string[] = [];
    for (const stmt of source.statements) {
        let members: ts.NodeArray<ts.TypeElement> | undefined;
        if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === declName) {
            members = stmt.members;
        } else if (
            ts.isTypeAliasDeclaration(stmt) &&
            stmt.name.text === declName &&
            ts.isTypeLiteralNode(stmt.type)
        ) {
            members = stmt.type.members;
        }
        if (!members) continue;
        for (const member of members) {
            const name = member.name;
            if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
                names.push(name.text);
            }
        }
    }
    if (names.length === 0) {
        throw new Error(
            `no members extracted for \`${declName}\` in ${file} — the declaration moved or ` +
                `changed shape, and this guard would otherwise pass vacuously`
        );
    }
    return names;
}

const GAME_STATE_KEYS = declarationMemberNames(STATE_TS, "GameState");
const PLAYER_STATE_KEYS = declarationMemberNames(STATE_TS, "PlayerState");
const CARD_INSTANCE_KEYS = declarationMemberNames(
    STATE_TS,
    "CardInstanceState"
);
const SPELL_CONTEXT_MEMBERS = declarationMemberNames(TYPES_TS, "SpellContext");
const OP_NAMES = EFFECT_OP_REGISTRY.map((row) => row.op);

const SURFACES: ReadonlyArray<{
    readonly label: string;
    readonly identifiers: readonly string[];
}> = [
    { label: "GameState key", identifiers: GAME_STATE_KEYS },
    { label: "PlayerState key", identifiers: PLAYER_STATE_KEYS },
    { label: "CardInstanceState key", identifiers: CARD_INSTANCE_KEYS },
    { label: "Op", identifiers: OP_NAMES },
    { label: "SpellContext member", identifiers: SPELL_CONTEXT_MEMBERS },
];

type Offence = {
    readonly surface: string;
    readonly identifier: string;
    readonly card: string;
};

/** Every (surface, identifier, card) triple where the identifier CONTAINS the
 *  normalised card name. Pure — the synthetic test below drives it with a
 *  hand-built corpus, which is what proves the guard can go red at all. */
function findOffences(
    surfaces: ReadonlyArray<{ label: string; identifiers: readonly string[] }>,
    cardNames: readonly string[]
): Offence[] {
    const exempt = new Set(
        RULES_VOCABULARY_NAMES.map((row) => normalise(row.card))
    );
    const needles = cardNames
        .map((name) => ({ name, normalised: normalise(name) }))
        .filter(
            (n) =>
                n.normalised.length >= MIN_NAME_LENGTH &&
                !exempt.has(n.normalised)
        );

    const offences: Offence[] = [];
    const seen = new Set<string>();
    for (const surface of surfaces) {
        for (const identifier of surface.identifiers) {
            const haystack = normalise(identifier);
            for (const needle of needles) {
                if (!haystack.includes(needle.normalised)) continue;
                const key = `${surface.label}|${identifier}|${needle.name}`;
                if (seen.has(key)) continue;
                seen.add(key);
                offences.push({
                    surface: surface.label,
                    identifier,
                    card: needle.name,
                });
            }
        }
    }
    return offences;
}

const isAllowed = (o: Offence): boolean =>
    ALLOWLIST.some(
        (a) =>
            a.surface === o.surface &&
            a.identifier === o.identifier &&
            a.card === o.card
    );

const describeOffence = (o: Offence): string =>
    `${o.surface} \`${o.identifier}\` contains the card name "${o.card}"`;

describe("No card name in an engine identifier (issue #1918)", () => {
    it("the AST extraction really found GameState — every serialized optional key is a member", () => {
        // Anti-vacuity: if `declarationMemberNames` ever matched the wrong
        // declaration, the sweep below would pass while scanning nothing
        // useful. `PERSISTED_OPTIONAL_KEYS` + `TRANSIENT_KEYS` are exhaustive
        // over GameState's optional keys by construction (serialize.ts's own
        // drift guard), so they must all appear in the extracted member list.
        const extracted = new Set(GAME_STATE_KEYS);
        const missing = [
            ...(PERSISTED_OPTIONAL_KEYS as readonly string[]),
            ...TRANSIENT_KEYS,
        ].filter((key) => !extracted.has(key));
        expect(
            missing,
            "GameState keys named by serialize.ts that the AST extraction did not see — " +
                "`declarationMemberNames` is reading the wrong declaration"
        ).toEqual([]);
    });

    it("flags a synthetic offender (proof the guard can fail)", () => {
        const offences = findOffences(
            [
                {
                    label: "GameState key",
                    identifiers: ["hiddenHorrorFlag", "turn"],
                },
            ],
            ["Hidden Horror", "Shock"]
        );
        expect(offences.map(describeOffence)).toEqual([
            'GameState key `hiddenHorrorFlag` contains the card name "Hidden Horror"',
        ]);
    });

    it("does not flag a card name that merely CONTAINS an identifier", () => {
        // Direction check: the Op `animate` must survive the card "Animate
        // Wall". Containment runs identifier ⊃ card name, never the reverse.
        expect(
            findOffences(
                [{ label: "Op", identifiers: ["animate"] }],
                ["Animate Wall"]
            )
        ).toEqual([]);
    });

    it("no engine identifier contains a card name", () => {
        const cardNames = getAllCards().map((card) => card.name);
        expect(cardNames.length).toBeGreaterThan(1000);

        const offenders = findOffences(SURFACES, cardNames)
            .filter((o) => !isAllowed(o))
            .map(describeOffence)
            .sort();

        expect(
            offenders,
            "an engine identifier is named after the card that introduced it — rename it after " +
                "the MECHANIC (the generic NAME comes from card #1; the generic SHAPE waits for " +
                "card #2 to show the axis of variation). A genuine collision with rules " +
                "vocabulary goes in RULES_VOCABULARY_NAMES; a rename that has not happened yet " +
                "goes in ALLOWLIST with its tracking issue."
        ).toEqual([]);
    });

    it("every ALLOWLIST entry is still load-bearing (the list can only shrink)", () => {
        const cardNames = getAllCards().map((card) => card.name);
        const live = new Set(
            findOffences(SURFACES, cardNames).map(
                (o) => `${o.surface}|${o.identifier}|${o.card}`
            )
        );
        const stale = ALLOWLIST.filter(
            (a) => !live.has(`${a.surface}|${a.identifier}|${a.card}`)
        ).map(
            (a) =>
                `${a.surface} \`${a.identifier}\` / "${a.card}" (issue #${a.issue})`
        );
        expect(
            stale,
            "ALLOWLIST entries that match nothing — the rename landed, so delete the row"
        ).toEqual([]);
        for (const a of ALLOWLIST) {
            expect(
                a.issue,
                `${a.identifier}/"${a.card}" needs a real tracking issue number`
            ).toBeGreaterThan(0);
        }
    });

    it("every RULES_VOCABULARY_NAMES entry names a real card", () => {
        const cardNames = new Set(getAllCards().map((card) => card.name));
        const unknown = RULES_VOCABULARY_NAMES.filter(
            (row) => !cardNames.has(row.card)
        ).map((row) => row.card);
        expect(
            unknown,
            "RULES_VOCABULARY_NAMES rows for names that are not in the catalogue — the row " +
                "exempts nothing and should go"
        ).toEqual([]);
    });
});
