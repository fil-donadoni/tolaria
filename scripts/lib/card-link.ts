// Card names in issue bodies are Scryfall links (issue #3666).
//
// A maintainer reading a generated issue on GitHub used to search Scryfall by
// hand for every card it named. The convention — `docs/agents/issue-tracker.md`
// § Card names are Scryfall links — writes each one as
//
//     [Lightning Bolt](https://scryfall.com/card/<scryfallId> "{R} · Instant")
//
// and this module is the one place that builds that string, so no skill
// assembles a URL by hand.
//
// **The id, never a name search.** `scryfall.com/card/<id>` redirects to the
// card's detail page; a `?q=` name search lands on a RESULTS LIST whenever a
// name has several printings, which is most of the cards worth linking.
//
// **The title is text, on purpose.** GitHub sanitizes JS/CSS and strips
// `target`, so a hover IMAGE and a forced new tab are both impossible in an
// issue body. The link title (mana cost · type line) is the tooltip GitHub does
// render.
//
// Resolution order — offline first, the network only for what the tree lacks:
//
//   1. id      — `data/card-index.json` (`scryfallId`)
//   2. tooltip — the committed Full Catalogue (`data/full-catalogue/*.json.gz`),
//                by exact name, then by front face for a `A // B` name
//   3. either missing → Scryfall: `/cards/<id>` when the index had the id,
//                `/cards/named?exact=` when it did not
//
// Fail-closed: a name nothing resolves is an ERROR naming the card, never a
// guessed URL.

import * as fs from "node:fs";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CARD_INDEX = path.join(REPO_ROOT, "data", "card-index.json");
const FULL_CATALOGUE_DIR = path.join(REPO_ROOT, "data", "full-catalogue");

const SCRYFALL_API = "https://api.scryfall.com";
/** Scryfall 400s on an HTTP library's default User-Agent (see
 *  `scripts/fetch-full-catalogue.mjs`). */
const SCRYFALL_HEADERS = {
    "User-Agent": "tolaria-card-link/1.0",
    Accept: "application/json",
};

/** Everything one link needs. */
export interface CardLinkData {
    name: string;
    scryfallId: string;
    manaCost: string;
    typeLine: string;
}

/** The two offline sources, keyed by exact card name. */
export interface CardLinkSources {
    /** name → Scryfall card id (`data/card-index.json`). */
    ids: ReadonlyMap<string, string>;
    /** name → tooltip fields (the Full Catalogue). */
    tooltips: ReadonlyMap<string, { manaCost: string; typeLine: string }>;
}

/** The subset of a Scryfall card object this module reads. */
export interface ScryfallCard {
    id: string;
    name: string;
    mana_cost?: string;
    type_line?: string;
    card_faces?: { mana_cost?: string; type_line?: string }[];
}

/** `path` → the parsed card, or `null` on a 404. Injected so tests run offline. */
export type ScryfallFetch = (apiPath: string) => Promise<ScryfallCard | null>;

export const scryfallCardUrl = (scryfallId: string): string =>
    `https://scryfall.com/card/${scryfallId}`;

/**
 * The ready-to-paste Markdown link. The tooltip is `<mana> · <type>`, or the
 * type line alone for a card with no mana cost (a land).
 */
export function formatCardLink(card: CardLinkData): string {
    const tooltip = [card.manaCost, card.typeLine]
        .filter((part) => part.trim() !== "")
        .join(" · ")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
    const text = card.name.replace(/([[\]])/g, "\\$1");
    return `[${text}](${scryfallCardUrl(card.scryfallId)} "${tooltip}")`;
}

/** A double-faced card's tooltip fields live on its faces, not on the card. */
function fromScryfall(card: ScryfallCard): CardLinkData {
    const faces = card.card_faces ?? [];
    const joinFaces = (
        pick: (f: (typeof faces)[number]) => string | undefined
    ) =>
        faces
            .map(pick)
            .filter((v): v is string => !!v)
            .join(" // ");
    return {
        name: card.name,
        scryfallId: card.id,
        manaCost: card.mana_cost || joinFaces((f) => f.mana_cost),
        typeLine: card.type_line || joinFaces((f) => f.type_line),
    };
}

function localTooltip(sources: CardLinkSources, name: string) {
    return (
        sources.tooltips.get(name) ??
        sources.tooltips.get(name.split(" // ")[0]!)
    );
}

/**
 * One name → its link data, or `null` when neither the tree nor Scryfall knows
 * it. Throws only on a transport failure — an unreachable API is not "unknown
 * card", and conflating the two would tell an author their spelling is wrong.
 */
export async function resolveCard(
    name: string,
    sources: CardLinkSources,
    fetchCard: ScryfallFetch
): Promise<CardLinkData | null> {
    const id = sources.ids.get(name);
    const tooltip = localTooltip(sources, name);
    if (id && tooltip) return { name, scryfallId: id, ...tooltip };

    const card = id
        ? await fetchCard(`/cards/${id}`)
        : await fetchCard(`/cards/named?exact=${encodeURIComponent(name)}`);
    if (!card) return null;
    const data = fromScryfall(card);
    // The link text is the name the author wrote — `named?exact=Delver of
    // Secrets` answers with the whole `A // B` name, which reads wrong in prose.
    // The index stays the id authority whenever it has one.
    return { ...data, name, scryfallId: id ?? data.scryfallId };
}

export interface CardLinkResult {
    links: string[];
    unresolved: string[];
}

export async function cardLinks(
    names: readonly string[],
    sources: CardLinkSources,
    fetchCard: ScryfallFetch
): Promise<CardLinkResult> {
    const links: string[] = [];
    const unresolved: string[] = [];
    for (const name of names) {
        const card = await resolveCard(name, sources, fetchCard);
        if (card) links.push(formatCardLink(card));
        else unresolved.push(name);
    }
    return { links, unresolved };
}

// ── Tree readers ─────────────────────────────────────────────────────────────

interface CardIndexEntry {
    name: string;
    scryfallId: string;
}

function readCardIndex(): CardIndexEntry[] {
    return JSON.parse(fs.readFileSync(CARD_INDEX, "utf8")) as CardIndexEntry[];
}

/** Every card name the catalogue knows — the lint's vocabulary. */
export function loadCardIndexNames(): string[] {
    return readCardIndex().map((e) => e.name);
}

interface FullCatalogueWire {
    names: string[];
    typeLines: string[];
    manaCosts: string[];
}

/** The committed Full Catalogue, or an empty map when the tree has none. */
function readFullCatalogueTooltips(): Map<
    string,
    { manaCost: string; typeLine: string }
> {
    const tooltips = new Map<string, { manaCost: string; typeLine: string }>();
    if (!fs.existsSync(FULL_CATALOGUE_DIR)) return tooltips;
    const file = fs
        .readdirSync(FULL_CATALOGUE_DIR)
        .find((f) => f.startsWith("full-catalogue-") && f.endsWith(".json.gz"));
    if (!file) return tooltips;
    const wire = JSON.parse(
        gunzipSync(
            fs.readFileSync(path.join(FULL_CATALOGUE_DIR, file))
        ).toString("utf8")
    ) as FullCatalogueWire;
    wire.names.forEach((name, i) => {
        if (!tooltips.has(name)) {
            tooltips.set(name, {
                manaCost: wire.manaCosts[i] ?? "",
                typeLine: wire.typeLines[i] ?? "",
            });
        }
    });
    return tooltips;
}

export function loadCardLinkSources(): CardLinkSources {
    return {
        ids: new Map(readCardIndex().map((e) => [e.name, e.scryfallId])),
        tooltips: readFullCatalogueTooltips(),
    };
}

/** The live Scryfall API: 404 → `null`, anything else non-OK → throw. */
export const fetchScryfallCard: ScryfallFetch = async (apiPath) => {
    const res = await fetch(`${SCRYFALL_API}${apiPath}`, {
        headers: SCRYFALL_HEADERS,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(`Scryfall ${apiPath} → HTTP ${res.status}`);
    }
    return (await res.json()) as ScryfallCard;
};
