// Guard: THE ENGINE IS BLIND TO PRINTS (ADR 0140 §6, issue #4119).
//
// The printing a player chose rides the engine as two opaque cosmetic values:
// `imagePrintId` (written by deck setup from the deck entry's Print ID, and by
// a copy effect's "except" art pin) and `sourcePrintId` (stamped on a created
// token, PRD #4115). No rules module may read either — a rule that branched on
// a printing would make two games with the same cards play differently
// depending on which art each player picked. The closed list of modules that
// may touch them is the ADR's: deck setup, token creation, copy,
// serialisation and projection (projection lives outside `convex/gre/`, in
// `convex/gameProjections.ts`, so it has no row here).
//
// Sibling in form to `drawPrimitiveGuard.test.ts` and
// `engineIdentifierNames.test.ts` (`convex/cards/__tests__/`): a source sweep
// against a narrow allowlist whose every entry is asserted to still be
// load-bearing, so it empties out instead of rotting.
//
// READ THROUGH THE TYPESCRIPT AST, not a regex: a comment naming the field is
// not a reader (dozens of doc comments explain why a spec pins no
// `imagePrintId`), while a string literal is (`"imagePrintId" in spec`). A
// type MEMBER declaration (`imagePrintId?: string` on an interface) is a
// declaration, not a read, so it is skipped; every other identifier or string
// literal spelling either name counts — property access, object-literal key,
// shorthand, destructuring, element access.
//
// This file reads SOURCE TEXT under Node's `fs`/`path` — a `.test.ts` file is
// never bundled into the deployed Convex function set.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const GRE_DIR = path.resolve("convex/gre");

const PRINT_FIELDS: ReadonlySet<string> = new Set([
    "imagePrintId",
    "sourcePrintId",
]);

/** The ADR 0140 §6 closed list, plus the one census row that exists to keep
 *  the field OUT of a behavioural comparison. */
type Role =
    | "deck setup"
    | "token creation"
    | "copy"
    | "serialisation"
    | "cosmetic-key exclusion";

interface AllowlistEntry {
    /** Path relative to `convex/gre`, POSIX separators. */
    readonly file: string;
    readonly role: Role;
    readonly reason: string;
}

const PRINT_READER_ALLOWLIST: readonly AllowlistEntry[] = [
    {
        file: "setup.ts",
        role: "deck setup",
        reason: "writes the deck entry's chosen Print ID into `imagePrintId` when it differs from the definition's own printing (`deckPrintPin`).",
    },
    {
        file: "state.ts",
        role: "token creation",
        reason: "`createTokenPermanents` resolves a token spec's printed-token art and stamps it on the synthesized token definition / instance.",
    },
    {
        file: "transform.ts",
        role: "token creation",
        reason: "registers a synthesized double-faced token's BACK-face definition, carrying the spec's own printed art (issue #1595).",
    },
    {
        file: "effects/validate.ts",
        role: "token creation",
        reason: "shape-validates the `imagePrintId` key of a `createToken` / `createTokenCopy` spec and a copy `except` block (non-empty string).",
    },
    {
        file: "copy.ts",
        role: "copy",
        reason: "a copy effect's CR 707.9 art-pin exception (Eternalize / Embalm token frame) is set on apply and cleared on revert.",
    },
    {
        file: "effects/interpreter.ts",
        role: "copy",
        reason: "forwards a copy Op's `except.imagePrintId` into the `CopyEffectOptions` `copy.ts` applies.",
    },
    {
        file: "state/cardFieldLifecycle.ts",
        role: "serialisation",
        reason: "the `CARD_FIELD_LIFECYCLE` codec row that compacts and expands the instance field.",
    },
    {
        file: "ai/botReachTarget.ts",
        role: "cosmetic-key exclusion",
        reason: "names the field in the set of definition keys that carry NO behaviour, so the Bot's plain-body test ignores art — the blindness rule, applied.",
    },
];

/** Every `.ts` source file under `convex/gre/**`, excluding tests and test
 *  fixtures. */
function collectEngineFiles(root: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name === "__tests__" || entry.name === "fixtures") continue;
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectEngineFiles(full));
        } else if (
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".test.ts")
        ) {
            out.push(full);
        }
    }
    return out;
}

/** Occurrences of a print field in `source` that are READS or WRITES — every
 *  identifier / string literal spelling one, except a type member's own name. */
function countPrintFieldUses(fileName: string, source: string): number {
    const sf = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    let count = 0;
    const visit = (node: ts.Node): void => {
        const text =
            ts.isIdentifier(node) || ts.isStringLiteralLike(node)
                ? node.text
                : undefined;
        if (
            text !== undefined &&
            PRINT_FIELDS.has(text) &&
            !(ts.isPropertySignature(node.parent) && node.parent.name === node)
        ) {
            count++;
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return count;
}

function engineUses(): Map<string, number> {
    const uses = new Map<string, number>();
    for (const file of collectEngineFiles(GRE_DIR)) {
        const rel = path.relative(GRE_DIR, file).split(path.sep).join("/");
        const n = countPrintFieldUses(rel, fs.readFileSync(file, "utf8"));
        if (n > 0) uses.set(rel, n);
    }
    return uses;
}

describe("engine print blindness (ADR 0140 §6, issue #4119)", () => {
    const uses = engineUses();
    const allowed = new Set(PRINT_READER_ALLOWLIST.map((e) => e.file));

    it("no module under convex/gre reads imagePrintId / sourcePrintId outside the closed list", () => {
        const offenders = [...uses.keys()]
            .filter((file) => !allowed.has(file))
            .map((file) => `${file}: ${uses.get(file)} use(s)`);
        expect(
            offenders,
            "a module under convex/gre/ reads a print field. The engine is blind to prints " +
                "(ADR 0140 §6): no rules decision may depend on which printing a player chose. " +
                "Move the read to the client or the projection — or, if the module IS deck " +
                "setup, token creation, copy or serialisation, add a PRINT_READER_ALLOWLIST row."
        ).toEqual([]);
    });

    it("every PRINT_READER_ALLOWLIST row is still load-bearing", () => {
        const stale = PRINT_READER_ALLOWLIST.filter(
            (e) => !uses.has(e.file)
        ).map(
            (e) =>
                `${e.file} (${e.role}) no longer touches a print field — remove its row`
        );
        expect(stale).toEqual([]);
    });

    it("counts reads and writes but not comments or type members", () => {
        const src = [
            "// imagePrintId in a comment",
            "/** sourcePrintId in a doc */",
            "interface T { imagePrintId?: string }",
            "const a = card.imagePrintId;",
            "const b = { sourcePrintId: 'x' };",
            "if ('imagePrintId' in spec) {}",
            "const { imagePrintId } = card;",
            "delete card['sourcePrintId'];",
        ].join("\n");
        expect(countPrintFieldUses("probe.ts", src)).toBe(5);
    });
});
