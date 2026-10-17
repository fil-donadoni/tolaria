// The name-a-card prompt in a CLIENT graph (issue #5616, PRD #5602): a game
// holds only its own shards, so the prompt loads the compiled Definition
// Index on demand — every nameable name, no definition, no shard.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { getChooseableCardNames } from "@convex/cards/catalogue";
import { chooseableNamesOf } from "@convex/cards/cardNames";
import { unpackCorpus } from "../../../../scripts/lib/packed-corpus";
import CardNameInput from "~/components/board/card-name-input";
import { compiledIndexUrl } from "~/lib/catalogue/compiled-shards";
import {
    PACKED,
    fetchedUrls,
    serveCompiledAssets,
} from "~/lib/catalogue/__tests__/compiledShardFixtures";

vi.mock(
    "@convex/cards/compiledPool",
    () => import("~/lib/catalogue/compiled-pool.browser")
);
vi.mock(
    "@convex/cards/setModules",
    () => import("~/lib/catalogue/set-modules.browser")
);

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("CardNameInput on a game route (issue #5616)", () => {
    it("loads the compiled names on demand — the index alone — then lists and submits a compiled card's name", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        const onSubmit = vi.fn();
        const { getByLabelText, getByText } = render(
            <CardNameInput disabled={false} onSubmit={onSubmit} />
        );
        const input = getByLabelText("Card name") as HTMLInputElement;
        // Nothing to choose from yet: the field waits for the names.
        expect(input.disabled).toBe(true);
        expect(input.placeholder).toBe("Loading card names…");

        await waitFor(() => expect(input.disabled).toBe(false));
        const name = PACKED.names[0]!;
        fireEvent.change(input, { target: { value: name.toLowerCase() } });
        fireEvent.click(getByText("Name it"));
        expect(onSubmit).toHaveBeenCalledWith(name);

        // Every nameable compiled name is in the list (CR 201.4) …
        const listed = new Set(getChooseableCardNames());
        for (const row of unpackCorpus(PACKED))
            for (const n of chooseableNamesOf(row))
                expect(listed.has(n), n).toBe(true);
        // … from ONE request: the names index, never a shard.
        expect(fetchedUrls(fetchMock)).toEqual([compiledIndexUrl]);
    });
});
