-- Migration to add UPDATE policy for messages table
-- This is necessary for users to update the metadata column when adding feedback

CREATE POLICY "Users can update own messages"
    ON messages FOR UPDATE
    USING (user_id = auth.uid());
