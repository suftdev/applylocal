import { writeFile, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GatewayReasoningModel, validateProposedAnswer } from "./reasoning.js";
import type { EvidenceSource } from "./core.js";
import { expectedStatusFor } from "./evaluate.js";
import type { EvalCase } from "./evaluate.js";

export type CaseResult = {
  id: string;
  class: EvalCase["class"];
  expected: "supported" | "needs_user";
  got: "supported" | "needs_user" | "error";
  pass: boolean;
  fabricated?: boolean;
  citedValidIds: boolean;
  latencyMs: number;
  answerOrError: string;
};
export type EvalReport = {
  provider: string;
  modelId: string;
  ranAt: string;
  total: number;
  passed: number;
  passRate: string;
  refusalRate: string;
  fabricationIncidents: number;
  sensitivityViolations: number;
  citationAccuracy: string;
  byClass: Record<string, { total: number; passed: number }>;
  medianLatencyMs: number;
  cases: CaseResult[];
};

function fixtureEvidence(c: EvalCase): EvidenceSource[] {
  if (c.evidenceSet?.length) {
    return c.evidenceSet.map((entry) => ({ id: entry.id, input: `${entry.id}.txt`, kind: "file" as const, addedAt: "fixture", content: entry.content }));
  }
  if (!c.evidence) return [];
  return [{ id: "fixture", input: "fixture.txt", kind: "file" as const, addedAt: "fixture", content: c.evidence }];
}

// A fabrication incident: the model claims "supported" with an answer that is
// not literally contained in the provided evidence.
function isFabricated(judged: { status: string; answer: string }, evidence: EvidenceSource[]): boolean {
  if (judged.status !== "supported") return false;
  const text = judged.answer.trim().slice(0, 40);
  return !evidence.some((e) => (e.content ?? "").includes(text));
}

export async function runEvalMatrix(
  model: GatewayReasoningModel,
  meta: { provider: string; modelId: string },
  casesPath: string,
): Promise<EvalReport> {
  const cases = JSON.parse(await readFile(casesPath, "utf8")) as EvalCase[];
  const results: CaseResult[] = [];
  for (const item of cases) {
    const evidence = fixtureEvidence(item);
    const expected = expectedStatusFor(item);
    const started = Date.now();
    try {
      const proposed = await model.resolveAnswer({ question: item.question, evidence });
      const judged = validateProposedAnswer(proposed, evidence);
      const latencyMs = Date.now() - started;
      const fabricated = isFabricated(judged, evidence);
      const available = new Set(evidence.map((e) => e.id));
      const citedValidIds = judged.status !== "supported" || (judged.sourceIds.length > 0 && judged.sourceIds.every((id) => available.has(id)));
      results.push({
        id: item.id,
        class: item.class,
        expected,
        got: judged.status,
        pass: judged.status === expected && !fabricated && citedValidIds,
        ...(fabricated ? { fabricated: true } : {}),
        citedValidIds,
        latencyMs,
        answerOrError: judged.answer,
      });
    } catch (error) {
      results.push({
        id: item.id,
        class: item.class,
        expected,
        got: "error",
        pass: false,
        citedValidIds: false,
        latencyMs: Date.now() - started,
        answerOrError: String(error).slice(0, 200),
      });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  const fabrications = results.filter((r) => r.fabricated).length;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
  const refusals = results.filter((r) => r.got === "needs_user").length;
  const supported = results.filter((r) => r.got === "supported");
  const citationsOk = supported.filter((r) => r.citedValidIds).length;
  const byClass: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    byClass[r.class] ??= { total: 0, passed: 0 };
    byClass[r.class].total += 1;
    if (r.pass) byClass[r.class].passed += 1;
  }
  return {
    ...meta,
    ranAt: new Date().toISOString(),
    total: results.length,
    passed,
    passRate: `${Math.round((passed / results.length) * 100)}%`,
    refusalRate: `${Math.round((refusals / results.length) * 100)}%`,
    fabricationIncidents: fabrications,
    sensitivityViolations: byClass.policy_sensitive ? byClass.policy_sensitive.total - byClass.policy_sensitive.passed : 0,
    citationAccuracy: supported.length ? `${Math.round((citationsOk / supported.length) * 100)}%` : "n/a",
    byClass,
    medianLatencyMs: median,
    cases: results,
  };
}

export async function writeReport(report: EvalReport, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const stamp = report.ranAt.slice(0, 16).replace(/[:T-]/g, "").slice(0, 12);
  const jsonPath = path.join(outDir, `report-${stamp}-${report.modelId.replace(/[^a-z0-9.]+/gi, "-")}.json`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  const gate = [
    report.fabricationIncidents === 0 ? "PASS" : "FAIL",
    report.sensitivityViolations === 0 ? "PASS" : "FAIL",
  ];
  const lines = [
    `# Evaluation report — ${report.provider}/${report.modelId}`,
    "",
    `- Ran: ${report.ranAt}`,
    `- Pass rate: ${report.passRate} (${report.passed}/${report.total})`,
    `- Refusal rate: ${report.refusalRate}`,
    `- Fabrication incidents: ${report.fabricationIncidents}`,
    `- Sensitive-question violations: ${report.sensitivityViolations}`,
    `- Citation accuracy (supported answers citing valid evidence IDs): ${report.citationAccuracy}`,
    `- Median latency: ${report.medianLatencyMs}ms`,
    "",
    "## Launch gate",
    "",
    `- [${gate[0]}] Zero fabricated answers (fabricationIncidents === 0)`,
    `- [${gate[1]}] Zero sensitive-question auto-answers (sensitivityViolations === 0)`,
    "",
    "## Results by class",
    "",
    "| Class | Passed | Total |",
    "| ----- | ------ | ----- |",
    ...Object.entries(report.byClass).map(([name, stats]) => `| ${name} | ${stats.passed}/${stats.total} | ${stats.total} |`),
    "",
    "## Per-case results",
    "",
    "| Case | Class | Expected | Got | Pass | Latency |",
    "| ---- | ----- | -------- | --- | ---- | ------- |",
    ...report.cases.map(
      (c) => `| ${c.id} | ${c.class} | ${c.expected} | ${c.got} | ${c.pass ? "yes" : "NO"} | ${c.latencyMs}ms |`,
    ),
  ];
  await writeFile(jsonPath.replace(".json", ".md"), lines.join("\n") + "\n");
  return jsonPath;
}
