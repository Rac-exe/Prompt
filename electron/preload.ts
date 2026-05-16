import { contextBridge, ipcRenderer } from 'electron';

type TranscriptionPayload = { text: string; accumulated: string; type: string };
type TranscriptionStatus = 'listening' | 'processing' | 'stopped';
type RecorderHandle = {
  stream: any;
  recorder: any;
};

const transcriptionListeners = {
  transcription: new Set<(data: TranscriptionPayload) => void>(),
  status: new Set<(status: TranscriptionStatus) => void>(),
  error: new Set<(error: string) => void>(),
};

let activeRecorder: RecorderHandle | null = null;

function emitTranscription(data: TranscriptionPayload) {
  transcriptionListeners.transcription.forEach((listener) => listener(data));
}

function emitTranscriptionStatus(status: TranscriptionStatus) {
  transcriptionListeners.status.forEach((listener) => listener(status));
}

function emitTranscriptionError(error: string) {
  transcriptionListeners.error.forEach((listener) => listener(error));
}

ipcRenderer.on('transcription:update', (_event: any, data: any) => {
  emitTranscription(data);
});
ipcRenderer.on('transcription:status', (_event: any, status: string) => {
  emitTranscriptionStatus(status as TranscriptionStatus);
});
ipcRenderer.on('transcription:error', (_event: any, error: string) => {
  emitTranscriptionError(error);
});

async function startLocalTranscription() {
  if (activeRecorder) {
    emitTranscriptionError('Recording already in progress.');
    return;
  }

  try {
    const mediaDevices = (globalThis as any).navigator?.mediaDevices;
    const MR = (globalThis as any).MediaRecorder;

    if (!mediaDevices?.getUserMedia || !MR) {
      throw new Error('Microphone capture is not available in this window.');
    }

    const devices = await mediaDevices.enumerateDevices();
    const mics = devices.filter((d: any) => d.kind === 'audioinput');
    ipcRenderer.send('transcription:debug', `audio devices: ${mics.length} mic(s) found`);

    if (mics.length === 0) {
      throw new Error(
        'No microphone detected. Check System Preferences > Sound > Input.'
      );
    }

    let stream: any;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (mediaErr: any) {
      const name = mediaErr?.name || 'UnknownError';
      if (name === 'NotAllowedError') {
        throw new Error('Microphone permission denied. Grant access in System Preferences > Privacy > Microphone.');
      } else if (name === 'NotFoundError') {
        throw new Error('Microphone not found. Ensure a microphone is connected and enabled.');
      } else if (name === 'NotReadableError') {
        throw new Error('Microphone is busy or unavailable. Close other apps using the mic and try again.');
      }
      throw new Error(`Microphone error (${name}): ${mediaErr?.message || 'unknown'}`);
    }

    const trackLabel = stream.getAudioTracks()?.[0]?.label || 'unknown';
    ipcRenderer.send('transcription:debug', `mic acquired: "${trackLabel}"`);

    const mimeType = MR.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MR(stream, { mimeType });
    let chunksSent = 0;

    recorder.ondataavailable = async (event: any) => {
      if (!activeRecorder || event.data.size === 0) return;
      try {
        const ab = await event.data.arrayBuffer();
        const uint8 = new Uint8Array(ab);
        ipcRenderer.send('transcription:audio-chunk', uint8);
        chunksSent++;
      } catch (_) {}
    };

    recorder.start(250);

    activeRecorder = { stream, recorder };

    ipcRenderer.send('transcription:debug', `mic started mimeType=${mimeType} device="${trackLabel}"`);
    ipcRenderer.send('transcription:start', {
      sessionId: Date.now().toString(),
      sampleRate: 48000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Microphone access failed.';
    emitTranscriptionError(message);
    emitTranscriptionStatus('stopped');
  }
}

async function stopLocalTranscription() {
  if (!activeRecorder) return;

  const rec = activeRecorder;
  activeRecorder = null;

  try { rec.recorder.stop(); } catch (_) {}
  rec.stream.getTracks().forEach((track: any) => track.stop());

  ipcRenderer.send('transcription:stop');
}

// Declare window type for TypeScript
declare global {
  interface Window {
    electronAPI: {
      // ============================================
      // OVERLAY API (for overlay.html)
      // ============================================
      overlay: {
        optimize: (data: { text: string; isRegenerate?: boolean; mode?: string; attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>; forcedSkill?: string; userGroupId?: string; userVersionIndex?: number; assistantGroupId?: string; assistantVersionIndex?: number; clarificationAnswers?: string; wantsSections?: boolean; clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string } }) => void;
        save: (data: { title: string; content: string; collectionId?: string }) => Promise<any>;
        copy: (text: string) => void;
        close: () => void;
        openApp: () => void;
        insert: (text: string) => Promise<{ success: boolean; fallback?: string }>;
        insertSection: (text: string) => Promise<{ success: boolean; fallback?: string }>;
        getSourceInfo: () => Promise<{ hwnd: number | null; title: string; detectedMode: 'chat' | 'document'; confidence: 'high' | 'low'; appName: string }>;
        checkAuth: () => Promise<{ isAuthenticated: boolean }>;
        getCollections: () => Promise<any>;
        createCollection: (name: string, icon?: string) => Promise<any>;
        getChats: () => Promise<Array<{ id: string; title: string }>>;
        saveToChat: (chatId: string, content: string) => Promise<{ messageId: string }>;
        onOpened: (callback: (data: { isAuthenticated: boolean }) => void) => () => void;
        onAuthState: (callback: (data: { isAuthenticated: boolean }) => void) => () => void;
        onClarificationRequired: (callback: (data: any) => void) => () => void;
        submitClarification: (data: { answers: Record<string, string>; wantsSections: boolean }) => void;
        onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => () => void;
        onOptimizationComplete: (callback: (data: { original: string; optimized: string }) => void) => () => void;
        onOptimizationError: (callback: (data: { error: string }) => void) => () => void;
        getSettings: () => Promise<any>;
        onSettingsUpdate: (callback: (settings: any) => void) => () => void;
        newSession: () => void;
        stopGeneration: () => void;
        truncateHistory: (keepCount: number) => void;
        notifyReady: () => void;
      };

      // ============================================
      // TRANSCRIPTION API (voice input)
      // ============================================
      transcription: {
        start: (sessionId: string) => void;
        stop: () => void;
        onTranscription: (callback: (data: { text: string; accumulated: string; type: string }) => void) => void;
        onStatus: (callback: (status: string) => void) => void;
        onError: (callback: (error: string) => void) => void;
      };

      // ============================================
      // APP WINDOW API
      // ============================================
      optimizePrompt: (
        text: string,
        isRegenerate?: boolean,
        chatId?: string,
        mode?: string,
        source?: 'chat' | 'space',
        spaceId?: string,
        projectId?: string,
        projectBranch?: string,
      ) => void;
      saveToChat: (originalText: string, optimizedText: string) => void;
      requestUserData: () => void;
      onUserDataLoaded: (callback: (user: any) => void) => void;
      onChatSaved: (callback: (data: { chatId: string }) => void) => void;
      loadChats: () => void;
      onChatsLoaded: (callback: (data: { chats: any[] }) => void) => void;
      createChat: (title?: string) => void;
      onChatCreated: (callback: (data: { chat: any }) => void) => void;
      loadMessages: (chatId: string) => void;
      onMessagesLoaded: (callback: (data: { chatId: string; messages: any[] }) => void) => void;
      onOverlayMessagesAppended: (callback: (data: { chatId: string; messages: any[] }) => void) => (() => void);
      deleteChat: (chatId: string) => void;
      onChatDeleted: (callback: (data: { chatId: string }) => void) => (() => void);
      onChatDeleteError: (callback: (data: { chatId: string; error: string }) => void) => (() => void);
      renameChat: (chatId: string, title: string) => void;
      onChatRenamed: (callback: (data: { chatId: string; title: string }) => void) => (() => void);
      onChatRenameError: (callback: (data: { chatId: string; error: string }) => void) => (() => void);
      signOut: () => void;
      copyToClipboard: (text: string) => void;
      saveFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
      stopGeneration: () => void;
      onOptimizationComplete: (callback: (data: { optimized: string; original: string; source?: 'chat' | 'space' }) => void) => (() => void);
      onOptimizationChunk: (callback: (data: { chatId: string | null; chunk: string; accumulated: string; source?: 'chat' | 'space' }) => void) => (() => void);
      onOptimizationError: (callback: (data: { error: string; source?: 'chat' | 'space' }) => void) => (() => void);

      // Clarification API
      submitClarification: (data: { chatId: string; answers: Record<string, string>; wantsSections: boolean }) => void;
      onClarificationRequired: (callback: (data: { chatId: string; should_clarify: boolean; is_complex: boolean; complexity_reason: string; suggested_sections: string[]; questions: Array<{ id: string; question: string; type: string; options: string[]; allow_other: boolean; optional: boolean }> }) => void) => (() => void);

      // Auth API
      signUp: (data: { name: string; dob: string; email: string; password: string }) => void;
      signIn: (data: { email: string; password: string }) => Promise<{ success?: boolean; error?: string }>;
      signInWithOAuth: (provider: 'google' | 'github') => Promise<{ success?: boolean; error?: string }>;
      checkAuth: () => void;
      onAuthStateChange: (callback: (data: { isAuthenticated: boolean; user: any }) => void) => void;
      getIdentities: () => Promise<{ identities: any[]; error?: string | null }>;
      linkIdentity: (provider: 'google' | 'github') => Promise<{ success?: boolean; error?: string }>;
      unlinkIdentity: (identityId: string) => Promise<{ success?: boolean; error?: string }>;
      resetPassword: (email: string) => Promise<{ success?: boolean; error?: string }>;
      // OTP API
      sendSignupOtp: (data: { name: string; dob: string; email: string; password: string }) => Promise<{ success?: boolean; error?: string }>;
      verifySignupOtp: (email: string, otp: string) => Promise<{ success?: boolean; error?: string }>;
      sendResetOtp: (email: string) => Promise<{ success?: boolean; error?: string }>;
      verifyResetOtp: (email: string, otp: string, newPassword: string) => Promise<{ success?: boolean; error?: string }>;
      updateProfile: (updates: any) => void;
      uploadAvatar: (imageData: string, filename: string) => Promise<{ success: boolean; url?: string; error?: string }>;
      updatePreferences: (updates: any) => void;
      setPersonalizationPrompt: (prompt: string) => void;
      onProfileUpdated: (callback: () => void) => void;
      onPreferencesUpdated: (callback: () => void) => void;

      // Settings API
      loadSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<any>;

      // Prompt Library API
      promptLibrary: {
        getAll: () => Promise<any>;
        getCollections: () => Promise<any>;
        createCollection: (name: string, icon?: string) => Promise<any>;
        renameCollection: (collectionId: string, name: string) => Promise<any>;
        deleteCollection: (collectionId: string) => Promise<any>;
        savePrompt: (collectionId: string, title: string, content: string, metadata?: any) => Promise<any>;
        createCollectionAndSave: (collectionName: string, promptTitle: string, promptContent: string, collectionIcon?: string, metadata?: any) => Promise<any>;
        updatePrompt: (promptId: string, updates: any) => Promise<any>;
        deletePrompt: (promptId: string) => Promise<any>;
        toggleFavorite: (promptId: string) => Promise<any>;
        // Sharing
        getShareLink: (collectionId: string) => Promise<{ shareToken: string; shareUrl: string }>;
        getSharedCollection: (token: string) => Promise<any>;
        saveSharedCollection: (originalCollectionId: string) => Promise<{ collection: any; alreadyExisted: boolean }>;
        // Prompt sharing
        getPromptShareLink: (promptId: string) => Promise<{ shareToken: string; shareUrl: string }>;
        getSharedPrompt: (token: string) => Promise<any>;
      };
      onPromptLibraryLoaded: (callback: (data: any) => void) => void;

      // Window controls (frameless window)
      windowControls: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };

      // Open URL in default system browser
      openExternal: (url: string) => void;

      // Common API
      send: (channel: string, data: any) => void;

      // Network status
      onNetworkStatus: (callback: (data: { isOnline: boolean }) => void) => void;
      onNetworkReconnected: (callback: () => void) => void;

      // Storage API (file attachments)
      storage: {
        getSignedUrl: (storagePath: string) => Promise<{ signedUrl?: string; error?: string }>;
        openPdf: (storagePath: string) => Promise<{ success: boolean; error?: string }>;
      };

      // Sentry user sync
      onSentryUser: (callback: (user: { id: string; email: string } | null) => void) => void;

      // Rate Limit API
      getRateLimitStatus: () => Promise<{ allowed: boolean; remaining: number; limit: number; role: string }>;

      // Memory API
      memory: {
        get: () => Promise<{
          user: Record<string, { key: string; value: string; source: string; confidence: number; memory_type: string; updated_at: string; observation_count?: number }>;
          behavioral: Record<string, { key: string; value: string; source: string; confidence: number; memory_type: string; updated_at: string; observation_count?: number }>;
          context: Record<string, { key: string; value: string; source: string; confidence: number; memory_type: string; updated_at: string; observation_count?: number }>;
        }>;
        upsert: (data: { memoryType: 'user' | 'behavioral' | 'context'; key: string; value: string; source?: 'inferred' | 'explicit'; confidence?: number }) => Promise<{ success: boolean; error?: string }>;
        delete: (data: { memoryType: 'user' | 'behavioral' | 'context'; key: string }) => Promise<{ success: boolean; error?: string }>;
        getEnabled: () => Promise<boolean>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
        onUpdated: (callback: (memory: any) => void) => (() => void);
      };

      // Feedback API
      feedback: {
        submit: (data: { rating: 'positive' | 'negative'; comment?: string }) => Promise<{ success: boolean; error?: string }>;
      };

      // GDPR Account Deletion API (Option C — hard lockout)
      deletion: {
        request: (reason?: string) => Promise<{ success: boolean; scheduledAt?: string; message?: string; error?: string }>;
        status: () => Promise<{ pending: boolean; request: { scheduled_deletion_at: string } | null }>;
        restore: {
          request: (email: string) => Promise<{ success: boolean; error?: string }>;
          confirm: (email: string, otp: string) => Promise<{ success: boolean; error?: string }>;
        };
        onRequested: (callback: (data: { scheduledAt: string }) => void) => () => void;
      };

      // Skills API
      skills: {
        list: () => Promise<any>;
      };

      // Python service status
      onPythonUnavailable: (callback: () => void) => void;
      onPythonRecovered: (callback: () => void) => void;

      // Zoom API
      zoom: {
        get: () => Promise<{ percent: number }>;
        set: (percent: number) => Promise<void>;
        onChanged: (callback: (data: { percent: number }) => void) => () => void;
      };

      // Auto-update API
      update: {
        onAvailable: (callback: (data: { version: string }) => void) => () => void;
        onProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => () => void;
        onDownloaded: (callback: (data: { version: string }) => void) => () => void;
        install: () => void;
      };

      // Auto-launch (start at login) API — per-machine preference
      autoLaunch: {
        get: () => Promise<{ enabled: boolean; osState: boolean }>;
        set: (enabled: boolean) => Promise<{ enabled: boolean }>;
      };

      // Project Context API
      project: {
        add: (options?: { folderPath?: string }) => Promise<any>;
        remove: (projectId: string) => Promise<void>;
        list: () => Promise<any[]>;
        status: (projectId: string) => Promise<any>;
        setActive: (projectId: string, localPath?: string) => Promise<void>;
        getActive: () => Promise<{ projectId: string | null; branch: string | null }>;
        reindex: (projectId: string, localPath: string) => Promise<{ totalFiles: number; totalChunks: number }>;
        sync: (projectId?: string) => Promise<void>;
        toggleWatching: (projectId: string, localPath: string, enable: boolean) => Promise<{ watching: boolean }>;
        isWatching: (projectId: string) => Promise<boolean>;
        retrieve: (params: { project_id: string; query: string; branch?: string; limit?: number; mode?: 'find' | 'ask' | 'bug' | 'optimize' }) => Promise<any>;
        context: (params: { project_id: string; query: string; branch?: string; limit?: number; mode?: 'find' | 'ask' | 'bug' | 'optimize' }) => Promise<any>;
        ensureFresh: (projects: Array<{ projectId: string; localPath: string }>) => Promise<{ triggered: number; total?: number }>;
        onStatusUpdate: (callback: (data: any) => void) => () => void;
        onOverlayStatus: (callback: (data: any) => void) => () => void;
      };

      // Spaces bridge API — see electron/main/ipc-handlers/spaces-bridge-handlers.ts
      // for the full architectural rationale. The gist: the app window owns
      // the canonical Spaces state (localStorage + React state); the overlay
      // window cannot read its sibling's localStorage so we relay through
      // main as a lightweight pub/sub.
      spaces: {
        /** App window: push the current spaces list to main's cache. */
        publishSnapshot: (
          spaces: Array<{
            id: string;
            name: string;
            projects: Array<{ projectId: string; name: string; localPath: string; branch?: string }>;
            lastUsedAt: number;
          }>,
        ) => void;
        /** Overlay (or any renderer): read the cached snapshot. */
        list: () => Promise<Array<{
          id: string;
          name: string;
          projects: Array<{ projectId: string; name: string; localPath: string; branch?: string }>;
          lastUsedAt: number;
        }>>;
        /** Overlay: append messages to a specific space (relayed to app window). */
        appendMessages: (payload: {
          spaceId: string;
          messages: Array<{
            id: string;
            role: 'user' | 'assistant';
            content: string;
            timestamp: number;
            groupId?: string;
            versionIndex?: number;
          }>;
        }) => void;
        /** App window: subscribe to overlay-originated appends. */
        onApplyAppend: (
          callback: (payload: {
            spaceId: string;
            messages: Array<{
              id: string;
              role: 'user' | 'assistant';
              content: string;
              timestamp: number;
              groupId?: string;
              versionIndex?: number;
            }>;
          }) => void,
        ) => () => void;
      };
    };
  }
}

// Expose protected methods to the renderer process
const electronAPI = {
  platform: process.platform as 'darwin' | 'win32' | 'linux',

  // ============================================
  // OVERLAY API (clean IPC contract)
  // ============================================
      overlay: {
        optimize: (data: { text: string; isRegenerate?: boolean; mode?: string; attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>; forcedSkill?: string; userGroupId?: string; userVersionIndex?: number; assistantGroupId?: string; assistantVersionIndex?: number; previousOutput?: string; clarificationAnswers?: string; wantsSections?: boolean; clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string }; chatId?: string; spaceMode?: boolean; spaceId?: string }) => {
          ipcRenderer.send('overlay:optimize', data);
        },
    save: (data: { title: string; content: string; collectionId?: string }) => {
      return ipcRenderer.invoke('overlay:save', data);
    },
    copy: (text: string) => {
      ipcRenderer.send('overlay:copy', { text });
    },
    close: () => {
      ipcRenderer.send('overlay:close');
    },
    openApp: () => {
      ipcRenderer.send('overlay:open-app');
    },
    insert: (text: string) => {
      return ipcRenderer.invoke('overlay:insert', { text });
    },
    insertSection: (text: string) => {
      return ipcRenderer.invoke('overlay:insert-section', { text });
    },
    getSourceInfo: () => {
      return ipcRenderer.invoke('overlay:get-source-info');
    },
    checkAuth: () => {
      return ipcRenderer.invoke('overlay:check-auth');
    },
    getCollections: () => {
      return ipcRenderer.invoke('overlay:get-collections');
    },
    createCollection: (name: string, icon?: string) => {
      return ipcRenderer.invoke('overlay:create-collection', { name, icon });
    },
    getChats: () => {
      return ipcRenderer.invoke('overlay:get-chats');
    },
    saveToChat: (chatId: string, content: string) => {
      return ipcRenderer.invoke('overlay:save-to-chat', { chatId, content });
    },
    onOpened: (callback: (data: { isAuthenticated: boolean }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('overlay:opened', handler);
      return () => ipcRenderer.removeListener('overlay:opened', handler);
    },
    onAuthState: (callback: (data: { isAuthenticated: boolean }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('overlay:auth-state', handler);
      return () => ipcRenderer.removeListener('overlay:auth-state', handler);
    },
    onClarificationRequired: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('overlay:clarification-required', handler);
      return () => ipcRenderer.removeListener('overlay:clarification-required', handler);
    },
    submitClarification: (data: { answers: Record<string, string>; wantsSections: boolean; clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string } }) => {
      ipcRenderer.send('overlay:submit-clarification', data);
    },
    onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('overlay:optimization-chunk', handler);
      return () => ipcRenderer.removeListener('overlay:optimization-chunk', handler);
    },
    onOptimizationComplete: (callback: (data: { original: string; optimized: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('overlay:optimization-complete', handler);
      return () => ipcRenderer.removeListener('overlay:optimization-complete', handler);
    },
    onOptimizationError: (callback: (data: { error: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('overlay:optimization-error', handler);
      return () => ipcRenderer.removeListener('overlay:optimization-error', handler);
    },
    onUploadPartialFailure: (callback: (data: { failedFiles: string[] }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('overlay:upload-partial-failure', handler);
      return () => ipcRenderer.removeListener('overlay:upload-partial-failure', handler);
    },
    onCursorPos: (callback: (data: { x: number; y: number }) => void) => {
      ipcRenderer.on('overlay:cursor-pos', (_event, data) => callback(data));
    },
    getSettings: () => {
      return ipcRenderer.invoke('overlay:get-settings');
    },
    onSettingsUpdate: (callback: (settings: any) => void) => {
      const handler = (_event: any, settings: any) => callback(settings);
      ipcRenderer.on('overlay:settings-update', handler);
      return () => ipcRenderer.removeListener('overlay:settings-update', handler);
    },
    newSession: () => {
      ipcRenderer.send('overlay:new-session');
    },
    stopGeneration: () => {
      ipcRenderer.send('overlay:stop-generation');
    },
    truncateHistory: (keepCount: number) => {
      ipcRenderer.send('overlay:truncate-history', { keepCount });
    },
    notifyReady: () => {
      ipcRenderer.send('overlay:ready');
    },
  },

  // ============================================
  // TRANSCRIPTION API (voice input)
  // ============================================
  transcription: {
    start: (_sessionId: string) => {
      void startLocalTranscription();
    },
    stop: () => {
      void stopLocalTranscription();
    },
    onTranscription: (callback: (data: { text: string; accumulated: string; type: string }) => void) => {
      transcriptionListeners.transcription.add(callback);
    },
    onStatus: (callback: (status: string) => void) => {
      transcriptionListeners.status.add(callback as (status: TranscriptionStatus) => void);
    },
    onError: (callback: (error: string) => void) => {
      transcriptionListeners.error.add(callback);
    },
  },

  // ============================================
  // APP WINDOW API
  // ============================================
  optimizePrompt: (text: string, isRegenerate: boolean = false, chatId?: string, mode: string = 'thinking', source: 'chat' | 'space' = 'chat', spaceId?: string, projectId?: string, projectBranch?: string) => {
    ipcRenderer.send('app:optimize-prompt', text, isRegenerate, chatId, mode, source, spaceId, projectId, projectBranch);
  },
  saveToChat: (originalText: string, optimizedText: string) => {
    ipcRenderer.send('app:save-to-chat', originalText, optimizedText);
  },
  requestUserData: () => {
    ipcRenderer.send('app:request-user-data');
  },
  onUserDataLoaded: (callback: (user: any) => void) => {
    ipcRenderer.on('user-data-loaded', (_event, user) => callback(user));
  },
  onChatSaved: (callback: (data: { chatId: string }) => void) => {
    ipcRenderer.on('chat-saved', (_event, data) => callback(data));
  },
  loadChats: () => {
    ipcRenderer.send('app:load-chats');
  },
  onChatsLoaded: (callback: (data: { chats: any[] }) => void) => {
    ipcRenderer.on('chats-loaded', (_event, data) => callback(data));
  },
  createChat: (title?: string) => {
    ipcRenderer.send('app:create-chat', title);
  },
  onChatCreated: (callback: (data: { chat: any }) => void) => {
    ipcRenderer.on('chat-created', (_event, data) => callback(data));
  },
  loadMessages: (chatId: string) => {
    ipcRenderer.send('app:load-messages', chatId);
  },
  deleteChat: (chatId: string) => {
    ipcRenderer.send('app:delete-chat', chatId);
  },
  onChatDeleted: (callback: (data: { chatId: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat-deleted', handler);
    return () => ipcRenderer.removeListener('chat-deleted', handler);
  },
  onChatDeleteError: (callback: (data: { chatId: string; error: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat-delete-error', handler);
    return () => ipcRenderer.removeListener('chat-delete-error', handler);
  },
  renameChat: (chatId: string, title: string) => {
    ipcRenderer.send('app:rename-chat', { chatId, title });
  },
  onChatRenamed: (callback: (data: { chatId: string; title: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat-renamed', handler);
    return () => ipcRenderer.removeListener('chat-renamed', handler);
  },
  onChatRenameError: (callback: (data: { chatId: string; error: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat-rename-error', handler);
    return () => ipcRenderer.removeListener('chat-rename-error', handler);
  },
  onMessagesLoaded: (callback: (data: { chatId: string; messages: any[] }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('messages-loaded', handler);
    return () => ipcRenderer.removeListener('messages-loaded', handler);
  },
  onOverlayMessagesAppended: (callback: (data: { chatId: string; messages: any[] }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('overlay:messages-appended', handler);
    return () => ipcRenderer.removeListener('overlay:messages-appended', handler);
  },
  sendMessage: (data: { 
    chatId: string | null; 
    content: string; 
    mode?: string;
    attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>;
    forcedSkill?: string | null;
    groupId?: string;
    versionIndex?: number;
  }) => {
    ipcRenderer.send('app:send-message', data);
  },
  regenerateResponse: (data: {
    chatId: string;
    content: string;
    mode?: string;
    groupId?: string;
    versionIndex?: number;
    attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>;
    forcedSkill?: string | null;
    previousContent?: string;
    clarificationAnswers?: string;
    wantsSections?: boolean;
    clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string };
  }) => {
    ipcRenderer.send('app:regenerate-response', data);
  },
  onMessageSent: (callback: (data: { chatId: string; chat: any; userMessage: any }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('message-sent', handler);
    return () => ipcRenderer.removeListener('message-sent', handler);
  },
  submitClarification: (data: {
    chatId: string;
    answers: Record<string, string>;
    wantsSections: boolean;
    clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string };
  }) => {
    ipcRenderer.send('app:submit-clarification', data);
  },
  onClarificationRequired: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('clarification-required', handler);
    return () => ipcRenderer.removeListener('clarification-required', handler);
  },
  onMessageReceived: (callback: (data: { chatId: string; message: any }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('message-received', handler);
    return () => ipcRenderer.removeListener('message-received', handler);
  },
  onMessageSendError: (callback: (data: { error: string; details?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('message-send-error', handler);
    return () => ipcRenderer.removeListener('message-send-error', handler);
  },
  onUploadPartialFailure: (callback: (data: { failedFiles: string[] }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('upload-partial-failure', handler);
    return () => ipcRenderer.removeListener('upload-partial-failure', handler);
  },
  onSendMessageQueued: (callback: (data: { chatId: string; content: string; message: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('send-message-queued', handler);
    return () => ipcRenderer.removeListener('send-message-queued', handler);
  },
  onOfflineMessageSynced: (callback: (data: { chatId: string; userMessage: any; assistantMessage: any }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('offline-message-synced', handler);
    return () => ipcRenderer.removeListener('offline-message-synced', handler);
  },
  copyToClipboard: (text: string) => {
    ipcRenderer.send('app:copy-to-clipboard', text);
  },
  saveFeedback: (messageId: string, rating: 'positive' | 'negative') => {
    ipcRenderer.send('app:save-feedback', { messageId, rating });
  },
  stopGeneration: () => {
    ipcRenderer.send('app:stop-generation');
  },
  getGenerationStatus: (chatId: string) => ipcRenderer.invoke('app:get-generation-status', chatId),
  signOut: () => {
    ipcRenderer.send('app:sign-out');
  },

  // Streaming optimization (app window uses these channels)
  onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('optimization-complete', handler);
    return () => ipcRenderer.removeListener('optimization-complete', handler);
  },
  onOptimizationChunk: (callback: (data: { chatId: string | null; chunk: string; accumulated: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('optimization-chunk', handler);
    return () => ipcRenderer.removeListener('optimization-chunk', handler);
  },
  onOptimizationError: (callback: (data: { error: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('optimization-error', handler);
    return () => ipcRenderer.removeListener('optimization-error', handler);
  },

  // ============================================
  // AUTH API
  // ============================================
  signIn: (data: { email: string; password: string }) => {
    return ipcRenderer.invoke('auth:sign-in', data);
  },
  signInWithOAuth: (provider: 'google' | 'github') => {
    return ipcRenderer.invoke('auth:oauth-sign-in', { provider });
  },
  checkAuth: () => {
    ipcRenderer.send('auth:check');
  },
  getIdentities: () => {
    return ipcRenderer.invoke('auth:get-identities');
  },
  linkIdentity: (provider: 'google' | 'github') => {
    return ipcRenderer.invoke('auth:link-identity', { provider });
  },
  unlinkIdentity: (identityId: string) => {
    return ipcRenderer.invoke('auth:unlink-identity', { identityId });
  },
  resetPassword: (email: string) => {
    return ipcRenderer.invoke('auth:reset-password', { email });
  },
  sendSignupOtp: (data: { name: string; dob: string; email: string; password: string }) => {
    return ipcRenderer.invoke('auth:send-signup-otp', data);
  },
  verifySignupOtp: (email: string, otp: string) => {
    return ipcRenderer.invoke('auth:verify-signup-otp', { email, otp });
  },
  sendResetOtp: (email: string) => {
    return ipcRenderer.invoke('auth:send-reset-otp', { email });
  },
  verifyResetOtp: (email: string, otp: string, newPassword: string) => {
    return ipcRenderer.invoke('auth:verify-reset-otp', { email, otp, newPassword });
  },
  onAuthStateChange: (callback: (data: { isAuthenticated: boolean; user: any }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.removeAllListeners('auth:state-changed');
    ipcRenderer.on('auth:state-changed', handler);
    return () => ipcRenderer.removeListener('auth:state-changed', handler);
  },
  updateProfile: (updates: any) => {
    ipcRenderer.send('user:update-profile', updates);
  },
  uploadAvatar: (imageData: string, filename: string) => {
    return ipcRenderer.invoke('avatar:upload', { imageData, filename });
  },
  updatePreferences: (updates: any) => {
    ipcRenderer.send('user:update-preferences', updates);
  },
  setPersonalizationPrompt: (prompt: string) => {
    ipcRenderer.send('user:set-personalization-prompt', prompt);
  },
  onProfileUpdated: (callback: () => void) => {
    ipcRenderer.on('user:profile-updated', () => callback());
  },
  onPreferencesUpdated: (callback: () => void) => {
    ipcRenderer.on('user:preferences-updated', () => callback());
  },

  // ============================================
  // SETTINGS API
  // ============================================
  loadSettings: () => {
    return ipcRenderer.invoke('settings:load');
  },
  saveSettings: (settings: any) => {
    return ipcRenderer.invoke('settings:save', settings);
  },

  // ============================================
  // PROMPT LIBRARY API
  // ============================================
  promptLibrary: {
    getAll: () => ipcRenderer.invoke('prompt-library:get-all'),
    getCollections: () => ipcRenderer.invoke('prompt-library:get-collections'),
    createCollection: (name: string, icon?: string) =>
      ipcRenderer.invoke('prompt-library:create-collection', { name, icon }),
    renameCollection: (collectionId: string, name: string) =>
      ipcRenderer.invoke('prompt-library:rename-collection', { collectionId, name }),
    deleteCollection: (collectionId: string) =>
      ipcRenderer.invoke('prompt-library:delete-collection', { collectionId }),
    savePrompt: (collectionId: string, title: string, content: string, metadata?: any) =>
      ipcRenderer.invoke('prompt-library:save-prompt', { collectionId, title, content, metadata }),
    createCollectionAndSave: (collectionName: string, promptTitle: string, promptContent: string, collectionIcon?: string, metadata?: any) =>
      ipcRenderer.invoke('prompt-library:create-collection-and-save', {
        collectionName,
        collectionIcon,
        promptTitle,
        promptContent,
        metadata
      }),
    updatePrompt: (promptId: string, updates: any) =>
      ipcRenderer.invoke('prompt-library:update-prompt', { promptId, updates }),
    deletePrompt: (promptId: string) =>
      ipcRenderer.invoke('prompt-library:delete-prompt', { promptId }),
    toggleFavorite: (promptId: string) =>
      ipcRenderer.invoke('prompt-library:toggle-favorite', { promptId }),
    // Sharing
    getShareLink: (collectionId: string) =>
      ipcRenderer.invoke('prompt-library:get-share-link', { collectionId }),
    getSharedCollection: (token: string) =>
      ipcRenderer.invoke('prompt-library:get-shared-collection', { token }),
    saveSharedCollection: (originalCollectionId: string) =>
      ipcRenderer.invoke('prompt-library:save-shared-collection', { originalCollectionId }),
    // Prompt sharing
    getPromptShareLink: (promptId: string) =>
      ipcRenderer.invoke('prompt-library:get-prompt-share-link', { promptId }),
    getSharedPrompt: (token: string) =>
      ipcRenderer.invoke('prompt-library:get-shared-prompt', { token }),
  },
  onPromptLibraryLoaded: (callback: (data: any) => void) => {
    ipcRenderer.on('prompt-library:loaded', (_event, data) => callback(data));
  },

  // ============================================
  // WINDOW CONTROLS (frameless window)
  // ============================================
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),

  // ============================================
  // COMMON API
  // ============================================
  send: (channel: string, data: any) => {
    const ALLOWED_SEND_CHANNELS = new Set([
      'overlay:settings-update',
      'overlay:close',
      'overlay:ready',
    ]);
    if (!ALLOWED_SEND_CHANNELS.has(channel)) {
      console.warn(`[Preload] Blocked IPC send to unknown channel: ${channel}`);
      return;
    }
    ipcRenderer.send(channel, data);
  },

  // ============================================
  // NETWORK STATUS
  // ============================================
  onNetworkStatus: (callback: (data: { isOnline: boolean }) => void) => {
    ipcRenderer.on('network:status', (_event, data) => callback(data));
  },
  onNetworkReconnected: (callback: () => void) => {
    ipcRenderer.on('network:reconnected', () => callback());
  },

  // ============================================
  // SENTRY USER SYNC
  // ============================================
  onSentryUser: (callback: (user: { id: string; email: string } | null) => void) => {
    const handler = (_event: any, user: any) => callback(user);
    ipcRenderer.removeAllListeners('sentry:set-user');
    ipcRenderer.on('sentry:set-user', handler);
    return () => ipcRenderer.removeListener('sentry:set-user', handler);
  },

  // ============================================
  // RATE LIMIT API
  // ============================================
  getRateLimitStatus: () => {
    return ipcRenderer.invoke('app:get-rate-limit-status');
  },

  // ============================================
  // MEMORY API
  // ============================================
  memory: {
    get: () => ipcRenderer.invoke('memory:get'),
    upsert: (data: { memoryType: 'user' | 'behavioral' | 'context'; key: string; value: string; source?: 'inferred' | 'explicit'; confidence?: number }) =>
      ipcRenderer.invoke('memory:upsert', data),
    delete: (data: { memoryType: 'user' | 'behavioral' | 'context'; key: string }) =>
      ipcRenderer.invoke('memory:delete', data),
    getEnabled: () => ipcRenderer.invoke('memory:get-enabled'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('memory:set-enabled', enabled),
    onUpdated: (callback: (memory: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('memory:updated', handler);
      return () => ipcRenderer.removeListener('memory:updated', handler);
    },
  },

  // ============================================
  // STORAGE API (file attachments)
  // ============================================
  storage: {
    getSignedUrl: (storagePath: string) =>
      ipcRenderer.invoke('storage:get-signed-url', { storagePath }),
    openPdf: (storagePath: string) =>
      ipcRenderer.invoke('storage:open-pdf', { storagePath }),
  },

  // ============================================
  // FEEDBACK API
  // ============================================
  feedback: {
    submit: (data: { rating: 'positive' | 'negative'; comment?: string }) =>
      ipcRenderer.invoke('feedback:submit', data),
  },

  // ============================================
  // GDPR ACCOUNT DELETION API (Option C — hard lockout)
  // ============================================
  deletion: {
    request: (reason?: string) => ipcRenderer.invoke('deletion:request', { reason }),
    status: () => ipcRenderer.invoke('deletion:status'),
    restore: {
      request: (email: string) => ipcRenderer.invoke('deletion:restore-request', { email }),
      confirm: (email: string, otp: string) => ipcRenderer.invoke('deletion:restore-confirm', { email, otp }),
    },
    onRequested: (callback: (data: { scheduledAt: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('deletion:requested', handler);
      return () => ipcRenderer.removeListener('deletion:requested', handler);
    },
  },

  // ============================================
  // DEEP LINK NAVIGATION
  // ============================================
  onNavigateToShare: (callback: (routePath: string) => void): (() => void) => {
    const handler = (_event: any, routePath: string) => callback(routePath);
    ipcRenderer.on('navigate-to-share', handler);
    return () => ipcRenderer.removeListener('navigate-to-share', handler);
  },

  // ============================================
  // PYTHON SERVICE STATUS
  // ============================================
  onPythonUnavailable: (callback: () => void) => {
    ipcRenderer.on('python:unavailable', () => callback());
  },
  onPythonRecovered: (callback: () => void) => {
    ipcRenderer.on('python:recovered', () => callback());
  },

  // ============================================
  // SKILLS API
  // ============================================
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
  },

  // ============================================
  // ZOOM API
  // ============================================
  zoom: {
    get: () => ipcRenderer.invoke('zoom:get'),
    set: (percent: number) => ipcRenderer.invoke('zoom:set', percent),
    onChanged: (callback: (data: { percent: number }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('zoom:changed', handler);
      return () => ipcRenderer.removeListener('zoom:changed', handler);
    },
  },

  // ============================================
  // AUTO-UPDATE API
  // ============================================
  update: {
    onAvailable: (callback: (data: { version: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('update:available', handler);
      return () => ipcRenderer.removeListener('update:available', handler);
    },
    onProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.removeListener('update:progress', handler);
    },
    onDownloaded: (callback: (data: { version: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('update:downloaded', handler);
      return () => ipcRenderer.removeListener('update:downloaded', handler);
    },
    install: () => ipcRenderer.send('update:install'),
  },

  // ============================================
  // AUTO-LAUNCH API (start at login — per-machine preference)
  // ============================================
  autoLaunch: {
    get: () => ipcRenderer.invoke('auto-launch:get'),
    set: (enabled: boolean) => ipcRenderer.invoke('auto-launch:set', enabled),
  },

  // ============================================
  // PROJECT CONTEXT API
  // ============================================
  project: {
    add: (options?: { folderPath?: string }) => ipcRenderer.invoke('project:add', options),
    remove: (projectId: string) => ipcRenderer.invoke('project:remove', projectId),
    list: () => ipcRenderer.invoke('project:list'),
    status: (projectId: string) => ipcRenderer.invoke('project:status', projectId),
    setActive: (projectId: string, localPath?: string) => ipcRenderer.invoke('project:set-active', projectId, localPath),
    getActive: () => ipcRenderer.invoke('project:get-active'),
    reindex: (projectId: string, localPath: string) => ipcRenderer.invoke('project:reindex', projectId, localPath),
    sync: (projectId?: string) => ipcRenderer.invoke('project:sync', projectId),
    toggleWatching: (projectId: string, localPath: string, enable: boolean) => ipcRenderer.invoke('project:toggle-watching', projectId, localPath, enable),
    isWatching: (projectId: string) => ipcRenderer.invoke('project:is-watching', projectId),
    isScanning: (projectId: string) => ipcRenderer.invoke('project:is-scanning', projectId),
    retrieve: (params: { project_id: string; query: string; branch?: string; limit?: number; mode?: 'find' | 'ask' | 'bug' | 'optimize' }) => ipcRenderer.invoke('project:retrieve', params),
    context: (params: { project_id: string; query: string; branch?: string; limit?: number; mode?: 'find' | 'ask' | 'bug' | 'optimize' }) => ipcRenderer.invoke('project:context', params),
    ensureFresh: (projects: Array<{ projectId: string; localPath: string }>) => ipcRenderer.invoke('project:ensure-fresh', projects),
    onStatusUpdate: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('project:status-update', handler);
      return () => ipcRenderer.removeListener('project:status-update', handler);
    },
    onOverlayStatus: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('overlay:project-status', handler);
      return () => ipcRenderer.removeListener('overlay:project-status', handler);
    },
  },

  // ============================================
  // SPACES BRIDGE API
  // ============================================
  // Cross-window relay for the Spaces feature. The app window publishes
  // its current spaces snapshot to main; overlay reads that snapshot for
  // the picker and appends finalized turns back through the same bridge.
  // Full design notes live in spaces-bridge-handlers.ts.
  spaces: {
    publishSnapshot: (spaces: any[]) => {
      ipcRenderer.send('spaces:publish-snapshot', spaces);
    },
    list: () => ipcRenderer.invoke('spaces:list'),
    appendMessages: (payload: { spaceId: string; messages: any[] }) => {
      ipcRenderer.send('spaces:append-messages', payload);
    },
    onApplyAppend: (callback: (payload: { spaceId: string; messages: any[] }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('spaces:apply-append', handler);
      return () => ipcRenderer.removeListener('spaces:apply-append', handler);
    },
    /** Returns the in-progress stream state for a space if one is active,
     *  or null if the space is idle. Used by SpaceWorkspace on mount to
     *  resume rendering when the user navigates back mid-generation. */
    getActiveStream: (spaceId: string) => ipcRenderer.invoke('spaces:get-active-stream', spaceId),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
