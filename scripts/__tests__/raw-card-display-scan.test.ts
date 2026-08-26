import { describe, it, expect } from "vitest";
import * as path from "path";
import {
    scanRawCardDisplayReads,
    type RawCardDisplayHit,
} from "../lib/raw-card-display-scan";

/**
 * Raw card-id display-name guard (issue #1735 review round 3).
 *
 * See `scripts/lib/raw-card-display-scan.ts` for the full rationale: three
 * review rounds each found one MORE site reading a battlefield-or-stack
 * card's raw `card.card.id` to resolve a DISPLAY name, which stays the CR
 * 708.2 face-down sentinel for every viewer including the card's own
 * controller. This test makes the census mechanical instead of a list a
 * person re-derives by eye every round: any NEW occurrence of the shape
 * fails CI, forcing a decision right when the site is introduced — repoint
 * to `displayCardId` (the fix every prior finding took), or add it here with
 * a one-line reason it is genuinely zone-safe.
 *
 * The allowlist below is every occurrence that exists TODAY and is NOT a
 * bug: a hand/graveyard/exile-zone card, none of which can be face down
 * (CR 708.7 turns a face-down permanent back face up before it can leave the
 * battlefield to any of those zones, and a face-down SPELL only exists on
 * the stack, never in hand). It is a real, reviewed exemption list in the
 * `KEYWORD_ALLOWLIST` mould — expected to grow only alongside new hand/
 * graveyard/exile display code, never as a way to silence a battlefield or
 * stack hit.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** `<repo-relative file>:<line>` → one-line reason it is zone-safe. */
const ALLOWLIST: Record<string, string> = {
    "src/components/board/graveyard-card-picker.tsx:37":
        "graveyard card tile title — graveyard cards are never face down",
    "src/components/board/cast-exile-cost-dialog.tsx:188":
        "exile-cost picker tile title — exiled/graveyard cards are never face down",
    "src/components/board/exile-cost-dialog.tsx:142":
        "exile-cost picker tile title — exiled/graveyard cards are never face down",
    "src/components/board/target-selection-banner.tsx:108":
        "hand card being cast — hand cards are never face down",
    "src/components/board/graveyard-target-dialog.tsx:73":
        "hand card being cast — hand cards are never face down",
    "src/components/board/discard-cost-dialog.tsx:101":
        "hand card picker tile title — hand cards are never face down",
    "src/components/board/cast-alternative-hand-cost-dialog.tsx:116":
        "hand card picker tile title — hand cards are never face down",
};

function key(hit: RawCardDisplayHit): string {
    return `${hit.file}:${hit.line}`;
}

describe("raw card-id display-name guard (issue #1735 review round 3)", () => {
    it("every hit in src/ is either fixed or on the reviewed zone-safe allowlist", () => {
        const hits = scanRawCardDisplayReads(REPO_ROOT);
        const unexplained = hits.filter((h) => !(key(h) in ALLOWLIST));
        expect(
            unexplained,
            unexplained
                .map(
                    (h) =>
                        `${key(h)} — reads getDefinition/tryGetDefinition(<x>.card.id).name raw; repoint to displayCardId(<x>) unless this is a hand/graveyard/exile zone read, in which case add it to ALLOWLIST with why`
                )
                .join("\n")
        ).toEqual([]);
    });

    it("every allowlist entry still matches something real (no stale exemptions)", () => {
        const hits = new Set(
            scanRawCardDisplayReads(REPO_ROOT).map((h) => key(h))
        );
        const stale = Object.keys(ALLOWLIST).filter((k) => !hits.has(k));
        expect(stale, stale.join("\n")).toEqual([]);
    });
});
