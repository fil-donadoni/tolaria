// Editing a debug scenario must not DELETE any spec field (issue #3462,
// widened by issue #3463).
//
// `updateDebugScenario` patches the row's `spec` wholesale, so the editor's
// assembled spec is the whole stored spec: a field it omits is gone. Issue
// #3462 classified the seven fields the form rendered nothing for as
// `preserved` so they were carried through untouched; issue #3463 then gave
// every one of them an input, so they are `form-owned` and survive by being
// INFLATED into the draft and re-emitted — a different mechanism with the same
// obligation, and one the `preserved` path no longer covers. Hence the round
// trip below sweeps every key of `ScenarioSpec`, not just the preserved ones
// (which are, by construction, none today).
//
// The table below is typed `Required<ScenarioSpec>`, so a spec field added
// tomorrow reds this file at `tsc` until it is given a value here — and the
// per-key assertions are driven by the ownership table itself, so it is then
// tested by whichever classification it was given, not by a hand-written list.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";

import {
    SCENARIO_SPEC_FIELD_OWNER,
    PRESERVED_SCENARIO_SPEC_KEYS,
    assembleScenarioSpec,
    scenarioSpecFieldOwner,
} from "../scenario-spec-ownership";

const mutationCalls: { ref: unknown; args: unknown }[] = [];

vi.mock("convex/react", () => ({
    useQuery: () => undefined,
    useMutation: (ref: unknown) => (args: unknown) => {
        mutationCalls.push({ ref, args });
        return Promise.resolve(null);
    },
    useAction: () => () => Promise.resolve(null),
}));

// A Proxy stands in for the whole generated `api`, so every ref the form
// reaches for resolves to a named marker instead of crashing on `undefined`.
vi.mock("@convex/_generated/api", () => {
    const namespace = (prefix: string) =>
        new Proxy(
            {},
            { get: (_t, key) => ({ name: `${prefix}.${String(key)}` }) }
        );
    return {
        api: new Proxy({}, { get: (_t, key) => namespace(String(key)) }),
    };
});

const DebugSaveScenario = (await import("../debug-save-scenario")).default;

/** A stored scenario carrying EVERY spec field — the curated/golden shape the
 *  editor is most likely to be pointed at (ADR 0044). `Required` is what makes
 *  a newly added spec field a compile error here. */
const STORED: Required<ScenarioSpec> = {
    cards: [{ name: "Psychatog", owner: "me", zone: "battlefield" }],
    phase: "POSTCOMBAT_MAIN",
    landCount: 4,
    libraryCount: 30,
    turn: 7,
    markLastDrawn: true,
    rngSeed: 4242,
    poison: { me: 3, opp: 1 },
    life: { me: 5, opp: 2 },
    experience: { me: 2, opp: 0 },
    // CR 102.1 / 117.1 / 117.4 (issue #3454) — a curated row pinning an
    // instant-speed decision on the opponent's turn.
    activePlayer: "opp",
    priority: "me",
    passCount: 1,
    companion: { name: "Lurrus of the Dream-Den", owner: "me", used: true },
};

/** What the form itself would assemble after the admin edits a card — only the
 *  form-owned fields, deliberately different from `STORED`. */
const FORM_ASSEMBLED: ScenarioSpec = {
    cards: [{ name: "Upheaval", owner: "me", zone: "hand" }],
    phase: "PRECOMBAT_MAIN",
    landCount: 1,
    libraryCount: 2,
    turn: 3,
};

const SPEC_KEYS = Object.keys(SCENARIO_SPEC_FIELD_OWNER) as Extract<
    keyof ScenarioSpec,
    string
>[];

describe("scenario spec field ownership", () => {
    it("classifies every key of ScenarioSpec", () => {
        // The `satisfies` in the module is the real guard (tsc reds on a
        // missing key); this pins the runtime list the assembler iterates.
        expect(SPEC_KEYS.length).toBeGreaterThan(0);
        for (const key of SPEC_KEYS) {
            expect(["form-owned", "preserved"]).toContain(
                SCENARIO_SPEC_FIELD_OWNER[key]
            );
        }
        expect(PRESERVED_SCENARIO_SPEC_KEYS).toEqual(
            SPEC_KEYS.filter((k) => scenarioSpecFieldOwner(k) === "preserved")
        );
    });

    it.each(SPEC_KEYS)(
        "assembleScenarioSpec resolves `%s` from its owner",
        (key) => {
            const assembled = assembleScenarioSpec(FORM_ASSEMBLED, STORED);
            const expected =
                scenarioSpecFieldOwner(key) === "preserved"
                    ? STORED[key]
                    : FORM_ASSEMBLED[key];
            expect(assembled[key]).toEqual(expected);
        }
    );

    it("lets the form CLEAR a field it owns", () => {
        // A form-owned field absent from the form's value means the admin
        // cleared it — the loaded value must not resurrect it.
        const cleared = assembleScenarioSpec({ cards: [] }, STORED);
        for (const key of SPEC_KEYS) {
            if (scenarioSpecFieldOwner(key) === "form-owned") continue;
            expect(cleared[key]).toEqual(STORED[key]);
        }
        expect(cleared.turn).toBeUndefined();
        expect(cleared.phase).toBeUndefined();
        expect(cleared.landCount).toBeUndefined();
        expect(cleared.libraryCount).toBeUndefined();
    });

    it("preserves nothing when creating a new scenario", () => {
        expect(assembleScenarioSpec(FORM_ASSEMBLED, null)).toEqual(
            FORM_ASSEMBLED
        );
    });
});

describe("editing a scenario through the real form", () => {
    beforeEach(() => {
        cleanup();
        mutationCalls.length = 0;
    });

    /** Open the stored row in the editor, change a card name, press Update. */
    const editAndSave = () => {
        render(
            <DebugSaveScenario
                editing={{
                    id: "row1" as Id<"debugScenarios">,
                    label: "Golden row",
                    spec: STORED,
                }}
            />
        );
        const nameField = screen.getByDisplayValue("Psychatog");
        fireEvent.change(nameField, { target: { value: "Upheaval" } });
        fireEvent.click(screen.getByText("Update"));
        const call = mutationCalls.at(-1)?.args as
            | { spec: ScenarioSpec }
            | undefined;
        expect(call).toBeDefined();
        return call!.spec;
    };

    it.each(SPEC_KEYS.filter((key) => key !== "cards"))(
        "keeps `%s` across an edit",
        (key) => {
            expect(editAndSave()[key]).toEqual(STORED[key]);
        }
    );

    it("still writes the edit the admin made", () => {
        const saved = editAndSave();
        expect(saved.cards).toEqual([{ name: "Upheaval", owner: "me" }]);
        // The form-owned knobs inflate from the row and come back unchanged.
        expect(saved.turn).toBe(STORED.turn);
        expect(saved.phase).toBe(STORED.phase);
    });

    it("carries a `preserved` field through, when there is one", () => {
        // Empty today (issue #3463 gave every field an input). The assertion
        // keeps the OTHER mechanism honest the day a widening is classified
        // `preserved`: an `it.each` over an empty list registers no test at
        // all, which is the silent kind of green this repo does not accept.
        for (const key of PRESERVED_SCENARIO_SPEC_KEYS) {
            expect(editAndSave()[key]).toEqual(STORED[key]);
        }
        expect(PRESERVED_SCENARIO_SPEC_KEYS.length).toBeLessThanOrEqual(
            SPEC_KEYS.length
        );
    });
});
