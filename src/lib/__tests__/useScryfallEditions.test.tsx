// `useScryfallEditions` must surface the editions its own fetch caches. A
// `useMemo([cardName])` over the cache served the empty first read forever —
// the fetch fills the cache AFTER that render, and only the `loading` flip
// re-renders — so a Full Catalogue card's printings never reached the
// printing picker (issue #4122).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useScryfallEditions } from "../scryfallApi";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("useScryfallEditions", () => {
    it("returns the fetched editions once load() resolves", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    data: [
                        {
                            id: "f29ec16d-7fe8-47ab-8a10-22aabd3c6dd1",
                            set: "lea",
                            collector_number: "1",
                        },
                        {
                            id: "3fbdd46c-c36c-4e6b-ae00-1e14097645b4",
                            set: "ody",
                            collector_number: "2",
                        },
                    ],
                }),
                { status: 200 }
            )
        );
        const { result } = renderHook(() =>
            useScryfallEditions("Stale Memo Probe")
        );
        expect(result.current.editions).toBeUndefined();
        act(() => result.current.load());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.editions?.map((e) => e.setCode)).toEqual([
            "lea",
            "ody",
        ]);
    });
});
