# 🎯 ApplyLocal

> **Your evidence-backed job application copilot — local, human-in-the-loop, and honest.**

```bash
npm install -g applylocal
```

Run `applylocal` with no arguments for the **interactive dashboard** — live status, a numbered action menu, inline claim review, and a continue flow that resolves blockers with you step by step.

- ✅ **Evidence-backed** — answers come only from claims you extracted and approved from your own resume and documents. An employer's "don't use AI" question is left untouched for you. A runtime gate downgrades any answer the model cannot ground in your evidence.
- 🤝 **Human where it matters** — login, MFA, captcha, legal declarations, and salary questions always pause for you. Nothing is submitted without your review.
- 🔌 **Provider-agnostic** — Anthropic, OpenAI, Google, Vercel AI Gateway, or any OpenAI-compatible endpoint (b.ai, Groq, Together, OpenRouter, ...), with live model listing during setup.
- 🌐 **Works on** — Lever, Greenhouse, Ashby, Workday, Workable, plus a generic fallback. Linux, Node 20+.

## 📦 Install

```bash
npm install -g applylocal
```

## ⚡ Quickstart

```bash
# 1. One-time setup: candidate info, AI provider + API key, work policies
applylocal setup

# 2. Register evidence and approve its claims
applylocal evidence add ~/Documents/Your_Resume.pdf
applylocal evidence claims list
applylocal evidence claims approve <claim-id>

# 3. Apply to a direct job URL — or just run applylocal and pick from the menu
applylocal apply https://jobs.lever.co/company/job-id --mode assist

# 4. Review the filled form in the visible browser window, then submit
applylocal runs continue <run-id>
```

## 🧰 Commands

| Command | What it does |
|---|---|
| `applylocal` | Interactive dashboard: status, apply, continue, review claims, resolve blockers |
| `applylocal apply <url> --mode assist` | Opens the job, fills what it can, pauses for your review |
| `applylocal runs continue <id>` | Rescans the live session and submits after review |
| `applylocal attention list` / `resolve <id>` | Handle questions the tool refused to answer |
| `applylocal applications` | Your local ledger of confirmed submissions |
| `applylocal doctor` | Verify environment health |
| `applylocal models` / `provider-test` | List provider models / verify credentials live |
| `applylocal evals` | Run the measured safety evaluation (fabrication, refusals, latency) |

Every command also accepts `--json` for scripts and agents.

## 🔑 Credentials

Setup verifies your provider key with a live call. Keep it in `~/.config/applylocal/env` so every run picks it up:

```bash
mkdir -p ~/.config/applylocal && chmod 700 ~/.config/applylocal
echo 'ANTHROPIC_API_KEY=sk-...' > ~/.config/applylocal/env
chmod 600 ~/.config/applylocal/env
```

## 🔒 Privacy

State lives locally in `~/.local/share/applylocal`. Only explicitly registered evidence is read, and only the parts relevant to the current question are sent to your configured provider. The `evals` command sends only synthetic fixtures, never your evidence. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## 🛠️ Development

```bash
npm install
npm run check   # typecheck
npm test        # fixture test suite
npm run build
```

MIT — see [LICENSE](LICENSE). Full changelog in [CHANGELOG.md](CHANGELOG.md).
