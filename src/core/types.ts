import type { ArtworkBody } from "../contract/artwork";

/** advisory は性質の観測などの助言の検査（保存の必須にしない）。 */
export type CheckLevel = "contract" | "loaded" | "operated" | "matched" | "advisory";

export interface CheckResult {
  id: string;
  level: CheckLevel;
  pass: boolean;
  detail?: string;
}

export interface Verification {
  id: string;
  digest: string;
  suite: string; // 試験セットの版
  environment: string; // ブラウザなど
  dataDigest: string | null;
  checks: CheckResult[];
  /** ホストが必須とした検査（contract・loaded・operated）がすべて合格したか。matched は含まない。 */
  requiredPassed: boolean;
  failedAt?: string;
  createdAt: number;
}

export interface Observation {
  kind: "contract" | "runtime-error" | "boot-timeout" | "blank" | "static" | "model-error";
  message: string;
}

export interface Artwork {
  id: string;
  owner: string;
  title: string;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
}

export interface Revision {
  artworkId: string;
  revision: number;
  parent: number | null;
  body: ArtworkBody;
  digest: string;
  verificationId: string;
  candidateId: string | null;
  restoredFrom: number | null;
  createdAt: number;
}

export type RunState = "running" | "presented" | "failed" | "cancelled" | "expired" | "superseded";

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface Run {
  id: string;
  owner: string;
  session: string;
  artworkId: string; // 新規なら予約した ID
  isNew: boolean;
  baseRevision: number; // 新規は 0
  baseDigest: string | null;
  generation: number;
  request: { message: string; conversation: Turn[] };
  state: RunState;
  deadline: number;
  attempts: number;
  candidateIds: string[];
  presentedCandidateId: string | null;
  failure: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface Candidate {
  id: string;
  runId: string;
  owner: string;
  artworkId: string;
  baseRevision: number;
  generation: number;
  attempt: number;
  body: ArtworkBody;
  digest: string;
  changes: string;
  unconfirmed: string[];
  reply: string;
  verificationId: string | null;
  createdAt: number;
}

export interface SaveReceipt {
  key: string;
  owner: string;
  fingerprint: string;
  status: number;
  result: unknown;
}
