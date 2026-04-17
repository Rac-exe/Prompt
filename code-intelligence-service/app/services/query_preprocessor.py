"""
Query preprocessor — extracts structured signals from raw user queries
before semantic search. Parses stack traces, file paths, error types,
and function names for targeted retrieval.
"""

import re
import logging
import sentry_sdk
from dataclasses import dataclass, field

logger = logging.getLogger("code-intel.query_preprocessor")

# Stack trace patterns for common languages/runtimes
_STACK_TRACE_PATTERNS = [
    # JS/TS: "at functionName (file.js:42:10)" or "at file.js:42"
    re.compile(r'at\s+(?:(?P<func>[\w$.]+)\s+\()?(?P<file>[^\s()]+\.\w{1,5}):(?P<line>\d+)(?::(?P<col>\d+))?\)?'),
    # Python: 'File "path/to/file.py", line 42, in func'
    re.compile(r'File\s+"(?P<file>[^"]+\.py)",\s+line\s+(?P<line>\d+)(?:,\s+in\s+(?P<func>\w+))?'),
    # Go: "file.go:42"
    re.compile(r'(?P<file>[\w/\\]+\.go):(?P<line>\d+)'),
    # Rust: "src/main.rs:42"
    re.compile(r'(?P<file>[\w/\\]+\.rs):(?P<line>\d+)'),
    # Java: "at com.example.Class.method(File.java:42)"
    re.compile(r'at\s+[\w.]+\.(?P<func>\w+)\((?P<file>\w+\.java):(?P<line>\d+)\)'),
]

# File path patterns in natural language or code
_FILE_PATH_RE = re.compile(
    r'(?:^|\s|[`\'"])'
    r'(?P<path>'
    r'(?:[\w.-]+/){1,10}[\w.-]+\.\w{1,5}'  # unix path: foo/bar/baz.tsx
    r'|[\w.-]+\.\w{1,5}'                     # bare filename: AuthContext.js
    r')'
    r'(?:\s|$|[`\'":,])',
)

_CODE_EXTENSIONS = {
    ".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".rb",
    ".c", ".cpp", ".h", ".hpp", ".cs", ".vue", ".svelte", ".php",
    ".swift", ".kt", ".scala", ".sql",
}

# Error type patterns
_ERROR_TYPE_RE = re.compile(
    r'\b(?P<error>'
    r'TypeError|ReferenceError|SyntaxError|RangeError|URIError'
    r'|ValueError|KeyError|AttributeError|ImportError|IndexError|RuntimeError'
    r'|NullPointerException|ClassNotFoundException|IOException'
    r'|panic|SIGABRT|SIGSEGV|segfault'
    r'|Error|Exception'
    r')\b'
)

# Function/method name patterns (camelCase, snake_case, Class.method)
_FUNCTION_NAME_RE = re.compile(
    r'(?:function|method|def|fn|func)\s+(?P<name>[\w.]+)'
    r'|(?:in|at|calling|calls)\s+(?P<name2>[\w.]+)\s*\('
    r'|\b(?P<name3>[A-Z]\w+\.\w+)\b'
)

# Directory reference patterns
_DIRECTORY_RE = re.compile(
    r'(?:in|from|inside|under|within)\s+(?:the\s+)?(?P<dir>[\w-]+)\s+(?:module|folder|directory|package|component)',
    re.IGNORECASE,
)


@dataclass
class QuerySignals:
    """Structured signals extracted from a user query."""
    file_paths: list[str] = field(default_factory=list)
    line_numbers: dict[str, list[int]] = field(default_factory=dict)
    function_names: list[str] = field(default_factory=list)
    error_types: list[str] = field(default_factory=list)
    directory_refs: list[str] = field(default_factory=list)
    has_stack_trace: bool = False


def preprocess_query(query: str) -> QuerySignals:
    """
    Extract structured signals from a raw user query.
    These signals are used for targeted DB lookups and file-path filtering.
    """
    signals = QuerySignals()

    _extract_stack_traces(query, signals)
    _extract_file_paths(query, signals)
    _extract_error_types(query, signals)
    _extract_function_names(query, signals)
    _extract_directory_refs(query, signals)

    signals.file_paths = list(dict.fromkeys(signals.file_paths))
    signals.function_names = list(dict.fromkeys(signals.function_names))
    signals.error_types = list(dict.fromkeys(signals.error_types))

    has_signals = (
        signals.file_paths or signals.function_names
        or signals.error_types or signals.directory_refs
        or signals.has_stack_trace
    )
    if has_signals:
        logger.info(
            f"[PREPROCESS] Signals extracted: "
            f"files={signals.file_paths}, functions={signals.function_names}, "
            f"errors={signals.error_types}, dirs={signals.directory_refs}, "
            f"line_numbers={dict(signals.line_numbers)}, "
            f"stack_trace={signals.has_stack_trace}"
        )
    else:
        logger.info(
            f"[PREPROCESS] No structured signals found in query "
            f"({len(query)} chars, {len(query.split())} words)"
        )

    return signals


def build_file_patterns(signals: QuerySignals) -> list[str]:
    """
    Convert extracted signals into SQL ILIKE patterns for file_path_search.
    """
    patterns: list[str] = []

    for fp in signals.file_paths:
        if "/" in fp:
            patterns.append(f"%{fp}")
        else:
            patterns.append(f"%/{fp}")
            patterns.append(fp)

    for d in signals.directory_refs:
        patterns.append(f"%{d}%")

    result = list(dict.fromkeys(patterns))[:10]
    if result:
        logger.info(f"[PREPROCESS] Built {len(result)} file patterns: {result}")
    return result


def _extract_stack_traces(query: str, signals: QuerySignals):
    for pattern in _STACK_TRACE_PATTERNS:
        for match in pattern.finditer(query):
            signals.has_stack_trace = True
            fp = match.group("file")
            if fp:
                signals.file_paths.append(fp)
            line = match.group("line")
            if fp and line:
                signals.line_numbers.setdefault(fp, []).append(int(line))
            func = match.groupdict().get("func")
            if func and func not in ("Object", "Module", "Array", "Promise"):
                signals.function_names.append(func)


def _extract_file_paths(query: str, signals: QuerySignals):
    for match in _FILE_PATH_RE.finditer(query):
        path = match.group("path")
        ext = "." + path.rsplit(".", 1)[-1] if "." in path else ""
        if ext.lower() in _CODE_EXTENSIONS:
            signals.file_paths.append(path)


def _extract_error_types(query: str, signals: QuerySignals):
    for match in _ERROR_TYPE_RE.finditer(query):
        signals.error_types.append(match.group("error"))


def _extract_function_names(query: str, signals: QuerySignals):
    for match in _FUNCTION_NAME_RE.finditer(query):
        name = match.group("name") or match.group("name2") or match.group("name3")
        if name and len(name) > 2 and name not in ("the", "this", "that", "from"):
            signals.function_names.append(name)


def _extract_directory_refs(query: str, signals: QuerySignals):
    for match in _DIRECTORY_RE.finditer(query):
        d = match.group("dir")
        if d and len(d) > 1:
            signals.directory_refs.append(d)
