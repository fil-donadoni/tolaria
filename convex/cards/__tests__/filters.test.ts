import { describe, expect, it } from "vitest";
import {
    matchesDamageSourceFilter,
    matchesPermanentFilter,
    matchesPlayerFilter,
    matchesSpellFilter,
    type FilterMatchContext,
    type MatchableDamageSource,
    type MatchablePermanent,
    type MatchablePlayer,
    type MatchableSpell,
} from "../filters";

function permanent(
    overrides: Partial<MatchablePermanent> = {}
): MatchablePermanent {
    return {
        id: "perm-1",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        controllerId: "p1",
        isToken: false,
        ...overrides,
    };
}

function spell(overrides: Partial<MatchableSpell> = {}): MatchableSpell {
    return {
        types: ["Instant"],
        subtypes: [],
        colors: [],
        ...overrides,
    };
}

function damageSource(
    overrides: Partial<MatchableDamageSource> = {}
): MatchableDamageSource {
    return {
        types: ["Creature"],
        subtypes: [],
        colors: [],
        staticAbilities: [],
        controllerId: "p1",
        instanceId: "src-1",
        ...overrides,
    };
}

function player(overrides: Partial<MatchablePlayer> = {}): MatchablePlayer {
    return { id: "p1", life: 20, ...overrides };
}

describe("matchesPermanentFilter", () => {
    it("returns true for an empty filter", () => {
        expect(matchesPermanentFilter(permanent(), {})).toBe(true);
    });

    it("matches by types (string or array, OR semantics)", () => {
        const card = permanent({ types: ["Artifact", "Creature"] });
        expect(matchesPermanentFilter(card, { types: "Creature" })).toBe(true);
        expect(matchesPermanentFilter(card, { types: "Land" })).toBe(false);
        expect(
            matchesPermanentFilter(card, { types: ["Enchantment", "Artifact"] })
        ).toBe(true);
    });

    it("excludeTypes rejects permanents carrying any listed type ('nonartifact creature')", () => {
        const creature = permanent({ types: ["Creature"] });
        const artifactCreature = permanent({ types: ["Artifact", "Creature"] });
        const nonartifactCreature = {
            types: "Creature" as const,
            excludeTypes: "Artifact" as const,
        };
        expect(matchesPermanentFilter(creature, nonartifactCreature)).toBe(
            true
        );
        expect(
            matchesPermanentFilter(artifactCreature, nonartifactCreature)
        ).toBe(false);
        // Array form, AND with `types`.
        expect(
            matchesPermanentFilter(artifactCreature, {
                excludeTypes: ["Land", "Artifact"],
            })
        ).toBe(false);
    });

    it("matches by subtypes (string or array, OR semantics)", () => {
        const card = permanent({ subtypes: ["Goblin", "Warrior"] });
        expect(matchesPermanentFilter(card, { subtypes: "Goblin" })).toBe(true);
        expect(matchesPermanentFilter(card, { subtypes: ["Elf"] })).toBe(false);
        expect(
            matchesPermanentFilter(card, { subtypes: ["Elf", "Warrior"] })
        ).toBe(true);
    });

    it("honors requireAbility / excludeAbility", () => {
        const card = permanent({ staticAbilities: ["flying"] });
        expect(matchesPermanentFilter(card, { requireAbility: "flying" })).toBe(
            true
        );
        expect(
            matchesPermanentFilter(card, { requireAbility: "trample" })
        ).toBe(false);
        expect(matchesPermanentFilter(card, { excludeAbility: "flying" })).toBe(
            false
        );
        expect(
            matchesPermanentFilter(card, { excludeAbility: "trample" })
        ).toBe(true);
    });

    it("honors isToken", () => {
        const tokenCard = permanent({ isToken: true });
        const printedCard = permanent({ isToken: false });
        expect(matchesPermanentFilter(tokenCard, { isToken: true })).toBe(true);
        expect(matchesPermanentFilter(tokenCard, { isToken: false })).toBe(
            false
        );
        expect(matchesPermanentFilter(printedCard, { isToken: false })).toBe(
            true
        );
        expect(matchesPermanentFilter(printedCard, { isToken: true })).toBe(
            false
        );
    });

    it("honors excludeInstanceIds", () => {
        const card = permanent({ id: "abc" });
        expect(
            matchesPermanentFilter(card, { excludeInstanceIds: ["xyz"] })
        ).toBe(true);
        expect(
            matchesPermanentFilter(card, { excludeInstanceIds: ["abc"] })
        ).toBe(false);
    });

    it("matches by colors (OR semantics, requires populated colors)", () => {
        const card = permanent({ colors: ["R", "G"] });
        expect(matchesPermanentFilter(card, { colors: "R" })).toBe(true);
        expect(matchesPermanentFilter(card, { colors: ["W", "U"] })).toBe(
            false
        );
        expect(matchesPermanentFilter(card, { colors: ["U", "G"] })).toBe(true);
        const colorlessCard = permanent({ colors: [] });
        expect(matchesPermanentFilter(colorlessCard, { colors: "R" })).toBe(
            false
        );
    });

    it("matches by powerAtLeast / toughnessAtLeast (inclusive)", () => {
        const card = permanent({ power: 3, toughness: 2 });
        expect(matchesPermanentFilter(card, { powerAtLeast: 3 })).toBe(true);
        expect(matchesPermanentFilter(card, { powerAtLeast: 4 })).toBe(false);
        expect(matchesPermanentFilter(card, { toughnessAtLeast: 2 })).toBe(
            true
        );
        expect(matchesPermanentFilter(card, { toughnessAtLeast: 3 })).toBe(
            false
        );
        const noPT = permanent({ power: undefined, toughness: undefined });
        expect(matchesPermanentFilter(noPT, { powerAtLeast: 0 })).toBe(false);
        expect(matchesPermanentFilter(noPT, { toughnessAtLeast: 0 })).toBe(
            false
        );
    });

    it("honors controllerRelation: self / you / opponents / any", () => {
        const card = permanent({ id: "perm-1", controllerId: "p1" });
        const ctx: FilterMatchContext = {
            selfInstanceId: "perm-1",
            selfControllerId: "p1",
        };
        expect(
            matchesPermanentFilter(card, { controllerRelation: "self" }, ctx)
        ).toBe(true);
        expect(
            matchesPermanentFilter(
                permanent({ id: "other" }),
                { controllerRelation: "self" },
                ctx
            )
        ).toBe(false);
        expect(
            matchesPermanentFilter(card, { controllerRelation: "you" }, ctx)
        ).toBe(true);
        expect(
            matchesPermanentFilter(
                permanent({ controllerId: "p2" }),
                { controllerRelation: "you" },
                ctx
            )
        ).toBe(false);
        expect(
            matchesPermanentFilter(
                permanent({ controllerId: "p2" }),
                { controllerRelation: "opponents" },
                ctx
            )
        ).toBe(true);
        expect(
            matchesPermanentFilter(card, { controllerRelation: "any" }, ctx)
        ).toBe(true);
    });

    it("combines fields with AND semantics", () => {
        const card = permanent({
            types: ["Creature"],
            subtypes: ["Elf"],
            colors: ["G"],
            power: 2,
        });
        expect(
            matchesPermanentFilter(card, {
                types: "Creature",
                subtypes: "Elf",
                colors: "G",
                powerAtLeast: 2,
            })
        ).toBe(true);
        expect(
            matchesPermanentFilter(card, {
                types: "Creature",
                subtypes: "Elf",
                colors: "G",
                powerAtLeast: 3,
            })
        ).toBe(false);
    });
});

describe("matchesSpellFilter", () => {
    it("returns true for an empty filter", () => {
        expect(matchesSpellFilter(spell(), {})).toBe(true);
    });

    it("matches by types (string or array)", () => {
        const s = spell({ types: ["Creature", "Artifact"] });
        expect(matchesSpellFilter(s, { types: "Creature" })).toBe(true);
        expect(matchesSpellFilter(s, { types: "Instant" })).toBe(false);
        expect(matchesSpellFilter(s, { types: ["Instant", "Artifact"] })).toBe(
            true
        );
    });

    it("matches by subtypes", () => {
        const s = spell({ subtypes: ["Aura", "Goblin"] });
        expect(matchesSpellFilter(s, { subtypes: "Aura" })).toBe(true);
        expect(matchesSpellFilter(s, { subtypes: ["Elf"] })).toBe(false);
        expect(matchesSpellFilter(s, { subtypes: ["Elf", "Goblin"] })).toBe(
            true
        );
    });

    it("matches by colors (OR semantics)", () => {
        const s = spell({ colors: ["U"] });
        expect(matchesSpellFilter(s, { colors: "U" })).toBe(true);
        expect(matchesSpellFilter(s, { colors: ["R", "G"] })).toBe(false);
        expect(matchesSpellFilter(s, { colors: ["U", "W"] })).toBe(true);
    });
});

describe("matchesDamageSourceFilter", () => {
    it("returns true for an empty filter", () => {
        expect(matchesDamageSourceFilter(damageSource(), {})).toBe(true);
    });

    it("matches by types", () => {
        const src = damageSource({ types: ["Instant"] });
        expect(matchesDamageSourceFilter(src, { types: "Instant" })).toBe(true);
        expect(matchesDamageSourceFilter(src, { types: "Creature" })).toBe(
            false
        );
    });

    it("matches by subtypes", () => {
        const src = damageSource({ subtypes: ["Dragon"] });
        expect(matchesDamageSourceFilter(src, { subtypes: "Dragon" })).toBe(
            true
        );
        expect(matchesDamageSourceFilter(src, { subtypes: ["Elf"] })).toBe(
            false
        );
    });

    it("matches by colors (OR semantics)", () => {
        const src = damageSource({ colors: ["R"] });
        expect(matchesDamageSourceFilter(src, { colors: "R" })).toBe(true);
        expect(matchesDamageSourceFilter(src, { colors: ["U", "W"] })).toBe(
            false
        );
        expect(matchesDamageSourceFilter(src, { colors: ["R", "G"] })).toBe(
            true
        );
    });

    it("honors requireAbility", () => {
        const src = damageSource({ staticAbilities: ["flying"] });
        expect(
            matchesDamageSourceFilter(src, { requireAbility: "flying" })
        ).toBe(true);
        expect(
            matchesDamageSourceFilter(src, { requireAbility: "trample" })
        ).toBe(false);
    });

    it("honors controllerRelation", () => {
        const ctx: FilterMatchContext = {
            selfInstanceId: "src-1",
            selfControllerId: "p1",
        };
        const own = damageSource({ instanceId: "src-1", controllerId: "p1" });
        const ally = damageSource({ instanceId: "other", controllerId: "p1" });
        const enemy = damageSource({ instanceId: "other", controllerId: "p2" });
        expect(
            matchesDamageSourceFilter(own, { controllerRelation: "self" }, ctx)
        ).toBe(true);
        expect(
            matchesDamageSourceFilter(ally, { controllerRelation: "self" }, ctx)
        ).toBe(false);
        expect(
            matchesDamageSourceFilter(ally, { controllerRelation: "you" }, ctx)
        ).toBe(true);
        expect(
            matchesDamageSourceFilter(
                enemy,
                { controllerRelation: "opponents" },
                ctx
            )
        ).toBe(true);
        expect(
            matchesDamageSourceFilter(enemy, { controllerRelation: "any" }, ctx)
        ).toBe(true);
    });
});

describe("matchesPlayerFilter", () => {
    it("returns true for an empty filter", () => {
        expect(matchesPlayerFilter(player(), {})).toBe(true);
    });

    it("honors relation: you / opponent", () => {
        const ctx: FilterMatchContext = { selfControllerId: "p1" };
        expect(
            matchesPlayerFilter(player({ id: "p1" }), { relation: "you" }, ctx)
        ).toBe(true);
        expect(
            matchesPlayerFilter(player({ id: "p2" }), { relation: "you" }, ctx)
        ).toBe(false);
        expect(
            matchesPlayerFilter(
                player({ id: "p2" }),
                { relation: "opponent" },
                ctx
            )
        ).toBe(true);
        expect(
            matchesPlayerFilter(
                player({ id: "p1" }),
                { relation: "opponent" },
                ctx
            )
        ).toBe(false);
    });

    it("honors relation: controller as alias of you", () => {
        const ctx: FilterMatchContext = { selfControllerId: "p1" };
        expect(
            matchesPlayerFilter(
                player({ id: "p1" }),
                { relation: "controller" },
                ctx
            )
        ).toBe(true);
        expect(
            matchesPlayerFilter(
                player({ id: "p2" }),
                { relation: "controller" },
                ctx
            )
        ).toBe(false);
    });

    it("honors relation: active / non-active", () => {
        const ctx: FilterMatchContext = { activePlayerId: "p1" };
        expect(
            matchesPlayerFilter(
                player({ id: "p1" }),
                { relation: "active" },
                ctx
            )
        ).toBe(true);
        expect(
            matchesPlayerFilter(
                player({ id: "p2" }),
                { relation: "active" },
                ctx
            )
        ).toBe(false);
        expect(
            matchesPlayerFilter(
                player({ id: "p2" }),
                { relation: "non-active" },
                ctx
            )
        ).toBe(true);
        expect(
            matchesPlayerFilter(
                player({ id: "p1" }),
                { relation: "non-active" },
                ctx
            )
        ).toBe(false);
    });

    it("honors relation: any", () => {
        expect(matchesPlayerFilter(player(), { relation: "any" })).toBe(true);
    });

    it("honors lifeAtMost / lifeAtLeast (inclusive bounds)", () => {
        const p = player({ life: 10 });
        expect(matchesPlayerFilter(p, { lifeAtMost: 10 })).toBe(true);
        expect(matchesPlayerFilter(p, { lifeAtMost: 9 })).toBe(false);
        expect(matchesPlayerFilter(p, { lifeAtLeast: 10 })).toBe(true);
        expect(matchesPlayerFilter(p, { lifeAtLeast: 11 })).toBe(false);
        expect(matchesPlayerFilter(p, { lifeAtLeast: 5, lifeAtMost: 15 })).toBe(
            true
        );
    });
});
