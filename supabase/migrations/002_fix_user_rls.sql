-- Add missing INSERT policy for users table
-- This allows users to create their own profile when they first sign in

CREATE POLICY "Users can create own profile"
    ON users FOR INSERT
    WITH CHECK (id = auth.uid());
