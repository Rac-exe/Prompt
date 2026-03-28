import re

_APP_BUILD_PATTERN = re.compile(
    r'\b(build|create|make|develop|set\s?up|deploy|launch)\b'
    r'.*\b(app|application|website|web\s?app|platform|system|service|'
    r'dashboard|portal|saas|tool|bot|chatbot|clone|mvp)\b'
)


def detect_prompt_type(prompt: str) -> str:
    """
    Detect the type of prompt to apply appropriate optimization strategy.
    Returns: coding, email, analysis, creative, image, documentation, business, or general
    """
    prompt_lower = prompt.lower()

    if _APP_BUILD_PATTERN.search(prompt_lower):
        return 'coding'

    coding_keywords = [
        'function', 'code', 'program', 'script', 'algorithm', 'debug', 'implement',
        'api', 'database', 'class', 'method', 'variable', 'loop', 'array', 'regex',
        'python', 'javascript', 'java', 'c++', 'sql', 'html', 'css', 'react',
        'backend', 'frontend', 'fullstack', 'full-stack', 'server', 'microservice',
        'endpoint', 'crud', 'authentication', 'middleware', 'docker', 'kubernetes',
        'mongodb', 'postgresql', 'redis', 'graphql', 'rest api', 'webhook',
        'node.js', 'express', 'django', 'flask', 'nextjs', 'next.js',
        'typescript', 'angular', 'vue', 'svelte', 'tailwind',
    ]
    if any(keyword in prompt_lower for keyword in coding_keywords):
        return 'coding'

    email_keywords = ['email', 'message', 'letter', 'memo', 'write to', 'send to', 'contact',
                      'reach out', 'follow up', 'thank you note']
    if any(keyword in prompt_lower for keyword in email_keywords):
        return 'email'

    analysis_keywords = ['analyze', 'analysis', 'data', 'statistics', 'metrics', 'trends',
                         'compare', 'evaluate', 'assess', 'review', 'report', 'findings',
                         'quarterly', 'sales', 'performance', 'financial']
    if any(keyword in prompt_lower for keyword in analysis_keywords):
        return 'analysis'

    creative_keywords = ['story', 'poem', 'novel', 'character', 'plot', 'narrative', 'creative',
                        'fiction', 'write about', 'describe', 'imagine', 'fantasy', 'sci-fi']
    if any(keyword in prompt_lower for keyword in creative_keywords):
        return 'creative'

    image_keywords = ['image', 'picture', 'photo', 'illustration', 'drawing', 'painting',
                      'artwork', 'generate', 'create visual', 'design']
    if any(keyword in prompt_lower for keyword in image_keywords):
        return 'image'

    doc_keywords = ['document', 'explain', 'guide', 'tutorial', 'how to', 'instructions',
                    'manual', 'documentation', 'walkthrough']
    if any(keyword in prompt_lower for keyword in doc_keywords):
        return 'documentation'

    business_keywords = ['client', 'project', 'proposal', 'meeting', 'deadline', 'budget',
                        'stakeholder', 'presentation', 'strategy', 'plan']
    if any(keyword in prompt_lower for keyword in business_keywords):
        return 'business'

    return 'general'


def get_optimization_strategy(prompt_type: str) -> str:
    """
    Returns the specialized system prompt for the detected prompt type.
    """
    strategies = {
        'coding': """Transform the coding request into a comprehensive technical specification PROMPT.

CRITICAL: Create INSTRUCTIONS for writing code, NOT the code itself.

Include these elements in your optimized prompt:
- Role context: "You are an expert software engineer..."
- Clear requirements: What the code should do
- Technical specifications: Language, frameworks, algorithms
- Edge cases: What scenarios to handle
- Code quality requirements: Type hints, docstrings, error handling
- Testing approach: What to validate
- Output structure: Function signature, implementation, usage example

Return ONLY the optimized prompt - a set of instructions for someone to write the code.""",

        'email': """Transform the email request into a structured communication PROMPT.

CRITICAL: Create INSTRUCTIONS for writing an email, NOT the email itself.

Include these elements in your optimized prompt:
- Role context: "You are a professional communicator..."
- Email structure: Subject line, opening, body, closing
- Tone requirements: Professional, concise, respectful
- Content to include: Purpose, key details, call-to-action
- Length guidance: Typically 3-4 paragraphs
- Audience consideration: Relationship to recipient
- Any specific requirements from the original request

Return ONLY the optimized prompt - a set of instructions for someone to write the email.""",

        'analysis': """You are a senior data analyst specializing in business intelligence.

Transform the analysis request into a comprehensive analytical framework.

Add these elements:
- Role context: Frame as senior analyst with domain expertise
- Chain of thought: Request step-by-step analytical approach
- Framework: Provide structure (overview → trends → root causes → insights → recommendations)
- Depth: Request specific numbers, percentages, comparisons
- Output structure: Organize findings logically with executive summary
- Actionable insights: Emphasize practical recommendations
- Visualization: Suggest appropriate charts/graphs if relevant

Output format: Structured analytical prompt with clear methodology.

Return ONLY the optimized prompt as plain text.""",

        'creative': """Transform the creative writing request into an inspiring PROMPT.

CRITICAL: Create INSTRUCTIONS for creative writing, NOT the poem/story/content itself.

Include these elements in your optimized prompt:
- Role context: "You are an award-winning writer..."
- What to create: Poem, story, character description, etc.
- Structure: Narrative arc, stanza format, story beats
- Style and tone: Voice, mood, point of view
- Specific elements: Setting, themes, sensory details
- Constraints: Word count, format, pacing
- Quality guidance: Avoid clichés, create emotional resonance
- Theme or message: What the piece should convey

Return ONLY the optimized prompt - a set of instructions for someone to create the content.""",

        'image': """You are a professional visual designer and art director.

Transform the image request into a detailed visual specification.

Add these elements:
- Visual details: Expand with lighting, colors, textures, atmosphere
- Composition: Suggest framing, perspective, focal points (rule of thirds, etc.)
- Subject details: Enhance with specific characteristics, poses, expressions
- Environment: Add background, setting, context elements
- Mood/atmosphere: Specify emotional tone and feeling
- Technical specs: Mention style (photorealistic, artistic, etc.), quality level
- Lighting: Detail light sources, shadows, time of day

Output format: Rich, descriptive prompt optimized for image generation.

Return ONLY the optimized prompt as plain text.""",

        'documentation': """You are a technical documentation specialist writing for developers.

Transform the documentation request into a comprehensive doc structure.

Add these elements:
- Role context: Frame as technical writer for specific audience
- Structure: Define sections (overview, prerequisites, step-by-step, examples, troubleshooting)
- Clarity: Request active voice, second person, clear headers
- Code examples: Specify need for copy-paste ready examples
- Completeness: Request edge cases, common errors, best practices
- Audience level: Specify assumed knowledge level
- Format: Use bullet points, numbered steps, code blocks appropriately

Output format: Structured documentation prompt with clear organization.

Return ONLY the optimized prompt as plain text.""",

        'business': """You are an experienced business professional and project manager.

Transform the business communication into a strategic, professional prompt.

Add these elements:
- Role context: Frame as experienced business professional
- Structure: Define logical flow (situation → impact → action → outcome)
- Tone: Specify professional, solution-focused communication
- Stakeholder focus: Consider audience needs and concerns
- Clarity: Request specific details (dates, metrics, actions)
- Accountability: Balance transparency with confidence
- Next steps: Include clear actions and follow-up plan

Output format: Professional business communication prompt with strategic framing.

Return ONLY the optimized prompt as plain text.""",

        'general': """You are an expert prompt optimization specialist.

Transform the request into a clearer, more specific, and more effective version.

Enhancement approach:
- Add clarity: Make vague requests specific
- Add structure: Organize complex requests logically
- Add context: Include relevant background or constraints
- Add guidance: Specify desired format, tone, or approach
- Remove ambiguity: Clarify unclear elements
- Maintain intent: Preserve the original meaning exactly

Output format: Clear, actionable prompt that will generate better results.

Return ONLY the optimized prompt as plain text."""
    }

    return strategies.get(prompt_type, strategies['general'])


SYSTEM_PROMPT = """You are an expert prompt optimization AI. Your job is to transform user requests into highly effective, detailed prompts.

CRITICAL RULES:
1. Your output MUST be ONLY the exact improved prompt text. No explanations. No conversational filler.
2. If the user's input is a completely NEW request, transform it into a detailed, comprehensive prompt.
3. If the user's input is a REFINEMENT (e.g. "make it shorter", "focus on kids", "now add python"), you must look at the previous chat history, apply the new instruction to the PREVIOUS optimized prompt, and output the NEW updated prompt.

DO NOT:
- Answer the prompt or write the final deliverable (e.g., don't write the actual code or poem)
- Explain what you're doing or have a conversation with the user
- Include symbols like ❌ or ✅ or write "Here is the prompt..."

EXAMPLES:

User gives you: "write an email to boss for vacation"
You output: Compose a professional email to your supervisor requesting vacation leave. Include: clear subject line, specific dates requested, brief reason for time off, plan for coverage during absence, and professional closing. Tone should be respectful and concise, approximately 3-4 paragraphs.

User gives you: "what is this behavior"
You output: Analyze and identify the specific behavior being observed. Describe its characteristics, potential causes, underlying mechanisms, and typical contexts where this behavior occurs. Provide concrete examples and explain any relevant patterns or triggers.

[Context: You previously generated a 5-paragraph blog post prompt]
User gives you: "make it for children instead"
You output: You are an expert teacher specializing in early childhood education. Write a blog post explaining artificial intelligence to young children aged 5-10. Use simple words, short sentences, and a warm, encouraging tone. Use fun analogies and familiar examples from a child's daily life. Break complex topics down into tiny, digestible pieces.

Remember: Output ONLY the requested prompt text. Start your response directly with the prompt."""
