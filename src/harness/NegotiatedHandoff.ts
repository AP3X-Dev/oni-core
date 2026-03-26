// ============================================================
// @oni.bot/core/harness — NegotiatedHandoff
// ============================================================
// Pre-commitment protocol between two agents before work begins.
// Generator proposes → evaluator reviews → contract locks →
// work proceeds → evaluator resolves.
// ============================================================

import { resolve, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { randomId, atomicWriteJSON, readJSON, ensureDir, withFileLock } from "./utils.js";
import { ContractNotFoundError, ContractNotApprovedError } from "./errors.js";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface VerificationCriterion {
  id: string;
  description: string;
  type: "functional" | "visual" | "performance";
  passingCondition: string;
  failingCondition: string;
}

export interface WorkProposal {
  proposalId: string;
  featureId: string;
  proposedBy: string;
  createdAt: string;

  implementation: {
    description: string;
    technicalApproach: string;
    filesAffected: string[];
    estimatedSteps: number;
  };

  verification: {
    criteria: VerificationCriterion[];
    automatedTests: string[];
    manualSteps: string[];
  };

  outOfScope: string[];
}

export type ReviewDecision = "approved" | "revision-requested" | "rejected";

export interface ProposalReview {
  reviewId: string;
  proposalId: string;
  reviewedBy: string;
  decision: ReviewDecision;
  concerns: string[];
  requiredChanges: string[];
  reviewedAt: string;
}

export type ContractStatus = "active" | "completed" | "failed" | "abandoned";

export interface NegotiatedContract {
  contractId: string;
  proposal: WorkProposal;
  review: ProposalReview;
  agreedAt: string;
  status: ContractStatus;
  actualFilesChanged?: string[];
  resolutionNotes?: string;
}

// ----------------------------------------------------------------
// NegotiatedHandoff
// ----------------------------------------------------------------

export class NegotiatedHandoff {
  private readonly contractDir: string;
  private readonly proposalDir: string;
  private readonly reviewDir: string;
  private readonly lockPath: string;

  constructor(contractDir: string) {
    this.contractDir = resolve(contractDir);
    this.proposalDir = join(this.contractDir, "proposals");
    this.reviewDir = join(this.contractDir, "reviews");
    this.lockPath = join(this.contractDir, ".lock");
    ensureDir(this.contractDir);
    ensureDir(this.proposalDir);
    ensureDir(this.reviewDir);
  }

  /**
   * Generator calls this to submit a proposal.
   */
  async submitProposal(
    proposal: Omit<WorkProposal, "proposalId" | "createdAt">,
  ): Promise<WorkProposal> {
    const full: WorkProposal = {
      ...proposal,
      proposalId: randomId(),
      createdAt: new Date().toISOString(),
    };

    const filePath = join(this.proposalDir, `proposal-${full.proposalId}.json`);
    atomicWriteJSON(filePath, full);
    return full;
  }

  /**
   * Evaluator calls this to review a proposal.
   */
  async submitReview(
    proposalId: string,
    review: Omit<ProposalReview, "reviewId" | "reviewedAt">,
  ): Promise<ProposalReview> {
    // Verify proposal exists
    const proposal = this.readProposal(proposalId);
    if (!proposal) throw new ContractNotFoundError(proposalId);

    const full: ProposalReview = {
      ...review,
      reviewId: randomId(),
      proposalId,
      reviewedAt: new Date().toISOString(),
    };

    const filePath = join(this.reviewDir, `review-${full.reviewId}.json`);
    atomicWriteJSON(filePath, full);
    return full;
  }

  /**
   * Once both have agreed, locks the contract.
   * Only proposals with an "approved" review can be finalized.
   */
  async finalizeContract(proposalId: string): Promise<NegotiatedContract> {
    const proposal = this.readProposal(proposalId);
    if (!proposal) throw new ContractNotFoundError(proposalId);

    const review = this.findReviewForProposal(proposalId);
    if (!review) throw new ContractNotFoundError(proposalId);
    if (review.decision !== "approved") throw new ContractNotApprovedError(proposalId);

    const contract: NegotiatedContract = {
      contractId: randomId(),
      proposal,
      review,
      agreedAt: new Date().toISOString(),
      status: "active",
    };

    const filePath = join(this.contractDir, `contract-${contract.contractId}.json`);
    atomicWriteJSON(filePath, contract);
    return contract;
  }

  /**
   * Generator calls this when work is done — triggers evaluation.
   */
  async submitForEvaluation(contractId: string, actualFilesChanged: string[]): Promise<void> {
    await withFileLock(this.lockPath, async () => {
      const contract = this.readContract(contractId);
      if (!contract) throw new ContractNotFoundError(contractId);

      contract.actualFilesChanged = actualFilesChanged;
      const filePath = join(this.contractDir, `contract-${contractId}.json`);
      atomicWriteJSON(filePath, contract);
    });
  }

  /**
   * Evaluator marks the contract outcome.
   */
  async resolveContract(
    contractId: string,
    status: "completed" | "failed",
    notes: string,
  ): Promise<void> {
    await withFileLock(this.lockPath, async () => {
      const contract = this.readContract(contractId);
      if (!contract) throw new ContractNotFoundError(contractId);

      contract.status = status;
      contract.resolutionNotes = notes;
      const filePath = join(this.contractDir, `contract-${contractId}.json`);
      atomicWriteJSON(filePath, contract);
    });
  }

  /**
   * Returns all active contracts.
   */
  async getActiveContracts(): Promise<NegotiatedContract[]> {
    if (!existsSync(this.contractDir)) return [];

    const files = readdirSync(this.contractDir)
      .filter(f => f.startsWith("contract-") && f.endsWith(".json"));

    const contracts: NegotiatedContract[] = [];
    for (const file of files) {
      const data = readJSON<NegotiatedContract>(join(this.contractDir, file));
      if (data && data.status === "active") {
        contracts.push(data);
      }
    }

    return contracts;
  }

  /**
   * Returns a formatted contract summary for agent context injection.
   */
  async getContractSummary(contractId: string): Promise<string> {
    const contract = this.readContract(contractId);
    if (!contract) throw new ContractNotFoundError(contractId);

    const p = contract.proposal;
    const r = contract.review;
    const lines: string[] = [
      `=== CONTRACT ${contract.contractId} ===`,
      `Status: ${contract.status}`,
      `Feature: ${p.featureId}`,
      `Proposed by: ${p.proposedBy}`,
      `Reviewed by: ${r.reviewedBy}`,
      `Agreed at: ${contract.agreedAt}`,
      "",
      "IMPLEMENTATION:",
      `  ${p.implementation.description}`,
      `  Approach: ${p.implementation.technicalApproach}`,
      `  Files: ${p.implementation.filesAffected.join(", ")}`,
      `  Estimated steps: ${p.implementation.estimatedSteps}`,
      "",
      "VERIFICATION CRITERIA:",
    ];

    for (const c of p.verification.criteria) {
      lines.push(`  [${c.id}] ${c.description}`);
      lines.push(`    Pass: ${c.passingCondition}`);
      lines.push(`    Fail: ${c.failingCondition}`);
    }

    if (p.verification.automatedTests.length > 0) {
      lines.push("");
      lines.push("AUTOMATED TESTS:");
      for (const t of p.verification.automatedTests) {
        lines.push(`  $ ${t}`);
      }
    }

    if (p.outOfScope.length > 0) {
      lines.push("");
      lines.push("OUT OF SCOPE:");
      for (const o of p.outOfScope) {
        lines.push(`  - ${o}`);
      }
    }

    if (contract.actualFilesChanged) {
      lines.push("");
      lines.push("ACTUAL FILES CHANGED:");
      for (const f of contract.actualFilesChanged) {
        lines.push(`  ${f}`);
      }
    }

    if (contract.resolutionNotes) {
      lines.push("");
      lines.push(`RESOLUTION: ${contract.resolutionNotes}`);
    }

    lines.push("=========================");
    return lines.join("\n");
  }

  // ---- Internal ----

  private readProposal(proposalId: string): WorkProposal | null {
    const filePath = join(this.proposalDir, `proposal-${proposalId}.json`);
    return readJSON<WorkProposal>(filePath);
  }

  private findReviewForProposal(proposalId: string): ProposalReview | null {
    if (!existsSync(this.reviewDir)) return null;

    const files = readdirSync(this.reviewDir)
      .filter(f => f.startsWith("review-") && f.endsWith(".json"));

    // Find the latest review for this proposal
    let latest: ProposalReview | null = null;
    for (const file of files) {
      const data = readJSON<ProposalReview>(join(this.reviewDir, file));
      if (data && data.proposalId === proposalId) {
        if (!latest || data.reviewedAt > latest.reviewedAt) {
          latest = data;
        }
      }
    }

    return latest;
  }

  private readContract(contractId: string): NegotiatedContract | null {
    const filePath = join(this.contractDir, `contract-${contractId}.json`);
    return readJSON<NegotiatedContract>(filePath);
  }
}
