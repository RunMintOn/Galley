import type { ChangeOutcome, ChangeReport } from "./changes.ts";

export interface Project { root: string; name: string }
export interface Round {
  id: string;
  sessionId: string;
  entryId?: string;
  report?: ChangeReport;
  outcome: ChangeOutcome;
  notice?: string;
  end: number;
}
export interface RoundSummary {
  id: string; end: number; outcome: ChangeOutcome; count: number; notice?: string;
}
export interface Session {
  id: string; root: string; file?: string; title: string;
  rounds: RoundSummary[];
  state: "offline" | "idle" | "working";
  error?: string;
}
export interface Registration {
  cwd: string; sessionId: string; file?: string; title?: string;
  bridge?: { origin: string; token: string };
}
