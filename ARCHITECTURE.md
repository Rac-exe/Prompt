# Prompt Optimizer - System Architecture

## 1. System Overview

Prompt Optimizer is a desktop application designed to help users refine and optimize their AI prompts. It combines a modern React-based frontend (Electron) with a powerful Python backend for AI processing and a Supabase integration for data persistence.

### High-Level Architecture

```mermaid
graph TD
    User[User Interaction] --> UI[Electron Renderer (React)]
    
    subgraph "Frontend Layer"
        UI --> Auth[AuthContext]
        UI --> Chat[Chat Interface]
        UI --> Settings[Settings UI]
        UI --> Stream[StreamBuffer (Ref)]
    end
    
    subgraph "Application Layer (Electron Main)"
        Main[Main Process] --> IPC[IPC Handlers]
        IPC --> AuthH[Auth Handlers]
        IPC --> ChatH[Chat Handlers]
        IPC --> AppH[App Handlers]
        Main --> Preload[Preload Script (Context Bridge)]
    end
    
    subgraph "Data Layer"
        ChatH --> ChatService[Chat Service]
        AuthH --> UserService[User Service]
        ChatService --> Supabase[(Supabase DB)]
        UserService --> Supabase
    end
    
    subgraph "AI Layer"
        ChatH --> PyClient[Python Client]
        PyClient --> PyService[Python Service (FastAPI)]
        PyService --> Ollama[Ollama LLM]
    end

    UI <--> Preload <--> IPC
```

## 2. Component Details

### 2.1. Frontend (Electron Renderer)
- **Technology**: React, TypeScript, Vite, Tailwind CSS, Radix UI.
- **Key Components**:
    - **`Sidebar.tsx`**: Manages navigation and chat history. Contains the **Chat Context Menu** for actions like Delete, Rename, Share.
    - **`Index.tsx`**: The main chat interface. Implements **Adaptive Buffered Streaming** to ensure liquid-smooth text rendering from the LLM.
    - **`AuthContext.tsx`**: centralized state management for user profile, authentication status, and preferences.
    - **`StreamBuffer`**: A specialized buffer combining a React Ref (for raw data) and State (for visual rendering) to decouple network speed from reading speed.

### 2.2. Backend (Electron Main)
- **Technology**: Electron (Node.js).
- **Responsibility**: Window management, native integrations, and orchestration.
- **IPC Handlers**: Modularized handlers found in `electron/main/ipc-handlers/`:
    - `auth-handlers.ts`: Login, Signup, Session management.
    - `chat-handlers.ts`: Sending messages, deleting chats, prompt optimization.
    - `app-handlers.ts`: Window controls, app state.
- **Services**:
    - `ChatService`: CRUD operations for chats and messages using Supabase.
    - `UserService`: User profile and preferences management.

### 2.3. AI Engine (Python Service)
- **Technology**: Python, FastAPI.
- **Responsibility**: Interfacing with the local LLM (Ollama) and applying prompt engineering logic.
- **Guardrails**:
    - **Keyword Filtering**: Prevents generation of non-prompt content (e.g., essays, blog posts).
    - **Skill Files**: Context-aware instructions for different domains (Coding, Creative, Business).
- **Communication**: WebSocket connection for streaming tokens to the Electron Main process.

### 2.4. Data Persistence (Supabase)
- **Role**: Cloud database for user data, chat history, and saved prompts.
- **Tables/Views**:
    - `user_profiles`: Stores user identity and metadata.
    - `user_preferences`: Stores theme, font, and behavior settings.
    - `chats`: Metadata for chat sessions.
    - `messages`: Individual message history.
    - `user_full_profile` (View): Aggregates profile and preferences for efficient fetching.

## 3. Key Workflows

### 3.1. Adaptive Buffered Streaming
To solve the "burstiness" of network packets and "clumpy" text rendering:
1. **Producer**: `onOptimizationChunk` event adds tokens to a hidden `StreamBuffer` (Ref).
2. **Consumer**: A `requestAnimationFrame` loop reads from the buffer.
3. **Adaptive Logic**:
    - If buffer is low (<10 chars), type 1 char/tick (smooth).
    - If buffer grows (>10 chars), accelerate to 2-3 chars/tick (catch up).
    - If buffer is huge (>50 chars), fast-forward (5+ chars/tick).
4. **Synchronization**: When the final message arrives from the DB, the UI waits for the visual stream to complete before swapping the temporary ID with the real DB ID.

### 3.2. Chat Deletion
1. **User Action**: User clicks "Delete" in the sidebar context menu.
2. **Frontend**: Calls `window.electronAPI.deleteChat(chatId)`.
3. **IPC Bridge**: Forwards request to `app:delete-chat`.
4. **Main Process**: `chatService.deleteChat()` executes `DELETE FROM chats WHERE id = ...`.
5. **Update**: Emits `chat-deleted` event; Frontend removes item from list optimistically or via reload.

### 3.3. Authentication Flow
1. **Login**: User enters credentials.
2. **AuthWrapper**: Listens for `auth:state-changed`.
3. **Context Update**: `AuthContext` receives `CompleteUserData` (Profile + Preferences).
4. **Persistence**: `SettingsView` uses this data to populate fields and save changes back to Supabase.
