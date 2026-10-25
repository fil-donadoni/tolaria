import { expect, it } from "vitest";
import { findBladeScenario } from "../registry";
import { runBladeScenario } from "../runner";
for (const label of [
    "discriminating pair: does NOT attack with Walking Ballista into an untapped Hill Giant",
    "flash permanent NEGATIVE CONTROL: still casts hasty Raging Kavu for lethal this turn",
    "Snapcaster Mage (issue #4217 reported position): holds it on turn 4 with an empty graveyard",
    "Sacrifice-for-denial outlet: casts the creature",
]) it(label, () => { expect(runBladeScenario(findBladeScenario(label)!).failureMessage).toBe(""); }, 900000);
