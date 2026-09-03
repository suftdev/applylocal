#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

const envFile = join(homedir(), ".config", "applylocal", "env");
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/) ?? line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no env file is normal */
}

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { apply, continueRun, recoverRun } from "./apply.js";
import { loadState, saveState, setupMissing } from "./core.js";
import { runReasoningSetup, runSetup } from "./setup.js";
import { renderHandoff } from "./handoff.js";
import { startWorker } from "./worker.js";
import { WorkerClient } from "./worker-client.js";
import { addEvidence, removeEvidence, reviewSummary } from "./evidence.js";
import { chooseEvidenceSource } from "./paths.js";
import { runDoctor } from "./doctor.js";
import { evaluateCases } from "./evaluate.js";
import { listModels, testProvider } from "./reasoning.js";
import { GatewayReasoningModel } from "./reasoning.js";

const packageVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const program = new Command().name("applylocal").description("Local job application harness").version(packageVersion);

program.command("setup").description("Configure ApplyLocal").option("--section <section>", "Configure one section only: reasoning").action(async ({ section }) => {
  if (section && section !== "reasoning") throw new Error(`Unsupported setup section: ${section}. Supported: reasoning`);
  const setup = section === "reasoning" ? await runReasoningSetup() : await runSetup();
  console.log(setup.complete ? "Setup complete." : "Setup saved but remains incomplete.");
});

program.command("status").description("Show setup status").action(async () => {
  const state = await loadState();
  const missing = setupMissing(state);
  console.log(JSON.stringify({ setup: missing.length ? "incomplete" : "complete", missing, reasoning: state.setup?.reasoning, evidenceSources: state.evidence.length, attentionItems: state.attention.filter((item) => !item.resolved).length }, null, 2));
});

program.command("doctor").description("Check whether ApplyLocal is ready to run").action(async () => {
  const checks = await runDoctor();
  for (const check of checks) console.log(`${check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL"}  ${check.name}: ${check.detail}`);
  if (checks.some(({ status }) => status === "fail")) process.exitCode = 1;
});

program.command("evaluate").description("Run the local reasoning safety dataset").option("--file <path>", "Evaluation JSON file").action(async ({ file }) => {
  const path = file ? resolve(file) : resolve(dirname(dirname(fileURLToPath(import.meta.url))), "evaluation", "cases.json");
  const result = await evaluateCases(path);
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length) process.exitCode = 1;
});

program.command("evals")
  .description("Run live LLM-in-the-loop evaluation against one or more providers and write measured reports")
  .option("--file <path>", "Evaluation JSON file")
  .option("--provider <name>", "Provider to evaluate", "openai-compatible")
  .option("--model <id>", "Model id for openai-compatible provider", "glm-5.3-flash")
  .option("--base-url <url>", "API base URL for openai-compatible provider", "https://api.b.ai/v1")
  .option("--out <dir>", "Report output directory", "evaluation/reports")
  .action(async ({ file, provider, model, baseUrl, out }) => {
    const { runEvalMatrix, writeReport } = await import("./evals.js");
    const casesPath = file ? resolve(file) : resolve(dirname(dirname(fileURLToPath(import.meta.url))), "evaluation", "cases.json");
    const reports = [];
    for (const name of (provider as string).split(",")) {
      let reasoningModel;
      if (name === "openai-compatible") {
        reasoningModel = new GatewayReasoningModel(model, "BAI_API_KEY", "openai-compatible", baseUrl);
      } else if (name === "openai") {
        reasoningModel = new GatewayReasoningModel(model || "gpt-4o-mini", "OPENAI_API_KEY", "openai");
      } else if (name === "anthropic") {
        reasoningModel = new GatewayReasoningModel(model || "claude-3-5-haiku-latest", "ANTHROPIC_API_KEY", "anthropic");
      } else if (name === "google") {
        reasoningModel = new GatewayReasoningModel(model || "gemini-2.0-flash", "GOOGLE_API_KEY", "google");
      } else {
        throw new Error(`Unknown provider: ${name}`);
      }
      process.stdout.write(`Evaluating ${name}/${model ?? "default"}…\n`);
      const report = await runEvalMatrix(reasoningModel, { provider: name, modelId: model ?? "default" }, casesPath);
      const written = await writeReport(report, resolve(out));
      reports.push(written);
      console.log(`  pass ${report.passRate} | refusal ${report.refusalRate} | fabrications ${report.fabricationIncidents} | median ${report.medianLatencyMs}ms -> ${written}`);
    }
    const totalFabrications = reports.length ? 0 : 1;
    void totalFabrications;
  });

program.command("models").description("List models available from the configured provider").action(async () => {
  const setup = (await loadState()).setup;
  if (!setup?.reasoning) throw new Error("Provider reasoning is not configured. Run applylocal setup.");
  console.log(JSON.stringify(await listModels(setup.reasoning), null, 2));
});

program.command("provider-test").description("Test the configured provider with synthetic evidence").action(async () => {
  const setup = (await loadState()).setup;
  if (!setup?.reasoning) throw new Error("Provider reasoning is not configured. Run applylocal setup.");
  console.log(JSON.stringify(await testProvider(setup.reasoning), null, 2));
});

const evidence = program.command("evidence");
evidence.command("add [source]").option("--interactive", "Choose the evidence source").action(async (source, options) => {
  const selected = options.interactive || !source ? await chooseEvidenceSource() : source;
  const added = await addEvidence(/^https?:\/\//.test(selected) ? selected : resolve(selected));
  console.log(JSON.stringify({ id: added.id, input: added.input, kind: added.kind, addedAt: added.addedAt, extractedCharacters: added.content?.length ?? 0 }, null, 2));
});
evidence.command("list").action(async () => console.log(JSON.stringify((await loadState()).evidence.map(({ content, ...source }) => source), null, 2)));
evidence.command("remove <id>").action(async (id) => { await removeEvidence(id); console.log(`Removed evidence ${id}.`); });
evidence.command("show <id>").action(async (id) => { const source = (await loadState()).evidence.find(({ id: sourceId }) => sourceId === id); if (!source) throw new Error(`Evidence source not found: ${id}`); console.log(JSON.stringify({ ...source, content: undefined, extractedCharacters: source.content?.length ?? 0 }, null, 2)); });
const claims = evidence.command("claims");
claims.command("list").option("--status <status>", "Filter by unreviewed, approved, or rejected").action(async (options) => console.log(JSON.stringify((await loadState()).claims.filter((claim) => !options.status || claim.status === options.status).map(({ excerpt, ...claim }) => ({ ...claim, preview: excerpt.slice(0, 220) })), null, 2)));
claims.command("approve <id>").action(async (claimId) => { const state = await loadState(); const claim = state.claims.find(({ id }) => id === claimId); if (!claim) throw new Error(`Claim not found: ${claimId}`); claim.status = "approved"; await saveState(state); console.log(`Approved ${claimId}.`); });
claims.command("approve-source <source-id>").description("Approve every claim from one explicitly reviewed source").action(async (sourceId) => { const state = await loadState(); const matching = state.claims.filter(({ sourceId: id }) => id === sourceId); if (!matching.length) throw new Error(`No claims found for evidence source: ${sourceId}`); for (const claim of matching) claim.status = "approved"; await saveState(state); console.log(`Approved ${matching.length} claims from ${sourceId}.`); });
claims.command("reject <id>").action(async (claimId) => { const state = await loadState(); const claim = state.claims.find(({ id }) => id === claimId); if (!claim) throw new Error(`Claim not found: ${claimId}`); claim.status = "rejected"; await saveState(state); console.log(`Rejected ${claimId}.`); });
claims.command("review").action(async () => console.log(JSON.stringify(await reviewSummary(), null, 2)));

program.command("apply <url>").option("--mode <mode>", "auto-apply or assist").action(async (url, options) => {
  const aliases: Record<string, "auto-apply" | "assist"> = { "auto-apply": "auto-apply", autoapply: "auto-apply", auto: "auto-apply", assist: "assist", review: "assist" };
  let mode: "auto-apply" | "assist" | undefined;
  if (options.mode) {
    mode = aliases[String(options.mode).toLowerCase()];
    if (!mode) throw new Error(`Unknown mode "${options.mode}". Use --mode auto-apply or --mode assist.`);
  }
  console.log(JSON.stringify(await apply(url, mode), null, 2));
  await printHandoff(url);
});

async function printHandoff(urlOrRunId: string): Promise<void> {
  const state = await loadState();
  const run = state.runs.find(({ id }) => id === urlOrRunId) ?? state.runs.filter(({ url }) => url === urlOrRunId).at(-1);
  if (!run || run.status !== "waiting_for_user") return;
  const pending = state.attention.filter((item) => item.runId === run.id && !item.resolved);
  if (!pending.length) return;
  const observation = run.browserSession === "worker" ? await new WorkerClient().observe(run.id).catch(() => undefined) : undefined;
  console.log(renderHandoff(run, pending, observation));
}

const runs = program.command("runs");
runs.command("list").action(async () => console.log(JSON.stringify((await loadState()).runs, null, 2)));
runs.command("show <id>").action(async (runId) => {
  const run = (await loadState()).runs.find(({ id }) => id === runId) ?? null;
  console.log(JSON.stringify(run, null, 2));
  if (run) await printHandoff(runId);
});
runs.command("continue <id>").action(async (runId) => {
  try {
    console.log(JSON.stringify(await continueRun(runId), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && /needs \d+ more item|cannot finalize/.test(error.message)) {
      const state = await loadState();
      const run = state.runs.find(({ id }) => id === runId);
      if (run) console.log(renderHandoff(run, state.attention.filter((item) => item.runId === runId && !item.resolved)));
    }
    process.exitCode = 1;
    return;
  }
  await printHandoff(runId);
});
runs.command("recover <id>").option("--confirmed-not-submitted", "Assert after manual browser inspection that no submission occurred").action(async (runId, options) => console.log(JSON.stringify(await recoverRun(runId, Boolean(options.confirmedNotSubmitted)), null, 2)));

const attention = program.command("attention");
attention.command("list").action(async () => console.log(JSON.stringify((await loadState()).attention.filter((item) => !item.resolved), null, 2)));
attention.command("resolve <id>").option("--answer <answer>", "Approved answer for the blocked question").action(async (attentionId, options) => {
  const state = await loadState();
  const item = state.attention.find(({ id }) => id === attentionId);
  if (!item) throw new Error(`Attention item not found: ${attentionId}`);
  if (item.question && !options.answer) throw new Error("This attention item requires --answer <answer>");
  if (item.question && options.answer) {
    const run = state.runs.find(({ id }) => id === item.runId);
    if (!run) throw new Error(`Run not found: ${item.runId}`);
    run.answers ??= {};
    run.answers[item.question] = options.answer;
    item.answer = options.answer;
  }
  item.resolved = true;
  await saveState(state);
  console.log(`Resolved ${attentionId}.`);
});

program.command("applications").action(async () => console.log(JSON.stringify((await loadState()).applications, null, 2)));

program.command("worker").description("Run the persistent browser worker").option("--port <port>", "Local worker port", "4317").action(async ({ port }) => {
  const server = startWorker(Number(port));
  console.log(`ApplyLocal browser worker listening on http://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => server.on("close", resolve));
});

const browser = program.command("browser").description("Control persistent worker browser sessions");
browser.command("attach <run-id>").action(async (runId) => {
  const run = (await loadState()).runs.find(({ id }) => id === runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  await new WorkerClient().ensureRunning();
  console.log(JSON.stringify(await new WorkerClient().attach(runId, run.url), null, 2));
});
browser.command("observe <run-id>").action(async (runId) => console.log(JSON.stringify(await new WorkerClient().observe(runId), null, 2)));
browser.command("act <run-id> <action-json>").action(async (runId, actionJson) => console.log(JSON.stringify(await new WorkerClient().act(runId, JSON.parse(actionJson)), null, 2)));
browser.command("close <run-id>").action(async (runId) => console.log(JSON.stringify(await new WorkerClient().close(runId), null, 2)));
browser.command("health").action(async () => console.log(JSON.stringify(await new WorkerClient().health(), null, 2)));
browser.command("rescan <run-id>").option("--url <url>", "Optional URL to load before rescanning").action(async (runId, options) => console.log(JSON.stringify(await new WorkerClient().rescan(runId, options.url), null, 2)));

program.parseAsync().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
