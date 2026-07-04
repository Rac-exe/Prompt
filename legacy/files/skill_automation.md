# SKILL FILE: AUTOMATION

## WHEN TO USE THIS SKILL

Use this skill when the request involves:
- Automating repetitive tasks or workflows
- Building scripts for batch processing
- Creating integrations between tools/services
- Setting up pipelines or data flows
- Scheduling or event-triggered processes
- Zapier/Make/n8n workflows
- Shell scripts, cron jobs, CI/CD pipelines

**Keywords that trigger this skill:**
automate, workflow, script, task, process, pipeline, integration, batch, schedule, cron, bot, zapier, n8n, trigger, webhook, etl, data flow, ci/cd, github actions

---

## OPTIMIZATION CHECKLIST

✓ **Trigger Defined?**
  - What starts the automation? (schedule, event, manual, webhook)

✓ **Input/Output Specified?**
  - What data goes in? What comes out?
  - Data format (CSV, JSON, API response)?

✓ **Tools and Constraints?**
  - Which platforms/services are involved?
  - Authentication method?
  - Rate limits or quotas to respect?

✓ **Error Handling?**
  - What happens if a step fails?
  - Retry logic, notifications, logging?

✓ **Success Criteria?**
  - How do you verify it ran correctly?
  - What does a successful run look like?

---

## OPTIMIZATION TEMPLATE

```
You are a [senior DevOps engineer / automation specialist] with expertise in [specific tools].

AUTOMATION CONTEXT:
Problem: [What manual process is being automated]
Current State: [How it's done today]
Desired State: [How it should work after automation]

TASK:
Build [automation type] that [specific goal]

TRIGGER:
- Type: [Schedule (cron) / Event / Manual / Webhook]
- Frequency: [if scheduled]
- Condition: [if event-based]

WORKFLOW STEPS:
1. [Input source — where data comes from]
2. [Processing — transformations, decisions, filters]
3. [Output destination — where results go]

REQUIREMENTS:
- Tools/Platform: [specific tools to use]
- Language: [if scripting]
- Authentication: [API keys, OAuth, service accounts]
- Error Handling: [retry N times / send alert / log and continue]
- Logging: [what to log and where]
- Rate Limits: [any API limits to respect]

SUCCESS CRITERIA:
- [Measurable outcome 1]
- [Measurable outcome 2]
- Error rate < [threshold]
```

---

## COMMON IMPROVEMENTS

### ❌ BAD:
```
"Automate my email workflow"
```

### ✅ GOOD:
```
You are a workflow automation specialist with expertise in Zapier and Gmail API.

PROBLEM:
Every day I manually check for new sales emails, copy lead info into a Google Sheet,
and send a follow-up reply. This takes 45 minutes daily.

TASK:
Build a Zapier automation that handles the full lead intake workflow.

TRIGGER:
- New email arrives in Gmail label: "Sales Leads"
- Runs immediately on new email

WORKFLOW:
1. Parse email: extract sender name, email, company, inquiry type
2. Add row to Google Sheet "Lead Tracker" with: timestamp, name, email, company, status="New"
3. Send automated reply from my Gmail using template (provided separately)
4. Create Trello card in "New Leads" board with email subject as title

REQUIREMENTS:
- Platform: Zapier (we have Team plan)
- Parse: Use Formatter step to extract email fields
- Google Sheet columns: Date | Name | Email | Company | Status | Source
- Trello card: Add due date of +2 business days
- Error handling: If email parse fails, send me a Slack notification
- Exclude: Emails from existing customers (sheet lookup)

SUCCESS CRITERIA:
- Zero manual data entry for new leads
- All leads in sheet within 5 minutes of email arrival
- Follow-up sent consistently every time
- Slack alert if automation fails
```

---

## DOMAIN-SPECIFIC TIPS

### For Shell Scripts:
- Always include `set -e` (exit on error)
- Add logging with timestamps
- Make idempotent when possible
- Include a `--dry-run` flag

### For API Integrations:
- Handle rate limiting with exponential backoff
- Cache responses where appropriate
- Store credentials in environment variables, never hardcoded
- Validate webhook signatures

### For Data Pipelines:
- Define schema up front
- Handle null/missing values explicitly
- Add checkpointing for long-running jobs
- Log record counts at each step

---

## ANTI-PATTERNS TO AVOID

❌ Don't automate without defining the failure path
❌ Don't hardcode credentials or secrets
❌ Don't skip idempotency (running twice shouldn't cause duplicates)
❌ Don't forget logging — debugging automation is hard without logs
