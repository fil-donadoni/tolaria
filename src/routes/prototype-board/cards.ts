/**
 * PROTOTYPE — shared fake card data for the board-rendering comparison.
 * Throwaway — delete after decision. Real Scryfall ids so images load.
 */

export type ProtoCard = {
    instanceId: string;
    cardId: string; // registry key == Scryfall id
    name: string;
    power: number;
    toughness: number;
};

// Real LEA/ARN creature ids — Scryfall art resolves from these.
const POOL: Omit<ProtoCard, "instanceId">[] = [
    {
        cardId: "0458b733-d689-4cb5-8970-3b675c67fc4d",
        name: "Serendib Djinn",
        power: 5,
        toughness: 6,
    },
    {
        cardId: "0ddb98e8-13fe-4786-83f7-b72c56db135a",
        name: "Hill Giant",
        power: 3,
        toughness: 3,
    },
    {
        cardId: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb",
        name: "Mahamoti Djinn",
        power: 5,
        toughness: 6,
    },
    {
        cardId: "2926777a-4f6e-4965-ba83-22cf7df02602",
        name: "Lord of the Pit",
        power: 7,
        toughness: 7,
    },
    {
        cardId: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3",
        name: "Force of Nature",
        power: 8,
        toughness: 8,
    },
    {
        cardId: "31bf3f14-b5df-498b-a1bb-965885c82401",
        name: "Juzám Djinn",
        power: 5,
        toughness: 5,
    },
    {
        cardId: "1cb9d405-f2b5-4e10-a405-feafd2a87d90",
        name: "Elvish Archers",
        power: 2,
        toughness: 1,
    },
    {
        cardId: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8",
        name: "Pearled Unicorn",
        power: 2,
        toughness: 2,
    },
    {
        cardId: "eaac88da-d19e-4771-944c-3709963d04e7",
        name: "Mesa Pegasus",
        power: 1,
        toughness: 1,
    },
    {
        cardId: "0631c7c8-9aa5-4333-8e20-20247fc47033",
        name: "Phantasmal Forces",
        power: 4,
        toughness: 1,
    },
    {
        cardId: "2ff21a6f-83a7-4bf3-a078-294e303232cc",
        name: "Uthden Troll",
        power: 2,
        toughness: 2,
    },
    {
        cardId: "140e567c-6e4a-42b0-8084-d6c9695ae802",
        name: "Wall of Stone",
        power: 0,
        toughness: 8,
    },
];

export function makeCards(n: number, seed = 0): ProtoCard[] {
    return Array.from({ length: n }, (_, i) => {
        const base = POOL[(i + seed) % POOL.length];
        return { ...base, instanceId: `proto-${seed}-${i}` };
    });
}

// Via the Vite dev proxy (see vite.config.ts) → same-origin, so the WebGL
// variant can upload textures and the card-image service worker stays out of
// the way. Throwaway alongside the prototype.
export const SCRYFALL_NORMAL = (id: string) =>
    `/scryfall-proxy/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
