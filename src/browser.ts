import { chromium, BrowserContext, Frame, Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { EvidenceClaim, EvidenceSource, Setup } from "./core.js";
import { approvedAnswer } from "./evidence.js";
import type { ReasoningModel } from "./reasoning.js";
import { resolveSponsorship, resolveWorkAuthorization } from "./policy.js";

export type FormScope = Page | Frame;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function isBrowserClosed(error: unknown): boolean { return /Target page, context or browser has been closed|Target closed|Browser has been closed|Session closed|Page crashed/i.test(error instanceof Error ? error.message : String(error)); }

export async function findFormScope(page: Page): Promise<FormScope> {
  const mainControls = page.locator("input:visible, select:visible, textarea:visible");
  if (await mainControls.count()) return page;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      if (await frame.locator("input:visible, select:visible, textarea:visible").count()) return frame;
    } catch { continue; }
  }
  return page;
}

export async function formControlCount(scope: FormScope): Promise<number> {
  return scope.locator("input, select, textarea").count();
}

export type ObservedField = { id: string; role: string; label: string; type: string; required: boolean; value: string; checked?: boolean };
export type ObservedLink = { id: string; text: string; href: string };
export type BrowserObservation = { url: string; title: string; text: string; fields: ObservedField[]; links: ObservedLink[]; canSubmit: boolean };
export type BrowserAction =
  | { type: "fill"; fieldId: string; value: string }
  | { type: "select"; fieldId: string; value: string }
  | { type: "check"; fieldId: string; value: boolean }
  | { type: "click"; target: "next" | "submit" }
  | { type: "visit"; linkId: string };

export async function openBrowser(setup: Setup): Promise<BrowserContext> {
  await mkdir(dirname(setup.browserProfile), { recursive: true });
  try {
    return await chromium.launchPersistentContext(setup.browserProfile, { headless: process.env.APPLYLOCAL_HEADLESS === "1", args: ["--disable-blink-features=AutomationControlled"], ignoreDefaultArgs: ["--enable-automation"] });
  } catch (error) {
    if (/Opening in existing browser session|profile.*already in use|ProcessSingleton/i.test(error instanceof Error ? error.message : String(error))) {
      throw new Error(`The ApplyLocal browser profile is already in use, usually by the persistent worker holding an open assist run.\n\nCheck waiting runs:   applylocal runs list\nClose a session:     applylocal browser close <run-id>\nStop the worker:     pkill -f "applylocal worker"\nThen retry your command.`);
    }
    throw error;
  }
}

export async function pageSnapshot(scope: FormScope): Promise<string> {
  return scope.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

export async function observePage(page: Page, scope?: FormScope): Promise<BrowserObservation> {
  const target = scope ?? page;
  const fields = await target.locator("input, select, textarea").evaluateAll((elements) => elements.map((element, index) => {
    const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const label = input.labels?.[0]?.textContent?.trim() || (input.closest("label") as HTMLLabelElement | null)?.textContent?.trim() || input.getAttribute("aria-label") || input.getAttribute("name") || `field-${index}`;
    const type = input instanceof HTMLInputElement ? input.type : input.tagName.toLowerCase();
    return {
      id: `field-${index}`,
      role: input.tagName.toLowerCase() === "select" ? "combobox" : type === "checkbox" ? "checkbox" : "textbox",
      label,
      type,
      required: input.hasAttribute("required") || input.getAttribute("aria-required") === "true",
      value: input instanceof HTMLSelectElement ? (input.selectedOptions[0]?.textContent ?? "") : input.value,
      ...(type === "checkbox" || type === "radio" ? { checked: (input as HTMLInputElement).checked } : {}),
    };
  }));
  return { url: page.url(), title: await page.title(), text: await pageSnapshot(target), fields, links: await observeLinks(target), canSubmit: await target.getByRole("button", { name: /submit application|submit/i }).count() > 0 };
}

async function observeLinks(scope: FormScope): Promise<ObservedLink[]> {
  const seen = new Set<string>();
  const links = await scope.locator("a[href]:visible").evaluateAll((elements) => elements.slice(0, 80).map((element) => {
    const anchor = element as HTMLAnchorElement;
    return { text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80), href: anchor.href };
  }));
  const result: ObservedLink[] = [];
  for (const [index, link] of links.entries()) {
    if (!link.text || !/^https?:/i.test(link.href) || seen.has(link.href)) continue;
    seen.add(link.href);
    result.push({ id: `link-${result.length}`, text: link.text, href: link.href });
    if (result.length >= 40) break;
    void index;
  }
  return result;
}

export function validateBrowserAction(action: BrowserAction, observation: BrowserObservation): void {
  if (action.type === "click") return;
  if (action.type === "visit") {
    const link = observation.links.find(({ id }) => id === action.linkId);
    if (!link) throw new Error(`Visit target is not present in the current observation: ${action.linkId}`);
    const targetOrigin = new URL(link.href).origin;
    if (targetOrigin !== new URL(observation.url).origin) throw new Error(`Cross-origin navigation is not permitted: ${link.href}`);
    return;
  }
  const field = observation.fields.find(({ id }) => id === action.fieldId);
  if (!field) throw new Error(`Browser action target is not present: ${action.fieldId}`);
  if (field.type === "file") throw new Error("File uploads require the dedicated resume upload path");
}

export const SENSITIVE_PATTERN = /social security|national id|government id|date of birth|gender|race|ethnicity|disability|veteran|legal declaration|certify|signature|salary|compensation|relocat|captcha|verification code|one-time code|password|work authorization|authorized to work|sponsor|sponsorship/i;

export function sensitiveFields(observation: BrowserObservation, allow: string[] = []): string[] {
  return observation.fields.filter(({ label, type, value, checked }) => {
    if (type === "hidden") return false;
    if (type === "checkbox" && checked) return false;
    if (type !== "checkbox" && type !== "radio" && value.trim()) return false;
    return SENSITIVE_PATTERN.test(label) && !allow.includes(label.trim());
  }).map(({ label }) => label);
}

export async function executeBrowserAction(page: Page, scope: FormScope, action: BrowserAction, observation: BrowserObservation): Promise<void> {
  validateBrowserAction(action, observation);
  if (action.type === "click") {
    if (action.target === "submit") {
      if (!await clickSubmit(scope)) throw new Error("Submit control is not available");
    } else if (!await clickNext(scope)) throw new Error("Next control is not available");
    return;
  }
  if (action.type === "visit") {
    const index = Number(action.linkId.slice(5));
    await scope.locator("a[href]:visible").nth(index).click();
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => undefined);
    await sleep(300);
    return;
  }
  const locator = scope.locator("input, select, textarea").nth(Number(action.fieldId.slice(6)));
  if (action.type === "fill") await locator.fill(action.value);
  if (action.type === "select") await locator.selectOption({ label: action.value }).catch(() => locator.selectOption(action.value));
  if (action.type === "check") await locator.setChecked(action.value);
}

export async function runModelActions(page: Page, model: { planBrowserAction(request: { observation: BrowserObservation; evidence: EvidenceSource[]; allowSubmit: boolean }): Promise<{ action: BrowserAction | { type: "pause"; reason: string }; sourceIds: string[]; reason: string }> }, evidence: EvidenceSource[], allowSubmit: boolean, maxSteps = 12, scope?: FormScope): Promise<{ pause?: string; navigated: boolean }> {
  let navigated = false;
  for (let step = 0; step < maxSteps; step += 1) {
    const observation = await observePage(page, scope ?? page);
    const proposed = await model.planBrowserAction({ observation, evidence, allowSubmit });
    if (proposed.action.type === "pause") return { pause: proposed.action.reason, navigated };
    if (proposed.action.type === "click" && proposed.action.target === "submit") return { navigated };
    const validSources = proposed.sourceIds.length > 0 && proposed.sourceIds.every((sourceId) => evidence.some(({ id }) => id === sourceId));
    if (!validSources && (proposed.action.type === "fill" || proposed.action.type === "select" || proposed.action.type === "check")) return { pause: "The proposed browser action is not backed by registered evidence", navigated };
    const field = observation.fields.find(({ id }) => "fieldId" in proposed.action && id === proposed.action.fieldId);
    if (field && sensitiveFields({ ...observation, fields: [field] }).length) return { pause: `Sensitive field requires user attention: ${field.label}`, navigated };
    await executeBrowserAction(page, scope ?? page, proposed.action, observation);
    if (proposed.action.type === "visit") navigated = true;
    if (proposed.action.type === "click" && proposed.action.target === "next") await sleep(250);
    if (proposed.action.type === "visit") break;
  }
  return { pause: navigated ? undefined : "The browser action planner reached its step limit", navigated };
}


export async function fillCommonFields(page: Page, scope: FormScope, setup: Setup, resume?: string): Promise<string[]> {
  const filled: string[] = [];
  const fields: Array<[string, string]> = [["first name", setup.candidate.name.split(" ")[0]], ["full name", setup.candidate.name], ["name", setup.candidate.name], ["email", setup.candidate.email], ["phone", setup.candidate.phone ?? ""]];
  for (const [label, value] of fields) {
    if (!value) continue;
    const locator = scope.getByLabel(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first();
    if (await locator.count() && await locator.isVisible().catch(() => false)) { await locator.fill(value); filled.push(label); }
  }
  if (filled.length < fields.filter(([label, value]) => value).length) {
    const observation = await observePage(page, scope);
    for (const entry of fields) {
      const [label, value] = entry;
      if (!value || filled.includes(label) || label === "name" || label === "first name" || label === "full name") continue;
      const pattern = new RegExp(label, "i");
      const target = observation.fields.find((field) => pattern.test(field.label) && !field.value.trim() && !["file", "hidden", "checkbox", "radio"].includes(field.type));
      if (target) { await executeBrowserAction(page, scope, { type: "fill", fieldId: target.id, value }, observation); filled.push(label); }
    }
  }
  if (resume) {
    const input = scope.locator('input[type="file"]').first();
    if (await input.count()) { await input.setInputFiles(resume); filled.push("resume"); }
  }
  return filled;
}

export async function fillApprovedNarratives(page: Page, scope: FormScope, evidence: EvidenceSource[], savedAnswers: Record<string, string>, model?: ReasoningModel, claims?: EvidenceClaim[]): Promise<string[]> {
  const unresolved: string[] = [];
  for (const textarea of await scope.locator("textarea").all()) {
    if (!await textarea.isVisible().catch(() => false)) continue;
    const meta = await textarea.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      const label = input.labels?.[0]?.textContent?.trim() || (input.closest("label") as HTMLLabelElement | null)?.textContent?.trim() || input.getAttribute("aria-label") || input.getAttribute("placeholder") || "";
      return { id: input.id, label, required: input.hasAttribute("required") || input.getAttribute("aria-required") === "true" };
    });
    const question = meta.id ? await scope.locator(`label[for="${meta.id}"]`).textContent({ timeout: 1000 }).catch(() => null) : null;
    const label = question?.trim() || meta.label.trim() || "Narrative question";
    const approvedSourceIds = new Set(claims?.filter(({ status }) => status === "approved").map(({ sourceId }) => sourceId));
    const approvedSources = claims ? evidence.filter(({ id }) => approvedSourceIds.has(id)) : evidence;
    const approved = savedAnswers[label] || approvedAnswer(approvedSources, label);
    if (approved) await textarea.fill(approved);
    else if (model) {
      const approvedEvidence = claims?.filter(({ status }) => status === "approved").map((claim) => ({ id: claim.id, input: claim.sourceId, kind: "file" as const, addedAt: claim.location ?? "claim", content: claim.excerpt })) ?? evidence;
      if (claims && !approvedEvidence.length) { if (meta.required) unresolved.push(label); continue; }
      let proposed;
      try {
        proposed = await model.resolveAnswer({ question: label, evidence: approvedEvidence });
      } catch {
        if (meta.required) unresolved.push(label);
        continue;
      }
      if (proposed.status === "supported") await textarea.fill(proposed.answer);
      else if (meta.required) unresolved.push(label);
    } else if (meta.required) unresolved.push(label);
  }
  return unresolved;
}

export async function fillMissingRequired(page: Page, scope: FormScope, evidence: EvidenceSource[], savedAnswers: Record<string, string>, model?: ReasoningModel, claims?: EvidenceClaim[]): Promise<string[]> {
  const unresolved: string[] = [];
  const approvedSourceIds = new Set(claims?.filter(({ status }) => status === "approved").map(({ sourceId }) => sourceId));
  const approvedSources = claims ? evidence.filter(({ id }) => approvedSourceIds.has(id)) : evidence;
  const approvedEvidence = claims?.filter(({ status }) => status === "approved").map((claim) => ({ id: claim.id, input: claim.sourceId, kind: "file" as const, addedAt: claim.location ?? "claim", content: claim.excerpt })) ?? evidence;
  for (const field of await scope.locator("input[required], input[aria-required='true'], textarea[required], textarea[aria-required='true']").all()) {
    if (!await field.isVisible().catch(() => false)) continue;
    const meta = await field.evaluate((element) => {
      const input = element as HTMLInputElement;
      if (input.type === "file" || input.type === "hidden") return null;
      if (input.type === "radio") {
        const group = input.name ? Array.from((input.form ?? document).querySelectorAll<HTMLInputElement>(`input[name="${input.name}"]`)) : [input];
        return group.some((radio) => radio.checked) ? null : { type: input.type, label: input.labels?.[0]?.textContent?.trim() || input.getAttribute("aria-label") || input.getAttribute("name") || "" };
      }
      if (input.type === "checkbox") return input.checked ? null : { type: input.type, label: input.labels?.[0]?.textContent?.trim() || input.getAttribute("aria-label") || input.getAttribute("name") || "" };
      if (input.value.trim()) return null;
      const label = input.labels?.[0]?.textContent?.trim() || (input.closest("label") as HTMLLabelElement | null)?.textContent?.trim() || input.getAttribute("aria-label") || input.getAttribute("name") || "";
      return { type: input.type, label };
    });
    if (!meta) continue;
    const cleanLabel = meta.label.replace(/\s+/g, " ").trim();
    if (!cleanLabel || /^cards\[/i.test(cleanLabel)) { unresolved.push(cleanLabel || "required field"); continue; }
    if (SENSITIVE_PATTERN.test(cleanLabel)) { unresolved.push(cleanLabel); continue; }
    const saved = savedAnswers[cleanLabel] || approvedAnswer(approvedSources, cleanLabel);
    if (saved) { await field.fill(saved); continue; }
    if (model && approvedEvidence.length) {
      try {
        const proposed = await model.resolveAnswer({ question: cleanLabel, evidence: approvedEvidence });
        if (proposed.status === "supported") { await field.fill(proposed.answer); continue; }
      } catch {
        /* provider failure leaves the field for the user */
      }
    }
    unresolved.push(cleanLabel);
  }
  return unresolved;
}

export async function fillPolicyFields(page: Page, scope: FormScope, setup: Setup, country?: string, resolvedOut?: string[]): Promise<string[]> {
  const unresolved: string[] = [];
  const pageText = await pageSnapshot(scope);
  const employmentType = /(contractor|freelance|independent consultant)/i.test(pageText) ? "contractor" as const : "employee" as const;
  for (const field of await scope.locator("input, select, textarea").all()) {
    if (!await field.isVisible().catch(() => false)) continue;
    const labelText = await field.locator("xpath=ancestor::label[1]").textContent({ timeout: 1000 }).catch(() => null);
    const aria = await field.getAttribute("aria-label", { timeout: 1000 }).catch(() => undefined) ?? undefined;
    const name = await field.getAttribute("name", { timeout: 1000 }).catch(() => undefined) ?? undefined;
    const idAttr = await field.getAttribute("id", { timeout: 1000 }).catch(() => undefined) ?? undefined;
    const label = `${labelText ?? ""} ${aria ?? ""} ${name ?? ""} ${idAttr ?? ""}`;
    const kind = /sponsor|sponsorship/i.test(label) ? "sponsorship" : /work authorization|authorized to work/i.test(label) ? "authorization" : undefined;
    if (!kind) continue;
    const cleanLabel = labelText?.trim() || aria?.trim() || name?.trim() || idAttr?.trim() || label.trim();
    resolvedOut?.push(cleanLabel);
    const decision = setup.policies.work
      ? kind === "sponsorship" ? resolveSponsorship(setup.policies.work, { question: label, country, employmentType }) : resolveWorkAuthorization(setup.policies.work, { question: label, country, employmentType })
      : { status: "answer" as const, answer: kind === "sponsorship" ? setup.policies.sponsorship : setup.policies.workAuthorization, reason: "Legacy configured answer" };
    if (decision.status === "pause") { unresolved.push(`${label.trim()}: ${decision.reason}`); continue; }
    if (decision.status === "not_applicable") { unresolved.push(`${label.trim()}: ${decision.reason}`); continue; }
    const value = decision.answer ?? "";
    if (await field.evaluate((element) => element.tagName === "SELECT")) {
      const option = field.locator("option").filter({ hasText: new RegExp(`^${value}$`, "i") }).first();
      if (await option.count()) await field.selectOption({ label: await option.textContent() ?? value });
      else unresolved.push(`${label.trim()}: no matching option for ${value}`);
    } else await field.fill(value);
  }
  return unresolved;
}

export async function unresolvedPolicyFields(page: Page, scope: FormScope, setup: Setup): Promise<string[]> {
  if (!setup.policies.work) return [];
  const unresolved: string[] = [];
  for (const field of await scope.locator("input, select, textarea").all()) {
    if (!await field.isVisible().catch(() => false)) continue;
    const question = `${await field.locator("xpath=ancestor::label[1]").textContent({ timeout: 1000 }).catch(() => "") ?? ""} ${await field.getAttribute("aria-label", { timeout: 1000 }).catch(() => "") ?? ""} ${await field.getAttribute("name", { timeout: 1000 }).catch(() => "") ?? ""}`;
    if (/work authorization|authorized to work/i.test(question)) {
      const decision = resolveWorkAuthorization(setup.policies.work, { question, country: inferCountry(question), employmentType: inferEmploymentType(question) });
      if (decision.status === "pause") unresolved.push(question.trim());
    }
    if (/sponsor|sponsorship/i.test(question)) {
      const decision = resolveSponsorship(setup.policies.work, { question, country: inferCountry(question), employmentType: inferEmploymentType(question) });
      if (decision.status === "pause") unresolved.push(question.trim());
    }
  }
  return unresolved;
}

function inferCountry(question: string): string | undefined {
  const match = question.match(/\b(Nigeria|United States|USA|United Kingdom|UK|Canada|Australia|Germany|France)\b/i);
  return match?.[1] === "USA" ? "United States" : match?.[1] === "UK" ? "United Kingdom" : match?.[1];
}

function inferEmploymentType(question: string): "employee" | "contractor" | "unknown" {
  return /contractor|freelance|independent consultant/i.test(question) ? "contractor" : "employee";
}

export async function unresolvedRequiredControls(scope: FormScope): Promise<string[]> {
  const unresolved: string[] = [];
  for (const field of await scope.locator("input[required], input[aria-required='true'], select[required], select[aria-required='true'], textarea[required], textarea[aria-required='true']").all()) {
    if (!await field.isVisible().catch(() => false)) continue;
    const valid = await field.evaluate((element) => {
      const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (input instanceof HTMLInputElement && input.type === "file") return Boolean(input.files?.length);
      if (input instanceof HTMLInputElement && input.type === "radio") {
        const group = input.name ? Array.from((input.form ?? document).querySelectorAll<HTMLInputElement>(`input[name="${input.name}"]`)) : [input];
        return group.some((radio) => radio.checked);
      }
      if (input instanceof HTMLInputElement && input.type === "checkbox") return input.checked;
      return Boolean(input.value);
    });
    if (!valid) unresolved.push(await field.getAttribute("aria-label") || await field.getAttribute("name") || "required field");
  }
  return unresolved;
}

export async function clickNext(scope: FormScope): Promise<boolean> {
  const next = scope.getByRole("button", { name: /next|continue/i }).first();
  if (await next.count() && await next.isVisible().catch(() => false)) { await next.click(); await sleep(150); return true; }
  return false;
}

export async function clickSubmit(scope: FormScope): Promise<boolean> {
  const submit = scope.getByRole("button", { name: /submit application|submit/i }).last();
  if (await submit.count() && await submit.isVisible().catch(() => false)) { await submit.click(); await sleep(250); return true; }
  return false;
}

export async function waitForConfirmation(page: Page, signals: RegExp[], timeoutMs = 10000, scope?: FormScope): Promise<{ confirmed: boolean; text: string }> {
  const deadline = Date.now() + timeoutMs;
  const readText = async () => [await pageSnapshot(page), ...(scope ? [await pageSnapshot(scope)] : [])].join("\n");
  while (Date.now() < deadline) {
    const text = await readText();
    const formsGone = await page.locator("form").count() === 0 && (!scope || await scope.locator("form").count() === 0);
    if (formsGone && signals.some((signal) => signal.test(text))) return { confirmed: true, text };
    await sleep(250);
  }
  return { confirmed: false, text: await readText() };
}

