import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Section } from "../Section";
import { TONES, toneRuleClass, type Tone } from "../../lib/tones";

/**
 * The framed section (PRD #3148 S1).
 *
 * `tone` is the half a review would otherwise let through unexercised: the
 * table it resolves through is unit-tested, but the WIRING from the prop to
 * the rendered class is not, and a section whose left rule silently never
 * paints is exactly the kind of regression that looks fine in a diff.
 */
describe("Section", () => {
    it("renders the title, the meta line and the body", () => {
        render(
            <Section title="Loop status" meta={<span>4 claims</span>}>
                <p>body</p>
            </Section>
        );
        expect(screen.getByRole("heading").textContent).toBe("Loop status");
        expect(screen.getByText("4 claims")).not.toBeNull();
        expect(screen.getByText("body")).not.toBeNull();
    });

    it.each(TONES)("wires the %s tone through to a left rule", (tone) => {
        const { container } = render(
            <Section title="t" tone={tone as Tone}>
                <p>body</p>
            </Section>
        );
        const section = container.querySelector("section")!;
        expect(section.className).toContain(toneRuleClass(tone as Tone));
        expect(section.className).toContain("border-l-2");
    });

    it("paints no rule at all without a tone — a container carries no verdict of its own", () => {
        const { container } = render(<Section title="t">body</Section>);
        expect(container.querySelector("section")!.className).not.toContain(
            "border-l-2"
        );
    });
});
