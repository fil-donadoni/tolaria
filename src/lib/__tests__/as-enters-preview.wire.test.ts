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
import { getCardByName, tryGetDefinition } from "@convex/cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { AsEntersChoice, CardDefinition } from "@convex/cards/types";
import { applyPlayLand } from "@convex/gre/playLand";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
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
    // A registered name, or the id of a test-only definition.
    const def = tryGetDefinition(cardName) ?? getCardByName(cardName);
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
    return {
        text: (body.oracleParagraphs ?? []).join("\n"),
        paragraphs: body.oracleParagraphs ?? [],
        lines: body.choiceLines ?? [],
        onWire,
    };
}

/** The green line of `kind` and the paragraph it is anchored under. */
function lineOf(
    body: ReturnType<typeof liveText>,
    kind: string
): { text: string; anchor: string | undefined } | undefined {
    const line = body.lines.find((l) => l.kind === kind);
    if (!line) return undefined;
    return {
        text: `${line.label}: ${line.value}`,
        anchor: body.paragraphs[line.anchorIndex],
    };
}

const FIXTURES: Record<
    Extract<AsEntersChoice["kind"], "name" | "mode" | "subtypes" | "opponent">,
    {
        card: string;
        choice: () => Choice;
        expected: string;
        /** The green choice line (issue #10980) and the paragraph it sits under. */
        line: string;
        anchor: string;
    }
> = {
    name: {
        card: "Pithing Needle",
        choice: () => ({ chosenName: "Plains" }),
        expected: "chosen name (Plains)",
        line: "Chosen name: Plains",
        anchor: "As this artifact enters, choose a card name.",
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
        line: "Chosen color: Green",
        anchor: "As this artifact enters, choose a color.",
    },
    subtypes: {
        card: "Engineered Plague",
        choice: () => ({ chosenSubtypes: ["Elf"] }),
        expected: "chosen type (Elf)",
        line: "Chosen type: Elf",
        anchor: "As this enchantment enters, choose a creature type.",
    },
    opponent: {
        card: "The Rack",
        choice: () => ({ chosenPlayerId: "p1" }),
        expected: "chosen player (Alice)",
        line: "Chosen player: Alice",
        anchor: "As this artifact enters, choose an opponent.",
    },
};

describe("as-enters choices reach the Live text, projected per seat", () => {
    for (const [kind, f] of Object.entries(FIXTURES)) {
        for (const viewer of ["p1", "p2"]) {
            it(`${kind} (${f.card}) — viewer ${viewer}`, () => {
                const body = liveText(f.card, f.choice(), viewer);
                expect(body.text).toContain(f.expected);
                expect(lineOf(body, kind)).toEqual({
                    text: f.line,
                    anchor: f.anchor,
                });
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
        const { text, lines } = liveText("The Rack", {});
        expect(text).not.toContain("(");
        expect(lines).toEqual([]);
    });

    it("no choice on the instance → no green line, for every fixture", () => {
        for (const f of Object.values(FIXTURES)) {
            expect(liveText(f.card, {}).lines).toEqual([]);
        }
    });

    it("two chosen types → one plural line", () => {
        const body = liveText("Engineered Plague", {
            chosenSubtypes: ["Elf", "Goblin"],
        });
        expect(lineOf(body, "subtypes")?.text).toBe(
            "Chosen types: Elf, Goblin"
        );
    });
});

describe("choice line fallback — no choosing paragraph", () => {
    const fallbackDef = (): CardDefinition => ({
        ...getCardByName("Engineered Plague"),
        id: "test-chosen-type-no-choosing-paragraph",
        name: "Test Chosen Type Without Choosing Paragraph",
        oracleText:
            "Flash.\nAll creatures of the chosen kind get -1/-1.\nDraw a card.",
    });

    it("anchors the line after the last paragraph, with no plain 'Chosen:' paragraph", () => {
        withTemporaryDefinition(fallbackDef(), () => {
            const body = liveText(fallbackDef().id, {
                chosenSubtypes: ["Elf"],
            });
            expect(body.paragraphs).toHaveLength(3);
            expect(body.lines).toHaveLength(1);
            expect(body.lines[0].anchorIndex).toBe(2);
            expect(lineOf(body, "subtypes")?.text).toBe("Chosen type: Elf");
            expect(body.text).not.toMatch(/Chosen:/);
        });
    });
});

describe("Cavern of Souls — played as a land, full path (CR 614.12a)", () => {
    it("the as-enters answer reaches the opponent's Live text in place AND as a green line", () => {
        const cavern = getCardByName("Cavern of Souls");
        const inHand = makeInstance(cavern.id, {
            id: "cavern",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { name: "Alice", hand: [inHand] }),
                makePlayer("p2", { name: "Bob" }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        applyPlayLand(state, state.players[0], "cavern");
        const head = (state.pendingChoices ?? [])[0];
        expect(head?.asEntersKind).toBe("subtypes");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["Elf"],
        });

        const projected = projectPublicState(state, 1, "p2");
        const players = projected.players as unknown as Player[];
        const onWire = players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "cavern") as CardInstance;
        expect(onWire.chosenSubtypes).toEqual(["Elf"]);
        const body = buildPreviewBody(cavern.id, onWire, {
            allPlayers: players,
            playerId: "p2",
        });
        const paragraphs = body.oracleParagraphs ?? [];
        expect(paragraphs.join("\n")).toContain("chosen type (Elf)");
        const [line] = body.choiceLines ?? [];
        expect(line && `${line.label}: ${line.value}`).toBe("Chosen type: Elf");
        expect(paragraphs[line.anchorIndex]).toBe(
            "As this land enters, choose a creature type."
        );
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

    it("each `annotated` kind produces a green choice line (issue #10980)", () => {
        const annotated = Object.entries(AS_ENTERS_PREVIEW_COVERAGE)
            .filter(([, how]) => how === "annotated")
            .map(([kind]) => kind);
        for (const kind of annotated) {
            const f = FIXTURES[kind as keyof typeof FIXTURES];
            const body = liveText(f.card, f.choice());
            expect(lineOf(body, kind), kind).toBeDefined();
        }
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
