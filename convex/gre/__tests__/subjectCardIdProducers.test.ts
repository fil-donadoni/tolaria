// Catalogue-wide guard: `PendingChoice.subjectCardId` may be ORIGINATED (or
// forwarded) only at an allowlisted, individually-audited set of SITES
// (issue #1982, CR 406.3).
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
// true — an unaudited hand-set call site would be the leak nothing catches,
// since no wire-level redaction exists to fall back on (see the extensive
// per-site discipline this codebase uses instead:
// `docs/agents/gre-guards.md` § Pending-choice wire safety).
//
// SCOPE: every non-generated, non-test `.ts` file under `convex/`, not only
// `convex/gre/` — `SpellContext.requestOptionChoice`'s `subjectCardId?`
// parameter (`convex/cards/types.ts`) means a future `resolve()` body under
// `convex/cards/sets/**` could originate one by hand just as easily as a
// `gre/` file can.
//
// PER-SITE, not per-file: the allowlist below pins an exact OCCURRENCE COUNT
// per file, not a bare boolean. `state.ts` and `interpreter.ts` are large,
// frequently-touched files — allowlisting them wholesale would let a SECOND,
// unaudited producer land inside an already-allowlisted file without this
// guard ever seeing it.
//
// Sibling in form to `mechanicsRegistry.test.ts` (Guard A) /
// `divergenceMarkers.test.ts` (Guard B): a narrow allowlist, individually
// justified, that a new or additional producer must extend deliberately
// rather than land silently. PRESENCE only, exactly like Guard B — this does
// not re-verify that each allowlisted site derives the id correctly (that is
// each site's own reference test's job); it only stops an unaudited one from
// appearing unnoticed.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const CONVEX_ROOT = path.join(__dirname, "..", "..");

// Every file this guard has individually verified derives `subjectCardId`
// from the card's OWN public visibility rather than an unconditional pin,
// mapped to its exact occurrence count (`bun run cr:ledger`-style: presence
// AND count, both load-bearing):
//  - `gre/effects/interpreter.ts` (1) — `ctx.getPublicCardIdentity(...)`, the
//    sanctioned SpellContext path (resolve-time Cast/Decline offers).
//  - `gre/madness.ts` (1) / `gre/rebound.ts` (1) — SpellContext-less
//    producers; the card was already made public by the PRECEDING step in
//    the same turn (a public discard, a public stack object) before either
//    file ever sees it.
//  - `gre/state.ts` (2) — TWO roles: (1) the generic `requestChoice`
//    plumbing FORWARDS a caller-supplied `req.subjectCardId` verbatim (the
//    caller already did the public-identity check); (2) the as-enters
//    (`stagedEntries`) staged-choice builder pins `presentedDefId(card)` —
//    safe because a staged permanent (Aura host pick, CR 303.4f) is already
//    entering the battlefield, a public zone transition, never face down.
const ALLOWLIST: Record<string, number> = {
    "gre/effects/interpreter.ts": 1,
    "gre/madness.ts": 1,
    "gre/rebound.ts": 1,
    "gre/state.ts": 2,
};

// Matches an ORIGINATING or FORWARDING assignment: `subjectCardId: <expr>`,
// the ES2015 shorthand `{ subjectCardId }` / `{ subjectCardId, ... }`,
// `<lvalue>.subjectCardId = <expr>`, or the bracket-notation equivalent
// `<lvalue>["subjectCardId"] = <expr>`. Deliberately does NOT match a bare
// READ (`req.subjectCardId`, `choice.subjectCardId`, `head!.subjectCardId`,
// an `expect(...).subjectCardId` chain) — those consume a value someone else
// already produced and are not a new leak surface. The optional TYPE
// declaration (`subjectCardId?: string;`, `state/declarations.ts`) also does
// not match — the `?` sits between the name and the colon, which `\s*`
// (whitespace only) does not span — so it needs no explicit exclusion; this
// guard still skips that file below, defensively, in case a future pattern
// tweak stops relying on that.
//
// KNOWN GAP (documented, not silently accepted): a value FORWARDED through an
// object spread (`{ ...req }`, where `req.subjectCardId` rides along
// unnamed) is invisible to this pattern. Narrowing the scan to every
// non-generated file under `convex/` bounds the blast radius — the spread's
// SOURCE object still has to be built from a named `subjectCardId` property
// somewhere, and that origin site is what this guard catches.
const ASSIGNMENT_PATTERN =
    /\bsubjectCardId\s*:|[{,]\s*subjectCardId\s*[,}]|\.subjectCardId\s*=(?!=)|\[\s*["']subjectCardId["']\s*\]\s*=(?!=)/g;

function listConvexFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue; // fixtures build choices directly — not wire producers
        if (entry.name === "_generated") continue; // Convex codegen, not authored
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listConvexFiles(full));
        } else if (
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".d.ts")
        ) {
            out.push(full);
        }
    }
    return out;
}

function countMatches(text: string): number {
    return [...text.matchAll(ASSIGNMENT_PATTERN)].length;
}

describe("PendingChoice.subjectCardId — producer allowlist (CR 406.3, issue #1982)", () => {
    it("is assigned only at the audited sites, in the audited count, under convex/", () => {
        const offenders: string[] = [];
        for (const file of listConvexFiles(CONVEX_ROOT)) {
            const rel = path.relative(CONVEX_ROOT, file).replace(/\\/g, "/");
            // The type SHAPE declaration is not a producer — it is what
            // every producer's assignment is checked against (see the
            // pattern's own doc comment for why it never matches anyway).
            if (rel === "gre/state/declarations.ts") continue;
            const text = fs.readFileSync(file, "utf8");
            const count = countMatches(text);
            const expected = ALLOWLIST[rel] ?? 0;
            if (count !== expected) {
                offenders.push(`${rel}: expected ${expected}, found ${count}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
