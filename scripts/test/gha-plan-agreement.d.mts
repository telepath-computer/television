export interface GhaAgreementPart {
  summary: Record<string, any>;
  plan: Record<string, any>;
  summaryPath?: string;
  planPath?: string;
}

export interface GhaPlanAgreement {
  schemaVersion: 1;
  status: "passed";
  planId: string;
  timingProvider: string;
  testedCommit: string;
  testedTree: string;
  shardTotal: number;
  assignedFileCount: number;
}

export function validateGhaPlanAgreement(args: { parts: GhaAgreementPart[]; expectedShardTotal: number }): GhaPlanAgreement;
export function readGhaPlanAgreementParts(root: string): GhaAgreementPart[];
