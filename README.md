# Prmpt — AI Prompt Optimizer

A powerful desktop application that optimizes your AI prompts in real-time, backed by local or cloud LLMs and cloud synchronization.

🌐 **Website**: [tryprmpt.vercel.app](https://tryprmpt.vercel.app/)

---

## 🚀 Features

### Core
- **⚡ Adaptive Real-time Streaming** — Liquid-smooth text generation that adapts to network speed, eliminating chunky rendering.
- **🎨 Modern UI** — Beautiful, responsive interface built with React, Tailwind CSS, and Shadcn UI. Supports light and dark mode.
- **🖥️ Overlay Mode** — A floating, always-on-top overlay window (Ctrl+5) for instant prompt optimization without leaving your current app.

### Chat & Input
- **📎 File Attachments** — Attach PDFs and images (PNG, JPG, WEBP) directly to messages. Up to 5 files, 10 MB each.
- **🖼️ Image Paste** — Paste images directly from clipboard (Ctrl+V) into the chat input.
- **🔍 Image Lightbox** — Click any image thumbnail in a message to expand it full-screen.
- **🎯 Skill Selection** — Choose a specialization (Coding, Creative, Business, etc.) via the Plus menu or `/` slash command to guide optimization.
- **🎙️ Voice Input** — Dictate prompts with real-time transcription.
- **✏️ Edit & Retry** — Edit any sent message or retry with the same content.
- **⏹️ Stop Generation** — Cancel mid-stream at any time.

### Library & Sharing
- **📂 Prompt Library** — Save optimized prompts into named collections with favorites support.
- **🔗 Shareable Collections** — Share entire prompt collections via a public link. Recipients can browse and save to their own library.
- **🔗 Shareable Prompts** — Share individual prompts via a unique link.
- **📋 Chat Management** — Full chat history with rename, delete, and context menus.

### Intelligence
- **🧠 User Memory** — Automatically infers your domain expertise (e.g., Backend Dev, ML) and writing style from your prompt history using exponential recency decay scoring. Stored in Supabase and used to personalize future optimizations.
- **🛡️ Guardrails** — Smart filtering ensures the AI helps you write *better prompts*, not write *for* you.
- **🔄 Smart Titles** — Chat sessions are automatically titled based on content.

### Infrastructure
- **📡 Offline Mode** — Local cache serves recent chats and messages when offline. Amber warning banner indicates connectivity status.
- **👤 User Profiles** — Cloud-synced preferences, avatar, and custom optimization instructions via Supabase.
- **🔒 Auth** — Email/password authentication with session persistence.

---

## 🛠️ Prerequisites

1. **Node.js** v18+
2. **Python** v3.10+
3. **OpenRouter API key** — [openrouter.ai/keys](https://openrouter.ai/keys)
4. **Supabase** project (for auth, chat history, library, memory)

---

## 📦 Installation

```bash
# 1. Clone the repository
git clone https://github.com/MrRaccooon/Prompt.git
cd Prompt

# 2. Install Node dependencies
npm install

# 3. Install Python dependencies
npm run python:install

# 4. Configure environment
cp .env.example .env
# Edit .env with your Supabase URL, keys, and LLM provider settings
```

---

## 🏃 Running the App

### Development Mode

**Terminal 1 — Python AI Service:**
```bash
npm run python:dev
```

**Terminal 2 — Electron App:**
```bash
npm run dev
```

### Production Build
```bash
npm run build
```

---

## 🏗️ Architecture

| Layer | Technology |
|---|---|
| Frontend | Electron Renderer · React · Vite · TypeScript · Tailwind CSS · Shadcn UI |
| Application | Electron Main Process · TypeScript · IPC |
| Overlay | Self-contained HTML/JS overlay window |
| AI Service | Python · FastAPI · WebSocket · LiteLLM |
| Database | Supabase (PostgreSQL) |
| Local Cache | Electron-side JSON cache for offline support |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a deep dive into the system design.

---

## 📁 Project Structure

```
├── app-ui/                  # React frontend (Vite)
│   └── src/
│       ├── components/
│       │   ├── chat/        # ChatView, MessageBubble, PlusMenu, SkillPicker
│       │   ├── layout/      # Sidebar, AppLayout, ProfileMenu
│       │   ├── library/     # PromptLibrary, SharedLibraryView, ShareModals
│       │   └── settings/    # SettingsView, MemoryView
│       ├── pages/           # Index.tsx (main orchestrator)
│       └── hooks/           # useSmoothStreaming, useInitializeSettings
│
├── electron/
│   ├── main/
│   │   ├── ipc-handlers/    # chat, overlay, auth, skill, prompt-library handlers
│   │   ├── database/
│   │   │   └── services/    # ChatService, MemoryService, PromptLibraryService…
│   │   ├── overlay/         # OverlayWindowManager
│   │   └── api/             # PythonClient (WebSocket), TranscriptionClient
│   ├── renderer/
│   │   └── overlay.html     # Self-contained overlay UI
│   └── preload.ts           # Context bridge (IPC ↔ renderer)
│
└── python-service/
    ├── app/main.py           # FastAPI WebSocket server
    └── pipeline_v2/
        ├── optimizer.py      # LLM orchestration pipeline
        ├── document_parser.py# PDF/image file processing
        └── skills.py         # Skill file loader
```

---

## 📝 Recent Updates

- **File Attachments** — Attach PDFs and images to messages; paste images from clipboard; image lightbox viewer.
- **Skill Selection** — Plus menu and `/` slash command to pick optimization specialization.
- **Shareable Prompt Library** — Share collections and individual prompts via public links.
- **User Memory System** — Multi-domain detection with recency-weighted scoring.
- **Overlay Glow Effect** — Mouse-following emerald border glow on the overlay window.
- **Light Mode Polish** — Darkened placeholder text for better readability.

---

## 🤝 Contributing

Please read [ARCHITECTURE.md](./ARCHITECTURE.md) before making major changes.

## 📄 License

MIT
