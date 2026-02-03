# 🚀 Quick Start: Supabase Auth Setup (5 Minutes)

## Step-by-Step Setup

### 1. Create Supabase Project (2 minutes)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click "New Project"
3. Enter:
   - **Name:** `prompt-optimizer`
   - **Database Password:** (choose strong password, save it!)
   - **Region:** (choose closest to you)
4. Click "Create new project"
5. Wait ~2 minutes for provisioning

### 2. Get Your Credentials (30 seconds)

1. In Supabase Dashboard, go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (e.g., `https://abcdefgh.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

### 3. Configure Your App (30 seconds)

1. In the `Prompt/` folder, copy `.env.example` to `.env`:
   ```bash
   cd Prompt
   cp .env.example .env
   ```

2. Edit `.env` and paste your credentials:
   ```env
   SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
   SUPABASE_ANON_KEY=eyJhbG...your-key-here
   ```

### 4. Run Database Migrations (1 minute)

**Option A: Using Supabase Dashboard (Recommended)**

1. In Supabase Dashboard → **SQL Editor**
2. Click "New query"
3. Copy entire contents of `supabase/migrations/001_init_schema.sql`
4. Paste and click "Run"
5. Wait for success message
6. Repeat for `supabase/migrations/002_add_profiles_and_preferences.sql`

**Option B: Using Supabase CLI**

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### 5. Verify Setup (30 seconds)

In Supabase Dashboard → **Table Editor**, you should see:
- ✅ profiles
- ✅ user_preferences
- ✅ chats
- ✅ messages
- ✅ prompt_optimizations
- ✅ prompt_versions

### 6. Start the App (1 minute)

**Terminal 1: Python Service**
```bash
cd Prompt
npm run python:dev
```

**Terminal 2: Electron App**
```bash
cd Prompt
npm run build:ui  # First time only
npm run build
npm run electron
```

### 7. Test It Out! 🎉

1. ✅ App opens showing **login screen**
2. ✅ Click "Sign up"
3. ✅ Enter:
   - Name: Test User
   - DOB: 1990-01-01
   - Email: test@example.com
   - Password: test123
4. ✅ Click "Sign Up"
5. ✅ You're automatically logged in
6. ✅ Main app appears!
7. ✅ Type a prompt → Get optimization
8. ✅ Close app and reopen → **Still logged in!** (session restored)

---

## 🎯 What You Can Do Now

### User Features
- ✅ **Sign up** with name, DOB, email, password
- ✅ **Log in** and stay logged in (session persists)
- ✅ **Sign out** and log back in
- ✅ **Create chats** and send messages
- ✅ **Optimize prompts** with AI
- ✅ **View chat history** in sidebar

### Personalization (Coming Soon in UI)
- Set custom instructions (e.g., "Always be concise")
- Customize theme, model, shortcuts
- Configure privacy settings

### Overlay
- ✅ Works **without login** (ephemeral)
- ✅ **Saves to database** if logged in
- ✅ Press `Ctrl+5` or type `@prompt` anywhere

---

## 🐛 Troubleshooting

### "Supabase client not initialized"
- ✅ Check `.env` file exists in `Prompt/` folder
- ✅ Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct
- ✅ Restart the app

### Login fails with "Invalid credentials"
- ✅ Check email/password are correct
- ✅ Verify user exists in Supabase Dashboard → Authentication → Users

### Migrations fail
- ✅ Run `001_init_schema.sql` first
- ✅ Then run `002_add_profiles_and_preferences.sql`
- ✅ Check for red error messages in SQL Editor

### App shows blank screen
- ✅ Check Terminal 1: Python service running
- ✅ Check DevTools console (Ctrl+Shift+I) for errors
- ✅ Verify React UI was built: `npm run build:ui`

---

## 📚 Next Steps

1. Read full docs: `AUTH_INTEGRATION_COMPLETE.md`
2. Customize UI: Edit files in `app-ui/src/`
3. Add features: Extend services in `electron/main/database/services/`
4. Deploy: Package app with `electron-builder`

---

## 🎉 Success!

You now have a **production-ready authentication system** with:
- ✅ Secure user accounts
- ✅ Persistent sessions
- ✅ User profiles and preferences
- ✅ Chat history per user
- ✅ Personalization support

**Total Setup Time:** ~5 minutes ⚡

Enjoy building with Prompt Optimizer! 🚀
