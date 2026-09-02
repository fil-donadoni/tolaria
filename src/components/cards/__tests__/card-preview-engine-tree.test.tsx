// The Engine View tree (issue #2704) rendered for each of the four card
// classes the issue names, every one of them through the REAL definition the
// registry hands the client (`getCardByName` / `tryGetDefinition`, ADR 0046) —
// never a hand-built fixture. A hand-built `CardDefinition` would pass this
// file forever while the real catalogue drifted underneath it, which is the
// same bug class `engine-view-badge.catalogue.test.ts` was written for.
//
// Assertions use plain `getByText`/`queryByText`/DOM queries, not jest-dom's
// custom matchers — `tsconfig.app.json`'s restricted `types` array doesn't
// pick up jest-dom's type augmentation (see `card-preview-engine-view.test.tsx`).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { getCardByName, tryGetDefinition } from "@convex/cards";
import { compiledReadyDefinitions } from "@convex/cards/compiledCatalogue";
import CardPreviewEngineTree from "../card-preview-engine-tree";
import { buildEngineViewTree } from "~/lib/engine-view-tree";
import type { CardDefinition } from "@convex/cards/types";

afterEach(cleanup);

/** The real definition, or a failure that names the card — a renamed/retired
 *  card must red HERE, not as an inscrutable "cannot read property of
 *  undefined" three frames into the builder. */
function realDefinition(name: string): CardDefinition {
    const def = getCardByName(name);
    if (!def) throw new Error(`no definition in the registry for "${name}"`);
    return def;
}

function renderTree(def: CardDefinition, gameId?: string) {
    return render(
        <CardPreviewEngineTree
            tree={buildEngineViewTree(def)}
            reportContext={{ gameId }}
        />
    );
}

describe("CardPreviewEngineTree (issue #2704)", () => {
    it("a DSL card renders its target group and its Effect Script Ops", () => {
        // Lightning Bolt: one `Creature|Player` target requirement, one
        // `dealDamage` Op reading `{ target: 0 }`.
        const { container, getAllByText, getByText } = renderTree(
            realDefinition("Lightning Bolt")
        );
        // TWICE on purpose: once as the `TGT` node announcing the target group,
        // once as the `dealDamage` Op's `to:` chip pointing back at it. That
        // cross-reference is the whole reason a positional `{ target: 0 }`
        // renders as `target #0` rather than as `target: 0` — the Op's chip has
        // to name something the player can find on screen.
        expect(getAllByText("target #0").length).toBe(2);
        getByText("dealDamage");
        // The chip census is derived from the Op's own keys, so the Op's
        // parameters are on screen rather than merely its name.
        expect(container.textContent).toContain("amount");
        expect(container.textContent).toContain("3");
        // Fully declarative: one body, covered.
        getByText("1/1 declarative");
        expect(
            container.querySelector("[data-engine-view-nodes]")
        ).not.toBeNull();
    });

    it("a compiled `ready` card walks the same path as a hand-written one", () => {
        // The contract of PRD #2693: "consumers never learn whether a
        // definition was compiled or hand-written". Slinking Skirge is a
        // compiled row (`data/oracle-compiled-pool.json`) registered through
        // the SAME `preloadDefinitions` seam, so it is fetched here the same
        // way — by id, out of the one registry — and produces the same node
        // kinds. There is deliberately no compiled-vs-hand-written branch in
        // `buildEngineViewTree` for this test to exercise.
        const pooled = compiledReadyDefinitions.find(
            (d) => d.name === "Slinking Skirge"
        );
        expect(pooled).toBeTruthy();
        const def = tryGetDefinition(pooled!.id);
        expect(def).toBeTruthy();

        const { container, getByText } = renderTree(def!);
        getByText("flying");
        getByText("activated");
        getByText("draw");
        getByText("1/1 declarative");
        expect(container.textContent).toContain("sacrifice");
    });

    it("a `resolve()` card renders a hand-written node and an uncovered bar", () => {
        // Camouflage is one of the two cards CLAUDE.md names as genuinely
        // protocol-like. The tree cannot look inside a closure, and says so
        // rather than rendering an empty well that reads as a broken component.
        const { container, getByText } = renderTree(
            realDefinition("Camouflage")
        );
        getByText("hand-written resolve()");
        getByText("0/1 declarative");
        // No Effect Script node can exist for a body that is a closure.
        expect(container.textContent).not.toContain("dealDamage");
    });

    it("a multi-face card renders its back face and that face's abilities", () => {
        // Jace, Vryn's Prodigy (CR 712): a creature whose back face is a
        // planeswalker with its own activated abilities. The face is a node,
        // and its abilities are that node's children — not siblings of the
        // front face's, which would read as abilities Jace has while still a
        // creature.
        const { container, getByText } = renderTree(
            realDefinition("Jace, Vryn's Prodigy")
        );
        getByText("Jace, Telepath Unbound");
        const face = Array.from(container.querySelectorAll("li")).find((li) =>
            li.textContent?.includes("Jace, Telepath Unbound")
        );
        expect(face).toBeTruthy();
        expect(face!.querySelectorAll("li").length).toBeGreaterThan(0);
    });

    it("a card with nothing to interpret says so instead of rendering an empty well", () => {
        // A basic land: no keywords, no abilities, no body. `Forest`'s mana is
        // an intrinsic ability of the land type (CR 305.6), not a definition
        // field, so there is genuinely nothing for the tree to read.
        const { getByText, container } = renderTree(realDefinition("Forest"));
        getByText(/Nothing to interpret/);
        expect(container.querySelector("[data-engine-view-nodes]")).toBeNull();
        // No bar either — a vacuous 100% would claim a coverage it has not
        // measured.
        expect(container.textContent).not.toContain("declarative");
    });

    // --- The three gaps PR #3034's review found, each pinned by the card that
    // --- proved it. All three were the same disease: the tree rendered only
    // --- what it had a named builder for, and everything else vanished with no
    // --- trace. The fixes are structural, so these tests guard the CLASS.

    it("renders the card's own rules riders, not just its abilities", () => {
        // Multiversal Passage carries `entersTappedUnlessPay: { life: 2 }` —
        // the CR 614.12 shock-land choice that IS the card's decision. Before
        // the fix the tree showed a `subtype-set` and a trigger and nothing
        // else: no node, no chip, no trace in the report text either.
        const { getByText, container } = renderTree(
            realDefinition("Multiversal Passage")
        );
        getByText("card");
        expect(container.textContent).toContain("entersTappedUnlessPay");
        expect(container.textContent).toContain("life: 2");
    });

    it("renders a modal option's own continuous effects", () => {
        // Phantasmal Terrain: a five-mode modal Aura whose ENTIRE effect is one
        // `staticEffects` entry per mode. `staticEffects` sat in the structural
        // skip set on the theory it was rendered elsewhere, and at the MODE
        // site nothing rendered it — five completely bare `MOD` nodes for a
        // card whose whole function is those five effects.
        const { getAllByText, container } = renderTree(
            realDefinition("Phantasmal Terrain")
        );
        // Twice: the `MOD` node's label, and the `subtypes:` chip on the
        // `STA` node underneath it. Before the fix the chip did not exist.
        expect(getAllByText("Island").length).toBe(2);
        // The mode's effect is the mode's CHILD, not a sibling: a flat list
        // would read as a card that sets every basic land type at once.
        const modes = Array.from(container.querySelectorAll("li")).filter(
            (li) => li.querySelector("span")?.textContent === "MOD"
        );
        expect(modes.length).toBe(5);
        for (const mode of modes) {
            expect(mode.querySelectorAll("li").length).toBe(1);
            expect(mode.textContent).toContain("subtype-set");
        }
    });

    it("recurses into EVERY nested Op body, not a hand-listed set of keys", () => {
        // Bend or Break: `divideIntoPiles` carries its two branches under
        // `chosenEffect` / `otherEffect`, which the key-list version of the
        // walk did not know about — they collapsed into one 400-character chip
        // whose real Ops read `[1]`. The rule is now structural (an Op-shaped
        // value is a body, anything else is a parameter), so a nesting key
        // added to the DSL tomorrow is covered on the day it lands.
        const { container } = renderTree(realDefinition("Bend or Break"));
        expect(container.textContent).toContain("chosenEffect");
        expect(container.textContent).toContain("otherEffect");
        // The Ops INSIDE those branches, which is what was actually lost.
        expect(container.textContent).toContain("destroy");
        expect(container.textContent).toContain("tapUntap");
    });

    it("the report action links to a pre-filled draft carrying name, id, game and tree", () => {
        const def = realDefinition("Lightning Bolt");
        const { container } = renderTree(def, "game-abc123");
        const link = container.querySelector(
            "[data-engine-view-report]"
        ) as HTMLAnchorElement;
        expect(link).toBeTruthy();
        expect(link.getAttribute("target")).toBe("_blank");
        const href = decodeURIComponent(link.getAttribute("href")!);
        expect(href).toContain("Lightning Bolt");
        expect(href).toContain(def.id);
        expect(href).toContain("game-abc123");
        expect(href).toContain("EFF dealDamage");
    });
});
