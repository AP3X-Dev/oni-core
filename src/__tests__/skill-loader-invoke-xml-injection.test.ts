import { describe, it, expect } from "vitest";
import { SkillLoader } from "../harness/skill-loader.js";
import type { SkillDefinition } from "../harness/skill-loader.js";

function makeSkill(name: string): SkillDefinition {
  return {
    name,
    description: `Skill ${name}`,
    content: `Content for ${name}`,
    sourcePath: "programmatic",
  };
}

describe("BUG-0027: invoke() escapes skill name to prevent XML injection", () => {
  it("BUG-0027: skill name containing XML special chars is escaped in pendingInjection", () => {
    // Before the fix, `invoke()` interpolated `name` directly into the XML attribute:
    //   `<skill-instructions name="${name}">` — no escXml() call.
    // A skill name like `foo" onload="alert(1)` would break out of the attribute.
    // After the fix, escXml() is applied so special characters are entity-encoded.
    const loader = new SkillLoader();
    const maliciousName = 'a"><injected attr="x';
    loader.register(makeSkill(maliciousName));

    const found = loader.invoke(maliciousName);
    expect(found).toBe(true);

    const injection = loader.getPendingInjection();
    expect(injection).not.toBeNull();

    // The opening tag attribute value must be safely entity-encoded.
    // Extract just the attribute value between name="..." to check escaping.
    const nameValueMatch = injection!.match(/^<skill-instructions name="([^"]*)">/);
    expect(nameValueMatch).not.toBeNull();
    const nameValue = nameValueMatch![1];
    expect(nameValue).toContain("&quot;");          // " → &quot;
    expect(nameValue).toContain("&gt;");            // > → &gt;
    // The raw attack characters must not appear unescaped in the attribute value
    expect(nameValue).not.toContain('"');
    expect(nameValue).not.toContain('>');

    // The outer element structure must remain syntactically intact
    expect(injection).toMatch(/^<skill-instructions name="/);
    expect(injection).toMatch(/<\/skill-instructions>$/);
  });

  it("BUG-0027: skill name with ampersand is escaped to &amp;", () => {
    const loader = new SkillLoader();
    const nameWithAmp = "search & retrieve";
    loader.register(makeSkill(nameWithAmp));

    loader.invoke(nameWithAmp);
    const injection = loader.getPendingInjection();
    expect(injection).not.toBeNull();
    // Check the opening tag attribute only — the skill body may contain the raw name
    const openingTag = injection!.split("\n")[0];
    expect(openingTag).not.toContain(" & ");      // raw ampersand must be escaped in attribute
    expect(openingTag).toContain("&amp;");
  });

  it("BUG-0027: normal skill name passes through unchanged", () => {
    const loader = new SkillLoader();
    loader.register(makeSkill("my-skill"));

    loader.invoke("my-skill");
    const injection = loader.getPendingInjection();
    expect(injection).not.toBeNull();
    expect(injection).toContain('name="my-skill"');
  });
});
