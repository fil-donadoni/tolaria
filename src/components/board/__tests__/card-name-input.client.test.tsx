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
    // First: the index is loaded once per graph, and kept.
    it("a failed names load is named with a Retry that really re-fetches — the prompt is never left dead", async () => {
        const served = serveCompiledAssets();
        let fail = true;
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) =>
                fail ? Promise.reject(new Error("offline")) : served(url)
            )
        );
        const { getByLabelText, findByText, getByText } = render(
            <CardNameInput disabled={false} onSubmit={() => {}} />
        );
        expect(
            await findByText("Card names failed to load: offline")
        ).toBeTruthy();
        const input = getByLabelText("Card name") as HTMLInputElement;
        expect(input.disabled).toBe(true);
        fail = false;
        fireEvent.click(getByText("Retry"));
        await waitFor(() => expect(input.disabled).toBe(false));
        // What the prompt loads is the names index alone — never a shard.
        expect(fetchedUrls(served)).toEqual([compiledIndexUrl]);
        cleanup();
    });

    it("loads the compiled names on demand — the index alone — then lists and submits a compiled card's name", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        const onSubmit = vi.fn();
        const { getByLabelText, getByText } = render(
            <CardNameInput disabled={false} onSubmit={onSubmit} />
        );
        const input = getByLabelText("Card name") as HTMLInputElement;
        // Nothing to choose from yet: the field waits for the names.
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
        // … and the index was resident already: no request at all, and
        // never a shard.
        expect(fetchedUrls(fetchMock)).toEqual([]);
    });
});
