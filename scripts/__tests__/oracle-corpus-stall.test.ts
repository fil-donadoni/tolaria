import { describe, expect, it } from "vitest";
import { withStallGuard } from "../oracle-corpus";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const x of it) out.push(x);
    return out;
}

describe("withStallGuard — a download stream cannot wait forever (issue #7937)", () => {
    it("passes every chunk of a stream that keeps emitting", async () => {
        async function* source() {
            yield 1;
            yield 2;
        }
        expect(await collect(withStallGuard(source(), 1000))).toEqual([1, 2]);
    });

    it("fails in bounded time on a stream that stops emitting", async () => {
        async function* source() {
            yield 1;
            await new Promise<never>(() => {}); // never settles
        }
        await expect(collect(withStallGuard(source(), 200))).rejects.toThrow(
            /download stalled/
        );
    });
});
