# Prompt Optimizer - Python Implementation Example

"""
This is a reference implementation showing how to integrate:
- Context Manager (UC + CC)
- LLM 1 (Summarizer)
- LLM 2 (Optimizer with DT + SF + PO)
- Skill File System

Adapt this to your specific LLM library and infrastructure.
"""

import json
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path

# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class UserContext:
    """User Context - learned preferences"""
    user_id: str
    tone: str = "neutral"  # concise | detailed | neutral
    detail_level: str = "medium"  # low | medium | high
    examples_needed: str = "sometimes"  # always | sometimes | never
    format_preference: str = "structured"  # structured | prose | mixed
    domains: List[str] = None
    patterns: List[str] = None
    interaction_count: int = 0
    
    def __post_init__(self):
        if self.domains is None:
            self.domains = []
        if self.patterns is None:
            self.patterns = []
    
    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "preferences": {
                "tone": self.tone,
                "detail_level": self.detail_level,
                "examples_needed": self.examples_needed,
                "format_preference": self.format_preference
            },
            "domains": self.domains,
            "patterns": self.patterns,
            "interaction_count": self.interaction_count
        }
    
    def to_string(self) -> str:
        """Compact string representation for token efficiency"""
        return f"tone={self.tone}|detail={self.detail_level}|examples={self.examples_needed}|format={self.format_preference}|domains={','.join(self.domains)}|patterns={'; '.join(self.patterns)}"


@dataclass
class Message:
    """Single message in conversation"""
    role: str  # "user" or "assistant"
    content: str
    timestamp: str


# ============================================================================
# TOKEN COUNTER (use your LLM's tokenizer)
# ============================================================================

def count_tokens(text: str) -> int:
    """
    Count tokens in text. 
    Replace this with your actual tokenizer (e.g., tiktoken for OpenAI, 
    transformers.AutoTokenizer for Llama)
    """
    # Rough approximation: 1 token ≈ 4 characters
    return len(text) // 4


# ============================================================================
# CONTEXT MANAGER
# ============================================================================

class ContextManager:
    """Manages UC and CC, decides when summarization is needed"""
    
    def __init__(self, max_input_tokens: int = 5192):
        self.max_input_tokens = max_input_tokens
        self.skills_dir = Path("skills")
    
    def load_user_context(self, user_id: str) -> UserContext:
        """Load UC from storage (database/file)"""
        uc_file = Path(f"storage/user_contexts/{user_id}.json")
        
        if uc_file.exists():
            with open(uc_file, 'r') as f:
                data = json.load(f)
                return UserContext(
                    user_id=user_id,
                    tone=data['preferences']['tone'],
                    detail_level=data['preferences']['detail_level'],
                    examples_needed=data['preferences']['examples_needed'],
                    format_preference=data['preferences']['format_preference'],
                    domains=data.get('domains', []),
                    patterns=data.get('patterns', []),
                    interaction_count=data.get('interaction_count', 0)
                )
        else:
            # New user - return default UC
            return UserContext(user_id=user_id)
    
    def save_user_context(self, uc: UserContext):
        """Save UC to storage"""
        uc_file = Path(f"storage/user_contexts/{uc.user_id}.json")
        uc_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(uc_file, 'w') as f:
            json.dump(uc.to_dict(), f, indent=2)
    
    def load_chat_context(self, session_id: str, max_messages: int = 15) -> List[Message]:
        """Load CC from storage"""
        cc_file = Path(f"storage/chat_histories/{session_id}.json")
        
        if cc_file.exists():
            with open(cc_file, 'r') as f:
                data = json.load(f)
                messages = [Message(**msg) for msg in data[-max_messages:]]
                return messages
        else:
            return []
    
    def save_chat_context(self, session_id: str, messages: List[Message]):
        """Save CC to storage"""
        cc_file = Path(f"storage/chat_histories/{session_id}.json")
        cc_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(cc_file, 'w') as f:
            json.dump([vars(msg) for msg in messages], f, indent=2)
    
    def load_skill_file(self, skill_name: str) -> str:
        """Load a skill file"""
        skill_file = self.skills_dir / f"skill_{skill_name}.md"
        
        if skill_file.exists():
            with open(skill_file, 'r') as f:
                return f.read()
        else:
            return ""
    
    def needs_summarization(self, uc: UserContext, cc: List[Message], 
                           system_prompt_tokens: int, 
                           skills_tokens: int, 
                           user_input_tokens: int) -> bool:
        """Determine if summarization is needed"""
        uc_tokens = count_tokens(uc.to_string())
        cc_tokens = sum(count_tokens(msg.content) for msg in cc)
        
        total_tokens = (system_prompt_tokens + uc_tokens + cc_tokens + 
                       skills_tokens + user_input_tokens)
        
        return total_tokens > self.max_input_tokens


# ============================================================================
# LLM 1: SUMMARIZER
# ============================================================================

class Summarizer:
    """LLM 1 - compresses context when budget exceeded"""
    
    def __init__(self):
        # Initialize your LLM here (Llama, GPT-4o-mini, etc.)
        pass
    
    def summarize_conversation(self, cc: List[Message], uc: UserContext) -> Tuple[str, Dict]:
        """
        Compress conversation history and update UC insights
        Returns: (compressed_cc_summary, uc_updates)
        """
        # Format chat history for summarization
        chat_text = "\n".join([
            f"{msg.role.upper()}: {msg.content}" 
            for msg in cc
        ])
        
        # Load summarizer prompt
        with open("prompts/system_prompt_summarizer.md", 'r') as f:
            system_prompt = f.read()
        
        user_prompt = f"""
Chat History:
{chat_text}

Current User Context:
{json.dumps(uc.to_dict(), indent=2)}

Compress this conversation into the required JSON format.
"""
        
        # Call your LLM here
        # response = your_llm.generate(system_prompt, user_prompt)
        
        # For example purposes, showing expected structure:
        mock_response = {
            "request_summary": "User optimizing prompts for Python API development",
            "previous_prompts": [
                "REST API with FastAPI and PostgreSQL",
                "Unit testing with pytest"
            ],
            "user_patterns": [
                "Prefers FastAPI framework",
                "Always requests error handling",
                "Wants type hints included"
            ],
            "domains": ["python", "backend_development"],
            "key_context": "Building production APIs with testing"
        }
        
        # Extract UC updates
        uc_updates = {
            "patterns": mock_response["user_patterns"],
            "domains": mock_response["domains"]
        }
        
        # Return compressed summary and UC updates
        summary = f"""
Previous requests: {', '.join(mock_response['previous_prompts'])}
Key patterns: {'; '.join(mock_response['user_patterns'])}
Context: {mock_response['key_context']}
"""
        
        return summary.strip(), uc_updates


# ============================================================================
# LLM 2: OPTIMIZER
# ============================================================================

class Optimizer:
    """LLM 2 - optimizes prompts using DT + SF + PO"""
    
    def __init__(self):
        # Initialize your LLM here (Llama, GPT-4, Claude, etc.)
        pass
    
    def optimize_prompt(self, user_input: str, uc: UserContext, 
                       cc_content: str, skills_content: str) -> str:
        """
        Main optimization function
        Uses DT to classify, SF to select skills, PO to optimize
        """
        # Load system prompt with DT + SF + PO
        with open("prompts/system_prompt_optimizer.md", 'r') as f:
            system_prompt = f.read()
        
        # Construct full prompt
        full_prompt = f"""
USER CONTEXT:
{uc.to_string()}

CHAT CONTEXT:
{cc_content}

LOADED SKILLS:
{skills_content}

USER REQUEST:
{user_input}

Analyze the request, classify it, select techniques, and provide the optimized prompt.
"""
        
        # Call your LLM here
        # response = your_llm.generate(system_prompt, full_prompt)
        
        # Mock response for example
        mock_response = """
**ANALYSIS**
Request Type: NEW
Skills Applied: Technical
Techniques Used: Role Assignment, Output Specification, Constraints, Task Decomposition

**OPTIMIZED PROMPT**
You are a senior Python developer with expertise in REST API development.

Write a FastAPI endpoint for user authentication with the following requirements:

REQUIREMENTS:
- Framework: FastAPI 0.104+, Python 3.11+
- Input: JSON with 'email' and 'password'
- Output: JSON with 'access_token', 'token_type', 'expires_in'
- Authentication: JWT tokens with 1-hour expiry
- Error Handling: Return 401 for invalid credentials, 422 for malformed input
- Security: Use bcrypt for password hashing, timing-attack resistant comparisons

APPROACH:
1. Define Pydantic request/response models
2. Create authentication logic with proper error handling
3. Generate JWT token on successful authentication
4. Add proper logging for security events

**KEY IMPROVEMENTS**
• Added specific framework versions (FastAPI 0.104+, Python 3.11+)
• Defined exact input/output structure with JSON format
• Specified security requirements (bcrypt, timing-attack resistance)
• Broke down task into clear steps for implementation

**USAGE TIP**
Test this endpoint with both valid and invalid credentials to ensure error handling works correctly.
"""
        
        return mock_response


# ============================================================================
# MAIN ORCHESTRATOR
# ============================================================================

class PromptOptimizerSystem:
    """Main system that orchestrates everything"""
    
    def __init__(self):
        self.context_manager = ContextManager()
        self.summarizer = Summarizer()
        self.optimizer = Optimizer()
        self.system_prompt_tokens = 1000  # Approximate
    
    def optimize(self, user_id: str, session_id: str, user_input: str) -> str:
        """
        Main entry point for prompt optimization
        """
        # Step 1: Load contexts
        uc = self.context_manager.load_user_context(user_id)
        cc = self.context_manager.load_chat_context(session_id)
        
        # Step 2: Select skills (simplified - in reality, use SF logic)
        selected_skills = self._select_skills(user_input)
        skills_content = "\n\n".join([
            self.context_manager.load_skill_file(skill) 
            for skill in selected_skills
        ])
        skills_tokens = count_tokens(skills_content)
        
        # Step 3: Check if summarization needed
        user_input_tokens = count_tokens(user_input)
        
        if self.context_manager.needs_summarization(
            uc, cc, self.system_prompt_tokens, skills_tokens, user_input_tokens
        ):
            # Use LLM 1 to compress
            print("🔄 Summarizing context...")
            cc_summary, uc_updates = self.summarizer.summarize_conversation(cc, uc)
            
            # Update UC with learned patterns
            uc.patterns.extend(uc_updates.get("patterns", []))
            uc.domains = list(set(uc.domains + uc_updates.get("domains", [])))
            
            cc_content = f"PREVIOUS CONVERSATION SUMMARY:\n{cc_summary}"
        else:
            # Use full CC
            cc_content = "\n".join([
                f"{msg.role.upper()}: {msg.content}" 
                for msg in cc[-10:]  # Last 10 messages
            ])
        
        # Step 4: Use LLM 2 to optimize
        print("✨ Optimizing prompt...")
        optimized = self.optimizer.optimize_prompt(
            user_input, uc, cc_content, skills_content
        )
        
        # Step 5: Update contexts
        uc.interaction_count += 1
        cc.append(Message(role="user", content=user_input, timestamp="now"))
        cc.append(Message(role="assistant", content=optimized, timestamp="now"))
        
        # Step 6: Save contexts
        self.context_manager.save_user_context(uc)
        self.context_manager.save_chat_context(session_id, cc)
        
        return optimized
    
    def _select_skills(self, user_input: str) -> List[str]:
        """
        Simple skill selection (simplified version of SF logic)
        In production, use the full keyword matching from system prompt
        """
        input_lower = user_input.lower()
        
        skill_keywords = {
            "technical": ["code", "api", "python", "function", "database"],
            "creative": ["write", "blog", "story", "content"],
            "business": ["strategy", "market", "revenue", "analysis"]
        }
        
        scores = {}
        for skill, keywords in skill_keywords.items():
            scores[skill] = sum(1 for kw in keywords if kw in input_lower)
        
        # Return top 2 skills
        selected = [
            skill for skill, score in 
            sorted(scores.items(), key=lambda x: x[1], reverse=True)
            if score > 0
        ][:2]
        
        return selected if selected else ["general"]


# ============================================================================
# USAGE EXAMPLE
# ============================================================================

if __name__ == "__main__":
    # Initialize system
    system = PromptOptimizerSystem()
    
    # Example usage
    user_id = "user_123"
    session_id = "session_456"
    
    # First request
    user_input_1 = "Create a prompt for writing Python code for REST APIs"
    result_1 = system.optimize(user_id, session_id, user_input_1)
    print("\n" + "="*80)
    print("REQUEST 1:")
    print(result_1)
    
    # Second request (refinement)
    user_input_2 = "Make it include error handling and authentication"
    result_2 = system.optimize(user_id, session_id, user_input_2)
    print("\n" + "="*80)
    print("REQUEST 2:")
    print(result_2)
    
    # Third request (new topic)
    user_input_3 = "Now create a prompt for writing marketing emails"
    result_3 = system.optimize(user_id, session_id, user_input_3)
    print("\n" + "="*80)
    print("REQUEST 3:")
    print(result_3)
