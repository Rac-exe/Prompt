-- ============================================
-- MIGRATION 002: Add Profiles and User Preferences
-- ============================================

-- Drop existing users table if it exists (will be replaced by profiles)
-- Note: In production, you'd migrate data first
DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- 1. PROFILES TABLE
-- ============================================
-- This extends auth.users with additional user information
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    dob DATE,
    email TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. USER PREFERENCES TABLE
-- ============================================
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    personalization_prompt TEXT,
    ui_settings JSONB DEFAULT '{
        "theme": "dark",
        "default_model": "llama3.2",
        "shortcuts": {
            "overlay_toggle": "Ctrl+5"
        },
        "optimization_preferences": {
            "auto_optimize": true,
            "show_diff": true,
            "min_prompt_length": 10
        },
        "privacy": {
            "store_history": true,
            "sync_across_devices": false
        }
    }'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- UPDATE EXISTING TABLES TO REFERENCE PROFILES
-- ============================================

-- Update chats table to reference auth.users (profiles inherits from auth.users)
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_user_id_fkey;
ALTER TABLE chats ADD CONSTRAINT chats_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update messages table
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_user_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update prompt_optimizations table
ALTER TABLE prompt_optimizations DROP CONSTRAINT IF EXISTS prompt_optimizations_user_id_fkey;
ALTER TABLE prompt_optimizations ADD CONSTRAINT prompt_optimizations_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_created_at ON profiles(created_at DESC);
CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);

-- ============================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Profiles RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- User Preferences RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
    ON user_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
    ON user_preferences FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
    ON user_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============================================
-- TRIGGERS FOR AUTO-UPDATING TIMESTAMPS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for profiles
CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for user_preferences
CREATE TRIGGER trigger_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Auto-create profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create profile entry (minimal data - will be updated during onboarding)
    INSERT INTO public.profiles (id, email, name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', 'User'));
    
    -- Create default preferences
    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile when user signs up
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- HELPER VIEWS
-- ============================================

-- View for complete user data (profile + preferences)
CREATE OR REPLACE VIEW user_full_profile AS
SELECT 
    p.id,
    p.name,
    p.dob,
    p.email,
    p.avatar_url,
    p.created_at,
    p.updated_at,
    up.personalization_prompt,
    up.ui_settings
FROM profiles p
LEFT JOIN user_preferences up ON p.id = up.user_id;

-- Grant access to authenticated users
GRANT SELECT ON user_full_profile TO authenticated;

-- ============================================
-- SAMPLE DATA (for testing)
-- ============================================
-- Note: Uncomment below if you want to create a test user
-- This should be done via Supabase Dashboard or Auth API instead

-- INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
-- VALUES (
--     '00000000-0000-0000-0000-000000000001',
--     'test@example.com',
--     '$2a$10$...',  -- Use Supabase Dashboard to create users
--     NOW(),
--     NOW(),
--     NOW()
-- );

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON TABLE profiles IS 'Extended user profile information linked to auth.users';
COMMENT ON TABLE user_preferences IS 'User-specific settings and personalization data';
COMMENT ON COLUMN user_preferences.personalization_prompt IS 'Custom instructions prepended to all optimizations for this user';
COMMENT ON COLUMN user_preferences.ui_settings IS 'JSONB field for flexible UI and app settings';
