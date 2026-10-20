# Prmpt: Help & Docs

---

## What is this, exactly?

You've probably had this happen: you open ChatGPT, type something like *"write me a cover letter"*, and get back something completely generic that you'd never actually send. The problem isn't the AI. It's that the AI needed more to work with than you gave it.

Prmpt sits between you and whatever AI you're using. You give it your rough idea, it turns it into a detailed, specific prompt that gets you a real answer. Then you paste that into ChatGPT, Claude, Midjourney, or wherever.

The part that makes it different is the overlay, a small floating panel that appears right where you're working, so you don't have to open another tab or switch apps. Type `@prompt` in any text box on Windows, and it's there.

---

## Table of Contents

1. [Getting started](#1-getting-started)
2. [The Overlay: how it actually works](#2-the-overlay-how-it-actually-works)
3. [Getting results you're happy with](#3-getting-results-youre-happy-with)
4. [Fast mode vs. Thinking mode](#4-fast-mode-vs-thinking-mode)
5. [Skills: when to bother](#5-skills-when-to-bother)
6. [Attaching files and images](#6-attaching-files-and-images)
7. [Voice input](#7-voice-input)
8. [Your chat history](#8-your-chat-history)
9. [Saving prompts you want to keep](#9-saving-prompts-you-want-to-keep)
10. [Sharing and backups](#10-sharing-and-backups)
11. [Memory: how Prmpt learns your style](#11-memory-how-prmpt-learns-your-style)
12. [Custom instructions](#12-custom-instructions)
13. [Your data and privacy](#13-your-data-and-privacy)
14. [Keyboard shortcuts](#14-keyboard-shortcuts)
15. [Things that catch people off guard](#15-things-that-catch-people-off-guard)
16. [Get help](#16-get-help)

---

## 1. Getting started

Prmpt is open source and runs on your computer. There's nothing to sign up for: you bring your own OpenRouter API key, and Prmpt uses it to reach the AI models.

### Running Prmpt from source

Prmpt has two small local services that run next to the app: one optimizes your prompts, the other powers Spaces (questions about your code). Both need to be running before you open the app, or you'll see connection errors. The [README](../README.md#getting-started) has the commands to install and start them.

### First launch

The first time you open Prmpt, it walks you through a short setup:

1. **Pick a theme.**
2. **Connect your AI provider.**
   - **OpenRouter API key**: paste your key. You can get one at [openrouter.ai/keys](https://openrouter.ai/keys). Prmpt checks it with OpenRouter before saving it, and you only pay OpenRouter for what you use.
   - **Prompt optimization model**: the model that rewrites your prompts, in the app and in the `@prompt` overlay.
   - **Code intelligence (RAG) model**: the model that answers questions about your Spaces. It needs tool calling, so this list only shows models that support it.
3. **Take the quick feature tour**, then you're in.

Not ready to add a key yet? Click **Set this up later (Settings > AI provider)**. Until a key is saved, the overlay shows a "Connect your AI provider" message instead of the input box.

### Changing your key or models later

Go to **Settings → AI provider**. Paste a new key to replace the saved one, pick different models, then click **Save**. This is also where you add an optional Deepgram key for voice input (see [section 7](#7-voice-input)).

---

## 2. The Overlay: how it actually works

The overlay is a small floating panel that appears on top of whatever you're doing. You don't have to stop working or switch apps.

### Three ways to open it

**Type `@prompt` in any text field.**
This is the main one. While you're writing in a browser, in Slack, in Notion, in Word, anywhere, just type `@prompt`. The overlay opens right next to your cursor. When you're done, click **Insert** and the optimized text replaces the `@prompt` you typed. You never had to leave the app.

**Press `Ctrl+5` from anywhere.**
Works as a toggle; press it again to close. Good for when you want to quickly optimize something that's already in your head, without typing `@prompt` first.

**Right-click the tray icon → Toggle Overlay.**
The Prmpt icon lives in your system tray (bottom-right of your taskbar). If you don't see it, click the up arrow to show hidden icons.

---

### The Insert button: why it's sometimes missing

If you opened the overlay with `Ctrl+5` or via the tray, the **Insert** button won't appear. That's not a bug. Insert works by putting the optimized text back into the exact app and text field where you typed `@prompt`. If you didn't trigger it that way, Prmpt doesn't know where to send it, so it only shows Copy instead.

If you want Insert, close the overlay, go to the text field where you want the result to end up, and type `@prompt` there.

---

### The overlay closed and I lost my result

The overlay closes when you click anywhere outside it. If that happened before you could copy or insert the result:

- Open the main Prmpt window from the tray → **Open App**
- Look under **Recent** in the sidebar — your last optimization is saved there
- Open it and copy from there

---

## 3. Getting results you're happy with

The first result you get might not be exactly what you want. That's fine. You can refine it without starting over.

**Just reply in the same chat.** If the result was too long, say *"make it shorter"*. If it was too formal, say *"more casual"*. If it missed the point, tell it what was wrong. Prmpt keeps the context of your entire conversation, so it knows what it already gave you.

**Edit your original message.** Hover over your message and click the pencil icon. Change what you wrote and send it again. Prmpt treats this as a new version; you can flip between the original and the new one using the `← →` arrows that appear on the message.

**Hit Regenerate.** If the result wasn't what you wanted but you're not sure exactly why, just try again. Different run, different result.

---

### The result is in the wrong format

If Prmpt keeps giving you bullet-point lists when you want paragraphs, or formal language when you want casual, instead of correcting it every time, set a custom instruction (see [section 12](#12-custom-instructions)). That way you only have to say it once.

---

### Before and after

**Writing task**

| | Prompt |
|---|---|
| What you typed | *write a blog post about productivity* |
| What you send to the AI | *Write a 600-word blog post for busy professionals. Open with a real story about a week where everything felt out of control. Focus on three habits that are unglamorous but actually work. End with something the reader can do in the next 10 minutes. Tone: direct, a little dry.* |

---

**Coding task**

| | Prompt |
|---|---|
| What you typed | *python script to parse csv* |
| What you send to the AI | *Write a Python function that reads a CSV file from a given path using pandas. It should: fill missing values with 0, detect and skip header rows automatically, return a cleaned DataFrame, and raise a descriptive error if the file doesn't exist. Add a short usage example below the function definition.* |

---

**Image generation**

| | Prompt |
|---|---|
| What you typed | *a city at night* |
| What you send to the AI | *Rainy Tokyo street at night, neon signs reflected in standing water, a single person in a dark hoodie walking away from camera, 35mm film, shallow depth of field, low ambient light, no lens flare, moody and quiet atmosphere, ultra-detailed, cinematic.* |

---

## 4. Fast mode vs. Thinking mode

Both modes do the same thing. One just takes longer and works harder.

**Fast mode** is the default. It's genuinely fast (a few seconds) and handles the vast majority of things well: emails, quick code questions, social captions, everyday writing. Use this for anything you'd describe as "straightforward."

**Thinking mode** is for when you actually need it. It takes longer (sometimes 15-30 seconds), but it reasons through your request more carefully. Worth it for prompts that need nuance, anything where the wording really matters, complex technical specs, or creative requests where "good enough" isn't enough.

Switch between them using the button at the bottom-left of the input bar. If you're not sure, start with Fast. You can always switch and try again.

---

## 5. Skills: when to bother

Skills give Prmpt a lens to look through when optimizing your prompt. Picking "Technical" makes it think like a developer. Picking "Creative" makes it think like an editor. Each one changes how the result is structured and worded.

| Skill | Use it when you're working on... |
|---|---|
| **Technical** | Code, APIs, system design, debugging prompts |
| **Creative** | Fiction, blog posts, social content, anything where voice matters |
| **Business** | Strategy docs, analysis, pitches, board-level writing |
| **Communication** | Emails, messages, anything going to a real person |
| **Educational** | Tutorials, explanations, guides meant to teach |
| **Visual** | Prompts for image generators (Midjourney, DALL-E, etc.) |
| **Automation** | Workflow instructions, scripts, step-by-step task specs |
| **Research** | Summaries, literature review, synthesizing information |

**When to skip it:** If you don't pick a skill, Prmpt looks at what you wrote and makes a reasonable guess. For most people most of the time, this works fine. You only really need to set one when the auto-detection is getting it wrong.

**How to pick one:** Click the `+` button in the input area → **Choose skill** → click whichever fits. A small tag appears in the input bar. Click `×` on it to remove it.

---

## 6. Attaching files and images

**What you can attach:** PDFs, PNG, JPG, or WebP images. Up to 5 files at a time, 10 MB each.

**To attach:** Click `+` in the input → **Add photos & files** → pick your files. They show up as cards above the input. Hit `×` on any card to remove it.

You can also **paste an image directly from your clipboard** with `Ctrl+V`, useful if you just took a screenshot.

---

**When files actually help:**

- You have a dense PDF (a report, a paper, a spec) and you want Prmpt to use the actual content, not just your description of it
- You have a screenshot of a UI and want to ask an image generator to create something similar
- You have a document you want rewritten and attaching it is faster than pasting the text

**When files don't help much:** Attaching a huge PDF when you only care about one paragraph. Just paste the relevant section instead; it'll be faster and more accurate.

---

## 7. Voice input

Voice input is optional. It uses Deepgram for transcription with your own Deepgram API key: add one in **Settings → AI provider** under **Deepgram API key**. If you leave that field empty, voice input stays off. You can get a key at [console.deepgram.com](https://console.deepgram.com/).

Click the microphone icon on the right side of the input bar. It turns red when recording. Speak your idea, and the text appears in real time as you talk. Click the icon again to stop, review what was captured, then hit Enter to optimize.

A few things worth knowing:
- It works best in a reasonably quiet environment, as background noise can throw off transcription
- You don't need to speak slowly or formally. Normal conversational speed is fine
- If it gets a word wrong, you can edit the text in the input box before sending
- On Windows, make sure Prmpt has microphone permission: **Settings → Privacy & Security → Microphone**
- While you record, your audio is streamed to Deepgram to be transcribed

---

## 8. Your chat history

Every optimization you do is saved as a conversation.

**Things you can do:**
- Click any chat in the sidebar to open it
- Hover over a chat → click `⋯` → **Rename** to give it a meaningful name
- Hover → `⋯` → **Delete** to remove it permanently
- Click **New Chat** to start fresh

**Version history within a chat:**
When you edit or regenerate a message, Prmpt saves the previous version. The `← →` arrows on a message let you flip between them. This is useful when you're not sure if the new version is actually better.

**Offline:** Your chats are saved on your computer, so you can still open and read them without internet. Sending new optimizations needs a connection, because Prmpt reaches the AI models through OpenRouter.

---

## 9. Saving prompts you want to keep

Chat history keeps everything, but it's not where you go when you want to *reuse* something. The library is.

After getting a result you like, click the **save** icon on the response. You'll name it and put it in a collection.

**Collections** are just folders. Make as many as you want — *Work Emails*, *Code Snippets*, *Image Prompts*, whatever makes sense for how you actually work. The default **All Prompts** view always shows everything you've saved.

**Things you can do with a saved prompt:**

| | |
|---|---|
| **Open** | Click the card to see the full text, with a button to copy it |
| **Copy** | Grab the text to paste somewhere |
| **Download** | Save it as a `.txt` file on your computer |
| **Edit** | Change the title, or move it to a different collection |
| **Delete** | Gone permanently, no undo |

Deletions are permanent. If you have a prompt you worked hard on, use **Download** to keep a backup before deleting.

---

## 10. Sharing and backups

Prmpt doesn't create share links. Your library lives on your computer, not on a server, so there's nothing for someone else to open.

**To share a prompt:** Hover over the prompt card and use **Copy** to paste the text into a message, or **Download** to get a `.txt` file you can send however you like.

**To back up a prompt:** Use **Download**. Prmpt doesn't sync anything to the cloud, so a downloaded copy is your backup.

---

## 11. Memory: how Prmpt learns your style

After you've used Prmpt for a bit, it starts picking up on patterns: what field you work in, how you like things written, what keeps coming up in your requests. It stores these inferences and uses them as background context for future optimizations, so results feel more like they're written for you.

**To see what it's inferred:** Settings → Memory. You'll see entries like "Backend engineering" or "Prefers concise answers."

**You can:**
- Edit any entry to correct it
- Delete entries that are wrong
- Add your own facts manually (these are always trusted over inferred ones)
- Turn off automatic learning entirely if you'd rather it not track patterns

**About privacy:** Memory is stored on your computer, in the same local database as your chats, and isn't shared with anyone. To learn, Prmpt sends one of your prompts and its result to OpenRouter (with your key) every third optimization and asks a model to pick out facts. Turn off automatic learning and that stops.

**When memory isn't helping:** If you work across very different domains (developer some days, marketing writing other days), memory might pull in assumptions that don't fit. Either delete the entries that don't apply, or turn off automatic learning and add manual facts for what's always true about you.

---

## 12. Custom instructions

Custom instructions are a short note you write once, and Prmpt adds it to every single optimization. Most people skip this and then wonder why results don't sound like them. This is where you fix that.

**Where to set it:** Settings → Customize → Custom Instructions.

Just tell it what you always want:

- `I'm a backend engineer. Always assume I know what I'm doing, don't over-explain basics.`
- `I work in healthcare. Avoid medical jargon when writing for patients, use it freely when writing for clinicians.`
- `Keep everything under 200 words unless I specifically ask for something longer.`
- `British English spelling. Always.`
- `I hate bullet points. Write in prose unless the task genuinely calls for a list.`

---

## 13. Your data and privacy

**No sign-up, no sign-in.** Prmpt is a single-user app on your own computer. There's no login screen and no cloud copy of your data.

**Where your data lives:** Your chats, saved prompts and collections, memory, settings, profile name and avatar, attachments, and Spaces code indexes all stay on your computer, in Prmpt's data folder. Most of it is in one local database file called `prmpt.db`; attachments sit next to it in an `attachments` folder.

**Your API keys:** Your OpenRouter and Deepgram keys are saved in that same local database (encrypted with your operating system's keystore on Windows). The app's screens only ever show the last few characters.

**What goes over the internet:** Prmpt still needs a connection to reach the AI models. Your prompts and attachments go to OpenRouter using your key, and so do your Spaces questions and the code snippets needed to index and answer them. Voice audio goes to Deepgram, only if you've added a Deepgram key and use the microphone. Prmpt doesn't collect analytics or crash reports.

**Your profile:** Settings → Profile lets you change your name and avatar. Both are stored only on this computer.

**Deleting things:** Delete chats from the sidebar (`⋯` → **Delete**), prompts from the library (trash icon), and memory facts from Settings → Memory. There's no account to delete. If you want to wipe everything, quit Prmpt and delete its data folder.

---

## 14. Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| Type `@prompt` anywhere | Opens the overlay at your cursor |
| `Ctrl+5` | Toggle the overlay open or closed |
| `Enter` | Send your message |
| `Shift+Enter` | New line in the input box |
| `Esc` | Close the overlay |

---

## 15. Things that catch people off guard

**`@prompt` didn't do anything.**
It only works in actual, editable text fields. If you typed it in a browser address bar, a read-only area, a search box, or a game, it won't trigger. Try it in something like a Gmail compose window, Notepad, or a Slack message box.

**The result is pasted in the wrong place.**
When you click Insert, Prmpt sends the text to the last active text field before the overlay opened. If you clicked somewhere else between triggering the overlay and clicking Insert, the focus may have shifted. Click Insert promptly, or use Copy and paste manually.

**The overlay appeared on the wrong monitor.**
The overlay opens at your cursor position. Before triggering it, make sure your cursor is on the right screen.

**The optimization sounds nothing like me.**
Go to Settings → Customize → Custom Instructions and describe your preferences. Even one or two sentences makes a noticeable difference.

**I'm getting the same result every time I regenerate.**
Try switching from Fast to Thinking mode, or add a note like "give me something different from last time." If your original prompt is very constrained, there's only so much variation it can introduce.

**The app seems slow or unresponsive.**
The Python service needs to be running separately. If you see connection errors, start it with `npm run python:dev` in a terminal and leave it running. Spaces also needs the code intelligence service (`npm run code-intel:dev`). See [Getting started](#1-getting-started).

**I edited a message and now I can't find the original.**
The original is still there. Use the `←` arrow on the message to go back to the previous version.

**The overlay says "Connect your AI provider", or I get an error about my key or model.**
Open Settings → AI provider. If no key is saved, paste your OpenRouter key and click Save. If OpenRouter rejected the key, paste a fresh one from [openrouter.ai/keys](https://openrouter.ai/keys). If the model wasn't found, pick a different one from the list. A rate limit or credit limit message means it's worth checking your OpenRouter credits.

---

## 16. Get help

If something isn't working, something's confusing, or you have a suggestion, let us know.

- **GitHub issues:** [github.com/Rac-exe/Prompt/issues](https://github.com/Rac-exe/Prompt/issues). Open an issue for bugs, questions, or ideas.
- **In the app:** Click your name at the bottom of the sidebar → **Help & Docs** to open the project README.

If it's a bug, tell us what you were doing when it happened and what you expected instead. Please don't paste your API keys into an issue.
