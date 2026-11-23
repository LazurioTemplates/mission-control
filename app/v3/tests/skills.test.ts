import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("the skills for agents", () => {
  test("the same for both harnesses, each named by its folder", () => {
    const skills = readdirSync(join(root, ".agents/skills")).sort();
    expect(skills).toEqual(["check-plans", "create-plan", "publish-plan-changes"]);
    expect(readdirSync(join(root, ".claude/skills")).sort()).toEqual(skills);
    for (const skill of skills) {
      const text = read(`.agents/skills/${skill}/SKILL.md`);
      expect(text).toStartWith(`---\nname: ${skill}\ndescription: "`);
      expect(read(`.claude/skills/${skill}/SKILL.md`)).toBe(text);
    }
  });

  test("they work through the App, and publish only on the person's instruction", () => {
    for (const skill of ["check-plans", "create-plan", "publish-plan-changes"]) {
      const text = read(`.agents/skills/${skill}/SKILL.md`);
      expect(text).toContain("`db/`");
    }
    const publish = read(".agents/skills/publish-plan-changes/SKILL.md");
    expect(publish).toContain("publish_draft");
    expect(publish).toContain("Publikuj");
  });
});
