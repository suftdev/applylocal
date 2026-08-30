# 🎯 ApplyLocal

> **Your evidence-backed job application copilot — local, human-in-the-loop, and honest.**

```bash
npm install -g applylocal
```

- ✅ **Evidence-backed** — answers come only from claims you extracted and approved from your own resume and documents. An employer's "don't use AI" question is left untouched for you.
- 🤝 **Human where it matters** — login, MFA, captcha, legal declarations, and salary questions always pause for you. Nothing is submitted without your review.
- 🔌 **Provider-agnostic** — Anthropic, OpenAI, Google, Vercel AI Gateway, or any OpenAI-compatible endpoint (b.ai, Groq, Together, OpenRouter, ...).
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

# 3. Apply to a direct job URL
applylocal apply https://jobs.lever.co/company/job-id --mode assist

# 4. Review the filled form in the visible browser window, then submit
applylocal runs continue <run-id>
```

## 🧰 Commands

| Command | What it does |
|---|---|
| `applylocal apply <url> --mode assist` | Opens the job, fills what it can, pauses for your review |
| `applylocal runs list` / `runs show <id>` | Inspect runs |
| `applylocal runs continue <id>` | Rescans the live session and submits after review |
| `applylocal attention list` / `resolve <id>` | Handle questions the tool refused to answer |
| `applylocal applications` | Your local ledger of confirmed submissions |
| `applylocal doctor` | Verify environment health |
| `applylocal models` / `provider-test` | List provider models / verify credentials |

`--mode auto-apply` submits without the final review pause. Assist is the default and recommended.

## 🔑 Credentials

Setup verifies your provider key with a live call. Keep it in `~/.config/applylocal/env` so every run picks it up:

```bash
mkdir -p ~/.config/applylocal && chmod 700 ~/.config/applylocal
echo 'ANTHROPIC_API_KEY=sk-...' > ~/.config/applylocal/env
chmod 600 ~/.config/applylocal/env
```

## 🔒 Privacy

State lives locally in `~/.local/share/applylocal`. Only explicitly registered evidence is read, and only the parts relevant to the current question are sent to your configured provider. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## 🛠️ Development

```bash
npm install
npm run check   # typecheck
npm test        # fixture test suite
npm run build
```

MIT — see [LICENSE](LICENSE).
