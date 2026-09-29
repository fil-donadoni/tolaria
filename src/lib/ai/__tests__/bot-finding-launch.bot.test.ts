// What a Reproducer label can do on the Bot Findings page (issue #4178): a
// saved scenario or a plain-board blade entry launches; a blade entry that
// needs setup steps gets a copy-command, never a launch.
import { describe, it, expect } from "vitest";
import { bladeEntryCommand, resolveReproducer } from "../bot-finding-launch";
import bladeReproducers from "../../../../data/blade-reproducers.json";
import bladeCardIndex from "../../../../data/blade-card-index.json";

const BLADE = {
    "plain board": { cards: [] },
    "needs setup": null,
};

describe("resolveReproducer", () => {
    it("a saved scenario launches, and wins over a blade entry of the same name", () => {
        const saved = { _id: "s1", label: "plain board", spec: { cards: [1] } };
        expect(resolveReproducer("plain board", [saved], BLADE)).toEqual({
            kind: "launch",
            label: "plain board",
            launch: saved,
        });
    });

    it("a setup-free blade entry launches through the same path, keyed by its label", () => {
        const action = resolveReproducer("plain board", [], BLADE);
        expect(action.kind).toBe("launch");
        if (action.kind === "launch")
            expect(action.launch).toEqual({
                _id: "blade:plain board",
                label: "plain board",
                spec: { cards: [] },
            });
    });

    it("a blade entry that needs setup steps is a copy-command, never a launch", () => {
        const action = resolveReproducer("needs setup", [], BLADE);
        expect(action.kind).toBe("command");
        if (action.kind === "command")
            expect(action.command).toBe(bladeEntryCommand("needs setup"));
    });

    it("a label naming nothing is shown as text", () => {
        expect(resolveReproducer("nope", [], BLADE).kind).toBe("unknown");
        // `Object.hasOwn`, not `in`: a prototype key is not a blade entry.
        expect(resolveReproducer("toString", [], BLADE).kind).toBe("unknown");
    });
});

describe("bladeEntryCommand", () => {
    it("single-quotes the label so `'` and `:` survive a shell paste", () => {
        expect(bladeEntryCommand("it's: a label")).toBe(
            "bunx vitest run --config vitest.blade.config.ts -t '^it'\\''s: a label$'"
        );
    });

    it("regex-escapes the label: vitest's -t is a pattern, and `(…)` must match itself", () => {
        const label = "charter: chump-blocks to survive lethal (block or die)";
        const command = bladeEntryCommand(label);
        const pattern = /-t '(.*)'$/.exec(command)![1]!;
        expect(new RegExp(pattern).test(label)).toBe(true);
        expect(
            new RegExp(pattern).test(
                "charter: chump-blocks to survive lethal block or die"
            )
        ).toBe(false);
        // Every committed label matches itself — and only itself.
        for (const l of Object.keys(bladeReproducers))
            expect(
                new RegExp(
                    /-t '(.*)'$/
                        .exec(bladeEntryCommand(l))![1]!
                        .replaceAll("'\\''", "'")
                ).test(l)
            ).toBe(true);
    });
});

describe("the committed artifacts", () => {
    it("every indexed blade entry is either launchable or a copy-command", () => {
        for (const entries of Object.values(bladeCardIndex))
            for (const e of entries) {
                const action = resolveReproducer(e.label, []);
                expect(action.kind).toBe(e.needsSetup ? "command" : "launch");
            }
        expect(Object.keys(bladeReproducers).length).toBeGreaterThan(0);
    });
});
