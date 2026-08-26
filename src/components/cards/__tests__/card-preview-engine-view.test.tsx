// The Engine View slot (ADR 0103 §9, issue #2728) — until #2704 lands its
// keyword/target/effect tree, the slot renders only the DSL/protocol badge
// read off the real `CardDefinition` (`computeEngineViewBadge`,
// `~/lib/preview-body`). This pins the slot's own render contract: the
// full-slot header + empty tree well #2704 mounts into, and the compact
// (desktop lateral zoom) badge-plus-hint form.
//
// Assertions use plain `getByText`/`queryByText`/DOM queries, not jest-dom's
// `toBeInTheDocument`/`toBeEmptyDOMElement` custom matchers —
// `tsconfig.app.json`'s restricted `types` array doesn't pick up jest-dom's
// type augmentation (see `draft-lab-term-breakdown.test.tsx`), and
// `getByText` itself throws when nothing matches, so a bare call already
// proves presence.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CardPreviewEngineView from "../card-preview-engine-view";

afterEach(cleanup);

describe("CardPreviewEngineView (issue #2728)", () => {
    it("renders nothing when there is no CardDefinition to read", () => {
        const { container } = render(<CardPreviewEngineView badge={null} />);
        expect(container.innerHTML).toBe("");
    });

    it("full slot: shows the eyebrow header, the DSL badge with its Op count, and an empty tree well for #2704", () => {
        const { container, getByText } = render(
            <CardPreviewEngineView badge={{ kind: "dsl", opCount: 3 }} />
        );
        getByText("Engine view");
        getByText("DSL · 3");
        const slot = container.querySelector("[data-engine-view-slot]");
        expect(slot).not.toBeNull();
        // The tree well #2704 mounts into — present and EMPTY.
        const tree = container.querySelector("[data-engine-view-tree]");
        expect(tree).not.toBeNull();
        expect(tree!.children.length).toBe(0);
    });

    it("full slot: a zero Op count reads bare 'DSL', not 'DSL · 0'", () => {
        const { getByText, queryByText } = render(
            <CardPreviewEngineView badge={{ kind: "dsl", opCount: 0 }} />
        );
        getByText("DSL");
        expect(queryByText("DSL · 0")).toBeNull();
    });

    it("full slot: a card with NO resolution body keeps the header and the tree well but shows NO chip", () => {
        // 24.6% of the catalogue (vanilla creatures, basic lands, pure
        // `staticEffects[]` anthems). The chip is a claim about the card's
        // script; with no script there is nothing to claim, and a bare `DSL`
        // here asserted one that does not exist. The WELL still renders —
        // it is #2704's mount point, and #2704's tree covers keywords and
        // static effects too.
        const { container, getByText, queryByText } = render(
            <CardPreviewEngineView badge={{ kind: "none" }} />
        );
        getByText("Engine view");
        expect(queryByText("DSL")).toBeNull();
        expect(queryByText("Protocol")).toBeNull();
        expect(
            container.querySelector("[data-engine-view-tree]")
        ).not.toBeNull();
    });

    it("compact: a card with NO resolution body shows the hint alone, no chip", () => {
        const { getByText, queryByText } = render(
            <CardPreviewEngineView badge={{ kind: "none" }} compact />
        );
        getByText("Alt: engine view");
        expect(queryByText("DSL")).toBeNull();
        expect(queryByText("Protocol")).toBeNull();
    });

    it("full slot: shows Protocol for a hand-written resolve() card", () => {
        const { getByText } = render(
            <CardPreviewEngineView badge={{ kind: "protocol" }} />
        );
        getByText("Protocol");
    });

    it("compact (desktop lateral zoom): badge + 'Alt: engine view' hint, no header or tree well", () => {
        const { container, getByText, queryByText } = render(
            <CardPreviewEngineView
                badge={{ kind: "dsl", opCount: 1 }}
                compact
            />
        );
        getByText("DSL · 1");
        getByText("Alt: engine view");
        expect(queryByText("Engine view")).toBeNull();
        expect(container.querySelector("[data-engine-view-slot]")).toBeNull();
        expect(container.querySelector("[data-engine-view-tree]")).toBeNull();
    });
});
