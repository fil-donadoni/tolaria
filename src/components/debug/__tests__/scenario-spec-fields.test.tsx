// Every SPEC-LEVEL field of `ScenarioSpec` classified `form-owned` must have a
// real input in the scenario form (issue #3463).
//
// "The form renders an input for it" was a claim in a doc comment until this
// file: the form spelled out four rows (`landCount`, `libraryCount`, `turn`,
// `phase`) while the spec had eleven fields, so `life`, `poison`, `experience`,
// `companion`, `rngSeed` and `markLastDrawn` could be produced by a blade
// scenario or `specFromState` and never typed by a human — and nothing said so.
//
// The assertions are DERIVED, never hand-listed: the labels come from
// `scenarioSpecFieldLabels`, the same function the component renders its
// `aria-label`s from, keyed on the classification table. A field classified
// `form-owned` with no row reds `tsc`; a row the component's loop does not
// render reds here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import { SCENARIO_PHASES, type ScenarioSpec } from "@convex/debugScenarioSpec";

import {
    FORM_OWNED_SCENARIO_SPEC_KEYS,
    SCENARIO_SPEC_FIELD_INPUT,
    scenarioSpecFieldLabels,
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

/** The fields with a spec-level control of their own — `cards` is the card
 *  repeater, which carries its own per-row labels. */
const LABELLED_KEYS = FORM_OWNED_SCENARIO_SPEC_KEYS.filter(
    (key) => SCENARIO_SPEC_FIELD_INPUT[key].kind !== "cards"
);

describe("the scenario form renders every form-owned spec field", () => {
    beforeEach(() => {
        cleanup();
        mutationCalls.length = 0;
    });

    it("has something to check (the derivation is not vacuous)", () => {
        expect(LABELLED_KEYS.length).toBeGreaterThan(6);
    });

    it.each(LABELLED_KEYS)("renders an input for `%s`", (key) => {
        render(<DebugSaveScenario />);
        const labels = scenarioSpecFieldLabels(key);
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) {
            expect(screen.getByLabelText(label)).toBeTruthy();
        }
    });

    it("renders per-seat fields as a me/opp PAIR", () => {
        render(<DebugSaveScenario />);
        const perSeat = FORM_OWNED_SCENARIO_SPEC_KEYS.filter(
            (key) => SCENARIO_SPEC_FIELD_INPUT[key].kind === "per-seat"
        );
        expect(perSeat.length).toBeGreaterThan(0);
        for (const key of perSeat) {
            const [me, opp] = scenarioSpecFieldLabels(key);
            expect(screen.getByLabelText(me)).not.toBe(
                screen.getByLabelText(opp)
            );
        }
    });

    it("offers the shared phase vocabulary, and only that", () => {
        render(<DebugSaveScenario />);
        const select = screen.getByLabelText("phase") as HTMLSelectElement;
        const offered = [...select.options].map((o) => o.value).filter(Boolean);
        // CR-faithful step names: the select and the LLM generator's schema
        // enum read the SAME list, so a generated scenario always has an
        // option to render against (issue #3463).
        expect(offered).toEqual([...SCENARIO_PHASES]);
    });

    it("writes what the admin typed into the saved spec", () => {
        render(<DebugSaveScenario />);
        fireEvent.change(screen.getByLabelText("Card 1 name"), {
            target: { value: "Psychatog" },
        });
        fireEvent.change(screen.getByLabelText("life me"), {
            target: { value: "4" },
        });
        fireEvent.change(screen.getByLabelText("life opp"), {
            target: { value: "17" },
        });
        fireEvent.change(screen.getByLabelText("experience me"), {
            target: { value: "2" },
        });
        fireEvent.change(screen.getByLabelText("rng seed"), {
            target: { value: "4242" },
        });
        fireEvent.click(screen.getByLabelText("mark last drawn"));
        fireEvent.change(screen.getByLabelText("companion name"), {
            target: { value: "Lurrus of the Dream-Den" },
        });
        fireEvent.change(screen.getByLabelText("companion owner"), {
            target: { value: "opp" },
        });
        fireEvent.click(screen.getByLabelText("companion used"));
        fireEvent.click(screen.getByText("Save to DB"));

        const saved = (mutationCalls.at(-1)?.args as { spec: ScenarioSpec })
            .spec;
        expect(saved.life).toEqual({ me: 4, opp: 17 });
        expect(saved.experience).toEqual({ me: 2 });
        expect(saved.rngSeed).toBe(4242);
        expect(saved.markLastDrawn).toBe(true);
        expect(saved.companion).toEqual({
            name: "Lurrus of the Dream-Den",
            owner: "opp",
            used: true,
        });
        // An untouched per-seat knob writes nothing — a scenario must not gain
        // a `poison: {}` it never asked for.
        expect(saved.poison).toBeUndefined();
    });

    it("clears a spec field the admin empties", () => {
        render(
            <DebugSaveScenario
                editing={{
                    id: "row1" as Id<"debugScenarios">,
                    label: "Golden row",
                    spec: {
                        cards: [{ name: "Psychatog", owner: "me" }],
                        life: { me: 5, opp: 2 },
                        rngSeed: 7,
                    },
                }}
            />
        );
        fireEvent.change(screen.getByLabelText("rng seed"), {
            target: { value: "" },
        });
        fireEvent.change(screen.getByLabelText("life me"), {
            target: { value: "" },
        });
        fireEvent.click(screen.getByText("Update"));

        const saved = (mutationCalls.at(-1)?.args as { spec: ScenarioSpec })
            .spec;
        expect(saved.rngSeed).toBeUndefined();
        // Only the emptied SEAT goes; the other side of the pair stays.
        expect(saved.life).toEqual({ opp: 2 });
    });
});
