import { describe, expect, it } from "vitest";
import { readRanking } from "../src/intake/preferences.js";

const order = "20 kg of chicken breast until the last day of this month 10 pm";

describe("intake comparison priority", () => {
  it.each([
    ["lowest carbon priority", "carbon"],
    ["lowest carbon footprint priority", "carbon"],
    ["lowest total cost priority", "cost"],
    ["highest delivery reliability priority", "reliability"],
  ])("extracts the explicit wording %s", (priority, objective) => {
    const note = `${order} with ${priority}.`;
    expect(readRanking(note, "note")).toEqual({ objective, evidence: { source: "note", excerpt: note } });
  });

  it.each([
    ["12 kgs of chicken breast until  20th of this month, 10 am. budget is 400eur, lowest carbon intensity.", "carbon", "budget is 400eur, lowest carbon intensity."],
    [`${order}. Highest delivery reliability.`, "reliability", "Highest delivery reliability."],
    [`${order} with lowest total cost.`, "cost", `${order} with lowest total cost.`],
  ])("accepts a stand-alone or trailing priority in %s", (note, objective, excerpt) => {
    expect(readRanking(note, "note")).toEqual({ objective, evidence: { source: "note", excerpt } });
  });

  it.each([
    "",
    ". Budget €120 and deliver on time.",
    " with no comparison preference.",
    " without lowest carbon priority.",
    " with lowest carbon priority if possible.",
    " with lowest carbon priority or highest delivery reliability priority.",
    " with carbon as the lowest priority.",
    ". The current product claims lowest carbon intensity.",
    ". Budget €400, not lowest carbon intensity.",
    ". Budget €400, lowest carbon intensity if possible.",
    ". Budget €400, lowest carbon intensity or highest delivery reliability.",
  ])("leaves comparison unset when the order ends with %j", (ending) => {
    expect(readRanking(`${order}${ending}`, "note")).toBeUndefined();
  });
});
