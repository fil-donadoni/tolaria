// Tokens in the debug scenario editor (CR 111 / 707.2).
//
// A token has no `CardDefinition`, so the scenario spec names it by
// token-catalogue key with `token: true` and the builder creates it through
// `createTokenPermanents`. The UI seam is exactly the "correct server-side,
// dead in the UI" class this repo keeps re-learning: the row must offer the
// token toggle, the name field must suggest TOKEN keys (not card names) while
// it's on, and the draft ⇄ spec round-trip must carry the flag. These tests
// drive the real components/helpers, never a hand-built stand-in.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { getAllTokenKeys } from "@convex/cards/tokenCatalogue";

import DebugScenarioCardFields from "../debug-scenario-card-fields";
import DebugCardNameField from "../debug-card-name-field";
import {
    cardToDraft,
    draftToCard,
    emptyCardDraft,
    type CardDraft,
} from "../scenario-draft";

beforeEach(() => cleanup());

describe("scenario draft ⇄ spec round-trip for a token row", () => {
    it("carries `token` through draftToCard and back", () => {
        const draft: CardDraft = {
            ...emptyCardDraft(),
            name: "Treasure",
            token: true,
            count: "3",
        };

        const card = draftToCard(draft);

        expect(card).toMatchObject({
            name: "Treasure",
            owner: "me",
            token: true,
            count: 3,
        });
        // CR 111.7 — a token exists only on the battlefield, so the row never
        // persists a zone.
        expect(card.zone).toBeUndefined();
        expect(cardToDraft(card).token).toBe(true);
    });

    it("leaves an ordinary card row untouched (no `token` field)", () => {
        const card = draftToCard({
            ...emptyCardDraft(),
            name: "Shivan Dragon",
            zone: "hand",
        });

        expect(card.token).toBeUndefined();
        expect(card.zone).toBe("hand");
    });
});

describe("DebugScenarioCardFields — token row", () => {
    const draft = emptyCardDraft();

    it("offers a token toggle that clears the name and locks the zone to battlefield", () => {
        const patches: Partial<CardDraft>[] = [];
        render(
            <DebugScenarioCardFields
                draft={{ ...draft, name: "Shivan Dragon", zone: "hand" }}
                index={0}
                onPatch={(p) => patches.push(p)}
                onRemove={() => {}}
            />
        );

        fireEvent.click(screen.getByLabelText("Card 1 is token"));

        expect(patches).toEqual([
            { token: true, name: "", zone: "battlefield" },
        ]);
    });

    it("disables the zone picker while the row places a token (CR 111.7)", () => {
        render(
            <DebugScenarioCardFields
                draft={{ ...draft, token: true }}
                index={0}
                onPatch={() => {}}
                onRemove={() => {}}
            />
        );

        expect(
            (screen.getByLabelText("Card 1 zone") as HTMLSelectElement).disabled
        ).toBe(true);
    });
});

describe("DebugCardNameField — token source", () => {
    it("suggests TOKEN catalogue keys, not card names, when source=tokens", () => {
        render(
            <DebugCardNameField
                value="Treas"
                onChange={() => {}}
                source="tokens"
                ariaLabel="Token name"
            />
        );

        fireEvent.focus(screen.getByLabelText("Token name"));

        const suggestion = screen.getByRole("button", { name: "Treasure" });
        expect(suggestion).toBeTruthy();
        expect(getAllTokenKeys()).toContain("Treasure");
    });

    it("still suggests card names by default", () => {
        render(
            <DebugCardNameField
                value="Shivan"
                onChange={() => {}}
                ariaLabel="Card name"
            />
        );

        fireEvent.focus(screen.getByLabelText("Card name"));

        expect(
            screen.getByRole("button", { name: "Shivan Dragon" })
        ).toBeTruthy();
    });
});
