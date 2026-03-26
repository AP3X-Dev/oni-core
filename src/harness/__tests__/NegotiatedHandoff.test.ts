import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NegotiatedHandoff } from "../NegotiatedHandoff.js";
import { ContractNotFoundError, ContractNotApprovedError, ContractAlreadyFinalizedError } from "../errors.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "oni-nh-test-"));
}

function makeSampleProposal() {
  return {
    featureId: "feat-001",
    proposedBy: "generator-agent",
    implementation: {
      description: "Add user login page",
      technicalApproach: "React component with form validation",
      filesAffected: ["src/pages/Login.tsx", "src/api/auth.ts"],
      estimatedSteps: 5,
    },
    verification: {
      criteria: [
        {
          id: "vc-1",
          description: "Login form renders",
          type: "functional" as const,
          passingCondition: "Form with email and password fields is visible",
          failingCondition: "Form does not render or is missing fields",
        },
      ],
      automatedTests: ["npm test -- login"],
      manualSteps: ["Navigate to /login", "Submit valid credentials"],
    },
    outOfScope: ["Password reset flow", "OAuth integration"],
  };
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("NegotiatedHandoff", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── submitProposal() ──

  it("submitProposal() creates a proposal with generated ID and timestamp", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());

    expect(proposal.proposalId).toBeTruthy();
    expect(proposal.createdAt).toBeTruthy();
    expect(proposal.featureId).toBe("feat-001");
    expect(proposal.proposedBy).toBe("generator-agent");
  });

  // ── submitReview() ──

  it("submitReview() creates a review for an existing proposal", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());

    const review = await nh.submitReview(proposal.proposalId, {
      proposalId: proposal.proposalId,
      reviewedBy: "evaluator-agent",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });

    expect(review.reviewId).toBeTruthy();
    expect(review.decision).toBe("approved");
    expect(review.reviewedAt).toBeTruthy();
  });

  it("submitReview() throws for non-existent proposal", async () => {
    const nh = new NegotiatedHandoff(tmpDir);

    await expect(
      nh.submitReview("nonexistent", {
        proposalId: "nonexistent",
        reviewedBy: "evaluator",
        decision: "approved",
        concerns: [],
        requiredChanges: [],
      }),
    ).rejects.toThrow(ContractNotFoundError);
  });

  // ── finalizeContract() ──

  it("finalizeContract() creates a locked contract from approved proposal", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());

    await nh.submitReview(proposal.proposalId, {
      proposalId: proposal.proposalId,
      reviewedBy: "evaluator-agent",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });

    const contract = await nh.finalizeContract(proposal.proposalId);

    expect(contract.contractId).toBeTruthy();
    expect(contract.status).toBe("active");
    expect(contract.proposal.proposalId).toBe(proposal.proposalId);
    expect(contract.review.decision).toBe("approved");
    expect(contract.agreedAt).toBeTruthy();
  });

  it("finalizeContract() throws when proposal not approved", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());

    await nh.submitReview(proposal.proposalId, {
      proposalId: proposal.proposalId,
      reviewedBy: "evaluator-agent",
      decision: "revision-requested",
      concerns: ["Missing error handling"],
      requiredChanges: ["Add try/catch in auth.ts"],
    });

    await expect(nh.finalizeContract(proposal.proposalId)).rejects.toThrow(
      ContractNotApprovedError,
    );
  });

  it("finalizeContract() throws for non-existent proposal", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    await expect(nh.finalizeContract("nonexistent")).rejects.toThrow(
      ContractNotFoundError,
    );
  });

  it("finalizeContract() throws on duplicate finalization", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());
    await nh.submitReview(proposal.proposalId, {
      proposalId: proposal.proposalId,
      reviewedBy: "eval",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });

    // First finalization succeeds
    await nh.finalizeContract(proposal.proposalId);

    // Second finalization throws
    await expect(nh.finalizeContract(proposal.proposalId)).rejects.toThrow(
      ContractAlreadyFinalizedError,
    );
  });

  // ── submitForEvaluation() ──

  it("submitForEvaluation() records actual files changed", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());
    await nh.submitReview(proposal.proposalId, {
      proposalId: proposal.proposalId,
      reviewedBy: "eval",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });
    const contract = await nh.finalizeContract(proposal.proposalId);

    await nh.submitForEvaluation(contract.contractId, [
      "src/pages/Login.tsx",
      "src/api/auth.ts",
      "src/utils/validate.ts",
    ]);

    const summary = await nh.getContractSummary(contract.contractId);
    expect(summary).toContain("src/utils/validate.ts");
  });

  // ── resolveContract() ──

  it("resolveContract() marks contract as completed", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());
    await nh.submitReview(proposal.proposalId, {
      proposalId: proposal.proposalId,
      reviewedBy: "eval",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });
    const contract = await nh.finalizeContract(proposal.proposalId);

    await nh.resolveContract(contract.contractId, "completed", "All criteria met");

    const active = await nh.getActiveContracts();
    expect(active).toHaveLength(0);
  });

  it("resolveContract() marks contract as failed", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());
    await nh.submitReview(proposal.proposalId, {
      proposalId: proposal.proposalId,
      reviewedBy: "eval",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });
    const contract = await nh.finalizeContract(proposal.proposalId);

    await nh.resolveContract(contract.contractId, "failed", "Login page didn't render");

    const summary = await nh.getContractSummary(contract.contractId);
    expect(summary).toContain("failed");
    expect(summary).toContain("Login page didn't render");
  });

  // ── getActiveContracts() ──

  it("getActiveContracts() returns only active contracts", async () => {
    const nh = new NegotiatedHandoff(tmpDir);

    // Create two contracts
    const p1 = await nh.submitProposal(makeSampleProposal());
    await nh.submitReview(p1.proposalId, {
      proposalId: p1.proposalId,
      reviewedBy: "eval",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });
    const c1 = await nh.finalizeContract(p1.proposalId);

    const p2 = await nh.submitProposal({ ...makeSampleProposal(), featureId: "feat-002" });
    await nh.submitReview(p2.proposalId, {
      proposalId: p2.proposalId,
      reviewedBy: "eval",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });
    const c2 = await nh.finalizeContract(p2.proposalId);

    // Complete one
    await nh.resolveContract(c1.contractId, "completed", "done");

    const active = await nh.getActiveContracts();
    expect(active).toHaveLength(1);
    expect(active[0]!.contractId).toBe(c2.contractId);
  });

  // ── getContractSummary() ──

  it("getContractSummary() returns formatted summary string", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    const proposal = await nh.submitProposal(makeSampleProposal());
    await nh.submitReview(proposal.proposalId, {
      proposalId: proposal.proposalId,
      reviewedBy: "evaluator-agent",
      decision: "approved",
      concerns: [],
      requiredChanges: [],
    });
    const contract = await nh.finalizeContract(proposal.proposalId);

    const summary = await nh.getContractSummary(contract.contractId);

    expect(summary).toContain("CONTRACT");
    expect(summary).toContain("active");
    expect(summary).toContain("feat-001");
    expect(summary).toContain("generator-agent");
    expect(summary).toContain("evaluator-agent");
    expect(summary).toContain("Add user login page");
    expect(summary).toContain("React component");
    expect(summary).toContain("Login form renders");
    expect(summary).toContain("npm test -- login");
    expect(summary).toContain("Password reset flow");
  });

  it("getContractSummary() throws for non-existent contract", async () => {
    const nh = new NegotiatedHandoff(tmpDir);
    await expect(nh.getContractSummary("nonexistent")).rejects.toThrow(
      ContractNotFoundError,
    );
  });
});
