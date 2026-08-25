// Guard B — documented-divergence-needs-issue (issue #962). Root-cause fix
// for the "silently-partial" anti-pattern: a card whose `resolve()`/`effects`
// silently drops an Oracle clause behind a `// Deferred` / `// divergence` /
// `// not implemented` / `// TODO` comment with NO linked tracking issue.
//
// Sibling to `scripts/check-stub-coverage.ts` (the commented-STUB guard) —
// same disposition-scan intent, but for an ACTIVE card's documented partial
// implementation rather than a commented-out card. Stub-coverage catches an
// untracked commented-out card; this guard catches an untracked partial
// implementation of a SHIPPED one.
//
// Scan: every `.ts` file under `convex/cards/sets/**` (excluding `__tests__`
// and `*.test.ts`), looking for a divergence-marker comment line anywhere it
// appears in a `//` comment (issue #1900 dropped the old first-word anchor —
// see below): `Deferred`/`divergence`/`not implemented`/`TODO`/`simplif*`/
// `approximat*`/`not model(l)?ed`/`not enforced`/`deviat*`/`unimplemented`/
// `unbuilt`.
//
// VOCABULARY (issue #1900) — widened from the original four words + UNANCHORED
// (a confession word anywhere in a `//` line, not only as its first word).
// Derived empirically off this corpus (never guessed off the issue's own
// examples — see `scripts/lib/divergence-markers.ts`'s own header for the
// derivation and the words rejected for being too false-positive-prone:
// `no-op`, `stub`/`placeholder`, `best effort`/`capability gap`).
//
// WINDOW — TIGHTENED (issue #1900) from "the marker's own comment PARAGRAPH"
// to: the marker's own line, the line immediately following it, or an
// EARLIER same-paragraph line that is itself a dispositioned marker (the
// shared section-footer shape). The old paragraph-wide scan (issue #962)
// closed two leaks by paragraph-scoping (a provenance ADR absorbing a
// deferral note below it; a genuine untracked list vouched by an unrelated
// "Out of scope" note lower in the same block) but left a THIRD one open one
// level down: an unrelated ref sitting in a DIFFERENT sentence of the SAME
// paragraph as the marker (`eld/colorless.ts`'s Fabled Passage — a
// `moveZone` provenance ref for one clause wrongly vouching for a wholly
// separate, untracked divergence a few lines later in the same paragraph;
// fixed on its own merits since, see the regression fixture below). A real
// multi-marker note (e.g. a section footer that lists several deferred cards
// under one `tracked-by: #NNN` header, with the word "deferred" recurring in
// its bullets) is still accepted — the header's own disposition vouches for
// the marker-word bullets under it via the "earlier dispositioned marker
// line" case.
//
// FALSE-POSITIVE SUPPRESSION (issue #1900) — four sanctioned shapes that look
// like violations but are not:
//   1. Commented-out card stubs (`check-stub-coverage.ts`'s domain) —
//      `isStubContext` (shared with the liveness sweep) drops any marker
//      sitting in the same contiguous comment run as a commented-out
//      `// export const … : CardDefinition` stub anchor.
//   2. "ACTIVE (#NNN)" completion citations — a bare `#NNN` on the marker's
//      OWN line already satisfies `DISPOSITION` (case 1 of the window above);
//      no special-casing needed, but see the regression test below.
//   3. Multi-marker section footers vouched once for the whole block — the
//      "earlier dispositioned marker line" window case, tested above and
//      below.
//   4. Set-header boilerplate / a card NAME containing a confession-shaped
//      word (`Fear of Missing Out`, `dsk/red.ts`; the `4ed/*.ts` "cards not
//      yet implemented are omitted" line, which line-wraps its own
//      `not`/`implemented` split so the literal phrase never appears on one
//      line) — regression-tested below.
//
// DISPOSITION — a linked issue ref (`#NNN`, prefer `tracked-by: #NNN`) or an
// explicit "out of scope" note. An `ADR NNNN` citation does NOT count: an ADR
// documents a card's DESIGN/provenance, it is not a tracking reference for a
// dropped clause (a permanently out-of-scope divergence still says so in
// words — "out of scope" — which does count). This is deliberately STRICTER
// than `check-stub-coverage.ts`'s disposition set, because a divergence on a
// SHIPPED card is a live gap that wants a work issue, not a design citation.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    SETS_DIR,
    collectSetFiles,
    scanDivergenceMarkers,
} from "../../../scripts/lib/divergence-markers";

// Scanner (marker/disposition regexes, paragraph scoping, file collection) now
// lives in `scripts/lib/divergence-markers.ts` (issue #2560) — shared with the
// marker-LIVENESS sweep (`scripts/check-marker-liveness.ts`) so both consumers
// use one parser and cannot drift. This test still owns the PRESENCE
// assertion (Guard B's original scope); liveness — whether a referenced issue
// is still open — is checked separately, outside the offline gate.

describe("Guard B — documented-divergence-needs-issue (issue #962)", () => {
    it("every divergence marker (Deferred/divergence/not implemented/TODO) in convex/cards/sets/** carries a linked disposition in its own paragraph", () => {
        const offenders: string[] = [];
        for (const file of collectSetFiles(SETS_DIR)) {
            const lines = fs.readFileSync(file, "utf8").split("\n");
            for (const hit of scanDivergenceMarkers(lines)) {
                if (!hit.tracked) {
                    offenders.push(
                        `${path.relative(SETS_DIR, file)}:${hit.line}: ${hit.text}`
                    );
                }
            }
        }
        expect(
            offenders,
            "divergence markers with no linked issue (#NNN / tracked-by:) or explicit " +
                "'out of scope' note in their OWN comment paragraph — every intentional " +
                "partial/deferred clause must be tracked (see .claude/rules/gre-development.md " +
                "§ Guard B). A ref in a separate paragraph (a card-intro provenance citation, or " +
                "another deferral note in the same block) does NOT count. Add a `tracked-by: #NNN` " +
                "ref on/next to the marker, or open a new issue and reference it."
        ).toEqual([]);
    });

    it("sanity: the scanner rejects an untracked marker and accepts issue / tracked-by / out-of-scope dispositions", () => {
        const untracked = [
            "// some card doc",
            "// DEFERRED: this thing is not built yet, no ref here",
            "export const foo = 1;",
        ];
        const issueTracked = [
            "// some card doc",
            "// DEFERRED (tracked-by: #123): this thing is not built yet",
            "export const foo = 1;",
        ];
        const outOfScopeTracked = [
            "// TODO: out of scope — ante mechanics are never built",
            "export const baz = 1;",
        ];

        const untrackedHits = scanDivergenceMarkers(untracked);
        expect(untrackedHits).toHaveLength(1);
        expect(untrackedHits[0].tracked).toBe(false);

        expect(scanDivergenceMarkers(issueTracked)[0].tracked).toBe(true);
        expect(scanDivergenceMarkers(outOfScopeTracked)[0].tracked).toBe(true);
    });

    it("a multi-line divergence note links a disposition declared on a DIFFERENT line of the SAME paragraph", () => {
        const block = [
            "// TODO: this card's second ability is deferred because the engine",
            "// lacks a primitive for it. See issue #4242 for the tracking ticket.",
            "export const someCard = 1;",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(true);
    });

    // --- Regression: the block-absorption hole this tightening closes -------
    // (issue #962 review). Each fixture WOULD have passed the first, whole-block
    // scan and now correctly REDS, because the only ref lives in a SEPARATE
    // paragraph than the marker.

    it("regression: a marker is NOT vouched for by a provenance ref in the card-intro paragraph above (blank-line separated)", () => {
        const block = [
            "// Foo — draws a card, then does bar. Migrated in #833 (ADR 0004).",
            "//",
            "// DEFERRED: the second, conditional clause is not built yet.",
            "export const foo = 1;",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        // The #833 / ADR 0004 above is a DIFFERENT paragraph — must not vouch.
        expect(hits[0].tracked).toBe(false);
    });

    it("regression: a bare ADR provenance citation adjacent to the marker does NOT count as a tracking ref", () => {
        const block = [
            "// DEFERRED: the anti-redirection rider is unbuilt (design per ADR 0004).",
            "export const foo = 1;",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(false);
    });

    it("regression: a marker is NOT vouched for by a separate deferral note's ref lower in the same contiguous block", () => {
        // The arn/colorless.ts shape: an untracked 'Deferred to later batches'
        // note, then a blank `//`, then a separate 'Out of scope' note. The
        // whole-block scan absorbed the lower note's disposition; paragraph
        // scoping keeps them independent.
        const block = [
            "// ─────────────────────────────────────────────",
            "// Deferred to later batches — needs unbuilt engine work:",
            "//   • Card A — needs primitive X.",
            "//",
            "// Out of scope — ante / subgames (ADR 0010): Card B.",
            "// ─────────────────────────────────────────────",
        ];
        const hits = scanDivergenceMarkers(block);
        // Only the first line matches MARKER ('Deferred'); it must RED.
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(2);
        expect(hits[0].tracked).toBe(false);
    });

    it("regression: a box-rule line separates paragraphs so a ref beyond it does not leak in", () => {
        const block = [
            "// DEFERRED: clause two is unbuilt.",
            "// ═════════════════════════════════",
            "// Some later section, tracked-by: #999.",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(false);
    });

    it("a real multi-marker section footer needs its tracking ref only once (recurring 'deferred' word in bullets under one header)", () => {
        const block = [
            "// ─────────────────────────────────────────────",
            "// C5 deferred (tracked-by: #1213) — counter cards owned by a later cluster:",
            "//   • Card A — needs a targeting feature, so it is",
            "//     deferred whole to avoid a partial card.",
            "//   • Card B — needs a board-computed cost. It is",
            "//     Deferred whole rather than shipped wrong.",
            "// ─────────────────────────────────────────────",
        ];
        // Several continuation lines START with a marker word (the real
        // leg/black.ts C5-footer shape), but they are ONE paragraph under the
        // single #1213 header — all tracked, ref needed only once.
        const hits = scanDivergenceMarkers(block);
        expect(hits.length).toBeGreaterThanOrEqual(2);
        for (const h of hits) expect(h.tracked).toBe(true);
    });

    it("finds a non-zero number of documented markers (the guard is actually scanning something)", () => {
        let total = 0;
        for (const file of collectSetFiles(SETS_DIR)) {
            const lines = fs.readFileSync(file, "utf8").split("\n");
            total += scanDivergenceMarkers(lines).length;
        }
        expect(total).toBeGreaterThan(0);
    });

    // --- Widened vocabulary (issue #1900) ------------------------------------

    it("the widened vocabulary catches confession words outside the original four, wherever they sit in the line", () => {
        const words = [
            "SIMPLIFICATION (flagged): the printed clause is not built.",
            "the second mode is approximated by a cheaper primitive, no ref here.",
            "the linger clause is not modelled in this engine, no ref here.",
            "the empty-stack requirement is not enforced here, no ref here.",
            "NOTE (CR 605.1a deviation): no engine change, no ref here.",
            "this backlog item is unimplemented today, no ref here.",
            "needs a genuinely unbuilt primitive, no ref here.",
        ];
        for (const text of words) {
            const hits = scanDivergenceMarkers([`// ${text}`]);
            expect(hits, text).toHaveLength(1);
            expect(hits[0].tracked, text).toBe(false);
        }
    });

    it("an untracked confession is still caught when the marker word is NOT the first word of the comment (the common shape: a card-name-first paragraph)", () => {
        const block = [
            "// Some Card Name — {1}{R} Creature. This is a SIMPLIFICATION",
            "// (flagged) of the printed clause, no ref anywhere in this note.",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(false);
    });

    // --- Tightened window: same-paragraph-vouching leak (issue #1900) -------

    it("regression: an unrelated ref elsewhere in the SAME paragraph no longer vouches for a different confession (the Fabled Passage leak)", () => {
        const block = [
            "// Some Land — forces the entering land tapped, issue #677; bind",
            "// captures it for a later Op.",
            "//",
            "// SIMPLIFIED (documented deviation): the conditional untap clause",
            "// has no ref of its own.",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        // #677 sits two lines above, across a blank-`//` paragraph break —
        // both the OLD paragraph scope and the new tightened window agree
        // this one is untracked (different paragraph). The load-bearing
        // regression is the SAME-paragraph case immediately below.
        expect(hits[0].tracked).toBe(false);
    });

    it("regression: an unrelated ref TWO+ lines away in the SAME paragraph (no blank/box-rule break) no longer vouches", () => {
        const block = [
            "// Some Land — forces the entering land tapped, issue #677; bind",
            "// captures it for a follow-up Op, standard idiom for this family.",
            "// SIMPLIFIED (documented deviation): the conditional untap clause",
            "// stands alone here with no disposition of its own.",
        ];
        const hits = scanDivergenceMarkers(block);
        // #677 is TWO lines above the marker, in the SAME paragraph (no
        // blank/box-rule break) but attached to an unrelated sentence —
        // neither on the marker's own line nor the line right after it — so
        // the tightened window must not treat it as this marker's
        // disposition.
        expect(hits.length).toBeGreaterThan(0);
        for (const h of hits) expect(h.tracked).toBe(false);
    });

    it("the tightened window still accepts a disposition on the line immediately following the marker", () => {
        const block = [
            "// SIMPLIFICATION (flagged): the printed clause is approximated by a",
            "// cheaper primitive (tracked-by: #4321).",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(true);
    });

    // --- False-positive suppression (issue #1900) ----------------------------

    it("false positive 1: a commented-out card stub's TODO note is skipped entirely, even using the widened vocabulary", () => {
        const block = [
            "// TODO(issue #9001 stub — needs an unbuilt primitive, this ability is",
            "// not modelled at all): Stop-and-issue; tracked stub.",
            "// export const someStub: CardDefinition = {",
            "//     id: 'x',",
            "//     name: 'Some Stub',",
            "// };",
        ];
        // Every line here matches MARKER (TODO / unbuilt / not modelled), but
        // the whole run sits around a commented-out `export const … :
        // CardDefinition` anchor — `check-stub-coverage.ts`'s domain, not
        // Guard B's. scanDivergenceMarkers must report ZERO hits.
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(0);
    });

    it("false positive 2: an 'ACTIVE (#NNN)' completion citation on the marker's own line disposes it presence-wise, even though the cited issue is deliberately CLOSED (`ice/white.ts:164` shape)", () => {
        // `DISPOSITION` is presence-only (`#\d+`) — it does not, and by
        // design cannot, know the cited issue is closed on purpose. That is
        // exactly why the (network) liveness sweep's `scanTrackedByRefs`
        // resolves only an explicit `tracked-by:` ref, never a bare `#NNN` —
        // a bare completion citation like this one is invisible to it, so a
        // deliberately-closed #729 never gets misreported as "rotten".
        const block = [
            "// DEFERRED (remain commented stubs) — block-restriction bypass cost:",
            "//   ACTIVE (#729 — the primitive shipped, this note is historical).",
        ];
        const hits = scanDivergenceMarkers(block);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(true);
    });

    // False positive 3 (a multi-marker section footer needing its tracking
    // ref only once) is covered by "a real multi-marker section footer
    // needs its tracking ref only once" above — no separate test here, to
    // avoid a duplicate assertion with nothing new to prove (issue #1900
    // fixup round 2, finding 4: the placeholder test that used to sit here
    // was `expect(true).toBe(true)`, vacuous).

    it("false positive 4: a card NAME containing a confession-shaped word does not itself become a marker unless the vocabulary actually matches", () => {
        // "Fear of Missing Out" (dsk/red.ts) — none of the widened words
        // (simplif/approximat/not modelled/not enforced/deviat/unimplemented/
        // unbuilt) are substrings of "Missing" or "Fear", so a plain card-name
        // comment line never trips MARKER regardless of anchoring.
        const block = ["// Fear of Missing Out — {1}{R} Enchantment Creature."];
        expect(scanDivergenceMarkers(block)).toHaveLength(0);
    });

    it("false positive 4b: set-header boilerplate split across two lines ('is not' / 'yet implemented') never joins into the literal 'not implemented' phrase", () => {
        // The 4ed/*.ts generator boilerplate: "Cards whose CardDefinition is
        // not\nyet implemented are omitted" — MARKER is a per-LINE regex, so
        // this must never match on either line.
        const block = [
            "// Excluded: ante cards are permanently out of scope. Cards whose",
            "// CardDefinition is not",
            "// yet implemented are omitted; each lands automatically once its",
            "// definition exists.",
        ];
        expect(scanDivergenceMarkers(block)).toHaveLength(0);
    });
});
