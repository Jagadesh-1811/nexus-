-- ============================================================
-- 1. CLEANUP & EXTENSIONS
-- ============================================================
-- Enable uuid-ossp extension for UID generation if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 2. CREATE SCHEMAS & TABLES
-- ============================================================

-- Workspaces Table
CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Users Table
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "email" TEXT UNIQUE NOT NULL,
  "name" TEXT,
  "supabase_id" TEXT UNIQUE NOT NULL, -- Links to auth.users.id
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Workspace Members Table
CREATE TABLE IF NOT EXISTS "workspace_members" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "workspace_id" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'MEMBER', -- MEMBER, LEAD_OWNER, EXECUTIVE, VIEWER
  "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_members_uniq" UNIQUE ("workspace_id", "user_id")
);

-- Meetings Table
CREATE TABLE IF NOT EXISTS "meetings" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "workspace_id" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "audio_url" TEXT,
  "transcript_raw" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, TRANSCRIBING, ANALYZING, VALIDATING, COMPLETED, FAILED
  "duration" INTEGER,
  "participant_names" TEXT[] NOT NULL DEFAULT '{}',
  "project_tags" TEXT[] NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Execution Plans Table
CREATE TABLE IF NOT EXISTS "execution_plans" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "meeting_id" TEXT UNIQUE NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "summary" TEXT NOT NULL,
  "enkrypt_validated" BOOLEAN NOT NULL DEFAULT FALSE,
  "enkrypt_validation_score" DOUBLE PRECISION,
  "enkrypt_report" JSONB,
  "halluc_flags_count" INTEGER NOT NULL DEFAULT 0,
  "refinement_count" INTEGER NOT NULL DEFAULT 0,
  "context_used" BOOLEAN NOT NULL DEFAULT FALSE,
  "context_meeting_ids" TEXT[] NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Action Items Table
CREATE TABLE IF NOT EXISTS "action_items" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "meeting_id" TEXT NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "description" TEXT NOT NULL,
  "assignee" TEXT,
  "deadline" TIMESTAMP WITH TIME ZONE,
  "status" TEXT NOT NULL DEFAULT 'EXTRACTED', -- EXTRACTED, VALIDATING, VALIDATED, FLAGGED, REFINED, DISPATCHED, APPROVED, REJECTED
  "validation_notes" TEXT,
  "validation_history" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "is_validated" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_dispatched" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Decisions Table
CREATE TABLE IF NOT EXISTS "decisions" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "meeting_id" TEXT NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Risks Table
CREATE TABLE IF NOT EXISTS "risks" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "meeting_id" TEXT NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "description" TEXT NOT NULL,
  "level" TEXT NOT NULL, -- LOW, MEDIUM, HIGH, CRITICAL
  "owner" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs Table
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "severity" TEXT NOT NULL, -- INFO, WARN, ERROR, CRITICAL
  "ip_address" TEXT,
  "user_agent" TEXT,
  "request_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. AUTOMATIC TIMESTAMPS GENERATION (triggers)
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_workspaces_modtime BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_users_modtime BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_meetings_modtime BEFORE UPDATE ON meetings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_execution_plans_modtime BEFORE UPDATE ON execution_plans FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_action_items_modtime BEFORE UPDATE ON action_items FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_decisions_modtime BEFORE UPDATE ON decisions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_risks_modtime BEFORE UPDATE ON risks FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper role determination function
CREATE OR REPLACE FUNCTION current_user_workspace_role(w_id text)
RETURNS text AS $$
  SELECT role::text FROM workspace_members
  WHERE workspace_id = w_id AND user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Users policies
CREATE POLICY "Users can read all workspace members and profiles"
  ON users FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE TO authenticated USING (supabase_id = auth.uid()::text);

-- Workspace policies
CREATE POLICY "Members can view workspaces they belong to"
  ON workspaces FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
    )
  );

CREATE POLICY "Leads and Executives can manage workspaces"
  ON workspaces FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
      AND workspace_members.role IN ('LEAD', 'EXECUTIVE')
    )
  );

-- Workspace Members policies
CREATE POLICY "Members can view workspace member list"
  ON workspace_members FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM workspace_members AS wm
      WHERE wm.workspace_id = workspace_id
      AND wm.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
    )
  );

-- Meetings policies
CREATE POLICY "Members can view workspace meetings"
  ON meetings FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspace_id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
    )
  );

CREATE POLICY "Leads and Executives can manage meetings"
  ON meetings FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspace_id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
      AND workspace_members.role IN ('LEAD', 'EXECUTIVE')
    )
  );

-- Action Items policies
CREATE POLICY "Read action items based on workspace access"
  ON action_items FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM meetings
      JOIN workspace_members ON workspace_members.workspace_id = meetings.workspace_id
      WHERE meetings.id = meeting_id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
    )
  );

CREATE POLICY "Manage action items based on workspace role"
  ON action_items FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM meetings
      JOIN workspace_members ON workspace_members.workspace_id = meetings.workspace_id
      WHERE meetings.id = meeting_id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
      AND workspace_members.role IN ('LEAD', 'EXECUTIVE')
    )
  );

-- Decisions policies
CREATE POLICY "Read decisions based on workspace access"
  ON decisions FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM meetings
      JOIN workspace_members ON workspace_members.workspace_id = meetings.workspace_id
      WHERE meetings.id = meeting_id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
    )
  );

CREATE POLICY "Manage decisions based on workspace role"
  ON decisions FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM meetings
      JOIN workspace_members ON workspace_members.workspace_id = meetings.workspace_id
      WHERE meetings.id = meeting_id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
      AND workspace_members.role IN ('LEAD', 'EXECUTIVE')
    )
  );

-- Risks policies
CREATE POLICY "Read risks based on workspace access"
  ON risks FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM meetings
      JOIN workspace_members ON workspace_members.workspace_id = meetings.workspace_id
      WHERE meetings.id = meeting_id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
    )
  );

CREATE POLICY "Manage risks based on workspace role"
  ON risks FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM meetings
      JOIN workspace_members ON workspace_members.workspace_id = meetings.workspace_id
      WHERE meetings.id = meeting_id
      AND workspace_members.user_id = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
      AND workspace_members.role IN ('LEAD', 'EXECUTIVE')
    )
  );

-- ============================================================
-- 5. AUTO-USER CREATION TRIGGER
-- ============================================================
-- Automatically insert a row into public.users when a user signs up in Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (email, name, supabase_id)
  VALUES (new.email, new.raw_user_meta_data->>'name', new.id::text);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
