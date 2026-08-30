import { addAttention, id, loadState, requireSetup, Run, saveState } from "./core.js";
import { openBrowser, pageSnapshot, fillCommonFields, fillApprovedNarratives, fillMissingRequired, fillPolicyFields, unresolvedRequiredControls, unresolvedPolicyFields, clickNext, clickSubmit, runModelActions, observePage, sensitiveFields, waitForConfirmation, findFormScope, formControlCount, isBrowserClosed } from "./browser.js";
import { reasoningModel } from "./reasoning.js";
import { siteBehavior } from "./sites.js";
import { extractJob } from "./jobs.js";
import { WorkerClient } from "./worker-client.js";

export async function apply(url: string, modeOverride?: "auto-apply" | "assist", existingRunId?: string, reviewed = false): Promise<Run> {
  const state = await loadState();
  const setup = requireSetup(state);
  const model = reasoningModel(setup.reasoning);
  const behavior = siteBehavior(url);
  const now = new Date().toISOString();
  const existing = existingRunId ? state.runs.find(({ id }) => id === existingRunId) : undefined;
  const run: Run = existing ?? { id: id("run"), url, status: "created", mode: modeOverride ?? setup.mode, attentionIds: [], answers: {}, createdAt: now, updatedAt: now };
  if (!existing && state.applications.some((application) => application.url === url)) throw new Error("An application for this URL is already recorded");
  if (!existing) state.runs.push(run);
  else {
    run.status = "created";
    run.updatedAt = now;
    for (const attentionId of run.attentionIds) {
      const item = state.attention.find(({ id }) => id === attentionId);
      if (item) item.resolved = true;
    }
  }
  await saveState(state);
  state.traces ??= [];
  state.traces.push({ runId: run.id, at: now, type: "run_started", detail: url });
  if (run.mode === "assist" && process.env.APPLYLOCAL_DISABLE_WORKER !== "1") {
    const worker = new WorkerClient();
    try {
      await worker.ensureRunning();
      const attached = await worker.attach(run.id, url);
      run.browserSession = "worker";
      run.title = attached.title;
      run.company = attached.company;
      const questions = attached.questions ?? [];
      const notices = attached.notices ?? [];
      run.status = questions.length || notices.length ? "waiting_for_user" : "filling";
      await saveState(state);
      if (questions.length || notices.length) {
        for (const question of questions) await addAttention(state, run, "A required question needs an approved answer", question);
        for (const notice of notices) await addAttention(state, run, notice);
        return run;
      }
    } catch (error) {
      run.status = "failed";
      run.updatedAt = new Date().toISOString();
      state.traces.push({ runId: run.id, at: run.updatedAt, type: "browser_error", detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) });
      await saveState(state);
      if (isBrowserClosed(error)) throw new Error(`The ApplyLocal browser was closed while preparing this application (run ${run.id}). Retry with: applylocal apply ${url} --mode assist`);
      throw error;
    }
    if (!reviewed) {
      await addAttention(state, run, "Assist mode requires review before final submission");
      return run;
    }
    const final = await worker.finalize(run.id);
    if (final.status === "submitted") {
      run.status = "submitted";
      run.confirmation = final.confirmation;
      run.updatedAt = new Date().toISOString();
      state.applications.push({ id: id("app"), runId: run.id, url, title: run.title, company: run.company, submittedAt: run.updatedAt, confirmation: final.confirmation ?? "" });
      state.traces.push({ runId: run.id, at: run.updatedAt, type: "submitted", detail: "Worker confirmed submission" });
      await saveState(state);
      return run;
    }
    if (final.status === "unknown") run.status = "unknown";
    else {
      for (const question of final.questions ?? []) await addAttention(state, run, "A required question needs an approved answer", question);
      for (const notice of final.notices ?? []) await addAttention(state, run, notice);
      if (!(final.questions ?? []).length && !(final.notices ?? []).length) await addAttention(state, run, final.reason ?? "Review required before submission");
      run.status = "waiting_for_user";
    }
    await saveState(state);
    return run;
  }
  const context = await openBrowser(setup);
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    run.status = "job_loaded";
    run.updatedAt = new Date().toISOString();
    await saveState(state);
    const job = await extractJob(page);
    run.title = job.title;
    run.company = job.company;
    if (job.applicationUrl !== page.url()) await page.goto(job.applicationUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    run.status = "filling";
    await saveState(state);
    const scope = await findFormScope(page);
    let resolvedScope = scope;
    if (!await formControlCount(scope)) {
      if (run.mode !== "assist") {
        let outcome;
        try {
          outcome = await runModelActions(page, model, state.evidence, false, 12, scope);
        } catch (error) {
          await addAttention(state, run, `The reasoning provider failed during navigation: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`);
          return run;
        }
        if (outcome.pause) {
          await addAttention(state, run, outcome.pause);
          return run;
        }
        resolvedScope = await findFormScope(page);
      }
      if (!await formControlCount(resolvedScope)) {
        await addAttention(state, run, "No application form was reached on this page. It may require sign-in or applying by email.");
        return run;
      }
    }
    const resolvedPolicyLabels: string[] = [];
    await fillCommonFields(page, resolvedScope, setup, setup.defaultResume);
    let policyUnresolved = await fillPolicyFields(page, resolvedScope, setup, job.location, resolvedPolicyLabels);
    if (policyUnresolved.length) {
      await addAttention(state, run, "A policy question needs user attention", policyUnresolved[0]);
      return run;
    }
    const unresolvedPolicy = await unresolvedPolicyFields(page, resolvedScope, setup);
    if (unresolvedPolicy.length) {
      await addAttention(state, run, "Work authorization or sponsorship policy needs an application-specific decision", unresolvedPolicy[0]);
      return run;
    }
    let unresolved = await fillApprovedNarratives(page, resolvedScope, state.evidence, run.answers ?? {}, model, state.claims);
    if (unresolved.length) {
      for (const question of unresolved) await addAttention(state, run, "A required question needs an approved answer", question);
      return run;
    }
    while (await clickNext(resolvedScope)) {
      await fillCommonFields(page, resolvedScope, setup, setup.defaultResume);
      policyUnresolved = await fillPolicyFields(page, resolvedScope, setup, job.location, resolvedPolicyLabels);
      if (policyUnresolved.length) {
        await addAttention(state, run, "A policy question needs user attention", policyUnresolved[0]);
        return run;
      }
      const pagePolicy = await unresolvedPolicyFields(page, resolvedScope, setup);
      if (pagePolicy.length) {
        await addAttention(state, run, "Work authorization or sponsorship policy needs an application-specific decision", pagePolicy[0]);
        return run;
      }
      unresolved = await fillApprovedNarratives(page, resolvedScope, state.evidence, run.answers ?? {}, model, state.claims);
      if (unresolved.length) {
        for (const question of unresolved) await addAttention(state, run, "A required question needs an approved answer", question);
        return run;
      }
    }
    if (run.mode === "assist" && !reviewed) {
      await addAttention(state, run, "Assist mode requires review before final submission");
      return run;
    }
    const sensitive = sensitiveFields(await observePage(page, resolvedScope), resolvedPolicyLabels);
    if (sensitive.length) {
      await addAttention(state, run, `Sensitive fields require user attention: ${sensitive.join(", ")}`, sensitive[0]);
      return run;
    }
    run.status = "ready_to_submit";
    const gapUnresolved = await fillMissingRequired(page, resolvedScope, state.evidence, run.answers ?? {}, model, state.claims);
    if (gapUnresolved.length) {
      for (const question of gapUnresolved) await addAttention(state, run, "A required question needs an approved answer", question);
      return run;
    }
    const required = await unresolvedRequiredControls(resolvedScope);
    if (required.length) {
      await addAttention(state, run, `Required fields need attention: ${required.join(", ")}`, required[0]);
      return run;
    }
    await saveState(state);
    if (!await clickSubmit(resolvedScope)) {
      await addAttention(state, run, "No unambiguous application submission control was found");
      return run;
    }
    run.status = "submitting";
    await saveState(state);
    const confirmationResult = await waitForConfirmation(page, behavior.submitSignals, 90000, resolvedScope);
    const confirmation = confirmationResult.text;
    if (!confirmationResult.confirmed) {
      run.status = "unknown";
      run.updatedAt = new Date().toISOString();
      await saveState(state);
      return run;
    }
    run.status = "submitted";
    run.confirmation = confirmation.slice(0, 500);
    run.updatedAt = new Date().toISOString();
    state.applications.push({ id: id("app"), runId: run.id, url, title: run.title, company: run.company, submittedAt: run.updatedAt, confirmation: run.confirmation });
    state.traces.push({ runId: run.id, at: run.updatedAt, type: "submitted", detail: "Visible confirmation matched the site behavior" });
    await saveState(state);
    return run;
  } catch (error) {
    run.status = "failed";
    run.updatedAt = new Date().toISOString();
    state.traces.push({ runId: run.id, at: run.updatedAt, type: "browser_error", detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) });
    await saveState(state);
    if (isBrowserClosed(error)) throw new Error(`The ApplyLocal browser was closed during this run (run ${run.id}). Retry with: applylocal apply ${url} --mode assist`);
    throw error;
  } finally {
    await context.close();
  }
}

export async function continueRun(runId: string): Promise<Run> {
  const state = await loadState();
  const run = state.runs.find(({ id }) => id === runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status === "unknown") throw new Error(`Run ${runId} has unknown submission status. Do not retry automatically; inspect the application first.`);
  if (run.status !== "waiting_for_user" && run.status !== "failed") throw new Error(`Run ${runId} cannot continue from ${run.status}`);
  if (run.browserSession === "worker") return continueWorkerRun(run);
  return apply(run.url, run.mode, run.id, true);
}

async function continueWorkerRun(run: Run): Promise<Run> {
  const state = await loadState();
  const blocking = state.attention.filter((item) => item.runId === run.id && !item.resolved);
  if (blocking.length) {
    const lines = blocking.map((item) => `  applylocal attention resolve ${item.id}${item.question ? ' --answer "..."' : ""}   // ${item.reason}`);
    throw new Error(`Run ${run.id} cannot finalize yet. Resolve these attention items first:\n${lines.join("\n")}`);
  }
  const worker = new WorkerClient();
  await worker.rescan(run.id).catch(() => undefined);
  let result;
  try {
    result = await worker.finalize(run.id);
  } catch (error) {
    if (!/Session not found|not reachable/i.test(error instanceof Error ? error.message : String(error))) throw error;
    return apply(run.url, run.mode, run.id, true);
  }
  const current = state.runs.find(({ id }) => id === run.id) ?? run;
  if (result.status === "submitted") {
    current.status = "submitted";
    current.confirmation = result.confirmation;
    current.updatedAt = new Date().toISOString();
    if (!state.applications.some(({ runId }) => runId === current.id)) state.applications.push({ id: id("app"), runId: current.id, url: current.url, title: current.title, company: current.company, submittedAt: current.updatedAt, confirmation: result.confirmation ?? "" });
  } else if (result.status === "unknown") {
    current.status = "unknown";
    current.updatedAt = new Date().toISOString();
    state.traces.push({ runId: current.id, at: current.updatedAt, type: "finalize_blocked", detail: result.reason ?? "Submission confirmation was not visible" });
    await saveState(state);
    throw new Error(`Submission status is UNKNOWN for run ${run.id}: ${result.reason ?? "confirmation was not visible"}. Inspect the browser before doing anything; do not resubmit automatically.`);
  } else {
    current.updatedAt = new Date().toISOString();
    state.traces.push({ runId: current.id, at: current.updatedAt, type: "finalize_blocked", detail: result.reason ?? "waiting_for_user" });
    await saveState(state);
    const created: string[] = [];
    for (const question of result.questions ?? []) created.push((await addAttention(state, current, "A required question needs an approved answer", question)).id);
    for (const notice of result.notices ?? []) created.push((await addAttention(state, current, notice)).id);
    if (created.length) {
      const lines = (result.questions ?? []).map((question, index) => `  applylocal attention resolve ${created[index]} --answer "..."   // ${question}`);
      throw new Error(`Run ${run.id} needs ${created.length} more item(s) resolved before submission:\n${lines.join("\n") || `  applylocal attention list`}`);
    }
    throw new Error(`Run ${run.id} is not ready to submit: ${result.reason ?? "review required"}`);
  }
  await saveState(state);
  return current;
}

export async function recoverRun(runId: string, confirmedNotSubmitted = false): Promise<Run> {
  const state = await loadState();
  const run = state.runs.find(({ id }) => id === runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status === "unknown") {
    if (!confirmedNotSubmitted) throw new Error(`Run ${runId} has unknown submission status. Inspect the application first, then run: applylocal runs recover ${runId} --confirmed-not-submitted (only when you verified in the browser that no submission happened)`);
    state.traces.push({ runId, at: new Date().toISOString(), type: "unknown_resolved", detail: "User confirmed during manual inspection that no submission occurred" });
  }
  if (run.status === "submitted") throw new Error(`Run ${runId} is already submitted`);
  run.status = "failed";
  run.updatedAt = new Date().toISOString();
  state.traces.push({ runId, at: run.updatedAt, type: "recovery_required", detail: "Browser session may have been lost; inspect before continuing" });
  await saveState(state);
  return run;
}
