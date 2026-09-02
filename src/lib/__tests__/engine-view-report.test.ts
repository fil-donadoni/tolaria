// The "Report a problem" draft (issue #2704). What this file guards is the
// part of the feature that has no visual tell: a URL that is too long comes
// back from GitHub as a 414 error page in a tab the player already switched
// to, and a body missing the card id produces a report nobody can act on.
import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    buildEngineViewTree,
    renderEngineTreeText,
} from "~/lib/engine-view-tree";
import {
    buildEngineViewReportBody,
    buildEngineViewReportUrl,
} from "~/lib/engine-view-report";
import type { CardDefinition } from "@convex/cards/types";

function realDefinition(name: string): CardDefinition {
    const def = getCardByName(name);
    if (!def) throw new Error(`no definition in the registry for "${name}"`);
    return def;
}

const BOLT = () => buildEngineViewTree(realDefinition("Lightning Bolt"));

describe("buildEngineViewReportBody (issue #2704)", () => {
    it("carries the card name, the card id and the rendered tree", () => {
        const tree = BOLT();
        const body = buildEngineViewReportBody(tree);
        expect(body).toContain("Lightning Bolt");
        expect(body).toContain(tree.cardId);
        expect(body).toContain(renderEngineTreeText(tree));
        expect(body).toContain("```text");
    });

    it("names the id as a Scryfall PRINT id, because that is what it is", () => {
        // ADR 0108: the project has ONE id space and a `CardDefinition` carries
        // no oracle id at all. Labelling this "oracle id" would send whoever
        // receives the report to an oracle-id lookup that never resolves.
        expect(buildEngineViewReportBody(BOLT())).toContain(
            "Scryfall print id"
        );
    });

    it("includes the game id when there is one and omits the line when there is not", () => {
        expect(
            buildEngineViewReportBody(BOLT(), { gameId: "g-123" })
        ).toContain("g-123");
        const outOfGame = buildEngineViewReportBody(BOLT(), { gameId: null });
        expect(outOfGame).not.toContain("Game id");
    });

    it("states the engine's own reading, so a report is legible without opening the card", () => {
        const body = buildEngineViewReportBody(BOLT());
        expect(body).toContain("dsl");
        expect(body).toContain("1/1 resolution bodies are declarative");
    });
});

describe("buildEngineViewReportUrl (issue #2704)", () => {
    it("targets the tracker's issue-compose form with title and body prefilled", () => {
        const url = buildEngineViewReportUrl(BOLT());
        expect(url.startsWith("https://github.com/")).toBe(true);
        expect(url).toContain("/issues/new?title=");
        expect(url).toContain("&body=");
        expect(decodeURIComponent(url)).toContain("Lightning Bolt");
    });

    it("elides the TREE rather than emitting a URL GitHub answers with a 414", () => {
        // Synthesised from a real tree so the shape stays honest: 4,000 Ops is
        // past anything in the catalogue, which is the point — the ceiling has
        // to hold for whatever the catalogue grows into, and no real card can
        // be relied on to sit above it today and still be there next month.
        const tree = BOLT();
        const huge = {
            ...tree,
            nodes: Array.from({ length: 4000 }, (_, i) => ({
                path: `eff.${i}`,
                kind: "EFF" as const,
                label: "dealDamage",
                chips: [{ key: "amount", value: String(i) }],
                children: [],
            })),
        };
        const url = buildEngineViewReportUrl(huge);
        expect(url.length).toBeLessThanOrEqual(6000);
        const body = decodeURIComponent(url);
        // Everything a maintainer cannot reconstruct survives the elision.
        expect(body).toContain("Lightning Bolt");
        expect(body).toContain(tree.cardId);
        expect(body).toContain("tree omitted");
    });
});

describe("renderEngineTreeText (issue #2704)", () => {
    it("indents children under their parent, two spaces per level", () => {
        // Jace, Vryn's Prodigy (CR 712): the back face's abilities are that
        // face's children. A flat rendering would report them as abilities the
        // front face has.
        const text = renderEngineTreeText(
            buildEngineViewTree(realDefinition("Jace, Vryn's Prodigy"))
        );
        const faceLine = text
            .split("\n")
            .findIndex((line) => line.startsWith("FACE "));
        expect(faceLine).toBeGreaterThanOrEqual(0);
        expect(text.split("\n")[faceLine + 1].startsWith("  ")).toBe(true);
    });

    it("renders each node as `KIND label — chips`", () => {
        const text = renderEngineTreeText(BOLT());
        expect(text).toContain("TGT target #0");
        expect(text).toMatch(/EFF dealDamage — .*amount: 3/);
    });
});
