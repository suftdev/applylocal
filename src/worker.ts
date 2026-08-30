import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, BrowserContext, Page } from "playwright";
import { openBrowser, observePage, executeBrowserAction, BrowserAction, FormScope, fillCommonFields, fillPolicyFields, unresolvedPolicyFields, fillApprovedNarratives, fillMissingRequired, clickNext, unresolvedRequiredControls, sensitiveFields, clickSubmit, waitForConfirmation, findFormScope, formControlCount, isBrowserClosed, runModelActions } from "./browser.js";
import { dataDir, loadState, requireSetup } from "./core.js";
import { extractJob } from "./jobs.js";
import { reasoningModel } from "./reasoning.js";
import { siteBehavior } from "./sites.js";

type Session = { context: BrowserContext; page: Page; scope: FormScope; resolvedPolicy: string[] };
const sessions = new Map<string, Session>();
const tokenPath = () => `${dataDir()}/worker.token`;

function workerToken(): string {
  const path = tokenPath();
  if (!existsSync(path)) {
    const token = randomBytes(32).toString("hex");
    writeFileSync(path, `${token}\n`, { mode: 0o600 });
    return token;
  }
  return readFileSync(path, "utf8").trim();
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

export async function workerHandler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.headers["x-applylocal-token"] !== workerToken()) return send(response, 401, { error: "Invalid worker token" });
    const input = await body(request);
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/health") return send(response, 200, { status: "ok", sessions: sessions.size });
    if (request.method === "POST" && path === "/sessions") {
      const runId = String(input.runId);
      if (!runId || sessions.has(runId)) return send(response, 409, { error: "A worker session already exists for this run" });
      const state = await loadState();
      const setup = requireSetup(state);
      let context: BrowserContext | undefined;
      try {
        context = await openBrowser(setup);
        const page = await context.newPage();
        await page.goto(String(input.url), { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("domcontentloaded");
        const run = state.runs.find(({ id }) => id === runId);
        if (!run) { await context.close(); return send(response, 404, { error: "Run not found" }); }
        const job = await extractJob(page);
        if (job.applicationUrl !== page.url()) await page.goto(job.applicationUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        const scope = await findFormScope(page);
        let workingScope = scope;
        let noForm = !await formControlCount(workingScope);
        const model = reasoningModel(setup.reasoning);
        if (noForm) {
          let outcome;
          try {
            outcome = await runModelActions(page, model, state.evidence, false, 12, workingScope);
          } catch (error) {
            sessions.set(runId, { context, page, scope: workingScope, resolvedPolicy: [] });
            return send(response, 200, { runId, observation: await observePage(page, workingScope), notices: [`The reasoning provider failed during navigation: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`], noForm: true, title: job.title, company: job.company });
          }
          if (outcome.pause) return send(response, 200, { runId, observation: await observePage(page, workingScope), notices: [outcome.pause], noForm: true, title: job.title, company: job.company });
          if (outcome.navigated) {
            workingScope = await findFormScope(page);
            noForm = !await formControlCount(workingScope);
          }
        }
        sessions.set(runId, { context, page, scope: workingScope, resolvedPolicy: [] });
        const questions: string[] = [];
        const notices: string[] = [];
        if (!noForm) {
          for (let step = 0; step < 10; step += 1) {
            await fillCommonFields(page, workingScope, setup, setup.defaultResume);
            notices.push(...await fillPolicyFields(page, workingScope, setup, job.location, (sessions.get(runId) as Session).resolvedPolicy));
            notices.push(...await unresolvedPolicyFields(page, workingScope, setup));
            questions.push(...await fillApprovedNarratives(page, workingScope, state.evidence, run.answers ?? {}, model, state.claims));
            notices.push(...await fillMissingRequired(page, workingScope, state.evidence, run.answers ?? {}, model, state.claims));
            if (questions.length || notices.length || !await clickNext(workingScope)) break;
          }
        } else notices.push(job.authRequired ? "This employer requires sign-in or registration before the application form appears. Complete it in the visible ApplyLocal browser window, then run: applylocal runs continue " + runId : "No application form was found on this page. It may require applying by email.");
        return send(response, 200, { runId, observation: await observePage(page, workingScope), questions, notices, noForm, authRequired: job.authRequired, title: job.title, company: job.company });
      } catch (error) {
        if (context) await context.close().catch(() => undefined);
        if (isBrowserClosed(error)) return send(response, 500, { error: `The persistent browser was closed while preparing this application (${error instanceof Error ? error.message.slice(0, 120) : "unknown"}). Retry the apply command.` });
        throw error;
      }
    }
    const runId = path.split("/")[2];
    const session = sessions.get(runId);
    if (!session) return send(response, 404, { error: "Session not found in this worker" });
    if (request.method === "GET" && path.endsWith("/observe")) return send(response, 200, await observePage(session.page, session.scope));
    if (request.method === "POST" && path.endsWith("/act")) {
      const action = input.action as BrowserAction;
      if (action.type === "click" && action.target === "submit") return send(response, 403, { error: "Worker submit is forbidden; use the guarded application workflow" });
      await executeBrowserAction(session.page, session.scope, action, await observePage(session.page, session.scope));
      return send(response, 200, await observePage(session.page, session.scope));
    }
    if (request.method === "POST" && path.endsWith("/rescan")) {
      if (typeof input.url === "string" && /^https?:\/\//i.test(input.url)) {
        await session.page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      }
      const state = await loadState();
      const run = state.runs.find(({ id }) => id === runId);
      const setup = requireSetup(state);
      const job = await extractJob(session.page);
      let scope = await findFormScope(session.page);
      session.scope = scope;
      session.resolvedPolicy = [];
      const model = reasoningModel(setup.reasoning);
      let noForm = !await formControlCount(scope);
      if (noForm) {
        const outcome = await runModelActions(session.page, model, state.evidence, false, 12, scope);
        if (!outcome.pause && outcome.navigated) {
          scope = await findFormScope(session.page);
          session.scope = scope;
          noForm = !await formControlCount(scope);
        }
      }
      const questions: string[] = [];
      const notices: string[] = [];
      if (!noForm) {
        for (let step = 0; step < 10; step += 1) {
          await fillCommonFields(session.page, scope, setup, setup.defaultResume);
          notices.push(...await fillPolicyFields(session.page, scope, setup, job.location, session.resolvedPolicy));
          notices.push(...await unresolvedPolicyFields(session.page, scope, setup));
          questions.push(...await fillApprovedNarratives(session.page, scope, state.evidence, run?.answers ?? {}, model, state.claims));
          notices.push(...await fillMissingRequired(session.page, scope, state.evidence, run?.answers ?? {}, model, state.claims));
          if (questions.length || notices.length || !await clickNext(scope)) break;
        }
      }
      return send(response, 200, { runId, observation: await observePage(session.page, scope), questions, notices, noForm, authRequired: job.authRequired, title: job.title, company: job.company, url: session.page.url() });
    }
    if (request.method === "POST" && path.endsWith("/finalize")) {
      const state = await loadState();
      const run = state.runs.find(({ id }) => id === runId);
      if (!run || run.mode !== "assist") return send(response, 403, { error: "Only an assist run can be finalized through its worker session" });
      if (state.attention.some((item) => item.runId === runId && !item.resolved)) return send(response, 200, { status: "waiting_for_user", reason: "The run still has unresolved attention items" });
      const setup = requireSetup(state);
      const model = reasoningModel(setup.reasoning);
      const answered = await fillApprovedNarratives(session.page, session.scope, state.evidence, run.answers ?? {}, model, state.claims);
      const gapFilled = await fillMissingRequired(session.page, session.scope, state.evidence, run.answers ?? {}, model, state.claims);
      if (answered.length || gapFilled.length) return send(response, 200, { status: "waiting_for_user", reason: `Required questions need approved answers: ${[...answered, ...gapFilled].join(", ")}`, questions: answered, notices: gapFilled });
      const observation = await observePage(session.page, session.scope);
      const sensitive = sensitiveFields(observation, session.resolvedPolicy);
      const required = await unresolvedRequiredControls(session.scope);
      if (sensitive.length || required.length) return send(response, 200, { status: "waiting_for_user", reason: `Review required: ${[...sensitive, ...required].join(", ")}`, notices: [...sensitive, ...required] });
      if (!await clickSubmit(session.scope)) return send(response, 200, { status: "waiting_for_user", reason: "No unambiguous submit control was found" });
      const confirmation = await waitForConfirmation(session.page, siteBehavior(run.url).submitSignals, 90000);
      return send(response, 200, confirmation.confirmed ? { status: "submitted", confirmation: confirmation.text.slice(0, 500) } : { status: "unknown", reason: "Submission confirmation was not visible" });
    }
    if (request.method === "DELETE" && path.startsWith("/sessions/")) {
      await session.context.close();
      sessions.delete(runId);
      return send(response, 200, { closed: true, runId });
    }
    send(response, 404, { error: "Unknown worker route" });
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function startWorker(port = Number(process.env.APPLYLOCAL_WORKER_PORT ?? 4317)): ReturnType<typeof createServer> {
  workerToken();
  const server = createServer((request, response) => { void workerHandler(request, response); });
  const closeSessions = async () => { await Promise.all([...sessions.values()].map(({ context }) => context.close().catch(() => undefined))); sessions.clear(); };
  server.on("close", () => { void closeSessions(); });
  server.listen(port, "127.0.0.1");
  return server;
}
