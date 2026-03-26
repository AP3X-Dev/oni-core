import { describe, it, expect, vi } from "vitest";
import { SwarmGraph } from "../graph.js";
import type {
  GANState, GANLoopConfig, CriterionScore,
  EvaluationCriterion, AgentDefinition,
} from "../graph.js";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

type TestState = Record<string, unknown>;

function makeCriteria(): EvaluationCriterion[] {
  return [
    {
      id: "quality",
      name: "Quality",
      description: "Overall output quality",
      weight: 0.6,
    },
    {
      id: "correctness",
      name: "Correctness",
      description: "Technical correctness",
      weight: 0.4,
    },
  ];
}

function makeGenerator(
  outputFn?: (state: GANState<TestState>) => Partial<GANState<TestState>>,
): AgentDefinition<TestState> {
  return {
    id: "test-generator",
    fn: (state) => {
      if (outputFn) return outputFn(state);
      return {
        generatorOutput: { result: `output-v${state.iteration + 1}` },
      };
    },
  };
}

function makeEvaluator(
  scoreFn: (state: GANState<TestState>) => { scores: CriterionScore[]; feedback: string },
): AgentDefinition<TestState> {
  return {
    id: "test-evaluator",
    fn: (state) => {
      const { scores, feedback } = scoreFn(state);
      return {
        scores,
        evaluatorFeedback: feedback,
      };
    },
  };
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("SwarmGraph.ganLoop()", () => {
  it("creates a compilable StateGraph", () => {
    const graph = SwarmGraph.ganLoop<TestState>({
      generator: makeGenerator(),
      evaluator: makeEvaluator(() => ({
        scores: [
          { criterionId: "quality", score: 0.9, rationale: "good", passed: true },
          { criterionId: "correctness", score: 0.9, rationale: "correct", passed: true },
        ],
        feedback: "Looks great",
      })),
      criteria: makeCriteria(),
    });

    expect(graph).toBeDefined();
    const compiled = graph.compile();
    expect(compiled).toBeDefined();
    expect(typeof compiled.invoke).toBe("function");
  });

  it("accepts when composite score meets threshold", async () => {
    const graph = SwarmGraph.ganLoop<TestState>({
      generator: makeGenerator(),
      evaluator: makeEvaluator(() => ({
        scores: [
          { criterionId: "quality", score: 0.9, rationale: "good", passed: true },
          { criterionId: "correctness", score: 0.85, rationale: "solid", passed: true },
        ],
        feedback: "Well done",
      })),
      criteria: makeCriteria(),
      passingThreshold: 0.80,
    });

    const compiled = graph.compile({ recursionLimit: 50 });
    const result = await compiled.invoke({});

    expect(result.decision).toBe("accept");
    expect(result.done).toBe(true);
    // 0.6*0.9 + 0.4*0.85 = 0.54 + 0.34 = 0.88
    expect(result.compositeScore).toBeCloseTo(0.88);
    expect(result.iteration).toBe(1);
  });

  it("refines when score is between pivot and passing thresholds", async () => {
    let callCount = 0;
    const graph = SwarmGraph.ganLoop<TestState>({
      generator: makeGenerator(),
      evaluator: makeEvaluator(() => {
        callCount++;
        // First 2 iterations: mediocre score (between 0.40 and 0.80)
        // Third iteration: passing score
        if (callCount <= 2) {
          return {
            scores: [
              { criterionId: "quality", score: 0.6, rationale: "ok", passed: false },
              { criterionId: "correctness", score: 0.7, rationale: "close", passed: false },
            ],
            feedback: "Needs more work",
          };
        }
        return {
          scores: [
            { criterionId: "quality", score: 0.9, rationale: "great", passed: true },
            { criterionId: "correctness", score: 0.9, rationale: "perfect", passed: true },
          ],
          feedback: "Excellent",
        };
      }),
      criteria: makeCriteria(),
      passingThreshold: 0.80,
      pivotThreshold: 0.40,
    });

    const compiled = graph.compile({ recursionLimit: 50 });
    const result = await compiled.invoke({});

    expect(result.decision).toBe("accept");
    expect(result.iteration).toBe(3);
  });

  it("pivots when score is below pivot threshold", async () => {
    let callCount = 0;
    const graph = SwarmGraph.ganLoop<TestState>({
      generator: makeGenerator((state) => {
        // When pivoting, change approach
        if (state.decision === "pivot") {
          return { generatorOutput: { result: "new-approach" } };
        }
        return { generatorOutput: { result: `v${state.iteration + 1}` } };
      }),
      evaluator: makeEvaluator(() => {
        callCount++;
        // First iteration: very low score → pivot
        if (callCount === 1) {
          return {
            scores: [
              { criterionId: "quality", score: 0.2, rationale: "bad", passed: false },
              { criterionId: "correctness", score: 0.1, rationale: "wrong", passed: false },
            ],
            feedback: "Completely wrong approach",
          };
        }
        // After pivot: passing score
        return {
          scores: [
            { criterionId: "quality", score: 0.9, rationale: "great", passed: true },
            { criterionId: "correctness", score: 0.9, rationale: "correct", passed: true },
          ],
          feedback: "Much better",
        };
      }),
      criteria: makeCriteria(),
      passingThreshold: 0.80,
      pivotThreshold: 0.40,
    });

    const compiled = graph.compile({ recursionLimit: 50 });
    const result = await compiled.invoke({});

    expect(result.decision).toBe("accept");
    expect(result.iteration).toBe(2);
  });

  it("stops at maxIterations and returns best iteration", async () => {
    const graph = SwarmGraph.ganLoop<TestState>({
      generator: makeGenerator(),
      evaluator: makeEvaluator((state) => {
        // Slowly improving but never passing
        const score = Math.min(0.5 + state.iteration * 0.05, 0.75);
        return {
          scores: [
            { criterionId: "quality", score, rationale: "improving", passed: false },
            { criterionId: "correctness", score, rationale: "getting closer", passed: false },
          ],
          feedback: "Keep trying",
        };
      }),
      criteria: makeCriteria(),
      maxIterations: 3,
      passingThreshold: 0.90,
    });

    const compiled = graph.compile({ recursionLimit: 50 });
    const result = await compiled.invoke({});

    expect(result.done).toBe(true);
    expect(result.iteration).toBe(3);
    expect(result.decision).not.toBe("accept");
    expect(result.bestIteration).not.toBeNull();
  });

  it("calls onIteration callback and stops when it returns false", async () => {
    const onIteration = vi.fn().mockResolvedValue(false);

    const graph = SwarmGraph.ganLoop<TestState>({
      generator: makeGenerator(),
      evaluator: makeEvaluator(() => ({
        scores: [
          { criterionId: "quality", score: 0.5, rationale: "mid", passed: false },
          { criterionId: "correctness", score: 0.5, rationale: "mid", passed: false },
        ],
        feedback: "Average",
      })),
      criteria: makeCriteria(),
      onIteration,
    });

    const compiled = graph.compile({ recursionLimit: 50 });
    const result = await compiled.invoke({});

    expect(onIteration).toHaveBeenCalledTimes(1);
    expect(result.done).toBe(true);
    expect(result.iteration).toBe(1);
  });

  it("respects hard thresholds — failing a hard threshold prevents acceptance", async () => {
    const criteria: EvaluationCriterion[] = [
      {
        id: "quality",
        name: "Quality",
        description: "Output quality",
        weight: 0.5,
        hardThreshold: 0.7,
      },
      {
        id: "correctness",
        name: "Correctness",
        description: "Correctness",
        weight: 0.5,
      },
    ];

    let callCount = 0;
    const graph = SwarmGraph.ganLoop<TestState>({
      generator: makeGenerator(),
      evaluator: makeEvaluator(() => {
        callCount++;
        if (callCount === 1) {
          // High composite (0.85) but quality below hard threshold
          return {
            scores: [
              { criterionId: "quality", score: 0.5, rationale: "below hard threshold", passed: false },
              { criterionId: "correctness", score: 1.0, rationale: "perfect", passed: true },
            ],
            feedback: "Quality needs improvement",
          };
        }
        // Second pass: everything passes
        return {
          scores: [
            { criterionId: "quality", score: 0.9, rationale: "good now", passed: true },
            { criterionId: "correctness", score: 0.9, rationale: "still good", passed: true },
          ],
          feedback: "All good",
        };
      }),
      criteria,
      passingThreshold: 0.70,
    });

    const compiled = graph.compile({ recursionLimit: 50 });
    const result = await compiled.invoke({});

    // Should have taken 2 iterations because hard threshold failed on iteration 1
    expect(result.iteration).toBe(2);
    expect(result.decision).toBe("accept");
  });

  it("throws when criteria weights don't sum to 1.0", () => {
    expect(() => {
      SwarmGraph.ganLoop<TestState>({
        generator: makeGenerator(),
        evaluator: makeEvaluator(() => ({
          scores: [],
          feedback: "",
        })),
        criteria: [
          { id: "a", name: "A", description: "A", weight: 0.3 },
          { id: "b", name: "B", description: "B", weight: 0.3 },
        ],
      });
    }).toThrow("weights must sum to 1.0");
  });

  it("tracks best iteration across multiple rounds", async () => {
    let callCount = 0;
    const graph = SwarmGraph.ganLoop<TestState>({
      generator: makeGenerator(),
      evaluator: makeEvaluator(() => {
        callCount++;
        // Oscillating scores: iteration 2 is the best but never passes
        const scoreMap: Record<number, number> = { 1: 0.5, 2: 0.7, 3: 0.4 };
        const score = scoreMap[callCount] ?? 0.5;
        return {
          scores: [
            { criterionId: "quality", score, rationale: "varies", passed: false },
            { criterionId: "correctness", score, rationale: "varies", passed: false },
          ],
          feedback: `Round ${callCount}`,
        };
      }),
      criteria: makeCriteria(),
      maxIterations: 3,
      passingThreshold: 0.90,
    });

    const compiled = graph.compile({ recursionLimit: 50 });
    const result = await compiled.invoke({});

    expect(result.bestIteration).not.toBeNull();
    expect(result.bestCompositeScore).toBeCloseTo(0.7);
  });
});
