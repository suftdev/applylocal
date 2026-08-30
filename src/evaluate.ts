import { readFile } from "node:fs/promises";
import { proposedAnswerSchema, validateProposedAnswer } from "./reasoning.js";

type Case = { id: string; question: string; expectedStatus: "supported" | "needs_user"; evidence: string };

export async function evaluateCases(path: string): Promise<{ total: number; passed: number; failed: string[] }> {
  const cases = JSON.parse(await readFile(path, "utf8")) as Case[];
  const failed: string[] = [];
  for (const item of cases) {
    const evidence = item.evidence ? [{ id: "fixture", input: "fixture.txt", kind: "file" as const, addedAt: "fixture", content: item.evidence }] : [];
    const candidate = item.expectedStatus === "supported"
      ? { status: "supported" as const, answer: item.evidence, sourceIds: ["fixture"], reason: "fixture evidence" }
      : { status: "supported" as const, answer: "invented answer", sourceIds: ["missing"], reason: "unsupported fixture" };
    const result = validateProposedAnswer(proposedAnswerSchema.parse(candidate), evidence);
    if (result.status !== item.expectedStatus) failed.push(item.id);
  }
  return { total: cases.length, passed: cases.length - failed.length, failed };
}
