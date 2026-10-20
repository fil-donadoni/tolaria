// The Brain worker's Manifest travels with the Worker's life (issue #5617).
//
// The worker installs only the shards of what it was primed with
// (`brain-residency.ts`); a compiled card it was not primed with is LOCATED
// through the catalogue-wide compiled index, ~175 KB gzip. A Worker replaced
// after a failure (issue #3040) starts with nothing resident, so a prime that
// went only to the dead one would make the replacement pay that index on its
// first consult. Drives the REAL `brain-client` with a stub `Worker` that
// records what it is posted.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { DefinitionManifestEntry } from "@convex/definitionManifestEntry";
import { disposeBrain, primeBrain, warmBrain } from "../brain-client";
import { clearAiDecisions } from "../trace-store";

const instances: RecordingWorker[] = [];

class RecordingWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    readonly posted: unknown[] = [];
    constructor() {
        instances.push(this);
    }
    postMessage(message: unknown) {
        this.posted.push(message);
    }
    terminate() {}
}

const originalWorker = globalThis.Worker;

const entry = (
    definitionId: string,
    setCode: string
): DefinitionManifestEntry => ({
    definitionId,
    setCode,
});
const BOLT = entry("bolt", "lea");
const ELF = entry("elf", "mm3");
const SHARK = entry("shark", "mir");

const primes = (w: RecordingWorker) =>
    w.posted.filter(
        (m): m is { kind: "prime"; entries: DefinitionManifestEntry[] } =>
            (m as { kind?: unknown }).kind === "prime"
    );

beforeEach(() => {
    instances.length = 0;
    (globalThis as { Worker?: unknown }).Worker = RecordingWorker;
});

afterEach(() => {
    disposeBrain();
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
    // A replaced Worker leaves its failure breadcrumb in the decision ring —
    // module state a shared `bot-node` worker hands the next file (issue
    // #6151).
    clearAiDecisions();
});

describe("primeBrain", () => {
    it("posts the Worker its Manifest entries, each only once", () => {
        warmBrain();
        primeBrain([BOLT, ELF]);
        primeBrain([ELF, SHARK]);
        primeBrain([BOLT]);

        expect(instances).toHaveLength(1);
        expect(primes(instances[0]!).map((m) => m.entries)).toEqual([
            [BOLT, ELF],
            [SHARK],
        ]);
    });

    it("hands a REPLACEMENT Worker every entry primed this game, before anything else", () => {
        warmBrain();
        primeBrain([BOLT, ELF]);
        instances[0]!.onerror?.({ message: "boom" });

        // The next call spawns the replacement (issue #3040's respawn).
        primeBrain([SHARK]);

        expect(instances).toHaveLength(2);
        const replacement = instances[1]!;
        expect(replacement.posted[0]).toEqual({
            kind: "prime",
            entries: [BOLT, ELF, SHARK],
        });
        expect(primes(replacement)).toHaveLength(1);
    });

    it("starts the next game with nothing primed", () => {
        warmBrain();
        primeBrain([BOLT]);
        disposeBrain();

        warmBrain();
        expect(primes(instances[1]!)).toEqual([]);
        primeBrain([BOLT]);
        expect(primes(instances[1]!).map((m) => m.entries)).toEqual([[BOLT]]);
    });

    it("is a no-op where there is no Worker", () => {
        (globalThis as { Worker?: unknown }).Worker = undefined;
        expect(() => primeBrain([BOLT])).not.toThrow();
    });
});
