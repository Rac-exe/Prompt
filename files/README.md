# PROMPT OPTIMIZER SYSTEM - IMPLEMENTATION GUIDE

## 📁 WHAT YOU HAVE

After analyzing your reference files (LYRA V2 and PromptMaxer), I've created a complete, production-ready prompt optimization system with all components:

### System Prompts:
1. **system_prompt_optimizer.md** - LLM 2 (Main optimizer with DT + SF + PO)
2. **system_prompt_summarizer.md** - LLM 1 (Context compressor)

### Skill Files (Examples):
3. **skill_technical.md** - Technical domain optimization
4. **skill_creative.md** - Creative content optimization
5. **skill_business.md** - Business strategy optimization

### Implementation:
6. **implementation_example.py** - Complete Python reference implementation
7. **prompt_optimizer_complete_blueprint.md** - Full system documentation

---

## 🎯 HOW IT ALL FITS TOGETHER

```
USER INPUT
    ↓
Context Manager
├─ Load UC (user preferences)
├─ Load CC (conversation history)
└─ Check token budget
    ↓
    ├─ IF exceeds budget → LLM 1 (Summarizer)
    └─ ELSE → Use full context
        ↓
LLM 2 (Optimizer)
├─ Decision Taker (classify: NEW/REFINEMENT/ADDITION)
├─ Skill Selector (pick 1-2 relevant skills)
└─ Prompt Optimizer (apply 10 core techniques)
    ↓
OPTIMIZED PROMPT
    ↓
Update UC + CC
```

---

## 🚀 QUICK START

### Step 1: Set Up Your Skill Files

Create a `skills/` directory and add the skill files:

```bash
mkdir -p skills
cp skill_technical.md skills/
cp skill_creative.md skills/
cp skill_business.md skills/
```

You should create 5 more skills based on these templates:
- `skill_communication.md` (emails, messages, docs)
- `skill_educational.md` (tutorials, teaching)
- `skill_visual.md` (image prompts, design)
- `skill_automation.md` (workflows, scripts)
- `skill_research.md` (analysis, reports)

### Step 2: Set Up System Prompts

Create a `prompts/` directory:

```bash
mkdir -p prompts
cp system_prompt_optimizer.md prompts/
cp system_prompt_summarizer.md prompts/
```

### Step 3: Integrate with Your LLM

**For Llama 3.2 3B (8K context):**

```python
from llama_cpp import Llama

# Initialize models
summarizer_llm = Llama(
    model_path="path/to/llama-3.2-3b.gguf",
    n_ctx=8192,  # 8K context
    n_threads=8
)

optimizer_llm = Llama(
    model_path="path/to/llama-3.2-3b.gguf",
    n_ctx=8192,
    n_threads=8
)

# Use in Summarizer class
def summarize_conversation(self, cc, uc):
    response = summarizer_llm(
        prompt=system_prompt + user_prompt,
        max_tokens=300,
        temperature=0.7
    )
    return response['choices'][0]['text']
```

**For OpenAI API:**

```python
from openai import OpenAI

client = OpenAI(api_key="your-api-key")

# Use in Optimizer class
def optimize_prompt(self, user_input, uc, cc_content, skills_content):
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": full_prompt}
        ],
        temperature=0.7,
        max_tokens=2000
    )
    return response.choices[0].message.content
```

**For Claude API:**

```python
import anthropic

client = anthropic.Anthropic(api_key="your-api-key")

def optimize_prompt(self, user_input, uc, cc_content, skills_content):
    response = client.messages.create(
        model="claude-sonnet-3.5",
        max_tokens=2000,
        system=system_prompt,
        messages=[
            {"role": "user", "content": full_prompt}
        ]
    )
    return response.content[0].text
```

---

## 📊 TOKEN BUDGET MANAGEMENT

With 8K context, your budget is:

```
Total: 8,192 tokens
Output: 3,000 tokens (reserved)
Input: 5,192 tokens (budget)

Typical allocation:
├─ System Prompt: 1,000 tokens
├─ User Context: 500 tokens
├─ Chat Context: 1,500 tokens
├─ Skills (2): 1,000 tokens
├─ User Input: 200 tokens
└─ Buffer: 992 tokens
```

**When summarization triggers:**
- CC grows to 2,500+ tokens
- Total input exceeds 5,192 tokens
- LLM 1 compresses CC from 2,500 → 300 tokens (88% reduction)

---

## 🎨 CUSTOMIZING FOR YOUR APP

### Add More Skills

Create new skill files following this template:

```markdown
# SKILL FILE: [SKILL_NAME]

## WHEN TO USE THIS SKILL
[Use cases and trigger keywords]

## OPTIMIZATION CHECKLIST
✓ [Key consideration 1]
✓ [Key consideration 2]

## OPTIMIZATION TEMPLATE
[Structure for optimized prompts]

## TECHNIQUE APPLICATION
[Which of the 10 techniques to use]

## COMMON IMPROVEMENTS
❌ BAD: [vague example]
✅ GOOD: [optimized example]

## DOMAIN-SPECIFIC TIPS
[Specific guidance for this domain]

## ANTI-PATTERNS TO AVOID
[Common mistakes]
```

### Modify Decision Taker Logic

In `system_prompt_optimizer.md`, edit the classification rules:

```markdown
**Classification Rules:**
1. If input contains X → NEW
2. If input contains Y → REFINEMENT
3. Custom rule for your app
```

### Customize User Context Fields

Add fields relevant to your users in `UserContext` class:

```python
@dataclass
class UserContext:
    user_id: str
    tone: str = "neutral"
    # Add your custom fields:
    industry: str = ""
    use_case: str = ""
    output_language: str = "en"
    # etc.
```

Then update the system prompt to use these fields.

---

## 🧪 TESTING YOUR SYSTEM

### Test 1: Classification Accuracy (DT)

Create a test set of 50 user inputs with ground truth labels:

```python
test_cases = [
    ("Create a prompt for X", "NEW"),
    ("Make it shorter", "REFINEMENT"),
    ("Add error handling", "ADDITION"),
    # ... 47 more
]

# Run through optimizer, check if classification matches
accuracy = sum(1 for input, expected in test_cases 
               if classify(input) == expected) / len(test_cases)

print(f"DT Accuracy: {accuracy * 100}%")
# Target: >85%
```

### Test 2: Skill Selection Accuracy (SF)

```python
test_cases = [
    ("Write Python code", ["technical"]),
    ("Create a blog post", ["creative"]),
    ("Analyze market opportunity", ["business"]),
    # ... more
]

accuracy = sum(1 for input, expected in test_cases 
               if set(select_skills(input)) == set(expected)) / len(test_cases)

print(f"SF Accuracy: {accuracy * 100}%")
# Target: >90%
```

### Test 3: Optimization Quality (PO)

Run A/B test with users:

```python
# Show users two prompts (one original, one optimized)
# Don't tell them which is which
# Ask: "Which prompt would produce better results?"

preference_rate = optimized_wins / total_comparisons
print(f"Preference for optimized: {preference_rate * 100}%")
# Target: >70%
```

---

## 🔧 PRODUCTION DEPLOYMENT

### 1. Storage Setup

**For UC (User Context):**
- Use Redis for fast lookups
- Fallback to PostgreSQL/MongoDB for persistence

```python
import redis
import json

r = redis.Redis(host='localhost', port=6379)

def load_user_context(user_id):
    data = r.get(f"uc:{user_id}")
    if data:
        return UserContext(**json.loads(data))
    # Fallback to database...
```

**For CC (Chat Context):**
- Redis for active sessions
- Archive old conversations to S3/GCS

### 2. Monitoring

Track these metrics:

```python
metrics = {
    "requests_per_second": 0,
    "avg_latency_ms": 0,
    "summarization_trigger_rate": 0,  # Should be <10%
    "token_usage_per_request": 0,
    "classification_accuracy": 0,
    "user_satisfaction": 0,  # Thumbs up/down
    "error_rate": 0
}
```

### 3. Cost Optimization

**Model Router Pattern:**

```python
def optimize_prompt(user_input, complexity):
    if complexity == "simple":
        # Use cheap/fast model
        return llama_3b.optimize(user_input)
    else:
        # Use smart/expensive model
        return gpt4.optimize(user_input)
```

**Determine complexity:**
```python
def assess_complexity(user_input):
    if len(user_input.split()) < 20:
        return "simple"
    if any(word in user_input for word in ["complex", "comprehensive", "detailed"]):
        return "complex"
    return "simple"
```

---

## 📈 PERFORMANCE TUNING

### Reduce Latency

1. **Cache frequently used components:**
```python
from functools import lru_cache

@lru_cache(maxsize=100)
def load_skill_file(skill_name):
    # Load once, cache in memory
    pass
```

2. **Parallel skill loading:**
```python
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor() as executor:
    skills = list(executor.map(load_skill_file, selected_skills))
```

3. **Stream LLM responses:**
```python
for chunk in llm.stream(prompt):
    yield chunk  # Return to user immediately
```

### Reduce Token Usage

1. **Compress UC format:**
```python
# Instead of JSON (verbose):
{"tone": "concise", "examples": "always"}

# Use compact format:
"tone=concise|examples=always"
# Saves ~40% tokens
```

2. **Smart CC trimming:**
```python
def trim_chat_context(messages, max_tokens):
    # Keep most recent messages
    # Remove pleasantries/metadata
    # Preserve only relevant context
    pass
```

---

## 🐛 TROUBLESHOOTING

### Issue: "Classification is wrong"

**Solution:** Improve DT rules in system prompt
- Add more specific keywords
- Add examples in system prompt
- Consider few-shot learning

### Issue: "Wrong skills selected"

**Solution:** Tune SF keyword lists
- Add domain-specific keywords
- Weight keywords by importance
- Add multi-word phrases

### Issue: "Optimization isn't improving prompts"

**Solution:** Enhance skill files
- Add more examples
- Make techniques more specific
- Update templates based on feedback

### Issue: "Token limit exceeded"

**Solution:** Adjust budget allocation
- Reduce skill file size
- Trigger summarization earlier
- Use more aggressive CC compression

### Issue: "Summarization loses important info"

**Solution:** Improve summarizer prompt
- Be more specific about what to preserve
- Add structure to summary format
- Test with various conversation types

---

## 🎓 LEARNING FROM PRODUCTION

### Collect Feedback

```python
def record_feedback(user_id, prompt_id, rating, comments):
    # thumbs up/down + optional comments
    # Store in database for analysis
    pass
```

### Analyze Patterns

```python
# Which skills are most used?
skill_usage = count_skill_selections()

# Which techniques work best?
technique_effectiveness = analyze_user_ratings_by_technique()

# Which UC patterns predict satisfaction?
uc_correlations = correlate_uc_with_ratings()
```

### Iterate on Skills

```python
# Every month, review:
# 1. Low-rated optimizations
# 2. Common user edits to prompts
# 3. Skill usage patterns
# 
# Then update skill files with learnings
```

---

## 🚀 SCALING TO 1000+ USERS

### Infrastructure

```
Load Balancer
    ↓
┌─────────────────────────────────────┐
│  Web Servers (3+)                   │
│  - Handle HTTP requests             │
│  - Validate input                   │
│  - Route to workers                 │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  Message Queue (RabbitMQ/Redis)     │
│  - Queue optimization requests      │
│  - Handle spikes                    │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  Worker Processes (10+)             │
│  - Run LLM calls                    │
│  - Process optimizations            │
│  - Update contexts                  │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  Databases                          │
│  - Redis (UC/CC cache)              │
│  - PostgreSQL (persistence)         │
│  - S3 (conversation archives)       │
└─────────────────────────────────────┘
```

### Rate Limiting

```python
from slowapi import Limiter

limiter = Limiter(key_func=get_user_id)

@app.post("/optimize")
@limiter.limit("10/minute")  # 10 requests per minute per user
def optimize_endpoint(request):
    pass
```

---

## 📚 NEXT STEPS

1. **Start with MVP** (Week 1-2)
   - Use Llama 3.2 3B for both LLMs
   - Implement 3 core skills (Technical, Creative, Business)
   - Test with 20-30 sample prompts

2. **Add Learning** (Week 3)
   - Implement UC update logic
   - Add summarization
   - Expand to 8 skills

3. **Production Ready** (Week 4)
   - Switch to API models for complex cases
   - Add monitoring and metrics
   - Implement feedback collection

4. **Scale Up** (Month 2)
   - Add queue system
   - Implement caching
   - Beta test with real users

---

## 💡 FINAL TIPS

1. **Don't over-engineer early** - Start simple, add complexity as needed
2. **Measure everything** - You can't improve what you don't measure
3. **Listen to users** - Their feedback guides skill file improvements
4. **Test continuously** - Classification accuracy, optimization quality, latency
5. **Start free, scale smart** - Test with Llama, switch to APIs only when needed

---

## 📞 SUPPORT

If you have questions:
1. Review the `prompt_optimizer_complete_blueprint.md` for detailed documentation
2. Check the skill file examples for optimization patterns
3. Examine the `implementation_example.py` for integration guidance
4. Test each component in isolation before integrating

---

**You now have everything you need to build a production-ready prompt optimization system! 🚀**

Good luck, and remember: iterate based on real usage data, not assumptions.
