/**
 * The `draft:audit:` PR receipt (issue #8895, PRD #8772): a diff that can move
 * what the draft Bot drafts or Auto-Build builds owes the Draft Table Audit's
 * verdict in its PR body, the way a DOM-reaching diff owes `check:ui`'s.
 *
 * Pure: the path predicate, the line parser and the verdict decision take
 * their inputs as arguments. `deriveReceiptLine` is the one impure reader (it
 * runs the audit); `pr-refusals.ts` injects it.
 */

/** The audit's own sources and everything it measures: the Bot Drafter,
 *  Auto-Build, the Card Profile layers and seeds, the Archetype Catalogue,
 *  the Capability registry, and the Draft Lab engine it drafts through. */
const OWING_PATHS: readonly RegExp[] = [
    /^convex\/limited\/(botDrafter|autoBuild|cardProfiles|cardProfilesCore|archetypeCatalogue|archetypeCatalogueCore|capabilityRegistry)\.ts$/,
    /^src\/lib\/limited\/draftLab[^/]*\.ts$/,
    /^data\/card-profiles\//,
    /^data\/archetype-catalogue\.json$/,
    /^scripts\/(lib\/)?draft-audit\.ts$/,
];

const isTestPath = (p: string): boolean =>
    /(^|\/)__tests__\//.test(p) || /\.test\.[tj]sx?$/.test(p);

/** Whether a landing diff owes the receipt. A test-only touch owes nothing. */
export function owesDraftAuditReceipt(paths: readonly string[]): boolean {
    return paths.some(
        (p) => !isTestPath(p) && OWING_PATHS.some((re) => re.test(p))
    );
}

/** The scopes a receipt must cover: every one that declares Floors, and the
 *  default seed count. Declared here, NOT imported from `./draft-audit`: that
 *  module's import closure reaches the fitted-weights path, which would make
 *  every `pr-refusals` importer read as resting on the corpus (`fileReadsCorpus`).
 *  The test pins both against `DRAFT_AUDIT_FLOORS` / `DRAFT_AUDIT_RECEIPT_SEEDS`. */
export const DRAFT_AUDIT_RECEIPT_SCOPES: readonly string[] = [
    "vintage-cube",
    "lea",
];
export const DRAFT_AUDIT_RECEIPT_SEEDS = 8;

export interface ReceiptLine {
    scope: string;
    from: number;
    to: number;
    floors: "PASS" | "FAIL" | "none";
    sha256: string;
}

const LINE_RE =
    /^draft:audit: (\S+) seeds (\d+)\.\.(\d+) floors: (PASS|FAIL|none) sha256:([0-9a-f]{64})\s*$/;

/** Every `draft:audit:` receipt line of a PR body. A line that starts with the
 *  marker but does not parse is returned in `malformed`. */
export function parseReceiptLines(body: string): {
    lines: ReceiptLine[];
    malformed: string[];
} {
    const lines: ReceiptLine[] = [];
    const malformed: string[] = [];
    for (const raw of body.split(/\r?\n/)) {
        const text = raw
            .trim()
            .replace(/^[-*>\s`]+/, "")
            .replace(/`+$/, "");
        if (!text.startsWith("draft:audit:")) continue;
        const m = LINE_RE.exec(text);
        if (!m) {
            malformed.push(text);
            continue;
        }
        lines.push({
            scope: m[1],
            from: Number(m[2]),
            to: Number(m[3]),
            floors: m[4] as ReceiptLine["floors"],
            sha256: m[5],
        });
    }
    return { lines, malformed };
}

export const DRAFT_AUDIT_RECEIPT_HELP =
    "run `bun run draft:audit -- --scope <scope> --quiet` for each of " +
    `${DRAFT_AUDIT_RECEIPT_SCOPES.join(", ")} and paste each \`draft:audit: <scope> …\` line into the PR body`;

/**
 * The refusal for a PR body against the receipt lines this tree re-derives, or
 * `null`. `derive(scope)` returns the receipt line the audit prints for the
 * scope on this tree (`formatReceiptLine`).
 */
export function draftAuditRefusal(
    owes: boolean,
    prBody: string,
    derive: (scope: string) => string
): string | null {
    if (!owes) return null;
    const { lines, malformed } = parseReceiptLines(prBody);
    if (malformed.length > 0)
        return `draft:audit receipt line is malformed (${malformed[0]}) — ${DRAFT_AUDIT_RECEIPT_HELP}`;
    for (const scope of DRAFT_AUDIT_RECEIPT_SCOPES) {
        const mine = lines.filter((l) => l.scope === scope);
        if (mine.length === 0)
            return `landing diff touches the Bot Drafter, Auto-Build, the Card Profiles, the Archetype Catalogue or the Capability registry and the PR body has no \`draft:audit: ${scope}\` receipt — ${DRAFT_AUDIT_RECEIPT_HELP}`;
        if (mine.length > 1)
            return `the PR body carries ${mine.length} \`draft:audit: ${scope}\` receipt lines — exactly one`;
        const line = mine[0];
        if (line.from !== 1 || line.to !== DRAFT_AUDIT_RECEIPT_SEEDS)
            return `\`draft:audit: ${scope}\` receipt covers seeds ${line.from}..${line.to}; the receipt is the default run, seeds 1..${DRAFT_AUDIT_RECEIPT_SEEDS}`;
        if (line.floors !== "PASS")
            return `\`draft:audit: ${scope}\` receipt says floors: ${line.floors} — a broken Floor refuses; fix the build, or say why a Floor moves in the same PR`;
        const derived = parseReceiptLines(derive(scope)).lines[0];
        if (
            !derived ||
            derived.sha256 !== line.sha256 ||
            derived.floors !== "PASS"
        )
            return `\`draft:audit: ${scope}\` receipt does not match this tree — pasted sha256:${line.sha256}, re-derived ${derived ? `sha256:${derived.sha256} floors: ${derived.floors}` : "nothing"}; re-run the audit on the pushed head`;
    }
    return null;
}
