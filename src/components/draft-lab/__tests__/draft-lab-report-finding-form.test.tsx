// "Report finding" on a Draft Lab seat's built deck (issue #8900): the Draft
// Lab's one write (ADR 0074, Amendment I) sends the seat's draft context and
// the note to `botFindings.reportDraftFinding`, then says it was reported and
// cannot be sent twice.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import DraftLabReportFindingForm from "../draft-lab-report-finding-form";

const mutationCalls: { name: string; args: unknown }[] = [];

vi.mock("convex/react", () => ({
    useMutation: (mutation: { _name: string }) => (args: unknown) => {
        mutationCalls.push({ name: mutation._name, args });
        return Promise.resolve("finding-id");
    },
}));

vi.mock("@convex/_generated/api", () => {
    const leaf = (name: string): unknown =>
        new Proxy(
            { _name: name },
            {
                get: (target, prop) =>
                    prop === "_name" || typeof prop === "symbol"
                        ? Reflect.get(target, prop)
                        : leaf(String(prop)),
            }
        );
    return { api: leaf("") };
});

const CONTEXT = { seed: 42, scope: "cube", seatIndex: 3, scorerVersion: 2 };

beforeEach(() => {
    mutationCalls.length = 0;
});
afterEach(cleanup);

describe("DraftLabReportFindingForm (issue #8900)", () => {
    it("files the seat's draft context and the note, once", async () => {
        render(<DraftLabReportFindingForm draftContext={CONTEXT} />);
        fireEvent.change(
            screen.getByLabelText("What is wrong with this build"),
            { target: { value: "three-colour pile" } }
        );
        const button = screen.getByRole("button", { name: "Report finding" });
        fireEvent.click(button);

        expect(mutationCalls).toEqual([
            {
                name: "reportDraftFinding",
                args: { draftContext: CONTEXT, note: "three-colour pile" },
            },
        ]);
        expect((await screen.findByRole("status")).textContent).toContain(
            "Reported"
        );
        expect((button as HTMLButtonElement).disabled).toBe(true);
    });
});
