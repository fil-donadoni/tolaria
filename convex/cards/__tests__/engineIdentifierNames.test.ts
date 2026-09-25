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
// MECHANICALLY VERIFIABLE: card names are enumerable, engine identifiers are
// enumerable, and the check is containment. The hand audit of 2026-07-29 was
// true for 2026-07-29 only.
//
// Sibling in form to `mechanicsRegistry.test.ts` (Guard A) /
// `divergenceMarkers.test.ts` (Guard B) / `drawPrimitiveGuard.test.ts`: a
// catalogue-wide sweep against a narrow allowlist whose every entry is
// asserted to still be load-bearing, so it empties out instead of rotting.
//
// SURFACES. EVERY top-level `interface`/`type` declaration in the type
// files — `convex/gre/state/declarations.ts` (where `gre/state.ts`'s
// declarations live since issue #4449; the core itself is still swept for the
// few value-derived types it keeps) and `convex/cards/types.ts` — plus the Op
// names in `EFFECT_OP_REGISTRY`. Issue #1918 named four declarations
// (`GameState`, `PlayerState`, `CardInstanceState`, `SpellContext`); a
// hand-listed set turned out to be a blind spot with no tell, since
// `PlayerPreferences` and `TriggerStateView` are separate declarations reached
// THROUGH those four, and both hold a live violation. Sweeping the files is
// the same work and closes the class.
//
// The type surfaces are read from SOURCE through the TypeScript AST
// (`scripts/lib/identity-test-classifier.ts` precedent) rather than a runtime
// key list, because a type has no runtime keys and because the AST sees the
// REQUIRED members too — `PERSISTED_OPTIONAL_KEYS` is exhaustive over the
// OPTIONAL ones only. Those serialize tuples are still used, as a
// self-check that the AST extraction actually found `GameState` (below).
//
// SCOPE LIMIT, stated rather than hidden: an ANONYMOUS inline shape is not a
// declaration and is not swept — `types.ts`'s
// `preferences?: { libraryOfLengRouting?: … }` is invisible here while the
// `PlayerPreferences` member it mirrors is caught. A rename sweep greps the
// old name, so the mirror travels with the original; what the guard promises
// is that the original cannot be missed.
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
const STATE_DECLARATIONS_TS = path.resolve("convex/gre/state/declarations.ts");
const TYPES_TS = path.resolve("convex/cards/types.ts");

/** Card name → comparison form: lowercase, non-alphanumerics dropped.
 *  "Island Sanctuary" → `islandsanctuary`, "Gaze of Pain" → `gazeofpain`. An
 *  identifier goes through the same funnel, so `gazeOfPainActiveThisTurn` →
 *  `gazeofpainactivethisturn` ⊃ `gazeofpain`. */
const normalise = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Minimum normalised card-name length considered. **5 is a floor, not a free
 *  choice**: raising it to 6 loses a real offender, `GameState.meleeCombat` ←
 *  the card "Melee" (5 normalised characters). Lowering it to 4 adds six pairs
 *  and all six are English substrings — "Bind" inside `captureBinding`,
 *  `recallCapturedBinding` (Op and `SpellContext`) and
 *  `CardInstanceState.capturedBindings`, "Rout" inside `revealTopAndRoute` —
 *  with no true positive among them. Both figures measured against the current
 *  catalogue. */
const MIN_NAME_LENGTH = 5;

/** Card names that are ALSO ordinary rules vocabulary: a keyword ability, a
 *  keyword action, a basic land type or a plain English verb the engine is
 *  entitled to use. Dropped from the corpus entirely — one row per word with
 *  the vocabulary it collides with, not one row per (surface, identifier)
 *  pair, because the collision is a property of the WORD.
 *
 *  This is the FAIL-OPEN list, so it is the one to keep honest: the cost of a
 *  row is that an identifier genuinely named after the card "Flash" would not
 *  be caught, forever, with no tell. A name belongs here only when the engine
 *  would use the word with no such card in existence, and the test below
 *  additionally deletes any row that suppresses nothing today. */
const RULES_VOCABULARY_NAMES: ReadonlyArray<{
    readonly card: string;
    readonly vocabulary: string;
}> = [
    { card: "Island", vocabulary: "basic land type (CR 205.3i)" },
    {
        card: "Flash",
        vocabulary:
            "keyword ability flash (CR 702.8), and flashback (CR 702.34)",
    },
    { card: "Overload", vocabulary: "keyword ability overload (CR 702.96)" },
    {
        card: "Regeneration",
        vocabulary: "keyword action regenerate (CR 701.19)",
    },
    { card: "Sacrifice", vocabulary: "keyword action sacrifice (CR 701.21)" },
    {
        card: "Blessing",
        vocabulary: "the city's blessing, granted by ascend (CR 702.131)",
    },
    {
        card: "Exclude",
        vocabulary:
            "plain English verb — the excludeTypes / excludeColors / excludeSource filter family",
    },
    {
        card: "Recall",
        vocabulary:
            "plain English verb — `recallCapturedBinding` recalls a binding, not the card",
    },
    {
        card: "Suppress",
        vocabulary:
            'plain English verb — `abilitiesSuppressedBy` / `suppressDamagePrevention` predate the card (issue #3812) and name ability removal and "can\'t be prevented", not it',
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
        surface: "GameState",
        identifier: "camouflageCombat",
        card: "Camouflage",
        issue: 1917,
    },
    {
        surface: "GameState",
        identifier: "meleeCombat",
        card: "Melee",
        issue: 1917,
    },
    {
        surface: "GameState",
        identifier: "islandSanctuaryProtection",
        card: "Island Sanctuary",
        issue: 1917,
    },
    {
        surface: "GameState",
        identifier: "gazeOfPainActiveThisTurn",
        card: "Gaze of Pain",
        issue: 1917,
    },
    {
        surface: "GameState",
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
        surface: "SpellContext",
        identifier: "setIslandSanctuaryProtection",
        card: "Island Sanctuary",
        issue: 1917,
    },
    {
        surface: "SpellContext",
        identifier: "markGazeOfPainActive",
        card: "Gaze of Pain",
        issue: 1917,
    },
    {
        surface: "SpellContext",
        identifier: "applyCamouflagePileBlocks",
        card: "Camouflage",
        issue: 1917,
    },
    {
        surface: "SpellContext",
        identifier: "addHighTide",
        card: "High Tide",
        issue: 1917,
    },
    {
        surface: "TriggerStateView",
        identifier: "gazeOfPainActiveThisTurn",
        card: "Gaze of Pain",
        issue: 1917,
    },
    {
        surface: "PlayerPreferences",
        identifier: "libraryOfLengRouting",
        card: "Library of Leng",
        issue: 1917,
    },
];

/** EVERY top-level `interface X {}` / `type X = {…}` declaration in a source
 *  file, as `{ label: "X", identifiers: [...] }` — one surface per
 *  declaration, so the offender message names the type you have to edit.
 *
 *  Deliberately the WHOLE file rather than a hand-listed set of type names.
 *  A hand-listed set is a blind spot with no tell: `GameState.playerPreferences`
 *  is a persisted key, but `PlayerPreferences` is its own declaration, so a
 *  four-name list scanned the container and missed
 *  `PlayerPreferences.libraryOfLengRouting` — a live violation that postdates
 *  the 2026-07-29 hand audit, i.e. exactly the drift this guard exists to
 *  catch. The client-facing mirrors (`TriggerStateView`,
 *  `ReplacementStateView`) are the same story. Sweeping the file closes the
 *  class instead of the two instances.
 *
 *  Nested object types are still NOT descended into: a nested member's
 *  enclosing type is itself a declaration here whenever it is one the engine
 *  addresses by name, and an anonymous inline shape is not an addressable
 *  identifier surface. */
function declarationSurfaces(
    file: string
): Array<{ label: string; identifiers: string[] }> {
    const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false
    );
    const surfaces: Array<{ label: string; identifiers: string[] }> = [];
    for (const stmt of source.statements) {
        let members: ts.NodeArray<ts.TypeElement> | undefined;
        let label: string | undefined;
        if (ts.isInterfaceDeclaration(stmt)) {
            // `extends` needs no special handling: an interface's OWN members
            // are `stmt.members` regardless, and a base declared in either
            // scanned file is swept as its own surface. Only a base declared
            // in a third file escapes — a scope limit of "these two files",
            // not a hole in the walk.
            label = stmt.name.text;
            members = stmt.members;
        } else if (
            ts.isTypeAliasDeclaration(stmt) &&
            ts.isTypeLiteralNode(stmt.type)
        ) {
            label = stmt.name.text;
            members = stmt.type.members;
        }
        if (!members || !label) continue;
        const identifiers: string[] = [];
        for (const member of members) {
            const name = member.name;
            if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
                identifiers.push(name.text);
            }
        }
        if (identifiers.length > 0) surfaces.push({ label, identifiers });
    }
    return surfaces;
}

const OP_NAMES = EFFECT_OP_REGISTRY.map((row) => row.op);

const SURFACES: ReadonlyArray<{
    readonly label: string;
    readonly identifiers: readonly string[];
}> = [
    ...declarationSurfaces(STATE_DECLARATIONS_TS),
    ...declarationSurfaces(STATE_TS),
    ...declarationSurfaces(TYPES_TS),
    { label: "Op", identifiers: OP_NAMES },
];

/** Measured floors, per file, for the anti-vacuity check below. A refactor
 *  that reshapes a declaration into something the AST walk cannot read (a
 *  mapped type, an intersection, a namespace) shrinks the scanned surface with
 *  NO test failing — the guard just stops looking. These floors are what turns
 *  that into a red. Raise them when the files grow; never lower one to make a
 *  refactor pass without re-checking what stopped being scanned. */
const MEMBER_FLOORS: ReadonlyArray<{ file: string; members: number }> = [
    { file: STATE_DECLARATIONS_TS, members: 500 },
    { file: TYPES_TS, members: 1150 },
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
    cardNames: readonly string[],
    /** Names to leave IN the corpus even though RULES_VOCABULARY_NAMES exempts
     *  them — how the load-bearing test below asks "what does this row
     *  actually suppress?". */
    ignoreVocabularyFor: readonly string[] = []
): Offence[] {
    const reinstated = new Set(ignoreVocabularyFor.map(normalise));
    const exempt = new Set(
        RULES_VOCABULARY_NAMES.map((row) => normalise(row.card)).filter(
            (name) => !reinstated.has(name)
        )
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
        // Anti-vacuity, part 1. If the AST walk ever stopped seeing the
        // `GameState` declaration, the sweep below would pass while scanning
        // nothing useful. `PERSISTED_OPTIONAL_KEYS` + `TRANSIENT_KEYS` are
        // exhaustive over GameState's optional keys by construction
        // (serialize.ts's own drift guard), so they must all appear.
        const gameState = SURFACES.find((s) => s.label === "GameState");
        expect(gameState, "no `GameState` surface was extracted").toBeDefined();
        const extracted = new Set(gameState!.identifiers);
        const missing = [
            ...(PERSISTED_OPTIONAL_KEYS as readonly string[]),
            ...TRANSIENT_KEYS,
        ].filter((key) => !extracted.has(key));
        expect(
            missing,
            "GameState keys named by serialize.ts that the AST extraction did not see — " +
                "`declarationSurfaces` is reading the wrong declaration"
        ).toEqual([]);
    });

    it("each scanned file still yields its floor of members", () => {
        // Anti-vacuity, part 2. `GameState` has a cross-check; the other ~200
        // declarations have none, so a reshape that the AST walk cannot read
        // (a mapped type, an intersection, a namespace, a split interface)
        // would silently shrink the surface with no test failing. The floors
        // are what makes that shrinkage a red.
        for (const floor of MEMBER_FLOORS) {
            const total = declarationSurfaces(floor.file).reduce(
                (n, s) => n + s.identifiers.length,
                0
            );
            expect(
                total,
                `${path.basename(floor.file)} yields ${total} scanned members, below the ` +
                    `measured floor of ${floor.members} — a declaration stopped being readable ` +
                    `by the AST walk and is no longer swept`
            ).toBeGreaterThanOrEqual(floor.members);
        }
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

    it("every RULES_VOCABULARY_NAMES entry names a real card AND suppresses something", () => {
        // The mirror of the ALLOWLIST staleness test, and the more important
        // of the two: this is the FAIL-OPEN list. A speculative row here
        // widens the blind spot across every surface, forever, with no tell.
        // So a row earns its place twice — the name must be a real card (or it
        // exempts nothing at all), and dropping it must actually change a
        // verdict (or it is a guess about a collision that never happened).
        const cardNames = getAllCards().map((card) => card.name);
        const known = new Set(cardNames);
        const unknown = RULES_VOCABULARY_NAMES.filter(
            (row) => !known.has(row.card)
        ).map((row) => row.card);
        expect(
            unknown,
            "RULES_VOCABULARY_NAMES rows for names that are not in the catalogue — the row " +
                "exempts nothing and should go"
        ).toEqual([]);

        const idle = RULES_VOCABULARY_NAMES.filter((row) => {
            const withoutRow = findOffences(SURFACES, cardNames, [row.card]);
            return !withoutRow.some((o) => o.card === row.card);
        }).map((row) => row.card);
        expect(
            idle,
            "RULES_VOCABULARY_NAMES rows that suppress nothing — delete them; re-add a row the " +
                "day the collision actually fires, with the identifier that fired it"
        ).toEqual([]);
    });
});
