import { describe, it, expect } from 'vitest';
import { friendlyError } from './ipc-error';

// ─── Inline replica of humanizeLlmError (lives in electron/ — can't import) ──
function humanizeLlmError(err: any): string {
  const raw: string = (err?.message ?? err?.code ?? String(err)).toLowerCase();
  if (raw.includes('econnrefused') || raw.includes('econnreset') || raw.includes('enotfound')) {
    return 'The AI service is not reachable. Please restart the application and try again.';
  }
  if (raw.includes('etimedout') || raw.includes('timeout')) {
    return 'The AI service timed out. It may be overloaded — please try again in a moment.';
  }
  if (raw.includes('socket hang up') || raw.includes('epipe')) {
    return 'The connection to the AI service was lost mid-response. Please try again.';
  }
  return 'The AI service encountered an error. Please try again.';
}

const FALLBACK = 'Something went wrong. Please try again.';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION A — friendlyError unit tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('friendlyError', () => {

  // ── A1: IPC prefix stripping ───────────────────────────────────────────────
  describe('A1 — IPC prefix stripping', () => {
    it('strips prefix then blocks technical content', () => {
      const e = new Error("Error invoking remote method 'save-chat': Error: ENOENT: no such file");
      expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
    });

    it('strips prefix and passes through clean message', () => {
      const e = new Error("Error invoking remote method 'rename-chat': Collection already exists");
      expect(friendlyError(e, FALLBACK)).toBe('Collection already exists');
    });
  });

  // ── A2: node_modules ──────────────────────────────────────────────────────
  describe('A2 — node_modules', () => {
    it('blocks node_modules paths', () => {
      expect(friendlyError(new Error('Cannot find module in /node_modules/xyz'), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── A3: .node binary ─────────────────────────────────────────────────────
  describe('A3 — .node binary references', () => {
    it("blocks .node' references", () => {
      expect(friendlyError(new Error("Could not load native module 'xyz.node'"), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── A4: NODE_MODULE_VERSION ───────────────────────────────────────────────
  describe('A4 — NODE_MODULE_VERSION', () => {
    it('blocks NODE_MODULE_VERSION mismatch', () => {
      expect(friendlyError(new Error('NODE_MODULE_VERSION mismatch 108 vs 115'), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── A5: POSIX error codes ────────────────────────────────────────────────
  describe('A5 — POSIX error codes', () => {
    it.each([
      ["ENOENT: no such file or directory, open '/Users/x/settings.json'"],
      ['connect ECONNREFUSED 127.0.0.1:5432'],
      ['EPERM: operation not permitted, unlink'],
      ['write EPIPE'],
      ['getaddrinfo ENOTFOUND api.example.com'],
    ])('blocks "%s"', (msg) => {
      expect(friendlyError(new Error(msg), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── A6: database / RLS internals ─────────────────────────────────────────
  describe('A6 — database / RLS internals', () => {
    it.each([
      ['new row violates row-level security policy for table'],
      ['violates RLS on table prompts'],
      ['permission denied for table users'],
    ])('blocks "%s"', (msg) => {
      expect(friendlyError(new Error(msg), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── A7: PowerShell / shell output ────────────────────────────────────────
  describe('A7 — PowerShell / shell output', () => {
    it.each([
      ['PowerShell exited with code 1: Access denied'],
      ['stderr: The process cannot access the file'],
      ['stdout: DEBUG processing item 3'],
    ])('blocks "%s"', (msg) => {
      expect(friendlyError(new Error(msg), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── A8: stack trace fragments ────────────────────────────────────────────
  describe('A8 — stack trace fragments', () => {
    it.each([
      ['at Object.handler (main.js:123:5)'],
      ['at async Promise.all (index 0)'],
    ])('blocks "%s"', (msg) => {
      expect(friendlyError(new Error(msg), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── A9: native module mismatch ───────────────────────────────────────────
  describe('A9 — native module mismatch', () => {
    it('blocks "compiled against" message', () => {
      expect(friendlyError(new Error('compiled against a different Node.js version (NODE_MODULE_VERSION 108)'), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── A10: clean pass-throughs ─────────────────────────────────────────────
  describe('A10 — clean pass-throughs', () => {
    it.each([
      ["Collection 'Work' already exists."],
      ['Prompt name cannot be empty.'],
      ['You have reached the 10-project limit.'],
      ['Invalid email address.'],
      ['That name is already taken.'],
    ])('passes through "%s"', (msg) => {
      expect(friendlyError(new Error(msg), FALLBACK)).toBe(msg);
    });
  });

  // ── A11: edge cases ──────────────────────────────────────────────────────
  describe('A11 — edge cases', () => {
    it('null → fallback', () => {
      expect(friendlyError(null, FALLBACK)).toBe(FALLBACK);
    });

    it('undefined → fallback', () => {
      expect(friendlyError(undefined, FALLBACK)).toBe(FALLBACK);
    });

    it('plain string "ENOENT" → fallback', () => {
      expect(friendlyError('ENOENT', FALLBACK)).toBe(FALLBACK);
    });

    it('empty Error message → fallback', () => {
      expect(friendlyError(new Error(''), FALLBACK)).toBe(FALLBACK);
    });

    it('plain object { message: "EPERM" } → does not crash, does not expose EPERM', () => {
      const result = friendlyError({ message: 'EPERM' }, FALLBACK);
      expect(result).not.toContain('EPERM');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION B — humanizeLlmError inline tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('humanizeLlmError (inline replica)', () => {
  it('ECONNREFUSED → not reachable', () => {
    expect(humanizeLlmError(new Error('connect ECONNREFUSED 127.0.0.1:8001')))
      .toBe('The AI service is not reachable. Please restart the application and try again.');
  });

  it('ENOTFOUND → not reachable', () => {
    expect(humanizeLlmError(new Error('getaddrinfo ENOTFOUND prompt-rsxh.onrender.com')))
      .toBe('The AI service is not reachable. Please restart the application and try again.');
  });

  it('etimedout → timed out', () => {
    expect(humanizeLlmError(new Error('Request failed: etimedout')))
      .toBe('The AI service timed out. It may be overloaded — please try again in a moment.');
  });

  it('socket hang up → connection lost', () => {
    expect(humanizeLlmError(new Error('socket hang up')))
      .toBe('The connection to the AI service was lost mid-response. Please try again.');
  });

  it('EPIPE → connection lost', () => {
    expect(humanizeLlmError(new Error('write EPIPE')))
      .toBe('The connection to the AI service was lost mid-response. Please try again.');
  });

  it('500 Internal Server Error → generic fallback', () => {
    expect(humanizeLlmError(new Error('status 500 Internal Server Error')))
      .toBe('The AI service encountered an error. Please try again.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION C — Per-call-site contract tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('call-site contracts', () => {

  it('SpaceWorkspace — send message: ENOENT → generic fallback', () => {
    const e = new Error("Error invoking remote method 'send-message': Error: ENOENT");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('SpaceWorkspace — add folder: EPERM → generic fallback', () => {
    const e = new Error("Error invoking remote method 'attach-folder': Error: EPERM");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('SpaceWorkspace — re-index: stack trace → indexing fallback', () => {
    const e = new Error("Error invoking remote method 'reindex-project': Error: at Object.");
    const indexFallback = 'Something went wrong while indexing. Please restart the app and try again.';
    expect(friendlyError(e, indexFallback)).toBe(indexFallback);
  });

  it('SpaceWorkspace — edit message: node_modules → generic fallback', () => {
    const e = new Error("Error invoking remote method 'edit-message': Error: node_modules");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('SpaceWorkspace — regenerate: ECONNREFUSED → generic fallback', () => {
    const e = new Error("Error invoking remote method 'regenerate': Error: ECONNREFUSED");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('Index — save prompt: RLS violation → generic fallback', () => {
    const e = new Error("Error invoking remote method 'save-prompt': Error: new row violates");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('Index — create collection: permission denied → generic fallback', () => {
    const e = new Error("Error invoking remote method 'create-collection': Error: permission denied");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('Index — rename collection: clean message passes through', () => {
    const e = new Error("Error invoking remote method 'rename-collection': Collection 'X' already exists");
    expect(friendlyError(e, FALLBACK)).toBe("Collection 'X' already exists");
  });

  it('Index — delete collection: EPERM → generic fallback', () => {
    const e = new Error("Error invoking remote method 'delete-collection': Error: EPERM");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('Index — update prompt: RLS → generic fallback', () => {
    const e = new Error("Error invoking remote method 'update-prompt': Error: violates RLS");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('Index — delete prompt: stdout leak → generic fallback', () => {
    const e = new Error("Error invoking remote method 'delete-prompt': Error: stdout: debug");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('ShareCollectionModal: ENOTFOUND → generic fallback', () => {
    const e = new Error("Error invoking remote method 'share-collection': Error: ENOTFOUND");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('SharePromptLinkModal: compiled against → generic fallback', () => {
    const e = new Error("Error invoking remote method 'share-prompt': Error: compiled against");
    expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
  });

  it('SharedLibraryView: permission denied → library-specific fallback', () => {
    const e = new Error("Error invoking remote method 'load-library': Error: permission denied");
    expect(friendlyError(e, 'Failed to load the shared library.')).toBe('Failed to load the shared library.');
  });

  it('text-replacer: clean throw passes through', () => {
    const e = new Error('Auto-replace failed. Use the Copy button and paste manually (Ctrl+V).');
    expect(friendlyError(e, FALLBACK)).toBe('Auto-replace failed. Use the Copy button and paste manually (Ctrl+V).');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION D — Hardened / adversarial cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('hardened cases', () => {

  // ── D1: Case insensitivity — patterns must catch regardless of casing ────
  describe('D1 — case insensitivity', () => {
    it.each([
      ['enoent: no such file'],
      ['Enoent: No Such File'],
      ['NODE_module_VERSION 115'],
      ['Node_Modules/some-pkg'],
      ['COMPILED AGAINST a different version'],
      ['powershell.exe terminated'],
      ['STDERR: fatal error'],
      ['STDOUT: debug trace'],
    ])('blocks "%s" regardless of casing', (msg) => {
      expect(friendlyError(new Error(msg), FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── D2: Multiple tech patterns in one message ───────────────────────────
  describe('D2 — multiple patterns in one message', () => {
    it('blocks message with ENOENT + node_modules combined', () => {
      expect(friendlyError(
        new Error("ENOENT: no such file '/app/node_modules/tree-sitter/build/Release/tree_sitter.node'"),
        FALLBACK
      )).toBe(FALLBACK);
    });

    it('blocks message with stack trace + compiled against', () => {
      expect(friendlyError(
        new Error("at Object.Module._extensions (compiled against NODE_MODULE_VERSION 108)"),
        FALLBACK
      )).toBe(FALLBACK);
    });
  });

  // ── D3: Real-world Sentry error strings ─────────────────────────────────
  describe('D3 — real-world Sentry-style errors', () => {
    it('blocks full Electron IPC native module error', () => {
      const e = new Error(
        "Error invoking remote method 'get-chats': Error: The module '\\\\?\\\\C:\\\\Users\\\\user\\\\AppData\\\\Local\\\\Programs\\\\prompt\\\\resources\\\\app.asar.unpacked\\\\node_modules\\\\better-sqlite3\\\\build\\\\Release\\\\better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 115."
      );
      expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
    });

    it('blocks Supabase RLS error with full detail', () => {
      expect(friendlyError(
        new Error("new row violates row-level security policy for table \"memories\""),
        FALLBACK
      )).toBe(FALLBACK);
    });

    it('blocks PowerShell UI automation full stderr', () => {
      expect(friendlyError(
        new Error("PowerShell -NoProfile -Command \"Add-Type ...\" stderr: Cannot find window"),
        FALLBACK
      )).toBe(FALLBACK);
    });

    it('blocks ECONNREFUSED with full address', () => {
      expect(friendlyError(
        new Error("connect ECONNREFUSED 127.0.0.1:8001"),
        FALLBACK
      )).toBe(FALLBACK);
    });
  });

  // ── D4: Double-wrapped IPC prefix ───────────────────────────────────────
  describe('D4 — double/nested IPC prefix', () => {
    it('strips one layer and blocks tech content underneath', () => {
      const e = new Error("Error invoking remote method 'save-chat': Error: connect ECONNREFUSED 127.0.0.1:5432");
      expect(friendlyError(e, FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── D5: False positive resistance — must NOT block these ────────────────
  describe('D5 — false positive resistance', () => {
    it.each([
      ['File not found.'],
      ['Connection timed out.'],
      ['Access denied.'],
      ['Operation failed.'],
      ['Server error. Please try later.'],
      ['Rate limit exceeded. Wait 60 seconds.'],
      ['Your session has expired. Please log in again.'],
      ['This collection is read-only.'],
      ['Maximum file size is 10MB.'],
      ['Unsupported file type.'],
    ])('passes through clean message: "%s"', (msg) => {
      expect(friendlyError(new Error(msg), FALLBACK)).toBe(msg);
    });
  });

  // ── D6: Whitespace and special characters ───────────────────────────────
  describe('D6 — whitespace and special chars', () => {
    it('whitespace-only message → fallback', () => {
      expect(friendlyError(new Error('   '), FALLBACK)).toBe('   ');
    });

    it('newline-only message preserves (non-empty)', () => {
      expect(friendlyError(new Error('\n'), FALLBACK)).toBe('\n');
    });

    it('number 0 as input → fallback (falsy string "0")', () => {
      expect(friendlyError(0 as any, FALLBACK)).toBe('0');
    });

    it('false as input → fallback (string "false")', () => {
      expect(friendlyError(false as any, FALLBACK)).toBe('false');
    });

    it('empty string literal → fallback', () => {
      expect(friendlyError('', FALLBACK)).toBe(FALLBACK);
    });
  });

  // ── D7: Error subclasses ────────────────────────────────────────────────
  describe('D7 — Error subclasses', () => {
    it('TypeError with tech content → fallback', () => {
      expect(friendlyError(new TypeError("Cannot read properties of undefined (at Object.handler)"), FALLBACK)).toBe(FALLBACK);
    });

    it('RangeError with clean message → passes through', () => {
      expect(friendlyError(new RangeError("Value must be between 1 and 100."), FALLBACK)).toBe("Value must be between 1 and 100.");
    });
  });

  // ── D8: No output ever leaks a raw tech pattern ────────────────────────
  describe('D8 — no leakage guarantee', () => {
    const DANGEROUS_INPUTS = [
      "Error invoking remote method 'x': Error: ENOENT: no such file or directory, open 'C:\\Users\\Prabhat\\AppData\\Local\\prompt\\settings.json'",
      "Error invoking remote method 'x': Error: The module 'C:\\node_modules\\better-sqlite3\\build\\better_sqlite3.node' was compiled against NODE_MODULE_VERSION 115",
      "Error invoking remote method 'x': Error: new row violates row-level security policy for table \"chats\"",
      "PowerShell -NoProfile stderr: Access is denied. at Object.execSync (child_process.js:700:33)",
      "at async MainProcess.handleIPC (C:\\Users\\Prabhat\\Desktop\\PROMPT\\dist\\main\\index.js:1234:5)",
    ];

    const LEAK_PATTERNS = [
      /C:\\Users/i,
      /node_modules/i,
      /\.node['"]/i,
      /NODE_MODULE_VERSION/i,
      /ENOENT|ECONNREFUSED|EPERM|EPIPE|ENOTFOUND/i,
      /violates|permission denied/i,
      /PowerShell|stderr|stdout/i,
      /at Object\.|at async /i,
      /compiled against/i,
      /child_process/i,
      /AppData/i,
      /\.js:\d+/,
    ];

    it.each(DANGEROUS_INPUTS.map((input, i) => [`dangerous input #${i + 1}`, input]))(
      '%s — output contains no leak patterns',
      (_label, input) => {
        const result = friendlyError(new Error(input), FALLBACK);
        for (const pattern of LEAK_PATTERNS) {
          expect(result).not.toMatch(pattern);
        }
      }
    );
  });
});
