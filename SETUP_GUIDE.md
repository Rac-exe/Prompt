# Quick Setup Guide - Plus Menu Feature

## 🚀 Environment Setup

### **Step 1: Copy Environment File**
```bash
cp .env.example .env
```

### **Step 2: Configure Required Variables**

#### **Essential (Required for Vision Models):**
```bash
# OpenRouter API Key (Required)
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Supabase (Required for data storage)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

#### **Optional (Recommended for Budget Control):**
```bash
# Default to budget-friendly model
DEFAULT_MODEL=openai/gpt-4o-mini

# Cheap model for summarization
SUMMARIZER_MODEL=claude-haiku-4-5-20251001
```

---

## 🔑 Getting Your API Keys

### **OpenRouter API Key** (Required for Vision)
1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up for an account
3. Go to [Keys](https://openrouter.ai/keys)
4. Create a new API key
5. Add some credits ($5-10 is plenty to start)
6. Copy the key (starts with `sk-or-v1-`)

### **Supabase Keys** (Required for Data)
1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Go to Settings → API
4. Copy the Project URL and anon/public key

---

## 💰 Budget Setup (Recommended)

### **Your .env should look like:**
```bash
# Supabase
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenRouter (Budget-friendly)
OPENROUTER_API_KEY=sk-or-v1-1234567890abcdef...
DEFAULT_MODEL=openai/gpt-4o-mini

# Python Service
PYTHON_SERVICE_URL=http://127.0.0.1:8001
```

---

## 🧪 Test Your Setup

### **1. Install Dependencies:**
```bash
cd python-service
pip install -r requirements.txt
```

### **2. Start the App:**
```bash
npm run dev
```

### **3. Test Vision Processing:**
1. Click the Plus button (should show ChatGPT-style menu)
2. Upload an image
3. Ask: "What do you see in this image?"
4. **Expected:** Detailed image analysis
5. **Cost:** ~$0.0007 per image with GPT-4o Mini

---

## 🔧 Troubleshooting

### **"OPENROUTER_API_KEY not set" Error:**
- Make sure your `.env` file has the correct key
- Restart the Python service after adding the key
- Check the key starts with `sk-or-v1-`

### **"Image processing not available" Error:**
- Ensure you're using a vision model: `openai/gpt-4o-mini`
- Check your OpenRouter account has credits
- Verify the model name is correct in settings

### **Files not showing in chat:**
- This is now fixed in the latest version
- Files should appear as pills above your messages
- Skills should show as colored pills

---

## 📊 Cost Monitoring

### **Expected Costs with GPT-4o Mini:**
- **Per image:** ~$0.0007
- **Per 100 images:** ~$0.07
- **Per 1000 images:** ~$0.75

### **Monitor Usage:**
- Check your OpenRouter dashboard regularly
- Set up billing alerts
- Start with $5-10 in credits

---

## ✅ Verification Checklist

- [ ] `.env` file created from `.env.example`
- [ ] `OPENROUTER_API_KEY` set with valid key
- [ ] `SUPABASE_URL` and `SUPABASE_ANON_KEY` configured
- [ ] `DEFAULT_MODEL=openai/gpt-4o-mini` for budget control
- [ ] Python dependencies installed (`pip install -r requirements.txt`)
- [ ] App starts without errors (`npm run dev`)
- [ ] Plus menu opens with ChatGPT-style design
- [ ] Image upload works and shows file pills
- [ ] Vision processing returns image analysis

**Once all items are checked, your Plus Menu feature is ready for production use!**