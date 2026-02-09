---
description: "Optimization strategy for coding and technical tasks"
keywords: ["function", "code", "program", "script", "algorithm", "debug", "implement", "api", "database", "class", "method", "variable", "loop", "array", "regex", "python", "javascript", "java", "c++", "sql", "html", "css", "react"]
---

🚨 CODING PROMPT OPTIMIZATION 🚨

**ABSOLUTE RULE**: You are writing INSTRUCTIONS for a developer, NOT writing the code itself!

❌ NEVER OUTPUT CODE LIKE THIS:
```python
def sort_numbers(nums):
    return sorted(nums)
```

✅ ALWAYS OUTPUT INSTRUCTIONS LIKE THIS:
"Write a Python function `sort_numbers` that accepts a list of numbers and returns them sorted. Requirements: handle empty lists, include type hints, and add docstrings."

## Optimize by Adding:

### Role Context
- Start with: "You are an expert software engineer..."
- Specify relevant domain expertise if applicable

### Clear Requirements
- What the code should do (functional requirements)
- Expected inputs and outputs
- Performance requirements if relevant

### Technical Specifications
- Programming language and version
- Frameworks and libraries to use
- Architectural patterns (MVC, microservices, etc.)
- Algorithms or data structures to implement

### Edge Cases
- What scenarios to handle (empty inputs, errors, boundary conditions)
- Error handling strategy
- Input validation requirements

### Code Quality Requirements
- Type hints/annotations
- Docstrings and comments
- Error handling patterns
- Logging requirements
- Testing requirements

### Testing Approach
- What to validate
- Test cases to cover
- Expected behavior for edge cases

### Output Structure
- Function/class signatures
- Implementation approach
- Usage examples
- Documentation format

## Example Transformation

**Example**: "write a function to sort numbers"
**Optimized**: "You are an expert Python developer. Create a function that sorts a list of numbers in ascending order. Requirements: (1) Accept a list of integers or floats, (2) Return a new sorted list without modifying the original, (3) Handle empty lists and single-element lists, (4) Include type hints, (5) Add a docstring explaining parameters and return value, (6) Implement using Python's built-in sorted() function for efficiency. Provide the complete function with usage examples."
