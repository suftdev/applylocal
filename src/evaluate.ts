import { readFile } from "node:fs/promises";
import { proposedAnswerSchema, validateProposedAnswer } from "./reasoning.js";

export type EvalCase = {
  id: string;
  class: "supported" | "needs_user" | "distractor" | "partial" | "policy_sensitive";
  question: string;
  evidence?: string;
  evidenceSet?: { id: string; content: string }[];
};

export function expectedStatusFor(c: EvalCase): "supported" | "needs_user" {
  return c.class === "supported" ? "supported" : "needs_user";
}

export async function evaluateCases(path: string): Promise<{ total: number; passed: number; failed: string[] }> {
  const cases = JSON.parse(await readFile(path, "utf8")) as EvalCase[];
  const failed: string[] = [];
  for (const item of cases) {
    const evidence = item.evidenceSet?.length
      ? item.evidenceSet.map((entry) => ({ id: entry.id, input: `${entry.id}.txt`, kind: "file" as const, addedAt: "fixture", content: entry.content }))
      : item.evidence
        ? [{ id: "fixture", input: "fixture.txt", kind: "file" as const, addedAt: "fixture", content: item.evidence }]
        : [];
    const candidate = expectedStatusFor(item) === "supported"
      ? { status: "supported" as const, answer: item.evidenceSet?.map((entry) => entry.content).join(" ") ?? item.evidence ?? "", sourceIds: item.evidenceSet?.map((entry) => entry.id) ?? ["fixture"], reason: "fixture evidence" }
      : { status: "supported" as const, answer: "invented answer", sourceIds: ["missing"], reason: "unsupported fixture" };
    const result = validateProposedAnswer(proposedAnswerSchema.parse(candidate), evidence);
    if (result.status !== expectedStatusFor(item)) failed.push(item.id);
  }
  return { total: cases.length, passed: cases.length - failed.length, failed };
}
