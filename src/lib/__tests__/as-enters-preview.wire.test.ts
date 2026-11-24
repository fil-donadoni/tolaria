// Issue #10224 — a permanent's persistent as-enters choice (CR 614.12) must
// reach the Live text for BOTH seats. Every board here crosses the real
// `projectPublicState` (a hand-built view carries the field by construction and
// proves nothing), then the real `buildPreviewBody` and the board's memo
// signature (`cardImageSignature`), whose blind spot was the root cause: a
// memoized CardImage kept the pre-choice instance, so the choice never showed.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import type { AsEntersChoice } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstance, Player } from "~/types/game";
import { AS_ENTERS_PREVIEW_COVERAGE } from "../as-enters-preview-coverage";
import { cardImageSignature } from "../card-image-signature";
import { buildPreviewBody } from "../preview-body";

type Choice = Partial<
    Pick<
        CardInstance,
        "chosenName" | "chosenModeId" | "chosenSubtypes" | "chosenPlayerId"
    >
>;

/** The card sits on P2's battlefield; the viewer is P1 (the opposing seat). */
function liveText(cardName: string, choice: Choice, viewerId = "p1") {
    const def = getCardByName(cardName);
    const perm = makeInstance(def.id, {
        id: "perm",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
        ...choice,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { name: "Alice" }),
            makePlayer("p2", { name: "Bob", battlefield: [perm] }),
        ],
    });
    const projected = projectPublicState(state, 1, viewerId);
    const players = projected.players as unknown as Player[];
    const onWire = players.find((p) => p.id === "p2")!
        .battlefield[0] as CardInstance;
    const body = buildPreviewBody(def.id, onWire, {
        allPlayers: players,
        playerId: viewerId,
    });
    return { text: (body.oracleParagraphs ?? []).join("\n"), onWire };
}

const FIXTURES: Record<
    Extract<AsEntersChoice["kind"], "name" | "mode" | "subtypes" | "opponent">,
    { card: string; choice: () => Choice; expected: string }
> = {
    name: {
        card: "Pithing Needle",
        choice: () => ({ chosenName: "Plains" }),
        expected: "chosen name (Plains)",
    },
    mode: {
        card: "Coldsteel Heart",
        choice: () => {
            const mode = getCardByName("Coldsteel Heart").modes?.find((m) =>
                /green/i.test(m.label || m.id)
            );
            return { chosenModeId: mode!.id };
        },
        expected: "chosen color (green)",
    },
    subtypes: {
        card: "Engineered Plague",
        choice: () => ({ chosenSubtypes: ["Elf"] }),
        expected: "chosen type (Elf)",
    },
    opponent: {
        card: "The Rack",
        choice: () => ({ chosenPlayerId: "p1" }),
        expected: "chosen player (Alice)",
    },
};

describe("as-enters choices reach the Live text, projected per seat", () => {
    for (const [kind, f] of Object.entries(FIXTURES)) {
        for (const viewer of ["p1", "p2"]) {
            it(`${kind} (${f.card}) — viewer ${viewer}`, () => {
                const { text } = liveText(f.card, f.choice(), viewer);
                expect(text).toContain(f.expected);
            });
        }
    }

    it("The Rack and Black Vise both name the chosen player", () => {
        for (const card of ["The Rack", "Black Vise"]) {
            const { text } = liveText(card, { chosenPlayerId: "p1" });
            expect(text).toContain("chosen player (Alice)");
        }
    });

    it("leaves the printed text alone while nothing is chosen", () => {
        const { text } = liveText("The Rack", {});
        expect(text).not.toContain("(");
    });
});

describe("class guard — every persistent as-enters kind is surfaced", () => {
    it("each `annotated` kind owns a fixture that shows its choice", () => {
        const annotated = Object.entries(AS_ENTERS_PREVIEW_COVERAGE)
            .filter(([, how]) => how === "annotated")
            .map(([kind]) => kind)
            .sort();
        expect(Object.keys(FIXTURES).sort()).toEqual(annotated);
    });
});

describe("cardImageSignature carries the as-enters choice (root cause)", () => {
    const base = (choice: Choice) => liveText("Pithing Needle", choice).onWire;

    it.each([
        ["chosenName", { chosenName: "Plains" }],
        ["chosenModeId", { chosenModeId: "G" }],
        ["chosenSubtypes", { chosenSubtypes: ["Elf"] }],
        ["chosenPlayerId", { chosenPlayerId: "p1" }],
    ] satisfies [string, Choice][])(
        "%s changes the signature once locked in",
        (_field, choice) => {
            expect(cardImageSignature(base(choice))).not.toBe(
                cardImageSignature(base({}))
            );
        }
    );
});
