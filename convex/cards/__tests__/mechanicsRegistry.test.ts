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
import { getAllCards } from "../index";
import {
    MECHANICS_REGISTRY,
    ENGINE_INTERNAL_MARKERS,
    EFFECT_OP_REGISTRY,
    EFFECT_OP_BACKLOG,
    isRegisteredEffectOp,
    isNamedMechanic,
    type MechanicRow,
} from "../mechanicsRegistry";

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
        ["unblockable", undefined, "unblockable"],
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

    // Known gaps (see module header): declared on cards, not actually
    // enforced anywhere in the engine. Documented as a fact, not silently
    // marked implemented.
    it.each(["haste", "hexproof", "shroud", "ward"] as const)(
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
        // (issue #840) and `counters` (issue #841) were wave-1 stubs but
        // SHIPPED — they now live in EFFECT_OP_REGISTRY, not the backlog.
        const named = [
            "tapUntap",
            "grantAbility",
            "libraryLook",
            "preventDamage",
            "regenerate",
            "createToken",
            "gainControl",
            "optionChoice",
            "addMana",
            "coinFlip",
        ];
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
