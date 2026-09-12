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
import {
    SCENARIO_PHASES,
    SCENARIO_SPEC_KEYS,
    type ScenarioSpec,
} from "@convex/debugScenarioSpec";

import {
    FORM_OWNED_SCENARIO_SPEC_KEYS,
    SCENARIO_SPEC_FIELD_OWNER,
    SCENARIO_SPEC_FIELD_INPUT,
    formOwnedKeysInGroup,
    scenarioSpecFieldGroup,
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

/** Expand "Other options" (issue #3494). The rare knobs render only once the
 *  disclosure is open — CONDITIONALLY, not merely hidden, which is exactly why
 *  every assertion below has to reach for them the way an admin does. */
function expandOther() {
    fireEvent.click(screen.getByText("Other options"));
}

/** Open the disclosure iff this field lives behind it. Derived from the
 *  classification table, never from a hand-kept list of "the rare ones" —
 *  re-grouping a field must not need an edit here. */
function revealField(key: (typeof LABELLED_KEYS)[number]) {
    if (scenarioSpecFieldGroup(key) === "other") expandOther();
}

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
        revealField(key);
        const labels = scenarioSpecFieldLabels(key);
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) {
            expect(screen.getByLabelText(label)).toBeTruthy();
        }
    });

    it("renders per-seat fields as a me/opp PAIR", () => {
        render(<DebugSaveScenario />);
        expandOther();
        // `startsWith` covers `per-seat-flag` too (issue #3450): the flag
        // pairs are two controls per field exactly as the numeric ones are,
        // and an `=== "per-seat"` filter silently stopped asserting the
        // moment the second per-seat shape shipped.
        const perSeat = FORM_OWNED_SCENARIO_SPEC_KEYS.filter((key) =>
            SCENARIO_SPEC_FIELD_INPUT[key].kind.startsWith("per-seat")
        );
        expect(perSeat.length).toBeGreaterThan(0);
        for (const key of perSeat) {
            const [me, opp] = scenarioSpecFieldLabels(key);
            expect(screen.getByLabelText(me)).not.toBe(
                screen.getByLabelText(opp)
            );
        }
    });

    it("classifies exactly the keys the VALIDATOR declares", () => {
        // The ownership table is typed off `keyof ScenarioSpec`, and the
        // generator's guard sweeps the VALIDATOR-derived list: a field added to
        // `scenarioSpecValidator` alone would reach one guard and not the
        // other, leaving the form green while genuinely missing the input.
        expect([...Object.keys(SCENARIO_SPEC_FIELD_OWNER)].sort()).toEqual(
            [...SCENARIO_SPEC_KEYS].sort()
        );
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
        expandOther();
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

    it("keeps a loaded phase the offer list does not contain", () => {
        // `specFromState` lowers the live `Phase` verbatim, so a captured board
        // can carry a step `SCENARIO_PHASES` does not offer. Without an option
        // for it the select renders blank — reading as "unset" over a value
        // that is set.
        render(
            <DebugSaveScenario
                editing={{
                    id: "row1" as Id<"debugScenarios">,
                    label: "Captured mid-combat",
                    spec: {
                        cards: [{ name: "Psychatog", owner: "me" }],
                        phase: "FIRST_STRIKE_DAMAGE",
                    },
                }}
            />
        );
        const select = screen.getByLabelText("phase") as HTMLSelectElement;
        expect(select.value).toBe("FIRST_STRIKE_DAMAGE");
        fireEvent.click(screen.getByText("Update"));
        const saved = (mutationCalls.at(-1)?.args as { spec: ScenarioSpec })
            .spec;
        expect(saved.phase).toBe("FIRST_STRIKE_DAMAGE");
    });

    it("round-trips a companion whose row omits the owner", () => {
        // `owner` is optional on the spec and the builder defaults it to the
        // "me" seat; the form always writes it explicitly, so this pins that
        // the widening does not change which seat the companion lands in.
        render(
            <DebugSaveScenario
                editing={{
                    id: "row1" as Id<"debugScenarios">,
                    label: "Implicit owner",
                    spec: {
                        cards: [{ name: "Psychatog", owner: "me" }],
                        companion: { name: "Lurrus of the Dream-Den" },
                    },
                }}
            />
        );
        fireEvent.click(screen.getByText("Update"));
        const saved = (mutationCalls.at(-1)?.args as { spec: ScenarioSpec })
            .spec;
        expect(saved.companion).toEqual({
            name: "Lurrus of the Dream-Den",
            owner: "me",
        });
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
        expandOther();
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
    it("keeps the frequent knobs visible with the disclosure shut", () => {
        // The whole point of the split: `phase` and `life` must not need a
        // click. A field that drifted into `other` shows up here as a missing
        // input, not as a silently deeper form.
        render(<DebugSaveScenario />);
        const frequent = formOwnedKeysInGroup("frequent").filter(
            (key) => SCENARIO_SPEC_FIELD_INPUT[key].kind !== "cards"
        );
        expect(frequent.length).toBeGreaterThan(3);
        for (const key of frequent) {
            for (const label of scenarioSpecFieldLabels(key)) {
                expect(screen.getByLabelText(label)).toBeTruthy();
            }
        }
    });

    it("hides the rare knobs until the disclosure is opened", () => {
        render(<DebugSaveScenario />);
        const other = formOwnedKeysInGroup("other");
        expect(other.length).toBeGreaterThan(3);
        for (const key of other) {
            for (const label of scenarioSpecFieldLabels(key)) {
                expect(screen.queryByLabelText(label)).toBeNull();
            }
        }
        expandOther();
        for (const key of other) {
            for (const label of scenarioSpecFieldLabels(key)) {
                expect(screen.getByLabelText(label)).toBeTruthy();
            }
        }
    });

    it("splits every form-owned field into exactly one group", () => {
        // The grouping is READ from the classification table (issue #3494), so
        // a newly classified field cannot land outside both groups — `tsc`
        // demands the `group` on its row, and this pins that the two derived
        // lists still partition the whole set.
        const both = [
            ...formOwnedKeysInGroup("frequent"),
            ...formOwnedKeysInGroup("other"),
        ].sort();
        expect(both).toEqual([...FORM_OWNED_SCENARIO_SPEC_KEYS].sort());
        expect(new Set(both).size).toBe(both.length);
    });

    it("pins the save CTA at the top of the form, not under every knob", () => {
        // Issue #3494: the Save button used to be the LAST element, under the
        // card rows and all ~28 spec inputs.
        render(<DebugSaveScenario pinnedHead />);
        const cta = screen.getByText("Save to DB");
        const head = cta.closest("div.sticky");
        expect(head).toBeTruthy();
        // …and the label input is pinned WITH it — a head that scrolled the
        // label away would leave an admin typing blind.
        expect(head?.contains(screen.getByLabelText("scenario label"))).toBe(
            true
        );
    });

    it("does NOT pin without a scroll port to pin inside", () => {
        // `/admin/scenarios` mounts this same form in a `PanelBody`, in normal
        // page flow. A `sticky` there pins against the APP SHELL's scroller —
        // the defect `shell-height-claims.guard.test.tsx` (issue #2274) exists
        // to stop — so the pin is the caller's call, not the form's.
        render(<DebugSaveScenario />);
        expect(screen.getByText("Save to DB").closest("div.sticky")).toBeNull();
    });
});
