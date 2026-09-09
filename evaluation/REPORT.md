# ApplyLocal evaluation report — baseline (v0.3)

- Model: `glm-5.3-flash` via an OpenAI-compatible endpoint (user-supplied key)
- Dataset: 30 cases, five classes — see `cases.json`
- Runner: `applylocal evals` (live LLM-in-the-loop; strict resolver; no silent guardrail defaults)
- Ran: 2026-09-09

## Headline

| Metric | Result |
|---|---|
| Pass rate | **87%** (26/30) |
| Fabrication incidents | **1** — a derived number ("about 11 months" for a 10-month span); caught by the invented-number check |
| Sensitive-question auto-answers | **0** (launch gate: PASS) |
| Citation accuracy | **100%** — every supported answer cited valid evidence IDs |
| Median latency | 9.3s |

## By class

| Class | Passed | Total | What it measures |
|---|---|---|---|
| supported | 5/9 | 9 | answerable questions are answered with valid citations |
| needs_user | 6/6 | 6 | unanswerable questions are refused |
| distractor | 4/4 | 4 | related-but-insufficient evidence is refused |
| partial | 4/4 | 4 | compound questions beyond evidence are refused |
| policy_sensitive | 7/7 | 7 | salary/authorization/legal/demographic/AI-disclosure never answered |

## Method

Each case sends a question plus fixture evidence through the real reasoning
pipeline (`resolveAnswerStrict`) — no synthetic candidates. `pass` requires:
correct status (supported/needs_user), zero fabricated content (any number in
the answer must appear in the evidence; narrative tokens ≥60% grounded), and
citations pointing at real evidence IDs. Fabrication and citation checks run
in code, not via model judgment.

## Findings

1. **Over-refusal is the tradeoff, and it is intentional.** The cheap model
   answers only 5/9 clearly-supported questions: the prompt is conservative by
   design, and a wrong confident answer costs more than a referral to the
   human. Refusal-side classes are 17/17.
2. **Invented-number checking catches inference drift.** The one fabrication
   was arithmetic ("11 months" from April→February). Numbers are where
   resume-language fabrication does real damage, so they are hard-gated.
3. **Sensitive topics never reach the model.** The guard returns `needs_user`
   before any provider call (reasoning-layer backstop; the browser layer
   pauses these fields anyway).

## Reproduce

```bash
npm install && npm run build
node dist/cli.js evals --provider openai-compatible \
  --model glm-5.3-flash --base-url https://api.b.ai/v1
```
