import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  collectRedactionValues,
  REDACTION_PLACEHOLDER,
  MIN_REDACTABLE_LENGTH,
} from "../redaction.js";

describe("redactSecrets", () => {
  it("replaces every occurrence of a secret value", () => {
    const out = redactSecrets("token=ABCDEF and again ABCDEF", ["ABCDEF"]);
    expect(out).toBe(`token=${REDACTION_PLACEHOLDER} and again ${REDACTION_PLACEHOLDER}`);
  });

  it("ignores values shorter than the minimum length", () => {
    expect("abc".length).toBeLessThan(MIN_REDACTABLE_LENGTH);
    const out = redactSecrets("value abc here", ["abc"]);
    expect(out).toBe("value abc here");
  });

  it("skips undefined entries in the iterable", () => {
    const out = redactSecrets("keep SECRETVALUE", [undefined, "SECRETVALUE"]);
    expect(out).toBe(`keep ${REDACTION_PLACEHOLDER}`);
  });

  it("redacts the longest value first so substrings do not leak", () => {
    // "alpha" is a substring of "alphabeta"; shortest-first would leave "beta"
    // dangling. Longest-first must fully mask both occurrences.
    const out = redactSecrets("x alphabeta y alpha z", ["alpha", "alphabeta"]);
    expect(out).toBe(`x ${REDACTION_PLACEHOLDER} y ${REDACTION_PLACEHOLDER} z`);
    expect(out).not.toContain("alpha");
  });

  it("is a no-op when no value is present in the text", () => {
    const out = redactSecrets("nothing to see", ["ABSENTVALUE"]);
    expect(out).toBe("nothing to see");
  });
});

describe("collectRedactionValues", () => {
  it("returns only granted secret values present in env", () => {
    const values = collectRedactionValues(["API_KEY", "TOKEN"], {
      API_KEY: "longsecretvalue",
      TOKEN: "anothersecret",
      PUBLIC: "not-a-secret",
    });
    expect(values.sort()).toEqual(["anothersecret", "longsecretvalue"]);
  });

  it("ignores non-secret env keys and short values", () => {
    const values = collectRedactionValues(["API_KEY", "PIN"], {
      API_KEY: "longsecretvalue",
      PIN: "12",
      OTHER: "ignored",
    });
    expect(values).toEqual(["longsecretvalue"]);
  });

  it("returns an empty array when env is undefined", () => {
    expect(collectRedactionValues(["API_KEY"], undefined)).toEqual([]);
  });
});
