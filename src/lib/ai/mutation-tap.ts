// A read-only tap on every mutation a Convex client sends (issue #3984).
//
// The human seat's moves reach the server through ~50 components, each holding
// its own `useMutation`, and every one of them calls `client.mutation` at
// invoke time (`convex/react`'s `createMutation`). Wrapping that ONE method is
// how the Verdict Proposal capture learns what the player submitted without
// threading a recorder through fifty call sites — or changing a single one.
//
// The tap only LISTENS: the call goes through unchanged, before any listener
// runs, and a listener that throws is swallowed — a question about a move must
// never be able to cost the move itself (ADR 0074: the client holds no
// authority, and this adds none).

import type { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";

/** One submitted mutation: its function name (`game:passPriority`) and args. */
export type TappedMutation = {
    name: string;
    args: Record<string, unknown>;
};

type Listener = (call: TappedMutation) => void;

type Mutate = ConvexReactClient["mutation"];
type AnyCall = (...params: unknown[]) => unknown;

const tapped = new WeakMap<
    ConvexReactClient,
    { listeners: Set<Listener>; original: Mutate }
>();

/** Start listening to `client`'s mutations. Returns the untap; the client's
 *  own method is restored once the last listener leaves. */
export function tapClientMutations(
    client: ConvexReactClient,
    listener: Listener
): () => void {
    let entry = tapped.get(client);
    if (!entry) {
        const original = client.mutation;
        const listeners = new Set<Listener>();
        const wrapped = function (
            this: ConvexReactClient,
            ...params: unknown[]
        ) {
            const result = (original as AnyCall).apply(this, params);
            const [reference, args] = params;
            let name: string;
            try {
                name = getFunctionName(
                    reference as FunctionReference<"mutation">
                );
            } catch {
                return result;
            }
            const call = {
                name,
                args: (args ?? {}) as Record<string, unknown>,
            };
            for (const l of listeners) {
                try {
                    l(call);
                } catch {
                    /* a listener never costs the mutation */
                }
            }
            return result;
        } as unknown as Mutate;
        client.mutation = wrapped;
        entry = { listeners, original };
        tapped.set(client, entry);
    }
    const current = entry;
    current.listeners.add(listener);
    return () => {
        current.listeners.delete(listener);
        if (current.listeners.size === 0 && tapped.get(client) === current) {
            client.mutation = current.original;
            tapped.delete(client);
        }
    };
}
