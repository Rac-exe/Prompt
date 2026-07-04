# PRMPT CLI Investability Report

Date: July 4, 2026  
Product evaluated: PRMPT CLI, a retrieval-native standalone coding agent for large repositories.

## Executive Verdict

PRMPT is technically interesting but not yet investable in the strong VC sense. It is currently a credible prototype with unusually honest benchmark work, not yet a company people should rush to fund.

The investable version is not "a cheaper Claude Code." That story is weak because Claude Code, Cursor, and Codex own distribution, trust, and workflow. The investable version is:

> PRMPT is the retrieval-native agent runtime for teams running high-volume AI coding workflows on large private repos, where wrong-file exploration, repeated repo discovery, and token waste are measurable costs.

Current harsh score: **5.8/10**.

Probable but not investable yet. To become investable, PRMPT needs proof from real users, real repos, and repeated tasks showing equal or better task success with 30%+ lower net token/cost on a meaningful share of workflows.

## What We Have

### 1. A Clearer Product Direction

The pivot away from desktop overlay, app, prompt library, MCP plugin, and generic prompt optimizer is correct. The current CLI direction is much sharper:

- Standalone CLI used instead of Claude Code/Codex.
- Built on a coding-agent loop.
- Has a native `prmpt_retrieve` tool.
- Retrieves relevant files and line ranges before editing.
- Measures tokens, retrieval calls, files touched, elapsed time, and test result.

This is a better venture wedge than the original overlay/app idea. The old product was broad and confusing. The CLI pivot is narrow enough to test.

Score: **7/10**

### 2. Real Technical Prototype

Current implementation is not vaporware. The repo contains:

- `prmpt-cli/src/index.ts`: Pi SDK based CLI agent wrapper.
- `prmpt-cli/src/prmpt-extension.ts`: live `prmpt_retrieve` tool calling `POST /api/context`.
- Code intelligence service for indexing, retrieval, summaries, embeddings, and graph-aware context.
- Benchmark harnesses for Claude Code vs PRMPT CLI vs optimized PRMPT.
- Warm-session benchmark runner.
- Usage/cost accounting artifacts.

This is materially better than most pre-seed AI tool ideas.

Score: **8/10**

### 3. Benchmark Signal

Current strongest numbers:

| Benchmark | Result |
|---|---:|
| Hardened 3-repeat PRMPT C vs Claude Code | 67.7% fewer total tokens |
| PRMPT C pass rate | 25/27 |
| Claude Code pass rate | 26/27 |
| PRMPT B token saving vs Claude Code | 53.2% fewer tokens |
| PRMPT B pass rate | 24/27 |
| Warm-session PRMPT B | 27/27, 34.7% fewer tokens |
| Warm-session PRMPT C | 25/27, 66.9% fewer tokens |

This is a real signal. It is not enough to claim victory.

The hard caveat: the best Arm C result averaged only `0.07` retrieval calls. That means the best savings are not yet proof that live retrieval is the main cause. They are proof that PRMPT's agent/prompt/context discipline can reduce tokens. Arm B tests retrieval more directly, but has reliability weakness in the hardened run.

Score: **6/10**

### 4. Honest Internal Learning

The repo and prior reports show the right kind of founder behavior:

- You tested against Claude/Codex/Cursor instead of only talking.
- You tracked token/cost and pass rate.
- You admitted when PRMPT was additive overhead.
- You noticed Claude Code is already strong.
- You moved away from MCP/plugin positioning.

That honesty is a strength. Investors like founders who can kill weak directions quickly.

Score: **8/10**

## What Is Missing

### 1. Real User Pull

There is no proof yet that developers want to switch their coding agent. This is the biggest missing piece.

Benchmarks prove technical possibility. They do not prove demand. A developer who already uses Claude Code or Cursor may say:

- "Cool, but Claude works."
- "I pay a subscription, so tokens do not matter."
- "I do not want another CLI."
- "Reliability matters more than savings."

Missing proof:

- 5-10 external users running PRMPT on their own repos.
- Repeat usage without you pushing them.
- Users asking for private repo support.
- Users willing to pay.
- Users saying they would be disappointed if PRMPT disappeared.

Score: **3/10**

### 2. Narrow ICP Proof

The current ICP is still too broad if stated as "developers." The likely ICP is:

> AI-forward engineering teams with large private repos, usage-based agent spend, and enough agent volume that context waste becomes a real budget/reliability problem.

Missing proof:

- Which customer has the pain weekly?
- Who has the budget?
- Who owns the decision?
- What is their current workaround?
- How much do they currently spend on coding agents?
- What dollar amount would make them switch?

Score: **4/10**

### 3. Reliability

Coding agents are judged brutally. A 30-60% token saving is not valuable if pass rate drops.

The investable bar:

- Reliable/default mode must match Claude/Cursor task success.
- Aggressive mode can be optional, but not the headline.
- The product should show when retrieval is uncertain.
- Failed tasks should generate useful diagnostics, not just cheaper failures.

Current score: **5/10**

### 4. Differentiated Moat

Right now the moat is implementation effort. That is weak.

Things incumbents can copy:

- Repo indexing.
- Retrieval before editing.
- Better prompt policy.
- Token accounting.
- Context cache.
- Semantic search.

Possible real moats:

- Proprietary eval set of real coding-agent tasks across real repos.
- Retrieval logs and failure data from many teams.
- Context engine that improves from usage.
- Enterprise trust layer for private codebases.
- Deployment model for CI/background coding agents.
- Better benchmark and observability layer for AI engineering managers.

Current score: **4/10**

### 5. Distribution

This is the weakest part.

Competing head-on with Claude Code/Cursor is bad distribution. They are already installed, trusted, integrated, and improving fast.

Better distribution wedges:

- Sell to teams running many agent jobs.
- Sell to AI devtools companies as infrastructure.
- Sell to engineering managers who want agent observability/cost control.
- Sell to enterprises where private repo indexing and auditability matter.
- Start with "benchmark your agent waste" before asking users to switch agents.

Current score: **3/10**

## The Real Problem To Validate

Do not ask users: "Would you use a retrieval-native coding agent?"

Ask them:

- "How often does your coding agent read the wrong files?"
- "Do you know your AI coding bill?"
- "What was the last agent run that wasted time?"
- "Do you manually tell the agent which files to inspect?"
- "Have you built any internal repo docs, Cursor rules, AGENTS.md, or scripts to help agents navigate?"
- "Would you pay to reduce failed/wasteful agent runs?"

Strong validation means users already cobble together solutions.

Examples of good current workarounds:

- Repo maps.
- Hand-written `AGENTS.md`.
- Cursor rules.
- Internal docs for agents.
- Preselected file lists.
- CI scripts that gather context.
- Manual file hints before every task.
- Paying for high agent token bills and complaining about it.

If users are not already doing any workaround, this may be a vitamin.

## From Probable To Investable

### Stage 0: Current State

Status: **Probable technical insight, weak market proof.**

You can say:

> We have a working prototype and benchmark signal that PRMPT can reduce token usage while preserving near-baseline correctness in controlled tasks.

You cannot honestly say:

> Developers are switching to PRMPT.

You also cannot honestly say:

> Retrieval alone is the proven reason for the savings.

### Stage 1: Investor-Interesting

Goal: move from 5.8/10 to 7/10.

Evidence required:

- 10 real tasks from 5 external users.
- At least 3 different real repos.
- Baseline comparison against their normal agent.
- PRMPT equal success on at least 8/10 tasks.
- 30%+ token/cost saving on at least 6/10 tasks.
- At least 2 users ask to keep using it.
- At least 1 user willing to pay or sign LOI.

This makes the idea investor-interesting.

### Stage 2: Investable

Goal: move to 8/10.

Evidence required:

- 10-20 active design partners.
- 50-100 real evaluated tasks.
- Clear ICP: for example, "AI-heavy Series A/B devtools teams with 100k+ line repos."
- Repeat usage without founder handholding.
- Paid pilots or signed LOIs.
- Clear reliability story: default mode preserves correctness.
- Clear distribution wedge: benchmarking/cost-control, not direct "replace Claude Code" pitch.
- Credible reason incumbents do not instantly erase you.

This becomes investable.

### Stage 3: Seed-Worthy

Goal: 9/10.

Evidence required:

- $5k-$20k MRR or paid pilots.
- At least 3 teams using PRMPT weekly.
- Strong retention or usage expansion.
- Case studies with concrete savings.
- Security/private repo story.
- Multi-language support beyond benchmark JS.
- Install/onboarding that does not require founder involvement.
- Fundraising story that leads to a venture-scale company, not just a utility.

## Recommended Fundraising Strategy

### Do Not Raise A Big Seed Yet

A $1.5M-$3M seed round right now would be hard unless the founder signal is exceptional or there is a strong warm network. The company does not yet have enough customer proof.

The right first raise is small and evidence-driven.

### Best Initial Funding Options

Option A: Accelerator first  
Best if accepted into YC, SPC, Neo, PearX, HF0, AI Grant, or Heavybit.

Option B: Small angel/pre-seed SAFE  
Raise **$150k-$300k** to fund 4-6 months of validation.

Option C: Tiny pilot-funded path  
Get 3 paid pilots at `$1k-$5k` each and use that to raise a stronger round.

### Recommended Ask Today

If raising before real users:

- Ask: **$150k-$250k**
- Instrument: SAFE
- Valuation cap: **$3M-$6M**
- Use: 4-6 months to prove real user pull
- Story: "We are not raising to scale. We are raising to buy proof."

If raising after 5 real design partners and 30+ evaluated tasks:

- Ask: **$500k-$750k**
- Instrument: SAFE
- Valuation cap: **$6M-$10M**
- Use: 9-12 months to convert pilots into paid teams and harden product

If accepted into YC or equivalent:

- Take the standard accelerator deal.
- Use the program to create investor urgency.
- Raise after Demo Day only if you have design partner proof.

### Budget For A $250k Validation Round

| Use | Amount | Why |
|---|---:|---|
| Model/API/benchmark credits | $35k | Run real tasks, baselines, retries, multi-model tests |
| Cloud/indexing/storage/security | $20k | Private repo pilots and hosted/on-prem testing |
| Founder living/runway | $90k | 6-9 months basic survival for 1-2 founders depending location |
| Pilot support/infra/user onboarding | $25k | Hands-on onboarding, logging, debugging |
| Contractors for packaging/security/docs | $30k | CLI install, docs, auth, private repo security review |
| Travel/network/customer discovery | $15k | Meet devtools founders, SF/AI events if needed |
| Legal/accounting/company setup | $15k | SAFE, incorporation, basic compliance |
| Buffer | $20k | Everything takes longer |

Total: **$250k**

### What This Money Must Produce

By the end of the validation round:

- 10+ design partners.
- 100+ real task comparisons.
- 3+ paid pilots or LOIs.
- Clear ICP.
- Public/private benchmark report.
- Working installable CLI.
- Security story for private repos.
- Fundraising memo for institutional seed.

If the money does not produce those proof points, do not raise more. Pivot or shut it down.

## Immediate Next Steps

### Next 7 Days

1. Rewrite positioning:
   - Remove/mark old overlay/app docs as legacy.
   - README should only say PRMPT CLI.
   - Headline: "Retrieval-native coding agent for large repos."

2. Create one-page memo:
   - Problem.
   - Current evidence.
   - ICP.
   - Benchmark result.
   - What you need to prove next.

3. Create 90-second demo:
   - Baseline agent explores repo.
   - PRMPT retrieves relevant files.
   - PRMPT edits.
   - Tests pass.
   - Token/cost comparison printed.

4. Build target list of 50 design partners:
   - Devtools founders.
   - AI-heavy engineering teams.
   - Large TypeScript/Python repo maintainers.
   - Teams visibly using Claude Code/Cursor.

5. Start 20 customer discovery conversations.

### Next 14 Days

1. Run 10 external tasks manually.
2. Track:
   - task description
   - repo size
   - baseline agent
   - PRMPT mode
   - pass/fail
   - tokens
   - cost
   - time
   - files touched
   - user qualitative feedback
3. Charge at least one person something, even if small.
4. Apply to open accelerators.

### Next 30 Days

1. Turn the harness into a user-facing "agent waste audit."
2. Support one-command indexing.
3. Improve reliable mode.
4. Add install docs.
5. Build a private pilot package.
6. Start investor updates.

## Investor Narrative

Bad pitch:

> PRMPT is a cheaper Claude Code.

Better pitch:

> Coding agents are becoming the default engineering interface, but they waste expensive context rediscovering large codebases every session. PRMPT is a retrieval-native coding agent that indexes the repo before the run and gives the agent exact file/line context before editing. In early benchmarks, our reliable mode matched task success while reducing tokens by about one-third in warm sessions. We are now validating this on real private repos with teams that run agents daily.

Best pitch after proof:

> Teams using coding agents at scale need an agent runtime that is cost-aware, repo-aware, and auditable. PRMPT reduces agent context waste and wrong-file exploration on large private repos. Across X real tasks from Y teams, PRMPT matched baseline task success while reducing net token usage by Z%, and N teams converted to paid pilots.

## What Investors Will Ask

Prepare direct answers:

1. Why will developers switch from Claude Code/Cursor?
2. Why will Anthropic/OpenAI/Cursor not build this?
3. Is token cost painful enough to pay for?
4. Does retrieval improve correctness or only reduce cost?
5. What is the ICP?
6. What happens when context windows become huge?
7. Can this work across languages?
8. Can enterprises trust you with private code?
9. What is the wedge into distribution?
10. Why are you the team to win?

Current honest answers are incomplete. That is fine, but do not bluff.

## VC And Accelerator Target List

Notes:

- "Apply path" means there is a public application or intake route.
- "Warm intro" means do not rely on a generic contact form. Find a partner, portfolio founder, scout, or operator intro.
- Only emails visible in public sources are listed. Do not invent email addresses.
- Links should be checked again before applying because program deadlines change.

### Highest Fit: Apply Immediately

| Investor / Program | Fit | Apply / Contact | How To Position |
|---|---:|---|---|
| Y Combinator | 10/10 | https://www.ycombinator.com/apply | "AI coding agents waste repo context; PRMPT is retrieval-native Claude Code for large repos." |
| HF0 | 9/10 | https://www.hf0.com/apply | Technical founder, intense build sprint, clear 12-week goal: 10 pilots and 100 real tasks. |
| South Park Commons Founder Fellowship | 9/10 | https://www.southparkcommons.com/founder-fellowship/ | Strong if framed as an illegible but huge agent infrastructure company. |
| Neo Accelerator | 9/10 | https://neo.com/accelerator | Strong devtools/AI fit; mention Cursor was Neo-backed only if relevant, not as name-dropping. |
| PearX | 8/10 | https://pear.vc/pearx-application/ | Pre-seed, technical product, needs PMF help and investor network. |
| AI Grant | 8/10 | https://aigrant.com/ | AI-native product, technical builder, compute/API cost need. |
| Sequoia Arc | 8/10 | https://www.sequoiacap.com/arc | Only apply if memo is sharp. They will push hard on market and why now. |
| Afore Alpha | 8/10 | https://www.afore.vc/afore-alpha | Pre-seed, raw but ambitious. Good for first institutional check. |
| Afore Founder-in-Residence | 7/10 | http://afore.vc/residence | Good if still ideating around exact ICP/wedge. Public email from page: laura@afore.vc for FIR help. |
| NFX FAST | 7/10 | https://fast.nfx.com/fast | Strong if you can argue network/data effects from agent telemetry. |
| Village Global Velocity | 7/10 | https://www.villageglobal.com/velocity/apply | Broad pre-seed fit. Public email: hello@villageglobal.com |
| Heavybit | 8/10 | https://www.heavybit.com/ | Excellent devtools/infrastructure fit. Use website application/contact and seek warm intro. |
| Alchemist Accelerator | 7/10 | https://www.alchemistaccelerator.com/apply | B2B/enterprise angle. Public email: admissions@alchemistaccelerator.com |
| Forum Ventures | 7/10 | https://www.forumvc.com/accelerator | Good if pitched as B2B AI/devtools with pilots. |
| Soma Fellows | 7/10 | https://programs.somacap.com/fellows | Founder fellowship, possible uncapped early capital. |
| Antler | 6/10 | https://www.antler.co/apply | Useful if you need founder support, less ideal if you already have direction. Public email from FAQ PDF: applications@antler.co |
| Entrepreneur First | 6/10 | https://apply.joinef.com/ | Strong for solo/early founders, especially if cofounder needed. |
| Techstars | 6/10 | https://apply.techstars.com | Apply to AI/devtools/B2B programs only, not generic if avoidable. |
| 500 Global | 5/10 | https://500.co/apply-for-an-accelerator | Broad, less precise fit, but valid application route. |
| LAUNCH Accelerator | 5/10 | https://launch.co/apply | Better after some traction; wants real metrics. |
| Pioneers VC | 5/10 | https://thepioneer.vc/apply/ | Valid open application, but less obvious fit than YC/SPC/Neo. |

### Strong Devtools / AI Funds: Warm Intro Preferred

| Investor | Fit | Website | Approach |
|---|---:|---|---|
| Amplify Partners | 9/10 | https://www.amplifypartners.com/ | Devtools/infrastructure. Need warm intro and strong technical memo. |
| Boldstart Ventures | 8/10 | https://boldstart.vc/ | Enterprise infra and developer-first software. Warm intro. |
| Root Ventures | 8/10 | https://root.vc/ | Technical/deep infrastructure founders. Warm intro. |
| Engineering Capital | 8/10 | https://engineeringcapital.com/ | Deep technical infrastructure. Warm intro or precise cold memo. |
| OSS Capital | 8/10 | https://oss.capital/ | Strong if any open-source strategy exists. |
| Uncork Capital | 7/10 | https://www.uncorkcapital.com/ | Seed fund, devtools-adjacent. Warm intro. |
| First Round Capital | 7/10 | https://www.firstround.com/who-we-back | Best through portfolio founder/operator intro. |
| Initialized Capital | 7/10 | https://initialized.com/ | Seed, product/engineering founders. Email/warm intro. |
| Greylock | 7/10 | https://greylock.com/ | Strong AI/devtools fit but bar high. Warm intro after proof. |
| Bessemer Venture Partners | 7/10 | https://www.bvp.com/ | Devtools/cloud/AI history. Better after pilots. |
| Menlo Ventures | 7/10 | https://menlovc.com/ | AI/application layer fit. Warm intro. |
| Lightspeed | 7/10 | https://lsvp.com/ | AI/devtools possible. Needs proof. |
| Accel | 7/10 | https://www.accel.com/ | Devtools possible, likely after stronger traction. |
| General Catalyst | 6/10 | https://www.generalcatalyst.com/ | Later once story is bigger than token savings. |
| Conviction | 7/10 | https://www.conviction.com/ | AI-native focus; very high bar. Warm intro. |
| Gradient Ventures | 7/10 | https://www.gradient.com/ | AI-focused, good fit after user proof. |
| Haystack | 7/10 | https://www.haystack.vc/ | Early-stage founder-friendly. Warm intro. |
| Moxxie Ventures | 6/10 | https://www.moxxie.vc/ | Seed, broad software. Warm intro. |
| S28 Capital | 7/10 | https://s28capital.com/ | Technical seed fund. Warm intro. |
| Costanoa Ventures | 7/10 | https://costanoa.vc/ | B2B infra/devtools. Warm intro. |
| Wing VC | 7/10 | https://wing.vc/ | Enterprise/AI infrastructure. Warm intro. |
| Work-Bench | 7/10 | https://www.work-bench.com/ | Enterprise GTM and buyers. Good if enterprise wedge emerges. |
| Emergence Capital | 6/10 | https://www.emcap.com/ | B2B software, better after revenue. |
| Bain Capital Ventures | 6/10 | https://baincapitalventures.com/ | AI/devtools possible, likely too early today. |
| Felicis | 6/10 | https://www.felicis.com/ | Broad high-conviction seed. Needs strong narrative. |
| Eniac Ventures | 6/10 | https://eniac.vc/ | Seed software/AI. Warm intro. |
| 1984 Ventures | 6/10 | https://www.1984.vc/ | Seed-stage software. Warm intro. |
| Garuda Ventures | 6/10 | https://www.garudavc.com/ | Early-stage, technical founders. Warm intro. |
| Mango Capital | 6/10 | https://www.mangocapitalinc.com/ | Infra/devtools history. Warm intro. |
| Essence VC | 6/10 | https://www.essencevc.fund/ | Early-stage software. Warm intro. |
| CRV | 6/10 | https://www.crv.com/ | Devtools history, but likely after traction. |
| Benchmark | 5/10 | https://www.benchmark.com/ | Too early unless extraordinary pull. |
| Khosla Ventures | 5/10 | https://www.khoslaventures.com/ | AI ambitious, but likely too early without traction. |

### India / Global Early-Stage Options

Useful if you are India-based or need accessible early capital.

| Investor / Program | Fit | Link | Approach |
|---|---:|---|---|
| Peak XV Surge | 8/10 | https://www.peakxv.com/surge/ | Strong if applications open; AI/devtools founder story can fit. |
| Accel Atoms | 7/10 | https://www.accel.com/atoms | India/SEA pre-seed program. Apply if cycle open. |
| Lightspeed Extreme Entrepreneurs | 6/10 | https://lsip.com/ | India/SEA founder program; check current applications. |
| Antler India | 6/10 | https://www.antler.co/apply | Founder residency route. |
| Entrepreneur First Bangalore | 6/10 | https://apply.joinef.com/ | Good if early and founder-led. |
| 100X.VC | 5/10 | https://www.100x.vc/ | India seed micro-VC; check application cycle. |
| Speciale Invest | 6/10 | https://www.specialeinvest.com/ | Deep tech/enterprise infra; warm intro. |
| Together Fund | 6/10 | https://www.together.fund/ | SaaS/devtools possible; warm intro. |

## Exact Application Order

### Batch 1: Apply Now

Do these first because they have structured applications and accept early founders:

1. YC
2. HF0
3. SPC Founder Fellowship
4. Neo Accelerator
5. PearX
6. AI Grant
7. Afore Alpha
8. NFX FAST
9. Village Global Velocity
10. Alchemist
11. Heavybit
12. Forum Ventures

### Batch 2: Warm Intro After First External Proof

Approach after 5-10 real user tasks:

1. Amplify
2. Boldstart
3. Root
4. Engineering Capital
5. OSS Capital
6. Uncork
7. First Round
8. Initialized
9. Haystack
10. Costanoa

### Batch 3: Only After Stronger Traction

Approach after paid pilots or strong investor pull:

1. Sequoia
2. Greylock
3. Bessemer
4. Menlo
5. Lightspeed
6. Accel
7. General Catalyst
8. Conviction
9. Gradient
10. Bain Capital Ventures

## What To Send Investors

### Subject Lines

Use one of:

- `Retrieval-native coding agent reducing large-repo agent tokens by 30%+`
- `PRMPT CLI: repo-aware coding agent for high-volume AI engineering teams`
- `Early benchmark: Claude-like task success with lower context waste`

### Cold Email Template

```text
Hi [Name],

I'm building PRMPT CLI, a retrieval-native coding agent for large repos.

The problem: coding agents waste expensive context rediscovering repo structure before editing. On large repos and repeated agent runs, this becomes real cost and reliability drag.

We built a standalone CLI agent with a native retrieval tool backed by a code-intelligence index. In warm-session benchmarks, our reliable mode matched baseline correctness at 27/27 while using 34.7% fewer tokens. A more aggressive mode cut 66.9% but still needs reliability work.

The honest caveat: we now need real-user proof. We're running private pilots with AI-heavy teams to compare PRMPT against their normal Claude/Codex/Cursor workflow on real tasks.

Would you be open to a 20-minute call? I can send the benchmark report and a 90-second demo.

[Name]
```

### Warm Intro Blurb

```text
[Founder] is building PRMPT CLI, a retrieval-native coding agent for large codebases. Instead of letting agents burn tokens discovering repo context, PRMPT pre-indexes the repo and gives the agent exact files/line ranges before editing. Early warm-session benchmark: reliable mode matched 27/27 correctness with 34.7% fewer tokens. They are looking for design partners and a small validation round to prove this on real private repos.
```

### Investor Memo Structure

Keep it to 2 pages:

1. One-line description.
2. Problem.
3. Why now.
4. Current product.
5. Benchmark evidence.
6. Honest caveats.
7. ICP.
8. What proof you are gathering.
9. Fundraise ask.
10. Founder-market fit.

## Fundraising Readiness Checklist

Do not start serious institutional outreach until these exist:

- [ ] Clean CLI-only README.
- [ ] 90-second demo video.
- [ ] One-page investor memo.
- [ ] 6-slide deck.
- [ ] External benchmark report.
- [ ] Design partner list.
- [ ] Security/private repo explanation.
- [ ] Install instructions.
- [ ] Clear ask: amount, instrument, runway, milestones.
- [ ] Weekly investor update template.

## Suggested Deck

Slide 1: PRMPT CLI  
Retrieval-native coding agent for large repos.

Slide 2: Problem  
Coding agents waste tokens/time rediscovering repo context and editing wrong files.

Slide 3: Product  
Index repo, retrieve exact file/line context, run agent, log tokens/tests.

Slide 4: Evidence  
Benchmark table with both good result and caveat.

Slide 5: ICP and GTM  
AI-heavy engineering teams, large repos, usage-based spend, agent workflows.

Slide 6: Ask  
Raising $250k to prove 10 design partners, 100 real tasks, 3 paid pilots.

## Harsh Final Assessment

This is fundable only if you stop selling the possibility and start selling proof.

Right now:

- Technical execution: strong.
- Benchmark discipline: promising.
- Market proof: weak.
- Distribution: weak.
- Moat: weak.
- Timing: strong.

Investors will not fund "maybe developers want cheaper Claude Code." They might fund:

> "We found a narrow group of teams running coding agents heavily. They already feel context waste. We ran 100 real tasks and saved 35-50% net cost without hurting success. Three teams are paying. We now need capital to productize the agent runtime and expand."

That is the target.

## 30-Day Operating Plan

### Week 1

- Clean docs.
- Create demo.
- Create investor memo.
- Build design partner list.
- Send 50 discovery messages.
- Apply to YC, HF0, SPC, Neo, PearX, AI Grant, Afore, NFX, Village.

### Week 2

- Run 5 real external tasks.
- Record all metrics.
- Fix install/indexing friction.
- Start investor update email list.
- Reach 10 more design partners.

### Week 3

- Run 10 more real tasks.
- Ask 3 users for paid pilot.
- Apply to Heavybit, Alchemist, Forum, Techstars if fit.
- Start warm intro requests to devtools funds.

### Week 4

- Publish/private-send "Real Repo Pilot Report v1."
- Decide:
  - if signal is strong, raise $250k
  - if signal is mixed, keep testing
  - if signal is weak, pivot to agent observability/context benchmarking

## The One Metric That Matters Next

Not GitHub stars. Not benchmark tokens. Not model demos.

The metric:

> Number of external real coding tasks where PRMPT matches success and reduces net token/cost by 30%+.

Target in 30 days: **20 tasks**.  
Target in 90 days: **100 tasks**.  
Investable threshold: **60-70% of real tasks show clear net advantage with no reliability loss.**

