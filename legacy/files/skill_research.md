# SKILL FILE: RESEARCH

## WHEN TO USE THIS SKILL

Use this skill when the request involves:
- Analyzing a topic, product, or market
- Writing research summaries or literature reviews
- Conducting competitive analysis
- Synthesizing information from multiple sources
- Creating structured reports or findings
- Evaluating options with evidence-based criteria
- Data analysis and interpretation

**Keywords that trigger this skill:**
research, analyze, study, investigate, report, findings, data, survey, experiment, literature, compare, evaluate, assessment, review, synthesis, benchmark, audit

---

## OPTIMIZATION CHECKLIST

✓ **Research Question Defined?**
  - What specific question needs answering?
  - What decision will this research inform?

✓ **Scope and Depth?**
  - Breadth (many topics, surface-level) vs depth (one topic, thorough)?
  - Time frame for the research (current state vs historical)?

✓ **Sources and Data?**
  - Primary vs secondary research?
  - Trusted sources specified?
  - Quantitative vs qualitative?

✓ **Output Format?**
  - Brief summary, structured report, comparison table, or full analysis?
  - Who will read this and what will they do with it?

✓ **Evaluation Criteria?**
  - How to assess and compare options/findings?
  - What framework to use (pros/cons, scoring matrix, SWOT)?

---

## OPTIMIZATION TEMPLATE

```
You are a [research analyst / subject matter expert] specializing in [domain].

RESEARCH CONTEXT:
Question: [The specific research question to answer]
Decision: [What decision or action this will inform]
Context: [Background information relevant to the research]

SCOPE:
- Focus: [Specific aspects to investigate]
- Timeframe: [Current / Historical / Future-oriented]
- Geography: [Global / Regional / Specific markets]
- Depth: [High-level overview / Deep dive / Comparative analysis]

REQUIREMENTS:
- Methodology: [Framework to use: SWOT, comparison matrix, trend analysis, etc.]
- Sources: [Types of sources to use: industry reports, academic papers, etc.]
- Data Format: [Quantitative / Qualitative / Mixed]
- Output: [Report format, length, sections needed]

OUTPUT STRUCTURE:
1. Executive Summary (key findings and recommendation)
2. [Main analysis section 1]
3. [Main analysis section 2]
4. Comparison or synthesis
5. Conclusions and recommendations

SUCCESS CRITERIA:
- Research question is definitively answered
- Findings are supported by evidence (not just opinion)
- Output is actionable (reader knows what to do next)
- Limitations and uncertainties are acknowledged
```

---

## COMMON IMPROVEMENTS

### ❌ BAD:
```
"Research the AI market"
```

### ✅ GOOD:
```
You are a technology market research analyst with expertise in AI/ML industry trends.

RESEARCH CONTEXT:
Question: What are the top 5 enterprise AI platforms in 2024, and how do they compare for a mid-sized SaaS company looking to add AI features?
Decision: Choosing an AI platform vendor for our product roadmap over the next 2 years
Context: We're a B2B SaaS company with a 15-person engineering team, Python-heavy stack, and $500K annual budget for AI infrastructure

SCOPE:
- Focus: Enterprise AI APIs and platforms (not consumer AI tools)
- Timeframe: Current state (2024), roadmap considerations (2025-2026)
- Geography: US-accessible services
- Depth: Comparative analysis across 5 platforms

REQUIREMENTS:
- Methodology: Scoring matrix across defined criteria
- Evaluation Criteria:
  1. API quality and reliability (uptime SLA, latency)
  2. Model capabilities (what tasks, quality, context length)
  3. Pricing model (per-token, per-request, flat rate)
  4. Enterprise features (audit logs, data privacy, fine-tuning)
  5. Python SDK quality and documentation
  6. Vendor stability (funding, market position)
- Sources: Official documentation, independent benchmarks, developer community feedback
- Output: Structured comparison report with recommendation

OUTPUT STRUCTURE:
1. Executive Summary: Recommended platform + 2-3 sentence rationale
2. Evaluation criteria with weightings
3. Platform-by-platform profiles (OpenAI, Anthropic, Google Vertex, AWS Bedrock, Azure OpenAI)
4. Comparison matrix (table format)
5. Recommendation with implementation considerations
6. Risk factors and mitigation

SUCCESS CRITERIA:
- Engineering lead can present this to the CEO in 15 minutes
- Clear #1 recommendation with evidence
- Cost projection for our usage (1M tokens/day estimate)
- Risks of each option clearly stated
```

---

## DOMAIN-SPECIFIC TIPS

### For Competitive Analysis:
- Define evaluation criteria before analyzing (avoids bias)
- Use a scoring matrix for objectivity
- Include "jobs to be done" perspective

### For Literature Reviews:
- Specify recency requirements (last 2 years, last 5 years)
- Request synthesis, not just summaries
- Ask for identification of gaps or contradictions

### For Data Analysis:
- Define the hypothesis before analysis
- Request confidence intervals for key numbers
- Ask for sensitivity analysis

### For Market Research:
- Segment the market first, then analyze segments
- Include both TAM (total) and SAM (serviceable)
- Request customer perspective alongside market data

---

## ANTI-PATTERNS TO AVOID

❌ Don't research without a clear question — leads to unfocused output
❌ Don't skip the "so what" — pure data without interpretation isn't research
❌ Don't forget to specify output format — narrative vs table vs bullets
❌ Don't omit sources/citations expectation if credibility matters
