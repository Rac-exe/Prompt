-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settings JSONB DEFAULT '{
        "theme": "dark",
        "default_model": "llama3.2",
        "shortcuts": {"overlay_toggle": "Ctrl+5"},
        "optimization_preferences": {
            "auto_optimize": true,
            "show_diff": true,
            "min_prompt_length": 10
        },
        "privacy": {
            "store_history": true,
            "sync_across_devices": false
        }
    }'::jsonb
);

-- Chats table
CREATE TABLE chats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_pinned BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{
        "tags": [],
        "folder": null,
        "color": "#ffffff",
        "statistics": {
            "total_messages": 0,
            "total_optimizations": 0,
            "avg_response_time_ms": 0
        }
    }'::jsonb
);

-- Message role enum
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    role message_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    optimization_id UUID,
    metadata JSONB DEFAULT '{
        "model": "llama3.2",
        "tokens": {"prompt": 0, "completion": 0, "total": 0},
        "timing": {"duration_ms": 0}
    }'::jsonb
);

-- Optimization source enum
CREATE TYPE optimization_source AS ENUM ('overlay', 'app_window', 'api');

-- Prompt optimizations table
CREATE TABLE prompt_optimizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_text TEXT NOT NULL,
    optimized_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source optimization_source NOT NULL DEFAULT 'overlay',
    applied BOOLEAN DEFAULT FALSE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    metadata JSONB DEFAULT '{
        "model": "llama3.2",
        "latency_ms": 0,
        "source_context": {},
        "optimization_params": {},
        "diff_stats": {}
    }'::jsonb
);

-- Prompt versions table (for regenerations)
CREATE TABLE prompt_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    optimization_id UUID NOT NULL REFERENCES prompt_optimizations(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    optimized_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_selected BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{
        "regeneration_count": 0,
        "temperature": 0.7,
        "variation_prompt": null
    }'::jsonb
);

-- Add foreign key constraint for optimization_id in messages
ALTER TABLE messages
ADD CONSTRAINT fk_messages_optimization
FOREIGN KEY (optimization_id)
REFERENCES prompt_optimizations(id)
ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX idx_chats_user_id ON chats(user_id);
CREATE INDEX idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_optimizations_user_id ON prompt_optimizations(user_id);
CREATE INDEX idx_optimizations_created_at ON prompt_optimizations(created_at DESC);
CREATE INDEX idx_versions_optimization_id ON prompt_versions(optimization_id);

-- JSONB indexes for metadata search
CREATE INDEX idx_chats_metadata_tags ON chats USING GIN ((metadata->'tags'));
CREATE INDEX idx_messages_metadata_source ON messages USING GIN ((metadata->'source_app'));

-- Row-Level Security (RLS) policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_optimizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

-- Users policies (users can only see their own data)
CREATE POLICY "Users can view own profile"
    ON users FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
    ON users FOR UPDATE
    USING (id = auth.uid());

-- Chats policies
CREATE POLICY "Users can view own chats"
    ON chats FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create own chats"
    ON chats FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own chats"
    ON chats FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete own chats"
    ON chats FOR DELETE
    USING (user_id = auth.uid());

-- Messages policies
CREATE POLICY "Users can view own messages"
    ON messages FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create own messages"
    ON messages FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own messages"
    ON messages FOR DELETE
    USING (user_id = auth.uid());

-- Prompt optimizations policies
CREATE POLICY "Users can view own optimizations"
    ON prompt_optimizations FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create own optimizations"
    ON prompt_optimizations FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own optimizations"
    ON prompt_optimizations FOR UPDATE
    USING (user_id = auth.uid());

-- Prompt versions policies
CREATE POLICY "Users can view own versions"
    ON prompt_versions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM prompt_optimizations po
        WHERE po.id = prompt_versions.optimization_id
        AND po.user_id = auth.uid()
    ));

CREATE POLICY "Users can create own versions"
    ON prompt_versions FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM prompt_optimizations po
        WHERE po.id = prompt_versions.optimization_id
        AND po.user_id = auth.uid()
    ));

-- Function to update chat updated_at timestamp
CREATE OR REPLACE FUNCTION update_chat_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chats
    SET updated_at = NOW()
    WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update chat timestamp on new message
CREATE TRIGGER trigger_update_chat_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_chat_timestamp();

-- Function to update chat statistics
CREATE OR REPLACE FUNCTION update_chat_statistics()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chats
    SET metadata = jsonb_set(
        metadata,
        '{statistics,total_messages}',
        to_jsonb((
            SELECT COUNT(*)::integer
            FROM messages
            WHERE chat_id = NEW.chat_id
        ))
    )
    WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update chat statistics
CREATE TRIGGER trigger_update_chat_statistics
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_chat_statistics();
