# Prompt Optimizer

A global desktop application that optimizes AI prompts in real-time across any application on your system.

## Features

- 🌐 **Global Detection**: Works system-wide in any application (browser, IDE, text editors, etc.)
- ⚡ **Real-time Optimization**: Instantly optimizes prompts as you type
- 🔒 **Privacy First**: All processing happens locally - no data leaves your device
- 🎯 **Smart Highlighting**: Visual indicators show optimized prompts
- 🖱️ **One-Click Replace**: Replace original text with optimized version instantly

## Prerequisites

1. **Node.js** (v18 or higher)
2. **Python** (v3.8 or higher)
3. **Ollama** installed and running locally
4. **LLM Model** downloaded in Ollama

### Installing Ollama

- **Windows**: Download from [ollama.ai](https://ollama.ai/download)
- **macOS**: `brew install ollama` or download from website
- **Linux**: See [ollama.ai](https://ollama.ai/download)

### Download a Model

```bash
# Example: Download LLaMA 3.2
ollama pull llama3.2

# Or try other models
ollama pull mistral
ollama pull codellama
```

## Installation

1. **Clone or download this repository**

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

3. **Install Python dependencies**:
   ```bash
   npm run python:install
   # Or manually:
   cd python-service
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

## Running the Application

### Development Mode

You need to run two processes:

**Terminal 1 - Python Service**:
```bash
npm run python:dev
```

**Terminal 2 - Electron App**:
```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

## Usage

1. Start both the Python service and Electron app
2. Open any text editor or application (Notepad, VS Code, Chrome, etc.)
3. Type: `@prompt your prompt text here`
4. Wait a moment for optimization (1-5 seconds)
5. The prompt text will be highlighted
6. Hover over the highlight to see the optimized version
7. Click "Replace" to use the optimized prompt

## Permissions

### Windows
- No special permissions required (uses low-level keyboard hook)

### macOS
- **Accessibility Permission Required**
  - Go to System Preferences → Security & Privacy → Privacy → Accessibility
  - Add the Prompt Optimizer app
  - Restart the app if needed

## Architecture

- **Electron**: Desktop application shell and UI
- **TypeScript**: Main process logic and orchestration
- **Python (FastAPI)**: AI service and Ollama integration
- **Ollama**: Local LLM inference

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## Project Structure

```
prompt-optimizer/
├── electron/              # Electron application
│   ├── main/             # Main process (TypeScript)
│   ├── renderer/         # UI files (HTML)
│   └── preload.ts        # Preload script
├── python-service/       # Python AI service
│   └── app/
│       └── main.py       # FastAPI server
├── package.json
└── README.md
```

## Configuration

### Changing the LLM Model

Edit `python-service/app/main.py` and change the model name:

```python
response = ollama.chat(
    model="your-model-name",  # Change this
    ...
)
```

### Changing the Port

Edit `electron/main/api/python-client.ts`:

```typescript
this.pythonClient = new PythonClient("http://localhost:8000"); // Change port
```

And `python-service/app/main.py`:

```python
uvicorn.run(app, host="127.0.0.1", port=8000)  # Change port
```

## Troubleshooting

### "Python service not available"
- Ensure the Python service is running: `npm run python:dev`
- Check that Ollama is running: `ollama list`
- Verify the port (default: 8000) is not in use

### Keyboard hook not working
- **Windows**: Try running as administrator
- **macOS**: Grant Accessibility permissions (see Permissions section)

### Optimization is slow
- Use a smaller/faster model
- Ensure Ollama has enough system resources
- Check that the model is loaded: `ollama list`

### Overlay not showing
- Check console for errors
- Verify window bounds calculation
- Try in a different application

## Development

### Building

```bash
npm run build
```

### Running Tests

(Add your test commands here)

## Limitations

- **Cursor Position**: Currently uses estimation - may not be perfectly accurate
- **Text Capture**: Simplified implementation - may not capture all special characters
- **Text Replacement**: Uses keyboard simulation - may not work in all applications
- **Single Language**: English only (MVP)

## Roadmap

- [ ] Improved cursor position detection
- [ ] Better text capture
- [ ] Application-specific integrations
- [ ] Multiple model support
- [ ] Custom system prompts
- [ ] Undo/redo support
- [ ] Settings UI

## License

MIT

## Contributing

Contributions welcome! Please open an issue or pull request.

## Support

For issues and questions, please open a GitHub issue.
