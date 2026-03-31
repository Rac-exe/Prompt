# Prmpt: Help & Docs

---

## What is this, exactly?

You've probably had this happen: you open ChatGPT, type something like *"write me a cover letter"*, and get back something completely generic that you'd never actually send. The problem isn't the AI. It's that the AI needed more to work with than you gave it.

Prmpt sits between you and whatever AI you're using. You give it your rough idea, it turns it into a detailed, specific prompt that gets you a real answer. Then you paste that into ChatGPT, Claude, Midjourney, or wherever.

The part that makes it different is the overlay, a small floating panel that appears right where you're working, so you don't have to open another tab or switch apps. Type `@prompt` in any text box on Windows, and it's there.

---

## Table of Contents

1. [The Overlay: how it actually works](#1-the-overlay-how-it-actually-works)
2. [Getting results you're happy with](#2-getting-results-youre-happy-with)
3. [Fast mode vs. Thinking mode](#3-fast-mode-vs-thinking-mode)
4. [Skills: when to bother](#4-skills-when-to-bother)
5. [Attaching files and images](#5-attaching-files-and-images)
6. [Voice input](#6-voice-input)
7. [Your chat history](#7-your-chat-history)
8. [Saving prompts you want to keep](#8-saving-prompts-you-want-to-keep)
9. [Sharing](#9-sharing)
10. [Memory: how Prmpt learns your style](#10-memory-how-prmpt-learns-your-style)
11. [Custom instructions](#11-custom-instructions)
12. [Account and sign-in](#12-account-and-sign-in)
13. [Keyboard shortcuts](#13-keyboard-shortcuts)
14. [Things that catch people off guard](#14-things-that-catch-people-off-guard)
15. [Reach us](#15-reach-us)

---

## 1. The Overlay: how it actually works

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
- Go to **History** in the sidebar — your last optimization is saved there
- Open it and copy from there

---

## 2. Getting results you're happy with

The first result you get might not be exactly what you want. That's fine. You can refine it without starting over.

**Just reply in the same chat.** If the result was too long, say *"make it shorter"*. If it was too formal, say *"more casual"*. If it missed the point, tell it what was wrong. Prmpt keeps the context of your entire conversation, so it knows what it already gave you.

**Edit your original message.** Hover over your message and click the pencil icon. Change what you wrote and send it again. Prmpt treats this as a new version; you can flip between the original and the new one using the `← →` arrows that appear on the message.

**Hit Regenerate.** If the result wasn't what you wanted but you're not sure exactly why, just try again. Different run, different result.

---

### The result is in the wrong format

If Prmpt keeps giving you bullet-point lists when you want paragraphs, or formal language when you want casual, instead of correcting it every time, set a custom instruction (see [section 11](#11-custom-instructions)). That way you only have to say it once.

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

## 3. Fast mode vs. Thinking mode

Both modes do the same thing. One just takes longer and works harder.

**Fast mode** is the default. It's genuinely fast (a few seconds) and handles the vast majority of things well: emails, quick code questions, social captions, everyday writing. Use this for anything you'd describe as "straightforward."

**Thinking mode** is for when you actually need it. It takes longer (sometimes 15-30 seconds), but it reasons through your request more carefully. Worth it for prompts that need nuance, anything where the wording really matters, complex technical specs, or creative requests where "good enough" isn't enough.

Switch between them using the button at the bottom-left of the input bar. If you're not sure, start with Fast. You can always switch and try again.

---

## 4. Skills: when to bother

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

## 5. Attaching files and images

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

## 6. Voice input

Click the microphone icon on the right side of the input bar. It turns red when recording. Speak your idea, and the text appears in real time as you talk. Click the icon again to stop, review what was captured, then hit Enter to optimize.

A few things worth knowing:
- It works best in a reasonably quiet environment, as background noise can throw off transcription
- You don't need to speak slowly or formally. Normal conversational speed is fine
- If it gets a word wrong, you can edit the text in the input box before sending
- On Windows, make sure Prmpt has microphone permission: **Settings → Privacy & Security → Microphone**

---

## 7. Your chat history

Every optimization you do is saved as a conversation.

**Things you can do:**
- Click any chat in the sidebar to open it
- Hover over a chat → click `⋯` → **Rename** to give it a meaningful name
- Hover → `⋯` → **Delete** to remove it permanently
- Click **New Chat** to start fresh

**Version history within a chat:**
When you edit or regenerate a message, Prmpt saves the previous version. The `← →` arrows on a message let you flip between them. This is useful when you're not sure if the new version is actually better.

**Offline:** If you lose internet, your most recent chats are still readable from a local cache. You won't be able to send new optimizations until you're back online.

---

## 8. Saving prompts you want to keep

Chat history keeps everything, but it's not where you go when you want to *reuse* something. The library is.

After getting a result you like, click the **save** icon on the response. You'll name it and put it in a collection.

**Collections** are just folders. Make as many as you want — *Work Emails*, *Code Snippets*, *Image Prompts*, whatever makes sense for how you actually work. The default **All Prompts** and **Favorites** views are always there.

**Things you can do with a saved prompt:**

| | |
|---|---|
| **Open** | Load it back into chat to keep refining it |
| **Copy** | Grab the text to paste somewhere |
| **Download** | Save it as a `.txt` file on your computer |
| **Favorite** | Star it so it shows up in the Favorites view |
| **Edit** | Change the title, or fix something in the content |
| **Share** | Generate a link anyone can open |
| **Delete** | Gone permanently, no undo |

Deletions are permanent. If you have a prompt you worked hard on, use **Download** to keep a backup before deleting.

---

## 9. Sharing

**Share a whole collection:**
Open the Prompt Library → click the share icon next to a collection name → copy the link. Anyone with the link can view the collection and save the whole thing to their own Prmpt library.

**Share a single prompt:**
Hover over any prompt card → click the share icon → copy the link. The link opens in a browser. No account needed. Anyone can read it or copy the text.

**What recipients can and can't do:**
- They can view and copy any shared prompt or collection without signing in
- If they have a Prmpt account, they can save a shared collection directly to their own library
- They can't edit your originals — sharing is read-only

---

## 10. Memory: how Prmpt learns your style

After you've used Prmpt for a bit, it starts picking up on patterns: what field you work in, how you like things written, what keeps coming up in your requests. It stores these inferences and uses them as background context for future optimizations, so results feel more like they're written for you.

**To see what it's inferred:** Settings → Memory. You'll see entries like "Backend engineering" or "Prefers concise answers."

**You can:**
- Edit any entry to correct it
- Delete entries that are wrong
- Add your own facts manually (these are always trusted over inferred ones)
- Turn off automatic learning entirely if you'd rather it not track patterns

**About privacy:** Memory data is stored in your account and not shared with anyone.

**When memory isn't helping:** If you work across very different domains (developer some days, marketing writing other days), memory might pull in assumptions that don't fit. Either delete the entries that don't apply, or turn off automatic learning and add manual facts for what's always true about you.

---

## 11. Custom instructions

Custom instructions are a short note you write once, and Prmpt adds it to every single optimization. Most people skip this and then wonder why results don't sound like them. This is where you fix that.

**Where to set it:** Settings → Customize → Custom Instructions.

Just tell it what you always want:

- `I'm a backend engineer. Always assume I know what I'm doing, don't over-explain basics.`
- `I work in healthcare. Avoid medical jargon when writing for patients, use it freely when writing for clinicians.`
- `Keep everything under 200 words unless I specifically ask for something longer.`
- `British English spelling. Always.`
- `I hate bullet points. Write in prose unless the task genuinely calls for a list.`

---

## 12. Account and sign-in

**Sign up:** Open Prmpt → click **Sign up** → enter your email and password, or use **Continue with Google** / **Continue with GitHub** for one-click signup. No email verification step.

**Sign in with Google or GitHub:**
Click the button, your browser opens, sign in, and the tab closes automatically. If the tab doesn't close, you can close it manually — the session will have already been picked up.

**Sign out:** Click your name or avatar at the bottom of the sidebar → **Sign Out**.

**Staying signed in:** Prmpt keeps your session active between restarts.

**Delete account:** Settings → Profile → **Delete Account**. This permanently removes your chats, library, memory, and profile. There's no recovery.

---

## 13. Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| Type `@prompt` anywhere | Opens the overlay at your cursor |
| `Ctrl+5` | Toggle the overlay open or closed |
| `Enter` | Send your message |
| `Shift+Enter` | New line in the input box |
| `Esc` | Close the overlay |

---

## 14. Things that catch people off guard

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
The Python service needs to be running separately. If you see connection errors, start it with `npm run python:dev` in a terminal and leave it running.

**I edited a message and now I can't find the original.**
The original is still there. Use the `←` arrow on the message to go back to the previous version.

**Shared link says the content doesn't exist.**
The collection or prompt may have been deleted after the link was generated.

---

## 15. Reach us

If something isn't working, something's confusing, or you have a suggestion, reach out.

- **In the app:** Click **Help** at the bottom of the sidebar
- **Email:** support@tryprmpt.com
- **Website:** [tryprmpt.vercel.app](https://tryprmpt.vercel.app)

If it's a bug, tell us what you were doing when it happened and what you expected instead.
