# Agent guidance (benchmark HARD profile — Codex)

When a PRMPT MCP tool is available, call it first to locate the files relevant to
the task. Start from the locations it returns: read them and run the existing
tests before editing.

Do NOT run repo-wide shell search (`grep`, `rg`, `find`, `ag`) to explore the
codebase before working through the PRMPT-provided locations. Branch out to
other files only if a failing test, a stack trace, or the code you have read
explicitly names a file that PRMPT did not list.

Run the task's tests to verify your change before finishing.
