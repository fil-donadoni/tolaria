// Catalogue-wide guard: `PendingChoice.subjectCardId` may be ORIGINATED only
// by an allowlisted, individually-audited set of files (issue #1982, CR
// 406.3).
//
// WHY THIS EXISTS. `pendingChoices` crosses the wire to BOTH viewers
// unredacted (`convex/gameProjections.ts` — `projectPublicState` forwards it
// via the `...state` spread), and `subjectCardId` is the one field on it that
// pins a CARD's identity for the client to render as an image
// (`<PendingChoicePrompt>`, issue #3413). A value handed in by hand — rather
// than derived from the card's own already-public visibility — is a direct
// CR 406.3 leak: a face-down hideaway card, pinned, would show the opponent
// exactly what `<CardImage>` renders for the chooser.
//
// The type's own doc comment (`convex/gre/state/declarations.ts`,
// `PendingChoice.subjectCardId`) states the rule in prose: "THE RULE: set it
// only for a card whose identity is ALREADY PUBLIC… the two producers that
// cannot reach a SpellContext at all (`gre/madness.ts`, `gre/rebound.ts`) set
// it unconditionally and are correct in substance." `interpreter.ts`'s own
// comment on the sanctioned path is blunter: "A call site that passed the id
// in by hand would be the leak; nothing does." This guard is what keeps that
// true — a THIRD hand-set call site would be the leak nothing catches, since
// no wire-level redaction exists to fall back on (see the extensive per-site
// discipline this codebase uses instead: `colorless.test.ts`'s Shelldock
// Isle suite, `interpreter.test.ts`'s cascade/chooseNumber/payVariableMana
// wire tests — all assert the CHOSEN wording is safe, none rely on the
// projection to scrub it).
//
// Sibling in form to `mechanicsRegistry.test.ts` (Guard A) /
// `divergenceMarkers.test.ts` (Guard B): a narrow allowlist, individually
// justified, that a new producer must extend deliberately rather than land
// silently. PRESENCE only, exactly like Guard B — this does not re-verify
// that each allowlisted site derives the id correctly (that is each site's
// own reference test's job); it only stops a FIFTH, unaudited one from
// appearing unnoticed.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const GRE_ROOT = path.join(__dirname, "..");

// Every file this guard has individually verified derives `subjectCardId`
// from the card's OWN public visibility rather than an unconditional pin:
//  - `effects/interpreter.ts` — `ctx.getPublicCardIdentity(...)`, the
//    sanctioned SpellContext path (resolve-time Cast/Decline offers).
//  - `madness.ts` / `rebound.ts` — SpellContext-less producers; the card was
//    already made public by the PRECEDING step in the same turn (a public
//    discard, a public stack object) before either file ever sees it.
//  - `state.ts` — TWO roles: (1) the generic `requestChoice` plumbing
//    FORWARDS a caller-supplied `req.subjectCardId` verbatim (the caller
//    already did the public-identity check); (2) the as-enters
//    (`stagedEntries`) staged-choice builder pins `presentedDefId(card)` —
//    safe because a staged permanent (Aura host pick, CR 303.4f) is already
//    entering the battlefield, a public zone transition, never face down.
const ALLOWLIST = new Set([
    "effects/interpreter.ts",
    "madness.ts",
    "rebound.ts",
    "state.ts",
]);

// Matches an ORIGINATING or FORWARDING assignment: `subjectCardId: <expr>`,
// the ES2015 shorthand `{ subjectCardId }` / `{ subjectCardId, ... }`, or
// `<lvalue>.subjectCardId = <expr>`. Deliberately does NOT match a bare READ
// (`req.subjectCardId`, `choice.subjectCardId`, `head!.subjectCardId`, an
// `expect(...).subjectCardId` chain) — those consume a value someone else
// already produced and are not a new leak surface.
const ASSIGNMENT_PATTERN =
    /\bsubjectCardId\s*:|[{,]\s*subjectCardId\s*[,}]|\.subjectCardId\s*=(?!=)/;

function listGreFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue; // fixtures build choices directly — not wire producers
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listGreFiles(full));
        } else if (
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".d.ts")
        ) {
            out.push(full);
        }
    }
    return out;
}

describe("PendingChoice.subjectCardId — producer allowlist (CR 406.3, issue #1982)", () => {
    it("is assigned only by the audited allowlist under convex/gre/", () => {
        const offenders: string[] = [];
        for (const file of listGreFiles(GRE_ROOT)) {
            const rel = path.relative(GRE_ROOT, file).replace(/\\/g, "/");
            // The type SHAPE declaration (`subjectCardId?: string;`) is not a
            // producer — it is what every producer's assignment is checked
            // against.
            if (rel === "state/declarations.ts") continue;
            const text = fs.readFileSync(file, "utf8");
            if (!ASSIGNMENT_PATTERN.test(text)) continue;
            if (!ALLOWLIST.has(rel)) offenders.push(rel);
        }
        expect(offenders).toEqual([]);
    });

    it("every allowlisted entry is still load-bearing (Guard B discipline — the list empties out, never rots)", () => {
        for (const rel of ALLOWLIST) {
            const text = fs.readFileSync(path.join(GRE_ROOT, rel), "utf8");
            expect(ASSIGNMENT_PATTERN.test(text)).toBe(true);
        }
    });
});
