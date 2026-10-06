// The read-only mutation tap (issue #3984): it hears every mutation a client
// sends, never changes one, and leaves the client as it found it.

import { describe, expect, it } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { tapClientMutations, type TappedMutation } from "../mutation-tap";

function fakeClient() {
    const sent: unknown[][] = [];
    const client = {
        mutation(...params: unknown[]) {
            sent.push(params);
            return "server-result";
        },
    };
    return { client: client as unknown as ConvexReactClient, sent };
}

const pass = makeFunctionReference<"mutation">("game:passPriority");

describe("tapClientMutations", () => {
    it("hears the call by name and args, and passes it through unchanged", () => {
        const { client, sent } = fakeClient();
        const heard: TappedMutation[] = [];
        tapClientMutations(client, (call) => heard.push(call));
        const result = client.mutation(pass, { gameId: "g", playerId: "p1" });
        expect(result).toBe("server-result");
        expect(sent).toEqual([[pass, { gameId: "g", playerId: "p1" }]]);
        expect(heard).toEqual([
            {
                name: "game:passPriority",
                args: { gameId: "g", playerId: "p1" },
            },
        ]);
    });

    it("a listener that throws never costs the mutation", () => {
        const { client, sent } = fakeClient();
        tapClientMutations(client, () => {
            throw new Error("listener bug");
        });
        expect(client.mutation(pass, {})).toBe("server-result");
        expect(sent).toHaveLength(1);
    });

    it("restores the client once the last listener leaves", () => {
        const { client } = fakeClient();
        const original = client.mutation;
        const heard: string[] = [];
        const untapA = tapClientMutations(client, () => heard.push("a"));
        const untapB = tapClientMutations(client, () => heard.push("b"));
        untapA();
        client.mutation(pass, {});
        expect(heard).toEqual(["b"]);
        untapB();
        expect(client.mutation).toBe(original);
    });
});
