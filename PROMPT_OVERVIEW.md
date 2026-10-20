# Prompt Overview

## What Prompt Is

Prompt is the core intelligence layer of Prmpt. Its job is to take rough user intent and convert it into clear, structured, high-signal prompts that produce better model output with fewer tokens wasted.

## What It Does

- Rewrites vague prompts into precise instructions.
- Asks clarification questions when required context is missing.
- Builds task-ordered outputs for complex implementation asks.
- Streams optimized output back to the UI in real time.
- Applies custom instructions and memory so users do not repeat preferences.
- Stores useful outputs into history and prompt library flows.

## Prompt Processing Flow

1. User submits raw prompt (overlay or app window).
2. Python optimization service classifies complexity and ambiguity.
3. If needed, clarification questions are generated and answered.
4. Prompt is enriched with memory/custom instructions.
5. If Spaces context is active, relevant code context is attached.
6. Optimized prompt is generated and streamed.
7. Result is inserted back into the originating app (overlay) or copied/used in app view.

## Inputs Used By Prompt

- User text prompt
- Clarification answers
- Attached files (where supported)
- Custom instructions
- User memory profile
- Optional Spaces retrieval context

## Outputs Produced By Prompt

- Final optimized prompt (primary output)
- Structured implementation sections for complex asks
- Follow-up clarity metadata (when needed)
- History entries and prompt library content

## Why It Matters

Without Prompt, users send under-specified instructions and get inconsistent model output. Prompt standardizes the request format, forces missing details to be resolved, and improves quality/reliability across models.
