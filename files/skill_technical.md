# SKILL FILE: TECHNICAL

## WHEN TO USE THIS SKILL

Use this skill when the request involves:
- Writing, debugging, or explaining code
- API development or documentation
- Database design, queries, or optimization
- System architecture or design patterns
- Algorithms or data structures
- DevOps, infrastructure, or deployment
- Technical documentation
- Data analysis or processing
- Software testing or quality assurance

**Keywords that trigger this skill:**
code, python, javascript, java, API, function, class, database, SQL, algorithm, script, debug, system, architecture, framework, library, deployment, server, cloud, AWS, Docker, testing, unit test

---

## OPTIMIZATION CHECKLIST

When optimizing technical prompts, ensure you've addressed:

✓ **Language/Framework Specified?**
  - Exact programming language and version
  - Frameworks and their versions
  - Libraries and dependencies

✓ **Input/Output Formats Defined?**
  - What data structure for input?
  - What data structure for output?
  - Data types specified?

✓ **Constraints and Requirements?**
  - Performance requirements (time/space complexity)
  - Error handling expectations
  - Security considerations
  - Code style/conventions
  - Testing requirements

✓ **Context Provided?**
  - What problem is being solved?
  - What's the broader system context?
  - Who will use/maintain this code?

✓ **Success Criteria Clear?**
  - What makes the code "good"?
  - How will correctness be verified?
  - What edge cases must be handled?

---

## OPTIMIZATION TEMPLATE

Use this structure for technical prompts:

```
You are a [senior/expert] [role] with extensive experience in [specific domain].

CONTEXT:
[Technical background: what system, what problem, what constraints]

TASK:
[Specific technical objective using precise terminology]

REQUIREMENTS:
- Language: [specific language and version]
- Framework: [if applicable, with version]
- Input: [exact data structure and format]
- Output: [exact data structure and format]
- Constraints:
  - Performance: [specific requirements]
  - Error Handling: [what to handle and how]
  - Code Style: [conventions to follow]
  - Dependencies: [what's allowed/required]

APPROACH:
[If complex, break down into steps]
1. [Step 1]
2. [Step 2]
3. [Step 3]

SUCCESS CRITERIA:
- [Specific, testable outcome 1]
- [Specific, testable outcome 2]

ADDITIONAL NOTES:
- [Any edge cases to consider]
- [Any assumptions to state]
```

---

## TECHNIQUE APPLICATION

**Primary Techniques for Technical Tasks:**

1. **Role Assignment**
   - Be specific: "senior Python developer" not just "developer"
   - Add domain: "with expertise in distributed systems"
   - Example: "You are a senior backend engineer with 8 years of experience building REST APIs in Python using FastAPI"

2. **Task Decomposition**
   - Break complex coding tasks into steps
   - Example: Instead of "write an API" → "1. Define data models 2. Create endpoints 3. Add validation 4. Implement error handling 5. Write tests"

3. **Constraints**
   - Always specify language/framework versions
   - Define performance expectations
   - State error handling requirements
   - Example: "Must handle rate limiting (max 100 req/sec), gracefully handle connection timeouts, log all errors"

4. **Output Specification**
   - Specify code style (PEP 8, Google Style, etc.)
   - Request specific features: "include type hints", "add docstrings", "write unit tests"
   - Define documentation level: "inline comments for complex logic only"

5. **Chain-of-Thought** (for complex problems)
   - "First analyze the algorithm complexity, then implement the solution, finally optimize"
   - Useful for: algorithms, system design, debugging

---

## COMMON IMPROVEMENTS

### ❌ BAD: Vague Technical Prompt
```
"Write a function to process user data"
```

### ✅ GOOD: Optimized Technical Prompt
```
You are a senior Python developer specializing in data processing.

Write a Python function that processes user registration data.

REQUIREMENTS:
- Language: Python 3.11+
- Input: Dictionary with keys: 'email', 'username', 'password', 'age'
- Output: Tuple of (success: bool, message: str, cleaned_data: dict or None)
- Validation:
  - Email must be valid format (RFC 5322)
  - Username: 3-20 chars, alphanumeric + underscore only
  - Password: min 12 chars, must include uppercase, lowercase, digit, special char
  - Age: must be integer 13-120
- Error Handling:
  - Return (False, error_message, None) for validation failures
  - Return (True, "Success", cleaned_data) for valid input
- Code Style: Follow PEP 8, include type hints, add docstring

SUCCESS CRITERIA:
- All validation rules enforced
- Clear error messages for each failure case
- Returns sanitized data (strip whitespace, lowercase email)
- Function is testable in isolation
```

---

### ❌ BAD: Unclear API Prompt
```
"Create an API endpoint for user authentication"
```

### ✅ GOOD: Optimized API Prompt
```
You are a senior backend engineer with expertise in secure authentication systems.

CONTEXT:
Building a REST API for a web application. Need user authentication endpoint using JWT tokens. API will serve both web and mobile clients.

TASK:
Create a POST /auth/login endpoint using FastAPI (v0.104+) and Python 3.11.

REQUIREMENTS:
- Framework: FastAPI 0.104+ with Pydantic v2
- Input: JSON body with 'email' (string) and 'password' (string)
- Output: JSON with 'access_token', 'token_type', 'expires_in' on success
- Authentication:
  - Verify against database (assume User model exists)
  - Use bcrypt for password verification
  - Generate JWT with 1-hour expiry using HS256
- Error Handling:
  - 401 for invalid credentials
  - 422 for malformed input
  - 429 for rate limit exceeded (5 attempts per minute per IP)
  - 500 for database errors
- Security:
  - Hash comparison must be timing-attack resistant
  - Log failed attempts (IP, timestamp, email)
  - Never expose whether email or password was wrong
- Code Style: Include type hints, async/await, error handling middleware

APPROACH:
1. Define Pydantic request/response models
2. Implement rate limiting decorator
3. Create endpoint with proper error handling
4. Add logging for security events

SUCCESS CRITERIA:
- Endpoint returns 200 + valid JWT for correct credentials
- Returns 401 with generic message for any auth failure
- Rate limiting works (test with 6 rapid requests)
- All errors logged appropriately
- Code passes type checking (mypy)
```

---

### ❌ BAD: Generic Database Prompt
```
"Help me design a database for an e-commerce site"
```

### ✅ GOOD: Optimized Database Prompt
```
You are a database architect with 10 years of experience designing e-commerce systems.

CONTEXT:
Building an e-commerce platform handling 10,000 orders/day. Need to support product catalog, inventory, orders, users, and payments. Primary database will be PostgreSQL 15.

TASK:
Design a normalized database schema for the core e-commerce functionality.

REQUIREMENTS:
- Database: PostgreSQL 15
- Scope: Users, Products, Categories, Orders, Order Items, Inventory, Payments
- Constraints:
  - Support multi-variant products (size, color, etc.)
  - Track inventory across multiple warehouses
  - Handle order lifecycle (pending → paid → shipped → delivered)
  - Store payment history (support refunds)
  - Soft deletes for all entities (don't actually delete data)
- Performance:
  - Optimize for fast product searches (by category, price range, name)
  - Efficient inventory checks (< 50ms query time)
  - Handle concurrent order placement (prevent overselling)
- Output Format:
  - SQL CREATE TABLE statements with indexes
  - Brief explanation of key design decisions
  - Note any denormalization for performance

APPROACH:
1. Define core entities and relationships
2. Add necessary indexes for query performance
3. Add constraints to ensure data integrity
4. Include timestamps and soft delete columns

SUCCESS CRITERIA:
- Schema enforces data integrity (foreign keys, constraints)
- Prevents overselling through proper inventory checks
- Supports all common queries efficiently
- No redundant data (properly normalized except where justified)
- Includes indexes on frequently queried columns
```

---

## DOMAIN-SPECIFIC TIPS

### For Python Code:
- Always specify Python version (3.10+, 3.11+)
- Request type hints if code is complex
- Specify async/await if doing I/O operations
- Mention PEP 8 or Black for style

### For JavaScript Code:
- Specify ES6+, ES2022, or TypeScript
- Mention Node.js version if backend
- Request modern syntax (arrow functions, destructuring)
- Specify if Promise/async-await preferred

### For Database Tasks:
- Specify RDBMS (PostgreSQL, MySQL) and version
- Request indexes for performance
- Ask for constraints (foreign keys, unique, not null)
- Consider concurrency if relevant

### For APIs:
- Specify REST, GraphQL, or gRPC
- Request OpenAPI/Swagger docs if helpful
- Define error response formats
- Include rate limiting if production-ready

### For DevOps/Infrastructure:
- Specify cloud provider (AWS, GCP, Azure)
- Request Infrastructure as Code (Terraform, CloudFormation)
- Define scaling requirements
- Include security best practices

---

## ANTI-PATTERNS TO AVOID

❌ Don't say: "Write good code"
✅ Instead: "Follow PEP 8, include docstrings, add type hints, handle errors"

❌ Don't say: "Make it efficient"
✅ Instead: "Target O(n log n) time complexity, use less than 100MB memory"

❌ Don't say: "Handle errors"
✅ Instead: "Catch ValueError for invalid input, log exceptions, return status codes"

❌ Don't say: "Modern JavaScript"
✅ Instead: "ES2022 syntax with async/await and optional chaining"

❌ Don't say: "Secure code"
✅ Instead: "Validate input against SQL injection, use parameterized queries, rate limit endpoints"

---

## REMEMBER

For technical prompts:
- Specificity is everything
- Versions matter
- Performance requirements should be quantified
- Error handling should be explicit
- Testing criteria should be testable
- Code style should be named (PEP 8, not "clean code")

The more concrete details you add, the better the code output will be.
