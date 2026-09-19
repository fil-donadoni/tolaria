#!/usr/bin/env bun
// `bun run card:link <name…>` — ready-to-paste Scryfall links for issue bodies
// (issue #3666; convention: docs/agents/issue-tracker.md § Card names are
// Scryfall links).
//
// Usage:
//   bun run card:link "Lightning Bolt" "Serra Angel"
//
// Prints one Markdown link per resolved name, in argument order. Exits 1 and
// names every card it could not resolve — fail-closed: no guessed URL is ever
// printed for an unknown name. Exits 2 on usage error.

import {
    cardLinks,
    fetchScryfallCard,
    loadCardLinkSources,
} from "./lib/card-link";

const names = process.argv.slice(2).filter((a) => a.trim() !== "");
if (names.length === 0) {
    console.error('usage: bun run card:link "<Card Name>" […]');
    process.exit(2);
}

const { links, unresolved } = await cardLinks(
    names,
    loadCardLinkSources(),
    fetchScryfallCard
);
for (const link of links) console.log(link);
if (unresolved.length > 0) {
    console.error(
        `card:link: no card named ${unresolved.map((n) => `"${n}"`).join(", ")} (exact name, not in the card index nor on Scryfall)`
    );
    process.exit(1);
}
