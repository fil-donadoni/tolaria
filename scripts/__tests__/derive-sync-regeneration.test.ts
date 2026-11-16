/**
 * `derive:sync`'s write-path order (issue #9915): the refit fits the card
 * pool the registry imports from `data/catalogue/`, so the weights it writes
 * must be the fit of the catalogue the same commit carries. On 2026-11-16
 * the refit ran on the catalogue HEAD committed — the previous tree's, after
 * a revert — and wrote `boardRemoval` 122.5 where the tree fits 156.7: six
 * Bot test files red at `9ea881da`, green under every bisect probe.
 *
 * The fake tree below is the one fact the order must respect: `pack` writes
 * the tree's catalogue to disk, `refit` writes the fit of the catalogue ON
 * DISK, `sweep` may move the tree's `ready` set.
 */
import { describe, expect, it } from "vitest";
import {
    runRegeneration,
    type DriftSweepResult,
    type RegenerationIo,
} from "../lib/derive-sync";

interface FakeTree {
    /** What `catalogue:pack` would write from the sources and lockfile. */
    source: string;
    /** The catalogue on disk — HEAD's until a pack. */
    disk: string;
    /** The weights on disk: the fit of the catalogue the last refit read. */
    weights: string;
    refits: number;
}

const fit = (catalogue: string): string => `fit(${catalogue})`;

function fakeIo(
    tree: FakeTree,
    opts: {
        sweep?: (tree: FakeTree) => DriftSweepResult;
        pack?: () => boolean;
        refit?: () => boolean;
    } = {}
): RegenerationIo {
    return {
        pack: () => {
            if (opts.pack && !opts.pack()) return false;
            tree.disk = tree.source;
            return true;
        },
        catalogue: () => tree.disk,
        refit: () => {
            tree.refits++;
            if (opts.refit && !opts.refit()) return false;
            tree.weights = fit(tree.disk);
            return true;
        },
        sweep: () =>
            opts.sweep ? opts.sweep(tree) : { ok: true, indexed: false },
    };
}

describe("runRegeneration — the committed weights are the fit of the committed catalogue (issue #9915)", () => {
    it("a tip whose committed catalogue is the previous tree's (a revert) refits on the catalogue packed from the tip", () => {
        const tree: FakeTree = {
            source: "reverted-pool",
            disk: "pre-revert-pool",
            weights: fit("pre-revert-pool"),
            refits: 0,
        };
        const result = runRegeneration(fakeIo(tree));
        expect(result).toEqual({ ok: true, refitted: true, indexed: false });
        expect(tree.disk).toBe("reverted-pool");
        expect(tree.weights).toBe(fit("reverted-pool"));
        expect(tree.refits).toBe(1);
    });

    it("a sweep that moves the pool (a card in or out of `ready`) refits once more, on the catalogue the commit carries", () => {
        const tree: FakeTree = {
            source: "pool",
            disk: "pool",
            weights: fit("pool"),
            refits: 0,
        };
        const result = runRegeneration(
            fakeIo(tree, {
                sweep: (t) => {
                    t.source = "pool+graduated";
                    return { ok: true, indexed: true };
                },
            })
        );
        expect(result).toEqual({ ok: true, refitted: true, indexed: true });
        expect(tree.disk).toBe("pool+graduated");
        expect(tree.weights).toBe(fit("pool+graduated"));
        expect(tree.refits).toBe(2);
    });

    it("the sweep plays on the refitted weights (it runs after the first refit)", () => {
        const tree: FakeTree = {
            source: "new-pool",
            disk: "old-pool",
            weights: fit("old-pool"),
            refits: 0,
        };
        let weightsAtSweep: string | null = null;
        runRegeneration(
            fakeIo(tree, {
                sweep: (t) => {
                    weightsAtSweep = t.weights;
                    return { ok: true, indexed: false };
                },
            })
        );
        expect(weightsAtSweep).toBe(fit("new-pool"));
    });

    it("a failed refit is reported, and the header and catalogue still land", () => {
        const tree: FakeTree = {
            source: "pool",
            disk: "old",
            weights: fit("old"),
            refits: 0,
        };
        const result = runRegeneration(fakeIo(tree, { refit: () => false }));
        expect(result).toEqual({ ok: true, refitted: false, indexed: false });
        expect(tree.disk).toBe("pool");
    });

    it("a pack or a sweep that fails builds no commit", () => {
        const packFails: FakeTree = {
            source: "p",
            disk: "o",
            weights: fit("o"),
            refits: 0,
        };
        expect(
            runRegeneration(fakeIo(packFails, { pack: () => false })).ok
        ).toBe(false);
        expect(packFails.refits).toBe(0);
        const sweepFails: FakeTree = { ...packFails, refits: 0 };
        expect(
            runRegeneration(
                fakeIo(sweepFails, {
                    sweep: () => ({ ok: false, indexed: false }),
                })
            ).ok
        ).toBe(false);
    });
});
