// Mechanics Registry guard tests (ADR 0045/0046, CR 701 keyword actions +
// CR 702 keyword abilities, issue #797). Prior art: the schema drift guard
// in convex/gre/__tests__/serialize.test.ts (single-authority list vs. live
// data) and scripts/check-card-index.ts (registry-wide consistency guard).
//
// This suite is the single CI authority on mechanic names: any card in the
// catalogue that declares a `staticAbilities` string not covered by the
// registry fails here, and the registry itself is guarded against duplicate
// or ambiguous ids/bindings.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getAllCards } from "../index";
import {
    MECHANICS_REGISTRY,
    ENGINE_INTERNAL_MARKERS,
    EFFECT_OP_REGISTRY,
    EFFECT_OP_BACKLOG,
    isRegisteredEffectOp,
    isNamedMechanic,
    EVENT_FIELD_REGISTRY,
    getEventFieldRow,
    isRegisteredEventField,
    type MechanicRow,
} from "../mechanicsRegistry";
import type { GameEvent } from "../types";

describe("Mechanics Registry (CR 701 keyword actions + CR 702 keyword abilities, ADR 0045/0046)", () => {
    it("is a total census: ~240+ rows spanning both CR 701 and CR 702", () => {
        expect(MECHANICS_REGISTRY.length).toBeGreaterThanOrEqual(240);
        const actions = MECHANICS_REGISTRY.filter(
            (r) => r.kind === "keyword-action"
        );
        const abilities = MECHANICS_REGISTRY.filter(
            (r) => r.kind === "keyword-ability"
        );
        expect(actions.length).toBeGreaterThan(0);
        expect(abilities.length).toBeGreaterThan(0);
    });

    it("has no duplicate or ambiguous registry ids", () => {
        const ids = MECHANICS_REGISTRY.map((r) => r.id);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect(dupes, "duplicate registry ids").toEqual([]);
    });

    it("registry ids don't collide with engine-internal marker ids", () => {
        const registryIds = new Set(MECHANICS_REGISTRY.map((r) => r.id));
        const collisions = ENGINE_INTERNAL_MARKERS.filter((m) =>
            registryIds.has(m.id)
        ).map((m) => m.id);
        expect(
            collisions,
            "ids shared between census and internal markers"
        ).toEqual([]);
    });

    it("has no duplicate/ambiguous plain bindings among rows that declare one", () => {
        const bound = MECHANICS_REGISTRY.filter(
            (r): r is MechanicRow & { binding: string } => !!r.binding
        );
        const bindings = bound.map((r) => r.binding);
        const dupes = bindings.filter((b, i) => bindings.indexOf(b) !== i);
        expect(
            dupes,
            "the same literal staticAbilities string is claimed as `binding` by more than one row"
        ).toEqual([]);
    });

    it("every `implemented` row carries a binding or bindingPattern", () => {
        const missing = MECHANICS_REGISTRY.filter(
            (r) => r.status === "implemented" && !r.binding && !r.bindingPattern
        ).map((r) => `${r.id} (${r.cr})`);
        expect(missing, "implemented rows with no engine binding").toEqual([]);
    });

    it("every `out-of-scope` / `planned` row with a gap has a note (documentation, not silence)", () => {
        // Not every planned row needs a note (most are simply un-built), but
        // out-of-scope rows always must justify the exclusion.
        const missing = MECHANICS_REGISTRY.filter(
            (r) => r.status === "out-of-scope" && !r.note
        ).map((r) => r.id);
        expect(missing, "out-of-scope rows with no justification note").toEqual(
            []
        );
    });

    // Spot-check (CLAUDE.md gre-development.md: "every mechanic currently
    // implemented in the engine is marked implemented with its correct
    // binding") — a regression guard so a future edit can't silently flip
    // one of these back to "planned" or drop its binding.
    it.each([
        ["flying", "702.9", "flying"],
        // #957 — deathtouch: nonzero damage from a deathtouch source destroys
        // the creature as an SBA (CR 702.2b / 704.5h).
        ["deathtouch", "702.2", "deathtouch"],
        ["defender", "702.3", "defender"],
        ["first-strike", "702.7", "first strike"],
        ["double-strike", "702.4", "double strike"],
        ["trample", "702.19", "trample"],
        ["vigilance", "702.20", "vigilance"],
        ["menace", "702.111", "menace"],
        ["reach", "702.17", "reach"],
        ["fear", "702.36", "fear"],
        ["indestructible", "702.12", "indestructible"],
        ["banding", "702.22", "banding"],
        ["cumulative-upkeep", "702.24", "cumulative-upkeep"],
        // #990 — echo: at the controller's first upkeep after it comes under
        // control, sacrifice it unless the echo cost is paid (CR 702.30a).
        ["echo", "702.30", "echo"],
        ["haste", "702.10", "haste"],
        // #958 — hexproof: a permanent can't be targeted by spells/abilities its
        // controller's opponents control (CR 702.11b), bridged from the keyword
        // to the shroud `cantBeTargeted` guard.
        ["hexproof", "702.11", "hexproof"],
        ["unblockable", undefined, "unblockable"],
        // #959 — shroud: reconciled from a stale "planned" (the registry
        // previously said the keyword STRING was unenforced, true only for
        // dynamically-granted shroud). Every printed-shroud card pairs the
        // string with a `permanent-guard` staticEffect that IS enforced.
        [
            "shroud",
            "702.18",
            "permanent-guard staticEffect (gre/permanentGuard.ts isGuardedAgainst)",
        ],
    ] as const)(
        "%s is implemented with binding %s",
        (id, cr, expectedBinding) => {
            const row = MECHANICS_REGISTRY.find((r) => r.id === id);
            expect(row, `no row for id "${id}"`).toBeDefined();
            expect(row!.status).toBe("implemented");
            expect(row!.binding).toBe(expectedBinding);
            if (cr) expect(row!.cr).toBe(cr);
        }
    );

    it.each(["landwalk", "protection", "rampage"] as const)(
        "%s is implemented with a bindingPattern",
        (id) => {
            const row = MECHANICS_REGISTRY.find((r) => r.id === id);
            expect(row, `no row for id "${id}"`).toBeDefined();
            expect(row!.status).toBe("implemented");
            expect(row!.bindingPattern).toBeInstanceOf(RegExp);
        }
    );

    // Known gaps (see module header): declared on cards (or not declared at
    // all), not actually enforced anywhere in the engine. Documented as a
    // fact, not silently marked implemented.
    // Haste graduated to `implemented` in issue #730 (combat honours it for
    // attack eligibility); hexproof in issue #958 (CR 702.11b targeting);
    // shroud in issue #959 (permanent-guard staticEffect enforcement). `ward`
    // was re-audited in issue #959 and confirmed to have zero engine wiring —
    // it stays the one honestly-planned row here.
    it.each(["ward"] as const)(
        "%s is honestly marked planned (declared-but-unenforced gap)",
        (id) => {
            const row = MECHANICS_REGISTRY.find((r) => r.id === id);
            expect(row, `no row for id "${id}"`).toBeDefined();
            expect(row!.status).toBe("planned");
        }
    );

    it("parametrized bindingPatterns match the literal strings actually declared on cards", () => {
        const landwalk = MECHANICS_REGISTRY.find((r) => r.id === "landwalk")!;
        for (const s of [
            "plainswalk",
            "islandwalk",
            "swampwalk",
            "mountainwalk",
            "forestwalk",
            "desertwalk",
            "legendary landwalk",
            "snow swampwalk",
            "snow forestwalk",
        ]) {
            expect(landwalk.bindingPattern!.test(s), s).toBe(true);
        }

        const protection = MECHANICS_REGISTRY.find(
            (r) => r.id === "protection"
        )!;
        for (const s of [
            "protection from red",
            "protection from white",
            "protection from black",
        ]) {
            expect(protection.bindingPattern!.test(s), s).toBe(true);
        }

        const rampage = MECHANICS_REGISTRY.find((r) => r.id === "rampage")!;
        for (const s of ["rampage 1", "rampage 2", "rampage 3"]) {
            expect(rampage.bindingPattern!.test(s), s).toBe(true);
        }

        const banding = MECHANICS_REGISTRY.find((r) => r.id === "banding")!;
        expect(banding.bindingPattern!.test("bands with other:legendary")).toBe(
            true
        );
        expect(
            banding.bindingPattern!.test(
                "bands with other:name=Wolves of the Hunt"
            )
        ).toBe(true);
    });

    // -------------------------------------------------------------------
    // Name-authority guard: the reason this file exists. Every card in the
    // catalogue must only declare staticAbilities strings the registry (or
    // the small engine-internal-marker allowlist) recognises — no invented
    // ad hoc keyword names (ADR 0045 "single authority on names").
    // -------------------------------------------------------------------
    it("every card's declared staticAbilities strings are named mechanics", () => {
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            for (const s of card.staticAbilities ?? []) {
                if (!isNamedMechanic(s)) {
                    offenders.push(`${card.id} (${card.name}): "${s}"`);
                }
            }
        }
        expect(
            offenders,
            "staticAbilities strings not covered by the Mechanics Registry — " +
                "either a typo, or a genuinely new mechanic that needs a registry row first"
        ).toEqual([]);
    });
});

// -----------------------------------------------------------------------
// Guard A — keyword-must-be-implemented (issue #962). Root-cause fix for the
// "declared-but-unimplemented" partial-card class: a card that declares a
// keyword whose Mechanics Registry row is `planned`/`out-of-scope` SHIPS
// functional-looking but is silently inert (the exact deathtouch/hexproof
// shape, #957/#958). The name-authority guard above only checks that a
// declared string resolves to SOME registry row — it does not check that
// row's implementation `status`. This guard closes that gap: every card's
// declared `staticAbilities` string must resolve to an `implemented` row (or
// a `bindingPattern` match on an `implemented` row), full stop.
//
// `ENGINE_INTERNAL_MARKERS` entries are exempt — they are not CR 701/702
// keywords with a `status` field at all (they're always-on rules-text
// markers consumed directly by the engine, e.g. `does-not-untap`), so
// "implemented" doesn't apply to them.
//
// A "non-stub" card is automatically what `getAllCards()` returns — a stub
// is a COMMENTED-OUT card definition (`scripts/check-stub-coverage.ts`), so
// it never becomes a live `CardDefinition` in the first place and never
// reaches this loop.
//
// A card that legitimately needs to ship BEFORE its keyword's engine support
// lands may be added to `KEYWORD_ALLOWLIST` below — narrow, one row per
// (card, keyword), each carrying a real open tracking issue. The allowlist is
// meant to empty out as items land (per the issue's own framing); it is not a
// blanket escape hatch — the guard test below asserts every KEYWORD_ALLOWLIST
// entry is well-formed and stays truthful (real card, real declared keyword).
// -----------------------------------------------------------------------
describe("Guard A — keyword-must-be-implemented (issue #962)", () => {
    /** Narrow, per-(card,keyword) exemption for a shipped card whose declared
     *  keyword's Mechanics Registry row isn't `implemented` yet. Empty right
     *  now — deathtouch (#957) and hexproof (#958) were the two known
     *  offenders and both shipped before this guard landed (issue #962
     *  dependency note). Add an entry here ONLY with a real open tracking
     *  issue; remove it the moment that issue closes. */
    const KEYWORD_ALLOWLIST: ReadonlyArray<{
        readonly cardId: string;
        readonly keyword: string;
        readonly issue: number;
    }> = [];

    /** Same resolution `isNamedMechanic` uses internally, but returns the row
     *  itself (not just a boolean) so this guard can inspect `status`. */
    function findMechanicRow(value: string): MechanicRow | undefined {
        const lower = value.toLowerCase();
        return MECHANICS_REGISTRY.find(
            (row) =>
                lower === row.name.toLowerCase() ||
                row.binding === value ||
                row.bindingPattern?.test(value)
        );
    }

    function isEngineInternalMarker(value: string): boolean {
        return ENGINE_INTERNAL_MARKERS.some(
            (m) => m.binding === value || m.bindingPattern?.test(value)
        );
    }

    it("every card's staticAbilities keyword resolves to an `implemented` Mechanics Registry row", () => {
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            for (const s of card.staticAbilities ?? []) {
                // Not a CR keyword at all (engine-internal rules-text marker,
                // e.g. "does-not-untap") — no status to check.
                if (isEngineInternalMarker(s)) continue;
                const row = findMechanicRow(s);
                // An unresolvable string is the name-authority guard's job
                // (the describe block above) — don't double-report it here.
                if (!row) continue;
                if (row.status === "implemented") continue;
                if (
                    KEYWORD_ALLOWLIST.some(
                        (a) => a.cardId === card.id && a.keyword === s
                    )
                ) {
                    continue;
                }
                offenders.push(
                    `${card.id} (${card.name}): "${s}" -> registry row "${row.id}" is status="${row.status}" (${row.cr})`
                );
            }
        }
        expect(
            offenders,
            "shipped (non-stub) cards declaring a keyword whose Mechanics Registry row is not " +
                "`implemented` — either ship the mechanic first, or add a narrow, issue-linked " +
                "KEYWORD_ALLOWLIST entry in this test file"
        ).toEqual([]);
    });

    it("every KEYWORD_ALLOWLIST entry is well-formed: a real open issue, a real card, a keyword it actually declares", () => {
        const cards = getAllCards();
        for (const a of KEYWORD_ALLOWLIST) {
            expect(
                a.issue,
                `${a.cardId}/${a.keyword} allowlist entry needs a real tracking issue number`
            ).toBeGreaterThan(0);
            const card = cards.find((c) => c.id === a.cardId);
            expect(card, `no card with id ${a.cardId}`).toBeDefined();
            expect(
                card!.staticAbilities ?? [],
                `${a.cardId} (${card?.name}) does not declare "${a.keyword}" — stale allowlist entry`
            ).toContain(a.keyword);
        }
    });
});

// -----------------------------------------------------------------------
// Self-verifying implementation status (issue #959).
//
// The audit that shipped with this suite found `shroud` drifted from actual
// engine wiring (marked "planned" despite being genuinely enforced via a
// `permanent-guard` staticEffect), and confirmed `ward` is genuinely unwired
// (its row correctly stays "planned"). To stop the next such drift from
// waiting on a manual audit, these tests make the `status` field
// self-verifying:
//
//   1. every `implemented` mechanic must have a findable engine consumer, and
//   2. no shipped card may declare (in `staticAbilities[]`) a keyword whose
//      registry row is still `planned` — the exact shape of the shroud
//      regression, turned into a permanent CI guard.
//
// "Findable engine consumer" is deliberately NOT a hand-maintained per-mechanic
// map (86 rows and growing — a hand-kept map goes stale exactly like the field
// it guards). Instead, for each `implemented` row we accept EITHER:
//   (a) its `binding` names a real engine file (a `convex/path/to/file.ts`
//       that exists, or a bare `file.ts` whose basename exists under convex/),
//       or
//   (b) the mechanic's `id` or `name` appears as a QUOTED STRING LITERAL
//       (`"flying"`, `'flashback'`) somewhere in the engine source
//       (convex/gre/** + convex/cards/** minus sets/** and __tests__/**).
// A quoted keyword literal is deliberate wiring — the engine consuming the
// keyword as a string — and, unlike free-form prose, does not match incidental
// English: a genuinely-unwired mechanic like `ward` (whose name appears in
// engine files only inside identifiers/comments such as "Artifact Ward", never
// as the bare literal `"ward"`) has no evidence and would fail here if it were
// ever mismarked `implemented`. The sanity test below proves the probe rejects
// both a fabricated binding and ward's real (unwired) row — i.e. it is not
// tautological.
// -----------------------------------------------------------------------
describe("Self-verifying implementation status (issue #959)", () => {
    // Engine wiring = the code that CONSUMES a mechanic. Excludes card DATA
    // (sets/**, pure declarations) and tests (proof, not the thing proved): a
    // card merely declaring a keyword, or a test merely asserting one, is not
    // evidence the engine enforces it.
    function collectFiles(root: string, skip: string[]): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (!skip.includes(e.name)) walk(p);
                } else if (e.name.endsWith(".ts")) {
                    out.push(p);
                }
            }
        };
        walk(root);
        return out;
    }

    const engineSrc = [
        ...collectFiles("convex/gre", ["__tests__"]),
        ...collectFiles("convex/cards", ["__tests__", "sets"]),
    ]
        .filter((f) => !f.endsWith("mechanicsRegistry.ts"))
        .map((f) => fs.readFileSync(f, "utf8"))
        .join("\n");

    // All convex/ .ts basenames (minus generated + tests), for resolving a
    // `binding` file-pointer.
    const allBasenames = new Set(
        collectFiles("convex", ["__tests__", "_generated"]).map((f) =>
            path.basename(f)
        )
    );

    /** The mechanic keyword consumed as a quoted string literal in engine src
     *  (`"flying"` / `'flying'`). Deliberate wiring, not incidental prose. */
    function quotedLiteralInEngine(token: string | undefined): boolean {
        if (!token) return false;
        const t = token.toLowerCase();
        return engineSrc.includes(`"${t}"`) || engineSrc.includes(`'${t}'`);
    }

    /** `binding` names a real engine file (full convex/… path or bare X.ts). */
    function bindingNamesRealFile(binding: string | undefined): boolean {
        if (!binding) return false;
        for (const m of binding.matchAll(/\bconvex\/[A-Za-z0-9_/]+\.ts\b/g)) {
            if (fs.existsSync(m[0])) return true;
        }
        for (const m of binding.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.ts\b/g)) {
            if (allBasenames.has(`${m[1]}.ts`)) return true;
        }
        return false;
    }

    // Ubiquitous shared types — too generic to prove a SPECIFIC mechanic
    // (they appear in nearly every engine file), so they never count as a
    // binding symbol.
    const GENERIC_SYMBOLS = new Set([
        "SpellContext",
        "CardDefinition",
        "TargetRequirement",
        "GameState",
        "PlayerState",
        "CardInstanceState",
        "EffectOp",
    ]);

    /** `binding` names a real engine SYMBOL: a mixed-case (camelCase /
     *  PascalCase) identifier of length >= 5 that occurs in the engine source.
     *  Mixed case = code, not prose, so this does not match incidental English
     *  in a note; it is mined from `binding` (a deliberate authored pointer)
     *  only, never the free-form `note`. */
    function bindingNamesRealSymbol(binding: string | undefined): boolean {
        if (!binding) return false;
        for (const m of binding.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
            const w = m[1];
            if (w.length < 5) continue;
            if (!/[a-z]/.test(w) || !/[A-Z]/.test(w)) continue;
            if (GENERIC_SYMBOLS.has(w)) continue;
            if (new RegExp(`\\b${w}\\b`).test(engineSrc)) return true;
        }
        return false;
    }

    function hasEngineEvidence(row: MechanicRow): boolean {
        return (
            bindingNamesRealFile(row.binding) ||
            bindingNamesRealSymbol(row.binding) ||
            quotedLiteralInEngine(row.id) ||
            quotedLiteralInEngine(row.name)
        );
    }

    it("every `implemented` mechanic has a findable engine consumer", () => {
        const offenders = MECHANICS_REGISTRY.filter(
            (r) => r.status === "implemented" && !hasEngineEvidence(r)
        ).map((r) => `${r.id} (${r.cr}) — binding: ${r.binding}`);
        expect(
            offenders,
            "`implemented` rows with no findable engine consumer — neither a " +
                "`binding` naming a real convex/** file nor the mechanic id/name " +
                "consumed as a quoted string literal in convex/gre|cards (minus " +
                "sets/tests). Either wire it, give `binding` a concrete file " +
                'pointer, or move the row back to `status: "planned"`.'
        ).toEqual([]);
    });

    it("sanity: the evidence probe is not tautological", () => {
        // A fabricated mechanic with a made-up binding + name must NOT pass.
        const fake = {
            id: "totallyfabricatedxyz",
            name: "Totally Fabricated Xyz",
            kind: "keyword-ability",
            cr: "999.99",
            status: "implemented",
            binding: "nonexistentModule.ts",
        } as MechanicRow;
        expect(hasEngineEvidence(fake)).toBe(false);

        // ward's REAL row (genuinely unwired) must not pass either — proving
        // the probe would have caught the shroud-style drift, had ward been
        // mismarked "implemented".
        const ward = MECHANICS_REGISTRY.find((r) => r.id === "ward")!;
        expect(hasEngineEvidence(ward)).toBe(false);
    });

    it("no card declares a `staticAbilities` keyword whose registry row is still `planned`", () => {
        // The exact shape of the shroud regression this suite fixes: a card
        // declares the keyword string (decoratively or otherwise) while its
        // registry row still says "planned". Engine-internal markers
        // (ENGINE_INTERNAL_MARKERS) are a separate, deliberately planned-free
        // allowlist and are not in scope here.
        const plannedNames = new Set(
            MECHANICS_REGISTRY.filter((r) => r.status === "planned").map((r) =>
                r.name.toLowerCase()
            )
        );
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            for (const s of card.staticAbilities ?? []) {
                if (plannedNames.has(s.toLowerCase())) {
                    offenders.push(`${card.id} (${card.name}): "${s}"`);
                }
            }
        }
        expect(
            offenders,
            "cards declaring a keyword the registry still marks `planned` — " +
                "either the card is decorative-only (confirm no paired " +
                "staticEffect/primitive enforces it) or the registry row is " +
                "stale and should flip to `implemented` (the shroud case)."
        ).toEqual([]);
    });
});

// -----------------------------------------------------------------------
// Effect Script Op census — status field + demand-driven backlog (PRD #826).
// The Op vocabulary is the demand-driven analogue of the CR-total keyword
// census above: EFFECT_OP_REGISTRY is the live/usable vocabulary
// (status "implemented"), EFFECT_OP_BACKLOG is the machine-visible IOU list
// (status "planned"), and a planned Op is NEVER usable by a card.
// -----------------------------------------------------------------------
describe("Effect Script Op census (ADR 0045/0046, PRD #826)", () => {
    it("every EFFECT_OP_REGISTRY row is implemented with a SpellContext or interpreter binding", () => {
        for (const row of EFFECT_OP_REGISTRY) {
            expect(row.status, row.op).toBe("implemented");
            // implemented rows always carry a binding (guarded 1:1 with the
            // interpreter/validator elsewhere); the two structural constructs
            // bind to interpreter control flow rather than a primitive.
            expect(row.binding, row.op).toBeTruthy();
        }
    });

    it("every EFFECT_OP_BACKLOG row is a planned reservation with no interpreter binding", () => {
        expect(EFFECT_OP_BACKLOG.length).toBeGreaterThan(0);
        for (const row of EFFECT_OP_BACKLOG) {
            expect(row.status, row.op).toBe("planned");
            // A planned Op has no interpreter binding yet — that is the point.
            expect(row.binding, row.op).toBeUndefined();
        }
    });

    it("backlog Op names are disjoint from the live registry and internally unique", () => {
        const live = new Set(EFFECT_OP_REGISTRY.map((r) => r.op));
        const backlog = EFFECT_OP_BACKLOG.map((r) => r.op);
        expect(new Set(backlog).size, "duplicate backlog Op names").toBe(
            backlog.length
        );
        const collisions = backlog.filter((op) => live.has(op));
        expect(collisions, "backlog Op already implemented").toEqual([]);
    });

    it("the demonstrated wave-1 Op backlog (still-planned named Ops) is present as planned stubs", () => {
        // The demand-driven backlog surfaced by the migration classifier
        // (scripts/migration-classifier.mjs). `X` is intentionally excluded —
        // it is an EffectValue grammar member, not an Op (PRD #826). `moveZone`
        // (issue #839), `delayedTrigger` (issue #838, ADR 0048), `pump`
        // (issue #840), `counters` (issue #841), `tapUntap` (issue #842) and
        // `grantAbility` (issue #843) were wave-1 stubs but SHIPPED — they now
        // live in EFFECT_OP_REGISTRY, not the backlog. `libraryLook` (issue
        // #844) SHIPPED too, but only its `shuffle` primitive folded; its
        // peek/reorder half is deferred to the new `scryReorder` backlog stub.
        // `preventDamage` (issue #845) SHIPPED — moved to EFFECT_OP_REGISTRY.
        // `regenerate` (issue #846) SHIPPED — moved to EFFECT_OP_REGISTRY.
        // `createToken` (issue #847) SHIPPED — its plain spec-driven form moved
        // to EFFECT_OP_REGISTRY; the copy form (createTokenCopyOf) split out as
        // the new `createTokenCopy` backlog stub.
        // `gainControl` (issue #848) SHIPPED — moved to EFFECT_OP_REGISTRY (the
        // full ControlChangeCondition duration grammar folded; the EOT+tap-rider
        // form Ray of Command / Magus of the Unseen stays resolve(), issue #730).
        // `optionChoice` (issue #849) SHIPPED — moved to EFFECT_OP_REGISTRY (the
        // "choose one" modal form folded; "choose one or more" / entwine /
        // escalate cardinality grammars stay a later Op on demand).
        // `addMana` (issue #850) SHIPPED — moved to EFFECT_OP_REGISTRY (the
        // fixed-produced-mana form folded; "any colour" / count-scaled amounts /
        // the addRestrictedMana spend-rider stay resolve() on demand).
        // `coinFlip` (issue #851) SHIPPED — moved to EFFECT_OP_REGISTRY (the
        // suspending reveal flip folded; the synchronous flipCoin and the
        // repeat/doubling loops stay resolve()). Migrating Goblin Kites surfaced
        // a new gap: `sacrificeObject` (sacrifice a single bound object) is a
        // planned backlog stub.
        // `scryReorder` (issue #885) SHIPPED — moved to EFFECT_OP_REGISTRY as
        // two orthogonal Ops (`scryReorder` = the choice-driven look/reorder
        // skin over orderTop; `mill` = the deterministic library→graveyard
        // loop); no longer a backlog reservation.
        const named = ["createTokenCopy", "sacrificeObject"];
        const backlog = new Set(EFFECT_OP_BACKLOG.map((r) => r.op));
        for (const op of named) expect(backlog.has(op), op).toBe(true);
        // …plus low-frequency long-tail reservations beyond the named set.
        expect(EFFECT_OP_BACKLOG.length).toBeGreaterThan(named.length);
    });

    it("isRegisteredEffectOp accepts implemented Ops but rejects planned backlog Ops", () => {
        // A card may reference a live Op…
        expect(isRegisteredEffectOp("dealDamage")).toBe(true);
        expect(isRegisteredEffectOp("destroy")).toBe(true);
        // …but never a planned reservation (validateEffectScript would reject
        // a card that tried), nor an invented name.
        for (const row of EFFECT_OP_BACKLOG) {
            expect(isRegisteredEffectOp(row.op), row.op).toBe(false);
        }
        expect(isRegisteredEffectOp("notARealOp")).toBe(false);
    });
});

// -----------------------------------------------------------------------
// EVENT_FIELD_REGISTRY — the `$event.<field>` name authority (ADR 0049,
// issue #865). Mirrors the EFFECT_OP_REGISTRY census tests: every censused
// field has a family and a working `resolve` that flattens the event to a
// single id, and lookups reject uncensused pairs (which is what keeps a wrong
// `$event.<field>` a CI failure, never a silent runtime skip).
// -----------------------------------------------------------------------
describe("Event field registry ($event.<field>, ADR 0049, issue #865)", () => {
    it("every row carries a valid family and a callable resolve", () => {
        for (const [eventType, fields] of Object.entries(
            EVENT_FIELD_REGISTRY
        )) {
            for (const [field, row] of Object.entries(fields)) {
                expect(["object", "player"], `${eventType}.${field}`).toContain(
                    row.family
                );
                expect(typeof row.resolve, `${eventType}.${field}`).toBe(
                    "function"
                );
            }
        }
    });

    it("getEventFieldRow / isRegisteredEventField accept censused fields and reject the rest", () => {
        expect(
            getEventFieldRow("BLOCKERS_CONFIRMED", "blockerId")?.family
        ).toBe("object");
        expect(
            getEventFieldRow("BLOCKERS_CONFIRMED", "attackerId")?.family
        ).toBe("object");
        expect(getEventFieldRow("DAMAGE_DEALT", "damagedPlayer")?.family).toBe(
            "player"
        );
        // issue #1066 — Collapsing Borders' each-player-upkeep scoped player.
        expect(getEventFieldRow("PHASE_BEGIN", "activePlayerId")?.family).toBe(
            "player"
        );
        expect(isRegisteredEventField("BLOCKERS_CONFIRMED", "blockerId")).toBe(
            true
        );
        expect(isRegisteredEventField("PHASE_BEGIN", "activePlayerId")).toBe(
            true
        );
        // Uncensused pairs are rejected — no runtime skip, a validation failure.
        expect(getEventFieldRow("BLOCKERS_CONFIRMED", "bogus")).toBeUndefined();
        expect(getEventFieldRow("PHASE_BEGIN", "phase")).toBeUndefined();
        expect(isRegisteredEventField("DAMAGE_DEALT", "damagedCreature")).toBe(
            false
        );
    });

    it("PHASE_BEGIN.activePlayerId flattens to the scoped player id", () => {
        const event: GameEvent = {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p2",
        };
        expect(
            getEventFieldRow("PHASE_BEGIN", "activePlayerId")!.resolve(event)
        ).toBe("p2");
    });

    it("BLOCKERS_CONFIRMED object fields flatten to the pair ids", () => {
        const event: GameEvent = {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "atk",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId: "blk",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: [],
        };
        expect(
            getEventFieldRow("BLOCKERS_CONFIRMED", "attackerId")!.resolve(event)
        ).toBe("atk");
        expect(
            getEventFieldRow("BLOCKERS_CONFIRMED", "blockerId")!.resolve(event)
        ).toBe("blk");
    });

    it("DAMAGE_DEALT.damagedPlayer flattens the nested target, undefined for a permanent", () => {
        const toPlayer: GameEvent = {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "src",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 1,
            isCombat: true,
        };
        const toPermanent: GameEvent = {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "src",
            sourceControllerId: "p1",
            target: { type: "permanent", id: "creature" },
            amount: 1,
            isCombat: true,
        };
        const row = getEventFieldRow("DAMAGE_DEALT", "damagedPlayer")!;
        expect(row.resolve(toPlayer)).toBe("p2");
        // Damage to a permanent has no damagedPlayer — the reading Op skips.
        expect(row.resolve(toPermanent)).toBeUndefined();
    });
});
