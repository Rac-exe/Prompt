# Prompt Optimizer

A powerful desktop application that optimizes your AI prompts in real-time, backed by local LLMs and cloud synchronization.

🌐 **Website**: [tryprmpt.vercel.app](https://tryprmpt.vercel.app/)

## 🚀 Features

- **⚡ Adaptive Real-time Streaming**: Experience liquid-smooth text generation that adapts to network speed, ensuring a premium typing feel.
- **🎨 Modern UI**: Beautiful, responsive interface built with React, Tailwind CSS, and Shadcn UI.
- **📂 Chat Management**: Organize your optimizations with a full chat history, context menus (Delete, Rename, Share), and search.
- **👤 User Profiles**: Cloud-synced user preferences and profiles via Supabase. Customizable themes and settings.
- **🧠 Local AI Power**: Utilizes Ollama for privacy-focused, offline-capable prompt engineering.
- **🛡️ Guardrails**: Smart filtering to ensure the AI helps you write prompts, not write *for* you.

## 🛠️ Prerequisites

1. **Node.js** (v18 or higher)
2. **Python** (v3.10 or higher)
3. **Ollama** installed and running locally
4. **LLM Model**: `llama3.2` (recommended) pulled via `ollama pull llama3.2`

## 📦 Installation

1. **Clone the repository**
2. **Install dependencies**:
   ```bash
   npm install
   npm run python:install
   ```

## 🏃 Running the App

### Development Mode

You need to run two terminal processes:

**Terminal 1 - Python AI Service**:
```bash
npm run python:dev
```

**Terminal 2 - Electron App**:
```bash
npm run dev
```

### Production Build

```bash
npm run build
```

## 🏗️ Architecture

- **Frontend**: Electron + React (Vite) + Tailwind CSS
- **Backend**: Electron Main Process (TypeScript)
- **AI Service**: Python (FastAPI) + WebSocket
- **Database**: Supabase (PostgreSQL)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a deep dive into the system design, including the **Adaptive Buffered Streaming** engine and **IPC Architecture**.

## 📝 Latest Updates

- **Chat Context Menu**: Right-click or use the "..." menu in the sidebar to delete, rename, or share chats.
- **Smooth Streaming**: Re-engineered rendering engine that eliminates text chunking and visual jitters.
- **Unified Auth**: Centralized `AuthContext` ensures your profile and settings are consistent everywhere.

## 🤝 Contributing

Contributions are welcome! Please read the architecture docs before making major changes.

## 📄 License


