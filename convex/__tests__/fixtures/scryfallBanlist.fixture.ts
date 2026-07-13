// Captured Scryfall Search API fixtures (issue #1143), trimmed to the `name`
// field this module reads. Names/pagination shape are real data pulled from
// `https://api.scryfall.com/cards/search` on 2026-07-13 for the exact queries
// `syncBanlist` issues (`banned:premodern`, `banned:oldschool`,
// `restricted:oldschool`); the response envelope (`object`, `has_more`,
// `next_page`, `data`) mirrors Scryfall's real shape. Where noted, a fixture
// is reshaped from the single real page Scryfall returned (all three queries
// fit in one page) into TWO pages, purely to exercise the pagination-merge
// path in `parseBanlistResponse` — the names themselves are untouched.
//
// `Strip Mine` is deliberately duplicated onto the second premodern page
// (it has genuinely shipped in a dozen+ sets — confirmed via a real
// `unique=prints` fetch) to exercise cross-page dedup by name.

import type { ScryfallSearchPage } from "../../banlistSync";

/** `banned:premodern` (33 real names as of the capture date), split into two
 *  pages with `Strip Mine` repeated on the second to exercise cross-page,
 *  cross-printing dedup. */
export const PREMODERN_BANNED_FIXTURE_PAGES: ScryfallSearchPage[] = [
    {
        has_more: true,
        next_page:
            "https://api.scryfall.com/cards/search?q=banned%3Apremodern&order=name&page=2",
        data: [
            { name: "Amulet of Quoz" },
            { name: "Balance" },
            { name: "Brainstorm" },
            { name: "Bronze Tablet" },
            { name: "Channel" },
            { name: "Demonic Consultation" },
            { name: "Earthcraft" },
            { name: "Entomb" },
            { name: "Flash" },
            { name: "Force of Will" },
            { name: "Goblin Recruiter" },
            { name: "Grim Monolith" },
            { name: "Jeweled Bird" },
            { name: "Land Tax" },
            { name: "Mana Vault" },
            { name: "Memory Jar" },
            { name: "Mind's Desire" },
            { name: "Mind Twist" },
        ],
    },
    {
        has_more: false,
        next_page: null,
        data: [
            { name: "Mystical Tutor" },
            { name: "Necropotence" },
            { name: "Parallax Tide" },
            { name: "Rebirth" },
            { name: "Strip Mine" },
            { name: "Tempest Efreet" },
            { name: "Tendrils of Agony" },
            { name: "Time Spiral" },
            { name: "Timmerian Fiends" },
            { name: "Tolarian Academy" },
            { name: "Vampiric Tutor" },
            { name: "Windfall" },
            { name: "Worldgorger Dragon" },
            { name: "Yawgmoth's Bargain" },
            { name: "Yawgmoth's Will" },
            // Cross-page, cross-printing dedup case: Strip Mine has shipped
            // in eos/sld/zne/exp/vma/… — Scryfall's default `unique=cards`
            // mode already collapses printings server-side, but a second
            // occurrence of the SAME name across pages must still collapse
            // to one entry client-side.
            { name: "Strip Mine" },
        ],
    },
];

/** `banned:oldschool` (7 real names — the ante/draft-manipulation cards; a
 *  single real page, kept as one page here). */
export const OLD_SCHOOL_BANNED_FIXTURE_PAGES: ScryfallSearchPage[] = [
    {
        has_more: false,
        next_page: null,
        data: [
            { name: "Bronze Tablet" },
            { name: "Contract from Below" },
            { name: "Darkpact" },
            { name: "Demonic Attorney" },
            { name: "Jeweled Bird" },
            { name: "Rebirth" },
            { name: "Tempest Efreet" },
        ],
    },
];

/** `restricted:oldschool` (22 real names — the Power 9 + restricted list; a
 *  single real page, kept as one page here). */
export const OLD_SCHOOL_RESTRICTED_FIXTURE_PAGES: ScryfallSearchPage[] = [
    {
        has_more: false,
        next_page: null,
        data: [
            { name: "Ancestral Recall" },
            { name: "Balance" },
            { name: "Black Lotus" },
            { name: "Braingeyser" },
            { name: "Channel" },
            { name: "Chaos Orb" },
            { name: "Demonic Tutor" },
            { name: "Library of Alexandria" },
            { name: "Mana Drain" },
            { name: "Mind Twist" },
            { name: "Mox Emerald" },
            { name: "Mox Jet" },
            { name: "Mox Pearl" },
            { name: "Mox Ruby" },
            { name: "Mox Sapphire" },
            { name: "Recall" },
            { name: "Regrowth" },
            { name: "Sol Ring" },
            { name: "Timetwister" },
            { name: "Time Vault" },
            { name: "Time Walk" },
            { name: "Wheel of Fortune" },
        ],
    },
];

/** A real Scryfall error-response body, captured from an empty `q=` query
 *  (`https://api.scryfall.com/cards/search?q=`) — the shape
 *  `parseScryfallSearchPage` must reject before any DB write. */
export const SCRYFALL_ERROR_RESPONSE_FIXTURE = {
    object: "error",
    code: "bad_request",
    status: 400,
    warnings: null,
    details: "You didn‘t enter anything to search for.",
};
