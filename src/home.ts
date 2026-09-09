import { input, select } from "@inquirer/prompts";
import { loadState, saveState, setupMissing, Run } from "./core.js";
import { apply, continueRun } from "./apply.js";
import { renderHandoffText } from "./handoff.js";
import { runDoctor } from "./doctor.js";
import { WorkerClient } from "./worker-client.js";
import { brandLine, glyphs, c, ledgerLine, section, kv, table, success, nextStep, humanError, withSpinner, bigHeader } from "./ui.js";
import { addEvidence } from "./evidence.js";
import { chooseEvidenceSource } from "./paths.js";

const BACK = "__back__";
const EXIT = "__exit__";

export function dashboard(state: Awaited<ReturnType<typeof loadState>>, version?: string): string {
  const lines: string[] = [];
  const missing = setupMissing(state);
  const pending = state.attention.filter((item) => !item.resolved);
  lines.push(bigHeader("Your evidence-backed job application copilot", version));
  lines.push("");
  lines.push(section("Status"));
  lines.push(kv("setup", missing.length ? c.warn("incomplete") : c.ok("complete")));
  const reasoning = state.setup?.reasoning;
  lines.push(kv("provider", reasoning ? `${reasoning.provider} ${c.dim("·")} ${c.name(reasoning.model)}` : c.warn("not configured")));
  lines.push(kv("evidence", `${state.evidence.length} sources · ${state.claims.length} claims`));
  lines.push(kv("ledger", `${state.applications.length} confirmed submission(s)`));
  lines.push(kv("attention", pending.length ? c.warn(`${pending.length} pending`) : c.dim("none")));
  lines.push(section("Next step"));
  if (missing.length) lines.push(`${glyphs.arrow} ${c.cmd("Finish setup")} ${c.dim("— configuration is incomplete")}`);
  else if (pending.length) lines.push(`${glyphs.arrow} ${c.cmd("Continue the paused run")} ${c.dim("— a form is waiting for your review")}`);
  else if (!state.applications.length) lines.push(`${glyphs.arrow} ${c.cmd("Apply to a job")} ${c.dim("— paste a direct job URL")}`);
  else lines.push(`${glyphs.arrow} ${c.cmd("Apply to a job")} ${c.dim("— the ledger is warm")}`);
  return lines.join("\n");
}

function suggestion(state: Awaited<ReturnType<typeof loadState>>): string {
  if (setupMissing(state).length) return "Run setup";
  const pending = state.attention.filter((item) => !item.resolved);
  if (pending.length) return "Continue a paused run";
  return "Apply to a job";
}

const packageVersion = (JSON.parse((await import("node:fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

async function pick<T>(messageOrOptions: string | { message: string; choices: { name: string; value: T; disabled?: string | false }[]; numbered?: boolean }, maybeChoices?: { name: string; value: T; disabled?: string | false }[]): Promise<T | typeof BACK> {
  const { message, choices: rawChoices, numbered } = typeof messageOrOptions === "string" ? { message: messageOrOptions, choices: maybeChoices ?? [], numbered: false } : messageOrOptions;
  const choices = numbered ? rawChoices.map((choice, index) => ({ ...choice, name: `${c.brand(`${index + 1}.`)} ${choice.name}` })) : rawChoices;
  try {
    return await select<T | typeof BACK>({ message, choices: [...choices, { name: c.dim("← Back"), value: BACK as unknown as T }] });
  } catch (error) {
    if ((error as { name?: string }).name === "ExitPromptError") return BACK;
    throw error;
  }
}

export async function runHome(): Promise<void> {
  if (!process.stdout.isTTY || process.env.APPLYLOCAL_NO_HOME === "1") return;
  for (;;) {
    const state = await loadState();
    console.clear();
    console.log(dashboard(state, packageVersion));
    console.log("");
    let action: string;
    try {
      action = await select<string>({ message: "What do you want to do?", default: suggestion(state), choices: [
        { name: `${c.brand("1.")} Apply to a job`, value: "apply" },
        { name: `${c.brand("2.")} Continue a paused run`, value: "continue" },
        { name: `${c.brand("3.")} Review attention items`, value: "attention" },
        { name: `${c.brand("4.")} Evidence and claims`, value: "evidence" },
        { name: `${c.brand("5.")} View the ledger`, value: "ledger" },
        { name: `${c.brand("6.")} List runs`, value: "runs" },
        { name: `${c.brand("7.")} Doctor (environment check)`, value: "doctor" },
        { name: `${c.brand("8.")} Run setup`, value: "setup" },
        { name: `${c.brand("9.")} ${c.dim("Exit")}`, value: EXIT },
      ] });
    } catch (error) {
      if ((error as { name?: string }).name === "ExitPromptError") return;
      throw error;
    }
    try {
      if (action === EXIT) return;
      if (action === "apply") await homeApply();
      if (action === "continue") await homeContinue();
      if (action === "attention") await homeAttention();
      if (action === "evidence") await homeEvidence();
      if (action === "ledger") { const fresh = await loadState(); console.log(ledgerTable(fresh.applications.map((a) => [glyphs.check, a.submittedAt.slice(0, 10), (a.title ?? a.url).slice(0, 46), a.company ?? "—"]))); pause(); }
      if (action === "runs") { const fresh = await loadState(); console.log(runsTable(fresh.runs)); pause(); }
      if (action === "doctor") { for (const check of await runDoctor()) { const mark = check.status === "pass" ? glyphs.check : check.status === "warn" ? c.warn("!") : glyphs.cross; console.log(`  ${mark} ${check.name.padEnd(24)}${check.status === "pass" ? c.dim(check.detail) : c.bad(check.detail)}`); } pause(); }
      if (action === "setup") { const { runSetup } = await import("./setup.js"); await runSetup(); pause(); }
    } catch (error) {
      if ((error as { name?: string }).name === "ExitPromptError") continue;
      console.log(humanError(error));
      pause();
    }
  }
}

async function homeEvidence(): Promise<void> {
  for (;;) {
    const state = await loadState();
    const pendingClaims = state.claims.filter((claim) => claim.status === "unreviewed");
    console.log("");
    console.log(table([
      [c.dim("sources"), String(state.evidence.length)],
      [c.dim("claims"), String(state.claims.length)],
      [c.dim("unreviewed"), pendingClaims.length ? c.warn(String(pendingClaims.length)) : c.ok("0")],
      [c.dim("approved"), String(state.claims.filter((claim) => claim.status === "approved").length)],
    ], ["Evidence", "Count"]));
    const action = await pick<string>("Evidence", [
      { name: "Add evidence (file, folder, or URL)", value: "add" },
      { name: "List claims", value: "claims" },
      { name: pendingClaims.length ? `Approve claims (${pendingClaims.length} unreviewed)` : c.dim("Approve claims (none unreviewed)"), value: "approve", disabled: pendingClaims.length ? false : "no unreviewed claims" },
      { name: "Claim review summary", value: "review" },
    ]);
    if (action === BACK) return;
    if (action === "add") {
      const source = await chooseEvidenceSource();
      const added = await withSpinner(`Reading ${source}`, () => addEvidence(/^https?:\/\//.test(source) ? source : source.replace(/^~/, process.env.HOME ?? "")));
      console.log(success(`Added ${added.kind} · ${added.content?.length ?? 0} characters extracted`));
      const claims = (await loadState()).claims.filter((claim) => claim.sourceId === added.id);
      if (claims.length) console.log(c.dim(`  ${claims.length} new claims extracted — review them below`));
    }
    if (action === "claims") {
      const claims = (await loadState()).claims;
      if (!claims.length) { console.log(c.dim("  (no claims yet — add evidence first)")); continue; }
      console.log(table(claims.slice(0, 25).map((claim) => {
        const mark = claim.status === "approved" ? glyphs.check : claim.status === "rejected" ? glyphs.cross : c.warn("▲");
        return [mark, c.dim(claim.id.slice(3, 13)), claim.excerpt.replace(/\s+/g, " ").slice(0, 70)];
      }), ["", "Id", "Claim"]));
    }
    if (action === "approve") {
      let remaining = (await loadState()).claims.filter((claim) => claim.status === "unreviewed");
      for (;;) {
        if (!remaining.length) { console.log(success("All claims reviewed.")); break; }
        const shown = remaining.slice(0, 12).map((claim) => ({ name: claim.excerpt.replace(/\s+/g, " ").slice(0, 78), value: claim.id }));
        const choice = await pick<string>("Approve or reject ( Esc to stop )", [
          ...shown,
          { name: c.ok(`✓ Approve ALL ${remaining.length} from this batch`), value: "__all__" },
          { name: c.dim("… show more"), value: "__more__", disabled: remaining.length <= 12 ? "all shown" : false },
        ]);
        if (choice === BACK) break;
        if (choice === "__all__") {
          const fresh = await loadState();
          for (const claim of fresh.claims) if (claim.status === "unreviewed") claim.status = "approved";
          await saveState(fresh);
          console.log(success(`Approved ${remaining.length} claims`));
          break;
        }
        if (choice === "__more__") { remaining = remaining.slice(12); continue; }
        const verdict = await pick<string>(`Claim ${choice.slice(3, 13)}`, [
          { name: c.ok("✓ Approve — I verify this is true for me"), value: "approve" },
          { name: c.bad("✗ Reject — not accurate or not wanted"), value: "reject" },
        ]);
        if (verdict === BACK) continue;
        const fresh = await loadState();
        const target = fresh.claims.find(({ id }) => id === choice);
        if (target) { target.status = verdict === "approve" ? "approved" : "rejected"; await saveState(fresh); }
        remaining = remaining.filter((claim) => claim.id !== choice);
      }
    }
    if (action === "review") {
      const { reviewSummary } = await import("./evidence.js");
      const summary = await reviewSummary();
      console.log(table(Object.entries(summary).map(([key, value]) => [c.dim(key), String(value)]), ["Status", "Count"]));
    }
  }
}

function pause(): void {
  console.log("");
}

function ledgerTable(rows: string[][]): string {
  if (!rows.length) return c.dim("  (no confirmed submissions yet)");
  return table(rows, ["", "Date", "Role", "Company"]);
}

function runsTable(runs: Run[]): string {
  if (!runs.length) return c.dim("  (none yet)");
  return table(runs.slice(-12).reverse().map((run) => [run.status === "submitted" ? glyphs.check : run.status === "failed" ? glyphs.cross : glyphs.dot(run.status), c.dim(run.id.slice(4, 14)), (run.title ?? run.url).slice(0, 48), run.status]), ["", "Run", "Title", "Status"]);
}

async function homeApply(): Promise<void> {
  let url: string;
  try {
    url = await input({ message: "Job URL", validate: (value) => /^https?:\/\//.test(value.trim()) || "Paste the full job URL (https://...)" });
  } catch (error) {
    if ((error as { name?: string }).name === "ExitPromptError") return;
    throw error;
  }
  const mode = await pick<"auto-apply" | "assist">("Mode", [
    { name: "Assist — review before anything is submitted (recommended)", value: "assist" as const },
    { name: "Auto-apply — submit when everything resolves", value: "auto-apply" as const },
  ]);
  if (mode === BACK) return;
  const run = await withSpinner(`Preparing ${url.trim()}`, () => apply(url.trim(), mode as "auto-apply" | "assist"));
  console.log(ledgerLine(run.title ?? url, run.status));
  if (run.status === "submitted") console.log(success(`Application submitted. Confirmation: ${run.confirmation?.slice(0, 80)}`));
  await showHandoff(run.id);
  pause();
}

async function resolveAttentionItemsInline(items: { id: string; question?: string; reason: string }[]): Promise<number> {
  let resolved = 0;
  for (const item of items) {
    console.log(`\n${c.warn("▲")} ${c.bold(item.question ?? item.reason)}`);
    let answer: string | undefined;
    if (item.question) {
      try {
        answer = await input({ message: "Your approved answer (Esc to skip)" });
      } catch (error) {
        if ((error as { name?: string }).name === "ExitPromptError") { console.log(c.dim("  skipped")); continue; }
        throw error;
      }
      if (!answer.trim()) { console.log(c.dim("  skipped")); continue; }
    } else {
      const verdict = await pick<string>("This is an informational blocker — mark it resolved?", [
        { name: c.ok("✓ Resolved — I handled it in the browser"), value: "resolve" },
        { name: c.dim("Skip for now"), value: "skip" },
      ]);
      if (verdict === BACK || verdict === "skip") { console.log(c.dim("  skipped")); continue; }
    }
    const fresh = await loadState();
    const target = fresh.attention.find(({ id }) => id === item.id);
    if (!target) continue;
    if (item.question && answer) {
      const run = fresh.runs.find(({ id }) => id === target.runId);
      if (run) { run.answers ??= {}; run.answers[item.question] = answer; }
      target.answer = answer;
    }
    target.resolved = true;
    await saveState(fresh);
    console.log(success(`Resolved ${item.id}`));
    resolved += 1;
  }
  return resolved;
}

async function homeContinue(): Promise<void> {
  const state = await loadState();
  const waiting = state.runs.filter((run) => run.status === "waiting_for_user" || run.status === "failed");
  if (!waiting.length) { console.log(c.dim("  (no paused runs)")); return; }
  const runId = await pick({ message: "Which run?", choices: waiting.map((run) => ({ name: `${(run.title ?? run.url).slice(0, 50)} ${c.dim(run.status)}`, value: run.id })), numbered: true });
  if (runId === BACK) return;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let run: Run;
    try {
      run = await withSpinner("Rescanning session and finalizing", () => continueRun(runId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cannot finalize yet/.test(message)) {
        const fresh = await loadState();
        const blockers = fresh.attention.filter((item) => item.runId === runId && !item.resolved);
        console.log(c.warn(`\n${blockers.length} blocker(s) must be resolved first:`));
        blockers.forEach((item, index) => console.log(`  ${index + 1}. ${(item.question ?? item.reason).slice(0, 80)}`));
        const resolvedCount = await resolveAttentionItemsInline(blockers);
        if (!resolvedCount) { await showHandoff(runId); pause(); return; }
        continue;
      }
      if (/needs \d+ more item|not ready to submit/.test(message)) {
        await showHandoff(runId);
        pause();
        return;
      }
      throw error;
    }
    console.log(ledgerLine(run.title ?? run.url, run.status));
    if (run.status === "submitted") console.log(success(`Application submitted. Confirmation: ${run.confirmation?.slice(0, 80)}`));
    await showHandoff(runId);
    pause();
    return;
  }
  console.log(c.dim("Retry limit reached — run: applylocal runs continue " + runId));
  pause();
}

async function showHandoff(runId: string): Promise<void> {
  const state = await loadState();
  const run = state.runs.find(({ id }) => id === runId);
  if (!run || run.status !== "waiting_for_user") return;
  const pending = state.attention.filter((item) => item.runId === run.id && !item.resolved);
  const observation = run.browserSession === "worker" ? await new WorkerClient().observe(run.id).catch(() => undefined) : undefined;
  console.log(renderHandoffText(run, pending, observation));
}

async function homeAttention(): Promise<void> {
  const state = await loadState();
  const pending = state.attention.filter((item) => !item.resolved);
  if (!pending.length) { console.log(success("Nothing pending.")); return; }
  console.log(table(pending.map((item) => [c.dim(item.id.slice(4, 16)), item.question ? c.warn("question") : "notice", (item.question ?? item.reason).slice(0, 64)]), ["Item", "Kind", "Reason"]));
  const itemId = await pick({ message: "Resolve which item?", choices: pending.map((item) => ({ name: (item.question ?? item.reason).slice(0, 60), value: item.id })) });
  if (itemId === BACK) return;
  const item = pending.find(({ id }) => id === itemId)!;
  let answer: string | undefined;
  if (item.question) {
    try {
      answer = await input({ message: `Your approved answer for: ${item.question.slice(0, 80)}` });
    } catch (error) {
      if ((error as { name?: string }).name === "ExitPromptError") return;
      throw error;
    }
  }
  const fresh = await loadState();
  const target = fresh.attention.find(({ id }) => id === itemId);
  if (!target) return;
  if (item.question && answer) {
    const run = fresh.runs.find(({ id }) => id === target.runId);
    if (run) { run.answers ??= {}; run.answers[item.question] = answer; }
    target.answer = answer;
  }
  target.resolved = true;
  await saveState(fresh);
  console.log(success(`Resolved ${itemId}`));
  console.log(nextStep(`continue the run: applylocal runs continue ${target.runId}`));
}
