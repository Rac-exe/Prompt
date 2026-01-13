# Debugging Guide - Continuous Optimization

## The Fix Applied

### Problem
- TextStatePoller was emitting `trigger-found` events every 200ms (polling interval)
- This caused `onTextChanged` to be called continuously
- `lastEditAt` timestamp was constantly updating
- System thought user was still typing (edit #499!)
- Prompt never reached STABLE phase → no optimization

### Solution Applied

1. **Text State Poller** - Added change detection:
   - Tracks `lastEmittedPromptText`
   - Only emits `trigger-found` when prompt text actually changes
   - Prevents spam events during polling

2. **Continuous Optimizer** - Added duplicate check:
   - Compares `session.promptText !== promptText` before updating
   - Ignores duplicate text changes
   - Allows stability timer to continue counting

## Expected Log Flow (Fixed)

### When typing "@prompt write a story":
```
[TextStatePoller] trigger-found: "write a story"
[ContinuousOptimizer] New session created "write a story"
```

### When you stop typing (pause 1.5s):
```
[ContinuousOptimizer] Prompt stabilized after 1500ms "write a story"
[ContinuousOptimizer] Starting optimization requestId: <uuid>
[AIGuardrails] Starting optimization: <uuid>
```

### When AI responds:
```
[AIGuardrails] Request completed: <uuid>
[ContinuousOptimizer] Optimization completed
[OverlayManager] Showing optimization overlay
```

## What You Should See

1. **Type:** `@prompt write a short story on hills`
2. **Wait:** 1.5 seconds without typing
3. **See:**
   - Loading indicator appears
   - Then optimization result shows
4. **Edit:** Add " and mountains"
5. **See:**
   - Old result disappears
   - New "Session updated" log
   - After 1.5s pause, new optimization starts

## Key Logs to Watch

### Good signs:
```
[ContinuousOptimizer] Prompt stabilized after 1500ms
[AIGuardrails] Starting optimization
[ContinuousOptimizer] Optimization completed
```

### Bad signs (if you see these, something is wrong):
```
[ContinuousOptimizer] Session updated (edit #499)  ← Should stop after you stop typing!
[AIGuardrails] Skipping - cooldown active         ← OK occasionally, bad if constant
[ResponseValidator] Discarding stale response     ← OK occasionally, bad if every response
```

## Timing Parameters

If 1.5s feels too fast/slow, adjust in:

**stability-tracker.ts** line 11:
```typescript
private readonly STABILITY_THRESHOLD_MS = 1500;  // Change to 2000 for 2 seconds
```

## Testing Checklist

- [ ] Type `@prompt test` → pause 1.5s → see optimization
- [ ] Type `@prompt test` → continue typing immediately → no optimization yet
- [ ] Type `@prompt test` → pause → see result → edit text → old result disappears
- [ ] Type `@prompt test` → pause → see result → type similar prompt → skipped (cooldown)
- [ ] Type `@prompt t` (too short) → pause → no optimization (min 10 chars)

## Troubleshooting

### Still seeing edit #499?
- Check TextStatePoller is comparing `lastEmittedPromptText`
- Check ContinuousOptimizer is comparing `session.promptText !== promptText`
- Rebuild: `npm run build`

### Never reaches STABLE?
- Increase stability threshold in stability-tracker.ts
- Check you're actually stopping typing for 1.5s
- Check console for "Prompt stabilized" message

### Optimization happens but result doesn't show?
- Check OverlayManager logs
- Check window bounds are valid (not NaN)
- Check Python service is responding

### Multiple optimizations for same text?
- Check AI guardrails similarity threshold (90%)
- Check cooldown period (3s)
- May be intentional if you edited then reverted

## Console Commands for Debugging

While app is running, you can check state:

```javascript
// In Electron dev tools console
// Note: These are internal, may need to expose via IPC
```

## Clean Restart

If something is stuck:
1. Stop Electron app (Ctrl+C)
2. Stop Python service (Ctrl+C)
3. Rebuild: `npm run build`
4. Start Python: `npm run python:dev`
5. Start Electron: `npm run dev`
