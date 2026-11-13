// Built deck view (issue #8899): renders one seat's Draft Table Audit fields
// off a REAL completed Lab draft, measured by the shared audit module
// (`buildDraftLabBuiltSeats` → `draftTableAudit.ts#auditSeatDeck`), and its
// Maindeck grouped by curve. Plain `getByText` queries, as the sibling tests
// (`tsconfig.app.json` carries no jest-dom types).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import DraftLabBuiltDeckPanel from "../draft-lab-built-deck-panel";
import {
    buildDraftLabBuiltSeats,
    runFullDraftLab,
    standardPackSlots,
} from "@/lib/limited/draftLabEngine";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";

afterEach(cleanup);

function fieldValue(label: string): string {
    return screen.getByText(label, { selector: "dt" }).nextElementSibling!
        .textContent!;
}

describe("DraftLabBuiltDeckPanel (issue #8899)", () => {
    const state = runFullDraftLab(3, standardPackSlots(CUBE_SOURCE_KEY));
    const built = buildDraftLabBuiltSeats(state).find(
        (s) => s.audit.planArchetype !== null && s.audit.planShare !== null
    )!;

    it("renders the audit's per-deck fields for the seat", () => {
        const { audit } = built;
        render(<DraftLabBuiltDeckPanel seatLabel="Bot 1" built={built} />);

        expect(screen.getByText("Bot 1 — built deck")).not.toBeNull();
        expect(fieldValue("plan")).toBe(
            `${audit.planArchetype} · ${Math.round(audit.planShare! * 100)}%`
        );
        expect(fieldValue("colours")).toBe(audit.colors.join(""));
        expect(fieldValue("main")).toBe(`${audit.mainSize}`);
        expect(fieldValue("lands")).toBe(`${audit.landCount}`);
        expect(fieldValue("curve")).toBe(
            audit.curve
                .slice(1)
                .map((n, i) => `${i === 5 ? "6+" : i + 1}:${n}`)
                .join(" ")
        );
        expect(fieldValue("castability")).toMatch(
            new RegExp(`^${Math.round(audit.meanCastability! * 100)}% · T`)
        );
        const early = audit.earlyCastability;
        expect(fieldValue("early castability")).toBe(
            `${early.mean === null ? "—" : `${Math.round(early.mean * 100)}%`} · ${early.below}/${early.spells} below 80%`
        );
        expect(fieldValue("splash")).toBe(
            audit.splash
                ? `${audit.splash.cards} cards · ${audit.splash.strained} double-pip or MV ≤ 2`
                : "—"
        );
        expect(fieldValue("off-colour duals")).toBe(`${audit.offColourDuals}`);
        expect(fieldValue("capability pairs")).toBe(`${audit.capabilityPairs}`);
        expect(fieldValue("unreviewed")).toMatch(
            /^archetypes .+ · capabilities /
        );
    });

    it("groups the whole Maindeck by curve, lands last", () => {
        render(<DraftLabBuiltDeckPanel seatLabel="Bot 1" built={built} />);

        const headings = screen
            .getAllByRole("heading", { level: 4 })
            .map((h) => h.textContent!);
        expect(headings.at(-1)).toBe(`Lands (${built.audit.landCount})`);
        const total = headings
            .map((h) => Number(/\((\d+)\)$/.exec(h)![1]))
            .reduce((a, b) => a + b, 0);
        expect(total).toBe(built.deck.cards.length);
        const listed = [...document.querySelectorAll("section > p")].map(
            (p) => p.textContent!
        );
        for (const card of built.deck.cards) {
            expect(listed.some((t) => t.includes(card.cardName))).toBe(true);
        }
    });
});
