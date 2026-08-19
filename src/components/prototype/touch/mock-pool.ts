// PROTOTYPE — throwaway. Mock Limited pool for the touch-gesture prototype
// (/prototype/touch). Real LEA printings so the tiles show real art; zone
// placement is invented. No persistence — state lives in React memory.
import { tryGetDefinition } from "@convex/cards";
import { manaValue } from "@convex/gre/constants";

export type Zone = "pool" | "main" | "side";

export interface ProtoCard {
    /** Unique per physical copy. */
    key: string;
    cardId: string;
    name: string;
    mv: number;
    isLand: boolean;
    isCreature: boolean;
}

const LEA = {
    plains: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    island: "90a57c0e-fa61-45ef-955d-d296403967d5",
    swamp: "6176936d-72e2-4205-8871-4c5a4f1cb2d8",
    animateDead: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b",
    badMoon: "43572906-ea74-4411-a549-5dc401591d2a",
    blackKnight: "c1662949-0d69-49a3-8c69-daf10717ed4e",
    bogWraith: "6701874e-986e-4b81-9268-90b6171e6187",
    darkRitual: "ebb6664d-23ca-456e-9916-afcd6f26aa7f",
    demonicHordes: "6c9bb8b1-fb79-4b99-ba09-c6e6c860de50",
    demonicTutor: "711d4d54-5520-4de8-9b93-79902ed8e562",
    drainLife: "5d077a49-73d4-4958-b42a-31b814e110e8",
    drudgeSkeletons: "23614289-0d73-4747-a849-5cb67cc97d6a",
    fear: "0cd927be-e63f-4371-a1d8-7a0489cb187e",
    airElemental: "69c3b2a3-0daa-4d42-832d-fcdfda6555ea",
    ancestralRecall: "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b",
    braingeyser: "62b19a12-6914-430e-81ce-dcfca47884df",
    clone: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3",
    controlMagic: "7b52f459-c703-4a0b-9114-ff69eec61287",
    counterspell: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    flight: "67c7784b-6b79-4268-a714-895c82809aff",
    blackLotus: "b0faa7f2-b547-42c4-a810-839da50dadfe",
    basaltMonolith: "66a74c89-6f86-4ec8-af17-391cd5026054",
    clockworkBeast: "27f916a2-0ace-44b5-99dc-72979af34db9",
    grizzlyBears: "ce2d603a-3231-4a8c-bf39-1617586ea870",
    giantSpider: "77636b4c-faea-4bf5-b88c-dd5bb88dc930",
    crawWurm: "bfed1a95-bd67-4e16-a781-81866028af2f",
    giantGrowth: "367dbefe-3366-408e-9fcf-7dc00f8cc201",
    fireball: "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece",
    earthElemental: "b24b5864-44c0-4bc8-8705-9504f83b2c03",
    dwarvenWarriors: "2d4d87a3-5f8b-4152-9a8b-538ab49d62e8",
    balance: "6f9ea46a-411f-40ce-a873-a905180093f4",
    benalishHero: "11600105-56c6-4073-a4a6-8469030b39c9",
    armageddon: "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb",
};

let seq = 0;
function make(cardId: string): ProtoCard {
    const def = tryGetDefinition(cardId);
    const types = def?.types ?? [];
    return {
        key: `${cardId}#${seq++}`,
        cardId,
        name: def?.name ?? cardId.slice(0, 8),
        mv: manaValue(def?.manaCost),
        isLand: types.includes("Land"),
        isCreature: types.includes("Creature"),
    };
}

function many(cardId: string, n: number): ProtoCard[] {
    return Array.from({ length: n }, () => make(cardId));
}

export interface PoolState {
    pool: ProtoCard[];
    main: ProtoCard[];
    side: ProtoCard[];
}

export function initialPool(): PoolState {
    seq = 0;
    return {
        main: [
            ...many(LEA.swamp, 9),
            ...many(LEA.island, 8),
            make(LEA.darkRitual),
            make(LEA.darkRitual),
            make(LEA.ancestralRecall),
            make(LEA.blackKnight),
            make(LEA.counterspell),
            make(LEA.counterspell),
            make(LEA.drudgeSkeletons),
            make(LEA.bogWraith),
            make(LEA.fear),
            make(LEA.animateDead),
            make(LEA.clone),
            make(LEA.controlMagic),
            make(LEA.drainLife),
            make(LEA.airElemental),
            make(LEA.demonicHordes),
            make(LEA.braingeyser),
        ],
        side: [
            make(LEA.flight),
            make(LEA.badMoon),
            make(LEA.demonicTutor),
            make(LEA.basaltMonolith),
        ],
        pool: [
            make(LEA.blackLotus),
            make(LEA.clockworkBeast),
            make(LEA.grizzlyBears),
            make(LEA.giantSpider),
            make(LEA.crawWurm),
            make(LEA.giantGrowth),
            make(LEA.fireball),
            make(LEA.earthElemental),
            make(LEA.dwarvenWarriors),
            make(LEA.balance),
            make(LEA.benalishHero),
            make(LEA.armageddon),
            ...many(LEA.plains, 3),
        ],
    };
}

/** Column/row buckets: LAND, then MV 0..5, 6+ */
export const BUCKETS = ["LAND", "0", "1", "2", "3", "4", "5", "6+"] as const;
export type Bucket = (typeof BUCKETS)[number];

export function bucketOf(c: ProtoCard): Bucket {
    if (c.isLand) return "LAND";
    if (c.mv >= 6) return "6+";
    return String(c.mv) as Bucket;
}

/** Draft pack: 15 cards, fresh keys. */
export function draftPack(): ProtoCard[] {
    return [
        LEA.blackLotus,
        LEA.ancestralRecall,
        LEA.counterspell,
        LEA.darkRitual,
        LEA.grizzlyBears,
        LEA.giantSpider,
        LEA.fireball,
        LEA.armageddon,
        LEA.balance,
        LEA.clone,
        LEA.controlMagic,
        LEA.bogWraith,
        LEA.crawWurm,
        LEA.benalishHero,
        LEA.flight,
    ].map(make);
}
