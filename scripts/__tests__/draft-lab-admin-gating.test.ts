// The Draft Lab's SERVER gate (ADR 0074, admin-only `/draft-lab`).
//
// `/draft-lab` renders a 404 for a non-admin (`src/routes/draft-lab.route.tsx`,
// tested in `src/routes/__tests__/draft-lab.route.test.tsx`), but a UI gate is
// cosmetic on its own: the two reads the workbench depends on are ordinary
// Convex queries anyone signed in could call directly. Both therefore gate on
// `assertIsAdmin`, and this test is what keeps them there — a well-meaning
// relaxation back to `getCurrentUserId` (which is what they shipped with, when
// the Lab was open to any authenticated user) would silently reopen every
// scope's Card Profiles and edited Pick Ratings to any account.
//
// A static source scan rather than a call-level test: the project has no
// convex-test harness (see `convex/__tests__/adminAuth.test.ts`), so a query's
// handler cannot be invoked with a fabricated identity here. "The gate is the
// first awaited statement in the handler" is checkable from the source,
// permanent, and independent of a harness. It lives under `scripts/__tests__`
// with the project's other repo-wide static guards
// (`bot-suite-boundary.test.ts`, `client-bundle-purity.test.ts`) rather than
// under `convex/`, since it only reads source text.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const LIMITED_DIR = path.resolve(__dirname, "..", "..", "convex", "limited");

/** The exported Convex functions the Draft Lab reads through, and the file
 *  each lives in. Both are Draft-Lab-only consumers today; if that ever stops
 *  being true, the fix is a second, differently-gated query — not loosening
 *  one of these. */
const ADMIN_GATED_DRAFT_LAB_QUERIES = [
    { file: "cardProfiles.ts", name: "listScopeCardProfiles" },
    { file: "cardRatings.ts", name: "listScopeCardRatingsForReplay" },
];

/** The source of one `export const <name> = query({ … });` block. */
function readExportBlock(file: string, name: string): string {
    const source = fs.readFileSync(path.join(LIMITED_DIR, file), "utf-8");
    const start = source.indexOf(`export const ${name} =`);
    expect(start, `${file} no longer exports ${name}`).toBeGreaterThan(-1);
    const end = source.indexOf("\n});", start);
    expect(end, `couldn't find the end of ${name} in ${file}`).toBeGreaterThan(
        start
    );
    return source.slice(start, end);
}

describe("Draft Lab reads are admin-gated server-side (ADR 0074)", () => {
    for (const { file, name } of ADMIN_GATED_DRAFT_LAB_QUERIES) {
        it(`${name} awaits assertIsAdmin before touching ctx.db`, () => {
            const block = readExportBlock(file, name);

            expect(
                block.includes("await assertIsAdmin(ctx)"),
                `${file}#${name} must gate on assertIsAdmin — the /draft-lab UI gate is cosmetic without it`
            ).toBe(true);

            // Order matters, not merely presence: gating AFTER a read would
            // still leak through a thrown-away result on some future refactor
            // (and mirrors the "assertIsAdmin runs FIRST" convention every
            // admin mutation in these files already documents).
            const gateAt = block.indexOf("await assertIsAdmin(ctx)");
            const dbAt = block.indexOf("ctx.db");
            expect(
                dbAt,
                `${file}#${name} no longer reads ctx.db`
            ).toBeGreaterThan(-1);
            expect(
                gateAt,
                `${file}#${name} touches ctx.db before its admin gate`
            ).toBeLessThan(dbAt);
        });

        it(`${name} does not fall back to the signed-in-only gate`, () => {
            const block = readExportBlock(file, name);
            expect(
                block.includes("getCurrentUserId"),
                `${file}#${name} gates on getCurrentUserId — any signed-in account could then read this scope`
            ).toBe(false);
        });
    }
});
