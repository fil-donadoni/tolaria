// The admin section's contents, in ONE place: the header's Admin menu and the
// `/admin` index page both render this list, so a new admin page is added once
// and appears in both. Route definitions live in `src/router.tsx`; keeping the
// paths here as plain strings (rather than importing the route objects) avoids
// a cycle — the router imports the pages, the pages import the header, the
// header imports this.

export interface AdminNavEntry {
    /** Route path, e.g. `/admin/banlists`. */
    to: string;
    /** Menu label. */
    label: string;
    /** One line shown on the `/admin` index card — what the page is FOR. */
    description: string;
}

export const ADMIN_NAV: readonly AdminNavEntry[] = [
    {
        to: "/admin/scenarios",
        label: "Scenarios",
        description:
            "Saved board setups: rename, edit the spec, promote to golden, regenerate or vary, prune the ephemeral ones.",
    },
    {
        to: "/admin/banlists",
        label: "Banlists",
        description:
            "Per-format banned/restricted lists, and the sync that reconciles them against the card catalogue.",
    },
    {
        to: "/admin/pick-ratings",
        label: "Pick Ratings",
        description:
            "The Bot Drafter's per-scope card ratings — the database layer over the checked-in seed file.",
    },
    {
        to: "/admin/card-profiles",
        label: "Card Profiles",
        description:
            "Archetypes, Capabilities and Combo Edges per card, plus the reviewed flag over the LLM-seeded census.",
    },
    {
        to: "/admin/draft-lab",
        label: "Draft Lab",
        description:
            "Run a whole bot draft in the browser, or replay a completed one, with the full per-candidate score breakdown.",
    },
    {
        to: "/admin/design-system",
        label: "Design System",
        description:
            "The living census of design tokens, chrome and component variants.",
    },
];
