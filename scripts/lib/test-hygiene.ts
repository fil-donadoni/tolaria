/**
 * The test-suite hygiene verdict (issue #4490, PRD #4481): the pure half of
 * `scripts/check-test-hygiene.ts`, so a unit test can exercise every red
 * without scanning the tree (the scan itself is the census, which is a
 * `health` step and never a PR-phase gate).
 *
 * The census keeps the identity-test classifier's two purge classes at zero
 * across every tracked test file:
 *
 *   - identity blocks (repo-wide, minus the named allow-list) — a block that
 *     calls nothing and asserts a constant is the constant written twice;
 *   - Op-only blocks on pure-DSL cards (`convex/cards/sets/**`) — a block the
 *     Op's own per-Op test and the generated smoke sweep already prove.
 *
 * Both were purged in one PR after a recorded sampled review, so a non-zero
 * count is regrowth: the fix is to delete the block (or, for a census /
 * partition check, to name it in `identity-test-allowlist.json` with its
 * reason), never to widen this verdict. A stale or ambiguous allow-list entry
 * is red too — a stale entry hides that its exemption was paid off, an
 * ambiguous one exempts blocks nobody named.
 *
 * The corpus floor is the guard against a sweep that silently scans nothing:
 * a census over zero files is green forever. Measured 2026-09-25: 1,876 test
 * files, 26,186 blocks — the floor sits far below both, so it trips only when
 * the file walk itself broke.
 */
import type { DryRunReport } from "../purge-identity-tests";

/** What the verdict reads off the dry-run report. */
export type HygieneReport = Pick<
    DryRunReport,
    "files" | "blocks" | "identity" | "opOnly" | "stale" | "ambiguous" | "rows"
>;

export interface HygieneVerdict {
    ok: boolean;
    /** One line per finding, in the order a reader fixes them. */
    findings: string[];
}

/** A census over fewer files or blocks than this scanned nothing real. */
export const HYGIENE_CORPUS_FLOOR = { files: 1000, blocks: 10_000 } as const;

const flaggedRows = (rows: readonly string[], kind: string): string[] =>
    rows
        .filter((r) => r.startsWith(`${kind}\t`))
        .map((r) => {
            const [, loc, name] = r.split("\t");
            return `    ${loc} — ${name}`;
        });

export function hygieneVerdict(report: HygieneReport): HygieneVerdict {
    const findings: string[] = [];

    if (
        report.files < HYGIENE_CORPUS_FLOOR.files ||
        report.blocks < HYGIENE_CORPUS_FLOOR.blocks
    ) {
        findings.push(
            `corpus below floor: ${report.files} test files / ${report.blocks} blocks scanned ` +
                `(floor ${HYGIENE_CORPUS_FLOOR.files} / ${HYGIENE_CORPUS_FLOOR.blocks}) — the walk found nothing real`
        );
    }
    if (report.identity.flagged > 0) {
        findings.push(
            `${report.identity.flagged} identity block(s) — a block that calls nothing and asserts a constant ` +
                `is the constant written twice; delete it, or name a census / partition check in ` +
                `scripts/lib/identity-test-allowlist.json with its reason:`,
            ...flaggedRows(report.rows, "identity")
        );
    }
    if (report.opOnly.blocks > 0) {
        findings.push(
            `${report.opOnly.blocks} Op-only block(s) on pure-DSL cards — the Op's per-Op test and the ` +
                `smoke sweep already prove these; delete them:`,
            ...flaggedRows(report.rows, "op-only")
        );
    }
    if (report.stale.length > 0) {
        findings.push(
            `${report.stale.length} stale allow-list entr${report.stale.length === 1 ? "y" : "ies"} — exempts nothing any more; delete:`,
            ...report.stale.map((s) => `    ${s}`)
        );
    }
    if (report.ambiguous.length > 0) {
        findings.push(
            `${report.ambiguous.length} ambiguous allow-list entr${report.ambiguous.length === 1 ? "y" : "ies"} — one name, several blocks; retitle them:`,
            ...report.ambiguous.map((s) => `    ${s}`)
        );
    }

    return { ok: findings.length === 0, findings };
}
