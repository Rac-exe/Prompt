# Integration Checklist ✓

## Phase 1: Basic Integration ✅ COMPLETE

- [x] Build App-main UI (`npm run build`)
- [x] Create `electron/renderer/app-ui/` directory
- [x] Copy built assets to Electron
- [x] Fix asset paths in index.html (absolute → relative)
- [x] Add CSP headers for Electron
- [x] Backup old UI (`app-window.html` → `app-window-old.html`)
- [x] Update `app-window-manager.ts` to load new UI
- [x] Rebuild Electron TypeScript (`npm run build`)
- [x] Document all changes

## Phase 2: Electron API Integration ⏳ TODO

### Required Files to Modify in App-main

- [ ] Create `src/lib/electron-api.ts` - Electron API type definitions
- [ ] Create `src/hooks/use-electron.ts` - React hook for Electron APIs
- [ ] Update `src/pages/Index.tsx` - Connect chat to IPC
- [ ] Add Electron API checks (graceful degradation for web)

### Code to Add:

```typescript
// src/lib/electron-api.ts
declare global {
  interface Window {
    electronAPI?: {
      // Prompt optimization
      optimizePrompt: (text: string, isRegenerate?: boolean) => void;
      onOptimizationComplete: (callback: (data: any) => void) => void;

      // Chat management
      saveToChat: (original: string, optimized: string) => void;
      onChatSaved: (callback: (data: any) => void) => void;
      loadChats: () => void;
      onChatsLoaded: (callback: (data: any) => void) => void;
      loadMessages: (chatId: string) => void;
      onMessagesLoaded: (callback: (data: any) => void) => void;

      // Utilities
      copyToClipboard: (text: string) => void;
      signOut: () => void;
      requestUserData: () => void;
      onUserDataLoaded: (callback: (user: any) => void) => void;
    };
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
export const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
```

## Phase 3: IPC Event Mapping ⏳ TODO

Map React UI actions to existing IPC channels:

| UI Action | IPC Channel | Handler Location |
|-----------|-------------|------------------|
| Optimize Prompt | `app:optimize-prompt` | `electron/main/app.ts` |
| Save to Chat | `app:save-to-chat` | `electron/main/app.ts` |
| Load Chats | `app:load-chats` | `electron/main/app.ts` |
| Load Messages | `app:load-messages` | `electron/main/app.ts` |
| Sign Out | `app:sign-out` | `electron/main/app.ts` |
| Request User Data | `app:request-user-data` | `electron/main/app.ts` |

- [ ] Test each IPC call from React UI
- [ ] Verify responses are received
- [ ] Add error handling

## Phase 4: Supabase Integration ⏳ TODO

- [ ] Remove direct Supabase calls from React app (if any)
- [ ] Route all database operations through IPC
- [ ] Use existing Supabase services:
  - `electron/main/database/services/chat-service.ts`
  - `electron/main/database/services/user-service.ts`
  - `electron/main/database/services/optimization-service.ts`

## Phase 5: Testing ⏳ TODO

### Critical Tests

- [ ] **Overlay Independence**
  - [ ] Press Ctrl+5 → Overlay appears
  - [ ] Close app window → Overlay still works
  - [ ] Reopen app window → Overlay unaffected

- [ ] **Window Lifecycle**
  - [ ] Close app window → Electron keeps running
  - [ ] Open via tray icon → Window appears
  - [ ] Multiple open/close cycles → No crashes

- [ ] **Core Functionality**
  - [ ] Login/Authentication works
  - [ ] Chat message send/receive
  - [ ] Prompt optimization
  - [ ] Save to library
  - [ ] Load history
  - [ ] Settings persist

- [ ] **IPC Communication**
  - [ ] Renderer → Main process
  - [ ] Main → Renderer process
  - [ ] No console errors
  - [ ] No memory leaks

### Optional Tests

- [ ] Performance benchmarks
- [ ] Bundle size analysis
- [ ] Memory usage profiling
- [ ] Load time measurements

## Phase 6: Polish ⏳ TODO

- [ ] Update app title/branding
- [ ] Add proper error boundaries
- [ ] Implement loading states
- [ ] Add offline mode handling
- [ ] Improve transition animations
- [ ] Add keyboard shortcuts
- [ ] Accessibility audit

## Rollback Plan 🚨

If anything breaks:

```bash
cd /c/prompt/Prompt/electron/renderer
rm -rf app-ui/
mv app-window-old.html app-window.html
# Edit app-window-manager.ts (revert path)
cd ../..
npm run build
```

## Quick Commands

### Rebuild Flow
```bash
# After changing React app
cd /c/prompt/App-main
npm run build
cp -r dist/* /c/prompt/Prompt/electron/renderer/app-ui/
cd /c/prompt/Prompt
npm run build
npm run dev
```

### Dev Mode
```bash
# Terminal 1: Python service
cd /c/prompt/Prompt
npm run python:dev

# Terminal 2: Electron app
npm run dev
```

## Success Criteria ✓

### Must Have ✅
- [x] New UI loads successfully
- [x] Electron architecture unchanged
- [x] Overlay system untouched
- [x] Window lifecycle preserved
- [x] Old UI backed up

### Should Have ⏳
- [ ] Full IPC integration
- [ ] All features working
- [ ] No regressions
- [ ] Performance acceptable
- [ ] Error handling robust

### Nice to Have ⏳
- [ ] Loading optimizations
- [ ] Enhanced UX transitions
- [ ] Additional features
- [ ] Comprehensive tests
- [ ] Documentation complete

## Status: Phase 1 Complete ✅

**Next Step**: Add Electron API bridge to React app (Phase 2)

**Estimated Time**: 30-60 minutes for Phases 2-4

**Risk Level**: Low (can rollback easily)

**Impact**: High (modern UI, better UX)
