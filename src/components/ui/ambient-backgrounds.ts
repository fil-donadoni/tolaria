/** Ambient background art pool — the rotation source for `AmbientPageGround`.
 *
 *  Two tiers, concatenated into one flat list the component picks from at random
 *  (one frame per mount):
 *
 *    1. LOBBY_BG    — fantasy frames shipped locally in `public/img/lobby-bg/`.
 *    2. CARD_ART_BG — Scryfall `art_crop` URLs for hand-picked cards, hotlinked
 *                     from the Scryfall CDN (`cards.scryfall.io`).
 *
 *  ## Why hotlinked URLs, not bundled files
 *
 *  Every frame is painted *heavily diluted* (opacity ~0.08, desaturated,
 *  darkened) as a faint atmospheric backdrop — quality is irrelevant, so the
 *  CDN-served `art_crop` JPG (~60–130 KB) is more than enough and there is no
 *  gain in re-optimising local copies. The names are resolved to URLs **once**
 *  (no per-mount API calls): the browser + Scryfall CDN handle image caching.
 *
 *  ## Adding a card
 *
 *  1. Resolve its `art_crop` URL once, e.g.
 *     `curl -s 'https://api.scryfall.com/cards/named?exact=CARD%20NAME' \
 *        | jq -r '.image_uris.art_crop // .card_faces[0].image_uris.art_crop'`
 *     (for a specific printing use `/cards/SET/COLLECTOR` instead of `named`).
 *  2. Append the URL below with a `// Card Name [set]` comment.
 *
 *  The trailing `?<timestamp>` is Scryfall's per-image cache key — keep it. */

/** Local fantasy frames in `public/img/lobby-bg/`. */
export const LOBBY_BG = [
    "/img/lobby-bg/01.webp",
    "/img/lobby-bg/02.webp",
    "/img/lobby-bg/03.webp",
    "/img/lobby-bg/04.webp",
    "/img/lobby-bg/05.webp",
    "/img/lobby-bg/06.webp",
    "/img/lobby-bg/07.webp",
    "/img/lobby-bg/08.webp",
];

/** Scryfall `art_crop` URLs for hand-picked cards (resolved once — see header). */
export const CARD_ART_BG = [
    "https://cards.scryfall.io/art_crop/front/b/6/b6af9894-95b5-4c8e-902f-a9ba70f02e4a.jpg?1730489317", // Etali, Primal Storm [fdn]
    "https://cards.scryfall.io/art_crop/front/1/c/1c68954c-4bab-4973-9819-ecd084438303.jpg?1562732195", // The Mirari Conjecture [dom]
    "https://cards.scryfall.io/art_crop/front/5/1/51b0dd0f-8ad8-4292-9df6-7b28ab4605e3.jpg?1562909992", // Plains [ody #333]
    "https://cards.scryfall.io/art_crop/front/7/b/7be413dd-d6e0-4bd3-8c14-4dbe44e8ee41.jpg?1562917881", // Copper-Leaf Angel [pcy]
    "https://cards.scryfall.io/art_crop/front/8/f/8f596ce1-b754-4e34-98e3-e1ddda2fd9b0.jpg?1562928792", // Divine Light [apc]
    "https://cards.scryfall.io/art_crop/front/6/5/65d5cff9-a3ec-432d-9ce5-68949e524279.jpg?1779014731", // Dive Down [fdn]
    "https://cards.scryfall.io/art_crop/front/8/5/85169934-1033-49d7-8d42-45e982077a23.jpg?1625193945", // Jaya Ballard [c21]
    "https://cards.scryfall.io/art_crop/front/d/5/d505d319-093d-47af-8ee9-fafae3885aa0.jpg?1562441641", // Living Wish [a25]
    "https://cards.scryfall.io/art_crop/front/9/a/9a82ffff-e02a-4ecb-a92d-8ed571beac46.jpg?1731347922", // Vizzerdrix [9ed]
    "https://cards.scryfall.io/art_crop/front/5/6/5631668d-75f2-4d2d-b644-90c073c7be21.jpg?1599707670", // Vengevine [2xm]
    "https://cards.scryfall.io/art_crop/front/6/0/6012964c-eb76-4581-82ae-aec2d36f0d56.jpg?1593095208", // Deicide [jou]
    "https://cards.scryfall.io/art_crop/front/e/7/e77fbc87-d78e-4602-baa0-da9b0d464dfb.jpg?1730489513", // Progenitus [fdn]
    "https://cards.scryfall.io/art_crop/front/b/a/ba86688d-18f0-4b5c-a797-42bf125a6c9f.jpg?1767658349", // Bloom Tender [ecl]
    "https://cards.scryfall.io/art_crop/front/7/1/7127164d-f2a3-4d79-b6db-93507ff5ab47.jpg?1759144841", // Bitterbloom Bearer [ecl]
    "https://cards.scryfall.io/art_crop/front/5/2/5223a04f-6b47-4379-80ce-8489c4a91734.jpg?1775937970", // Comforting Counsel [sos]
    "https://cards.scryfall.io/art_crop/front/5/e/5e07d3c6-60a5-44d1-a926-6414be85bd50.jpg?1752947436", // Cosmogoyf [eoe]
    "https://cards.scryfall.io/art_crop/front/0/2/0220c1e9-07bc-44f0-b39e-ca345ec4ea28.jpg?1739655313", // Mishra, Lost to Phyrexia [bro]
    "https://cards.scryfall.io/art_crop/front/7/8/78c2bfef-06a5-4c7f-8283-ea3fb673b7a1.jpg?1562850573", // Elesh Norn, Grand Cenobite [ima]
    "https://cards.scryfall.io/art_crop/front/0/0/00832a47-dec8-411e-9708-b3ebbd3a2dfc.jpg?1547432491", // Llanowar [opca] (Plane)
    "https://cards.scryfall.io/art_crop/front/c/b/cba58beb-9524-46d4-ac63-119f19d9d44f.jpg?1721428156", // Mr. Foxglove [blc]
    "https://cards.scryfall.io/art_crop/front/9/3/93294349-75ae-4a6b-896d-b403a5d69e98.jpg?1562926099", // Argothian Wurm [usg]
];

/** Flat rotation pool: local frames + hand-picked card art. */
export const AMBIENT_BG_IMAGES = [...LOBBY_BG, ...CARD_ART_BG];
