import {
    renderEngineTreeText,
    type EngineViewTree,
} from "~/lib/engine-view-tree";

/**
 * The Engine View's "Report a problem" action (issue #2704): a pre-filled
 * GitHub issue draft describing how the engine read a card, opened in a new
 * tab so the player never leaves the game.
 *
 * It DRAFTS, it does not file — GitHub's `/issues/new` prefill lands the
 * reporter on the compose form with everything already typed, and nothing is
 * created until they press the button themselves. That is the whole reason
 * this is a link rather than a mutation: a misread card is a report worth
 * having, and an unauthenticated player pressing a button in a game overlay is
 * not consent to open a public issue under someone else's account.
 */

/** The repository the draft targets. Hard-coded because it is not a runtime
 *  variable: the tree describes THIS engine's reading of a card, so the report
 *  belongs on this engine's tracker regardless of where the client is served
 *  from. */
const REPO_URL = "https://github.com/fil-donadoni/tolaria";

/** GitHub rejects a `GET /issues/new` whose querystring is too long with a
 *  414, and the failure is invisible in a new tab — the player gets an error
 *  page instead of a compose form. A deep tree (Urza's Saga, a modal spell
 *  with five modes) can pass that on its own, so the TREE is what gets elided
 *  when the draft is too long: every other part of the body is the part a
 *  maintainer cannot reconstruct. */
const MAX_URL_LENGTH = 6000;

export type EngineViewReportContext = {
    /** The game the card was previewed in, when there is one. Absent in the
     *  deck builder, the Draft Lab and every other out-of-game surface — the
     *  draft then simply omits the line rather than inventing a placeholder a
     *  maintainer would try to look up. */
    gameId?: string | null;
};

/** The issue body, as Markdown. Card name and id first (they are what a
 *  maintainer greps for), then the tree in a fenced block so GitHub does not
 *  eat the indentation the tree's structure is carried in. */
export function buildEngineViewReportBody(
    tree: EngineViewTree,
    ctx: EngineViewReportContext = {}
): string {
    const coverage =
        tree.coverage.total > 0
            ? `${tree.coverage.declarative}/${tree.coverage.total} resolution bodies are declarative`
            : "no resolution body";
    return [
        `**Card:** ${tree.cardName}`,
        // `CardDefinition.id` IS a Scryfall print id — the project has one id
        // space and no oracle id anywhere on a definition (ADR 0108). Labelled
        // as what it is, so nobody pastes it into an oracle-id lookup.
        `**Card id (Scryfall print id):** \`${tree.cardId}\``,
        ctx.gameId ? `**Game id:** \`${ctx.gameId}\`` : null,
        `**Engine reading:** ${tree.badge.kind} — ${coverage}`,
        "",
        "## What looks wrong",
        "",
        "<!-- What did you expect the card to do, and what did it do instead? -->",
        "",
        "## Engine view",
        "",
        "```text",
        renderEngineTreeText(tree) || "(no nodes)",
        "```",
    ]
        .filter((line) => line !== null)
        .join("\n");
}

/** The pre-filled `issues/new` URL. Falls back to a body with the tree
 *  replaced by a pointer when the full draft would exceed {@link
 *  MAX_URL_LENGTH} — a report that opens without the tree beats one that 414s
 *  with it. */
export function buildEngineViewReportUrl(
    tree: EngineViewTree,
    ctx: EngineViewReportContext = {}
): string {
    const title = `Engine view: ${tree.cardName} reads wrong`;
    const url = (body: string) =>
        `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    const full = url(buildEngineViewReportBody(tree, ctx));
    if (full.length <= MAX_URL_LENGTH) return full;
    const elided = buildEngineViewReportBody(
        { ...tree, nodes: [] },
        ctx
    ).replace(
        "(no nodes)",
        "(tree omitted — too large for a pre-filled link; paste it from the card's Engine view)"
    );
    return url(elided);
}
