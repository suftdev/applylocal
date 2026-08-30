import { confirm, input, select } from "@inquirer/prompts";
import { access, mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { loadState, saveState, Setup, setupMissing } from "./core.js";
import { choosePath } from "./paths.js";
import { listModels, testProvider } from "./reasoning.js";
import { WorkPolicy } from "./policy.js";

async function detectedEnvNames(): Promise<string[]> {
  try {
    const text = await readFile(join(homedir(), ".config", "applylocal", "env"), "utf8");
    return [...new Set(text.split("\n").map((line) => (line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/) ?? [])[1]).filter((name): name is string => Boolean(name)))];
  } catch {
    return [];
  }
}

const validateEnvName = (value: string) => {
  const trimmed = value.trim();
  if (/^(sk-|key-|cq-)/i.test(trimmed) || /^[A-Za-z0-9_-]{32,}$/.test(trimmed)) return "That looks like the key itself. Enter the VARIABLE NAME (for example BAI_API_KEY); the key value belongs in ~/.config/applylocal/env";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return "Enter an environment variable name like BAI_API_KEY";
  return true;
};

async function chooseCredentialVar(defaultName: string, previousName?: string): Promise<string> {
  const detected = (await detectedEnvNames()).filter((name) => name !== defaultName && name !== previousName);
  const choices = [
    ...(previousName ? [{ name: `${previousName} (current)`, value: previousName }] : []),
    { name: `${defaultName}${process.env[defaultName] || detected.includes(defaultName) ? " (from ~/.config/applylocal/env)" : ""}`, value: defaultName },
    ...detected.map((name) => ({ name: `${name} (from ~/.config/applylocal/env)`, value: name })),
    { name: "Enter a different variable name", value: "__manual__" },
  ];
  const choice = await select({ message: "Credential environment variable", choices });
  return choice === "__manual__" ? (await input({ message: "Environment variable name", validate: validateEnvName })).trim() : choice;
}

async function chooseReasoning(previous?: Setup): Promise<Setup["reasoning"]> {
  const provider = await select({ message: "AI provider", choices: [{ name: "Anthropic", value: "anthropic" as const }, { name: "OpenAI", value: "openai" as const }, { name: "Google", value: "google" as const }, { name: "Vercel AI Gateway", value: "gateway" as const }, { name: "Other provider (OpenAI-compatible: b.ai, Groq, Together, OpenRouter, ...)", value: "openai-compatible" as const }] });
  const defaults: Record<Setup["reasoning"]["provider"], [string, string]> = { anthropic: ["claude-sonnet-4-5", "ANTHROPIC_API_KEY"], openai: ["gpt-5", "OPENAI_API_KEY"], google: ["gemini-2.5-pro", "GOOGLE_GENERATIVE_AI_API_KEY"], gateway: ["anthropic/claude-sonnet-4.5", "AI_GATEWAY_API_KEY"], "openai-compatible": ["", "CUSTOM_API_KEY"] };
  const [defaultModel, defaultEnv] = defaults[provider];
  let baseUrl: string | undefined;
  let defaultName = defaultEnv;
  if (provider === "openai-compatible") {
    baseUrl = await input({ message: "API base URL (must end with /v1)", default: previous?.reasoning?.baseUrl ?? "", validate: (value) => /^https:\/\/.+/.test(value) || "Enter an https base URL, for example https://api.b.ai/v1" });
    defaultName = `${new URL(baseUrl).hostname.replace(/^(api|gateway)\./, "").replace(/\./g, "").toUpperCase()}_API_KEY`;
  }
  const sameProvider = previous?.reasoning?.provider === provider ? previous.reasoning.credentialEnv : undefined;
  const credentialEnv = await chooseCredentialVar(defaultName, sameProvider);
  let model: string;
  let models: string[] = [];
  try {
    models = (await listModels({ type: "provider", provider, model: "", credentialEnv, baseUrl })).filter((id) => !/(embed|whisper|tts|dall|moderation|image)/i.test(id)).slice(0, 40);
  } catch {
    /* listing is optional; manual entry follows */
  }
  if (models.length) {
    const choice = await select({ message: "Model", choices: [...models.map((id) => ({ name: id, value: id, description: undefined as string | undefined })), { name: "Enter a model ID manually", value: "__manual__", description: undefined }] });
    model = choice === "__manual__" ? await input({ message: "Model ID", default: previous?.reasoning?.model ?? defaultModel }) : choice;
  } else {
    model = await input({ message: "Model ID", default: previous?.reasoning?.model ?? defaultModel, validate: (value) => value.trim().length > 0 || "Enter the model ID from your provider's documentation" });
  }
  const reasoning: Setup["reasoning"] = { type: "provider", provider, model, credentialEnv, ...(baseUrl ? { baseUrl } : {}) };
  let verified = false;
  while (!verified) {
    try {
      await testProvider(reasoning);
      verified = true;
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
      const retry = await confirm({ message: "Fix the credential and try again?", default: true });
      if (!retry) throw new Error("Provider verification failed. Setup is incomplete.");
      reasoning.credentialEnv = await chooseCredentialVar(reasoning.credentialEnv);
    }
  }
  console.log(`Provider verified: ${provider} ${model}`);
  return reasoning;
}

export async function runReasoningSetup(): Promise<Setup> {
  const state = await loadState();
  if (!state.setup) throw new Error("Run applylocal setup first.");
  state.setup.reasoning = await chooseReasoning(state.setup);
  state.setup.complete = setupMissing(state).length === 0;
  await saveState(state);
  return state.setup;
}

export async function runSetup(): Promise<Setup> {
  const state = await loadState();
  const previous = state.setup;
  const name = await input({ message: "Full name", default: previous?.candidate.name });
  const email = await input({ message: "Email", default: previous?.candidate.email, validate: (value) => /\S+@\S+\.\S+/.test(value) || "Enter a valid email address" });
  const phone = await input({ message: "Phone (optional)", default: previous?.candidate.phone });
  const defaultResume = await choosePath("file", "Choose your default resume", previous?.defaultResume);
  const browserProfile = await input({ message: "Browser profile", default: previous?.browserProfile ?? resolve(homedir(), ".local", "share", "applylocal", "browser"), validate: async (value) => { try { await mkdir(resolve(value), { recursive: true }); return true; } catch { return "Browser profile directory is not writable"; } } });
  const mode = await select({ message: "Default application mode", default: previous?.mode ?? "assist", choices: [{ name: "Auto apply", value: "auto-apply" as const }, { name: "Assist", value: "assist" as const }] });
  const reasoning = await chooseReasoning(previous);
  const currentCountry = await input({ message: "Where are you currently based? (Example: Nigeria)", default: previous?.policies.work?.currentCountry ?? "Nigeria" });
  const authorizedCountries = await input({ message: "Which countries can you legally work in? Separate countries with commas.", default: previous?.policies.work?.authorizedCountries.join(", ") ?? currentCountry });
  const outsideAuthorized = await select({ message: "For an employee role outside those countries, what should ApplyLocal do?", choices: [{ name: "Answer No, I am not currently authorized", value: "not_authorized" as const }, { name: "Pause and ask me", value: "pause" as const }] });
  const sponsorshipOutsideAuthorized = await select({ message: "For an employee role outside those countries, do you need sponsorship?", choices: [{ name: "Answer Yes, I need sponsorship", value: "required" as const }, { name: "Answer No, I do not need sponsorship", value: "not_required" as const }, { name: "Pause and ask me", value: "pause" as const }] });
  const contractor = await select({ message: "For contractor or freelance roles, how should employee authorization be handled?", choices: [{ name: "Not applicable", value: "not_applicable" as const }, { name: "Pause and ask me", value: "pause" as const }] });
  const unknown = "pause" as const;
  const work: WorkPolicy = { currentCountry, authorizedCountries: authorizedCountries.split(",").map((country) => country.trim()).filter(Boolean), outsideAuthorized, sponsorshipOutsideAuthorized, contractor, unknown };
  const workAuthorization = "policy";
  const sponsorship = "policy";
  const salary = await select({ message: "Salary questions: use a saved answer or ask each time?", choices: [{ name: "Pause and ask", value: "pause" as const }, { name: "Use an explicitly registered answer", value: "answer" as const }] });
  const setup: Setup = { complete: false, candidate: { name, email, phone: phone || undefined }, browserProfile: resolve(browserProfile), defaultResume: defaultResume ? resolve(defaultResume) : undefined, mode, reasoning, policies: { workAuthorization, sponsorship, salary, work } };
  if (setup.defaultResume) await access(setup.defaultResume);
  console.log("\nPolicy preview:");
  console.log(`- ${currentCountry} employee role: authorized`);
  console.log(`- Employee roles outside ${authorizedCountries}: ${outsideAuthorized === "pause" ? "pause" : "answer not authorized"}`);
  console.log(`- Sponsorship outside ${authorizedCountries}: ${sponsorshipOutsideAuthorized === "required" ? "answer sponsorship required" : sponsorshipOutsideAuthorized === "pause" ? "pause" : "answer sponsorship not required"}`);
  console.log(`- Contractor or freelance role: ${contractor === "not_applicable" ? "not applicable" : "pause"}`);
  if (mode === "auto-apply") await confirm({ message: "Enable auto-apply with these policies?", default: false }).then((approved) => { if (!approved) setup.mode = "assist"; });
  state.setup = setup;
  setup.complete = setupMissing(state).length === 0;
  await saveState(state);
  return setup;
}
