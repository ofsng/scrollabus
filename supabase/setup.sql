-- Scrollabus: full database setup (generated).
-- Paste into the Supabase SQL Editor and run once on a fresh project.
-- Sources are concatenated in the order they were added to the repo.

-- ============================================================
-- supabase/schema.sql
-- ============================================================
-- =============================================
-- Scrollabus — Supabase Schema
-- Run in Supabase SQL Editor
-- =============================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- =============================================
-- TABLES
-- =============================================

-- Profiles (extends auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  onboarding_completed boolean not null default false,
  interests text[] default '{}',
  created_at timestamptz default now()
);

-- AI study influencer personas (seeded)
create table if not exists personas (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  avatar_url text,
  system_prompt text not null,
  description text,
  accent_color text not null default '#C9B8E8',
  role_tag text not null default 'Study Guide',
  emoji text not null default '📚',
  created_at timestamptz default now()
);

-- Uploaded study materials
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  title text not null,
  raw_text text not null,
  source_type text check (source_type in ('pdf', 'text', 'link')) default 'text',
  created_at timestamptz default now()
);

-- Feed posts (AI-generated from materials)
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references materials(id) on delete set null,
  persona_id uuid references personas(id) on delete set null,
  post_type text check (post_type in ('concept', 'example', 'trap', 'review', 'recap')) not null default 'concept',
  title text,
  body text not null,
  media_type text check (media_type in ('text', 'image', 'audio', 'video')) not null default 'text',
  media_url text,
  source text check (source in ('n8n', 'creao')) not null default 'n8n',
  sort_order int default 0,
  created_at timestamptz default now()
);

-- Comments (human or AI persona)
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete set null,
  persona_id uuid references personas(id) on delete set null,
  body text not null,
  parent_comment_id uuid references comments(id) on delete set null,
  created_at timestamptz default now(),
  constraint comment_author_check check (
    (user_id is not null and persona_id is null) or
    (user_id is null and persona_id is not null)
  )
);

-- Saved posts
create table if not exists saves (
  user_id uuid references profiles(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, post_id)
);

-- View impressions (feed ranking + Creao engagement data)
create table if not exists impressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  duration_ms int,
  created_at timestamptz default now()
);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

alter table profiles enable row level security;
alter table materials enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table saves enable row level security;
alter table impressions enable row level security;
-- personas is public read
alter table personas enable row level security;

-- Profiles: users can read/update their own
create policy "profiles_select_own" on profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

-- Personas: anyone authenticated can read
create policy "personas_select_all" on personas for select using (true);

-- Materials: users own their materials
create policy "materials_select_own" on materials for select using (auth.uid() = user_id);
create policy "materials_insert_own" on materials for insert with check (auth.uid() = user_id);

-- Posts: all authenticated users can read posts
create policy "posts_select_authenticated" on posts for select using (auth.role() = 'authenticated');
-- Service role can insert (n8n/API routes use service role)
create policy "posts_insert_service" on posts for insert with check (true);

-- Comments: authenticated users can read and insert their own
create policy "comments_select_authenticated" on comments for select using (auth.role() = 'authenticated');
create policy "comments_insert_own" on comments for insert with check (
  auth.uid() = user_id or persona_id is not null
);

-- Saves: users own their saves
create policy "saves_select_own" on saves for select using (auth.uid() = user_id);
create policy "saves_insert_own" on saves for insert with check (auth.uid() = user_id);
create policy "saves_delete_own" on saves for delete using (auth.uid() = user_id);

-- Impressions: users own their impressions
create policy "impressions_insert_own" on impressions for insert with check (auth.uid() = user_id);

-- =============================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- =============================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- =============================================
-- INDEXES
-- =============================================

create index if not exists idx_posts_created_at on posts (created_at desc);
create index if not exists idx_posts_material_id on posts (material_id);
create index if not exists idx_posts_persona_id on posts (persona_id);
create index if not exists idx_comments_post_id on comments (post_id);
create index if not exists idx_saves_user_id on saves (user_id);
create index if not exists idx_impressions_user_post on impressions (user_id, post_id);


-- ============================================================
-- supabase/seed.sql
-- ============================================================
-- =============================================
-- Scrollabus — Persona Seed Data
-- Run AFTER schema.sql
-- =============================================

insert into personas (slug, name, description, accent_color, role_tag, emoji, system_prompt)
values
(
  'lecture-bestie',
  'Lecture Bestie',
  $d$okay wait pause. what did they just say?? yeah no, i'm not letting that slide. come sit with me, i'll explain it the way i wish someone explained it to me the first time$d$,
  '#C9B8E8',
  'Plain English',
  '💜',
  $p$You are Lecture Bestie — a warm, clever study influencer who explains academic concepts in plain English.
Your tone is casual, friendly, and encouraging. You use relatable analogies, never condescend, and always make the learner feel capable.
You are concise: max 3 short paragraphs or a short bulleted list. Never use academic jargon without immediately explaining it.
Format: A short punchy title, then the explanation. End with one engaging question or "try this" moment.$p$
),
(
  'exam-gremlin',
  'Exam Gremlin',
  $d$nahhh that question is trying to trick you. i can literally feel it. if you fall for it, i will laugh in your face. come, let me show you how to dodge it.$d$,
  '#D4544A',
  'Trap Spotter',
  '👺',
  $p$You are Exam Gremlin — a mischievous but genuinely helpful study influencer who specialises in exposing exam traps, common mistakes, and trick questions.
Your tone is slightly devious but educational. You delight in pointing out where students always go wrong, then explaining exactly why.
Structure: Start with "Don't fall for this:" or "Common mistake:" followed by the trap, then the correct reasoning.
Keep it punchy — max 2-3 short paragraphs. Always end with a brief "why this matters in exams" note.$p$
),
(
  'problem-grinder',
  'Problem Grinder',
  $d$We're going to do this properly. Every step, no shortcuts. It might feel slow, but by the end of it, you'll understand exactly how it works.$d$,
  '#9DBE8A',
  'Step-by-Step',
  '🔢',
  $p$You are Problem Grinder — a methodical, no-nonsense study influencer who specialises in worked examples and step-by-step problem solving.
Your tone is clear, confident, and precise. You love numbered steps, clear notation, and showing exactly how to get from A to B.
Structure: Brief setup of the problem, then numbered steps with reasoning at each step. No fluff.
Always show your working. End with a one-line "key takeaway" about the method used.$p$
)
on conflict (slug) do update
  set
    name = excluded.name,
    description = excluded.description,
    accent_color = excluded.accent_color,
    role_tag = excluded.role_tag,
    emoji = excluded.emoji,
    system_prompt = excluded.system_prompt;

insert into personas (slug, name, description, accent_color, role_tag, emoji, system_prompt)
values
(
  'doodle-prof',
  'Doodle Prof',
  $d$okay don't judge my drawings... they're ugly on purpose. if i can make this make sense with stick figures, you're definitely getting it too.$d$,
  '#F5C842',
  'Comic Strip',
  '✏️',
  $p$You are Doodle Prof — a quirky study influencer who explains concepts through hand-drawn doodle comic strips.
Your output describes a 3-panel comic strip that illustrates the concept visually and humorously with stick figures.
Each panel has a brief scene description and a short caption (max 8 words).
Keep it simple, funny, and educational — the doodle style makes complex ideas accessible.
Format your response as JSON with two fields: "title" (the comic strip title, max 8 words) and "body" (describe panels as "Panel 1: [scene] | Panel 2: [scene] | Panel 3: [scene]").
Return ONLY valid JSON, no markdown fences.$p$
),
(
  'meme-lord',
  'Meme Lord',
  $d$hold on this is actually so memeable i already know the EXACT template for this!! if it makes you laugh, it's gonna stick. TRUST ME!!!$d$,
  '#B8E86B',
  'Meme Drop',
  '😂',
  $p$You are Meme Lord — a chaotic-good study influencer who explains academic concepts through internet memes.
Pick a classic meme template (Drake, Distracted Boyfriend, This Is Fine, Expanding Brain, Surprised Pikachu, etc.) and write the text overlay.
The meme must be funny AND accurately explain the academic concept.
Format your response as JSON with two fields: "title" (template name + academic twist, max 10 words) and "body" (top text, bottom text, and one-line description of what the meme image shows).
Return ONLY valid JSON, no markdown fences.$p$
),
(
  'study-bard',
  'Study Bard',
  $d$Roses are red, violets are blue. I'm a bard, singin' til you study hard~$d$,
  '#7EC8E3',
  'Study Songs',
  '🎵',
  $p$You are Study Bard — a musical genius who turns lecture notes into catchy songs students actually want to replay.
Write a short song (hook + verse + chorus) in a specified genre (pop, hip-hop, lo-fi, folk, etc.) that encodes the key concept in the lyrics.
Every lyric should reinforce the learning. Be creative with rhymes and rhythm.
Format your response as JSON with two fields: "title" (song title + genre in square brackets, max 10 words) and "body" (full lyrics labelled with [Hook], [Verse], [Chorus]).
Return ONLY valid JSON, no markdown fences.$p$
)
on conflict (slug) do update
  set
    name = excluded.name,
    description = excluded.description,
    accent_color = excluded.accent_color,
    role_tag = excluded.role_tag,
    emoji = excluded.emoji,
    system_prompt = excluded.system_prompt;


-- ============================================================
-- supabase/migrations/add_av_output_pref.sql
-- ============================================================
-- Add user preference for whether to generate audio and video content
alter table profiles
  add column if not exists enable_av_output boolean not null default true;


-- ============================================================
-- supabase/migrations/add_external_content.sql
-- ============================================================
-- =============================================
-- Scrollabus — External Social Content
-- Run in Supabase SQL Editor after schema.sql
-- =============================================

-- Curated channels/accounts to pull content from
create table if not exists curated_channels (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('youtube', 'tiktok', 'instagram')),
  channel_id text not null,
  channel_name text,
  tags text[] default '{}',
  is_active boolean default true,
  created_at timestamptz default now(),
  unique(platform, channel_id)
);

-- External social media content ingested via n8n
create table if not exists external_content (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('youtube', 'tiktok', 'instagram')),
  external_id text not null,
  title text,
  description text,
  thumbnail_url text,
  embed_url text not null,
  author_name text,
  author_avatar_url text,
  view_count bigint default 0,
  like_count bigint default 0,
  tags text[] default '{}',
  duration_seconds int,
  published_at timestamptz,
  fetched_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(platform, external_id)
);

-- Indexes
create index if not exists idx_external_content_platform on external_content(platform);
create index if not exists idx_external_content_tags on external_content using gin(tags);
create index if not exists idx_external_content_published on external_content(published_at desc);
create index if not exists idx_curated_channels_platform on curated_channels(platform, is_active);

-- RLS
alter table curated_channels enable row level security;
alter table external_content enable row level security;

-- Curated channels: authenticated users can read, service role manages
create policy "curated_channels_select_authenticated"
  on curated_channels for select using (auth.role() = 'authenticated');
create policy "curated_channels_insert_service"
  on curated_channels for insert with check (true);
create policy "curated_channels_update_service"
  on curated_channels for update using (true);

-- External content: authenticated users can read, service role (n8n) inserts
create policy "external_content_select_authenticated"
  on external_content for select using (auth.role() = 'authenticated');
create policy "external_content_insert_service"
  on external_content for insert with check (true);
create policy "external_content_update_service"
  on external_content for update using (true);


-- ============================================================
-- supabase/migrations/add_learner_memory.sql
-- ============================================================
-- =============================================
-- Scrollabus — Learner Memory Events
-- Run in Supabase SQL Editor after schema.sql
-- =============================================
-- Local audit log of raw learner signals.
-- HydraDB is the primary memory store; this table
-- serves as a fast-lookup fallback and event trail.

create table if not exists learner_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  -- e.g. material_uploaded, comment_posted, quiz_answered, post_saved, post_viewed, dm_sent, interests_set
  event_type text not null,
  -- Arbitrary context: { title, persona_slug, post_type, media_type, duration_ms, is_correct, ... }
  payload jsonb not null default '{}',
  created_at timestamptz default now()
);

alter table learner_events enable row level security;

-- Users can only read/insert their own events
create policy "learner_events_select_own" on learner_events
  for select using (auth.uid() = user_id);

create policy "learner_events_insert_own" on learner_events
  for insert with check (auth.uid() = user_id or true); -- service role writes on behalf

create index if not exists idx_learner_events_user on learner_events (user_id, created_at desc);
create index if not exists idx_learner_events_type on learner_events (user_id, event_type);


-- ============================================================
-- supabase/migrations/add_likes_and_save_categories.sql
-- ============================================================
-- =============================================
-- Scrollabus — Likes & Save Categories
-- Run in Supabase SQL Editor after schema.sql
-- =============================================

-- Post likes
create table if not exists likes (
  user_id uuid references profiles(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, post_id)
);

-- User-defined save categories (e.g. "Favorites", "Exam Prep")
create table if not exists save_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  unique(user_id, name)
);

-- Many-to-many: a saved post can belong to multiple categories
create table if not exists save_category_memberships (
  user_id uuid references profiles(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  category_id uuid references save_categories(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, post_id, category_id)
);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

alter table likes enable row level security;
alter table save_categories enable row level security;
alter table save_category_memberships enable row level security;

-- Likes: users own their likes
create policy "likes_select_own" on likes for select using (auth.uid() = user_id);
create policy "likes_insert_own" on likes for insert with check (auth.uid() = user_id);
create policy "likes_delete_own" on likes for delete using (auth.uid() = user_id);

-- Save categories: users own their categories
create policy "save_categories_select_own" on save_categories for select using (auth.uid() = user_id);
create policy "save_categories_insert_own" on save_categories for insert with check (auth.uid() = user_id);
create policy "save_categories_update_own" on save_categories for update using (auth.uid() = user_id);
create policy "save_categories_delete_own" on save_categories for delete using (auth.uid() = user_id);

-- Save category memberships: users own their memberships
create policy "save_category_memberships_select_own" on save_category_memberships for select using (auth.uid() = user_id);
create policy "save_category_memberships_insert_own" on save_category_memberships for insert with check (auth.uid() = user_id);
create policy "save_category_memberships_delete_own" on save_category_memberships for delete using (auth.uid() = user_id);

-- =============================================
-- INDEXES
-- =============================================

create index if not exists idx_likes_user_id on likes (user_id);
create index if not exists idx_likes_post_id on likes (post_id);
create index if not exists idx_save_categories_user_id on save_categories (user_id);
create index if not exists idx_save_category_memberships_user_post on save_category_memberships (user_id, post_id);
create index if not exists idx_save_category_memberships_category on save_category_memberships (category_id);


-- ============================================================
-- supabase/migrations/add_media_and_persona_prefs.sql
-- ============================================================
-- Migration: add media fields to posts + persona preferences to profiles
-- Run in Supabase SQL Editor

-- Add media_type and media_url to posts table
alter table posts
  add column if not exists media_type text check (media_type in ('text', 'image', 'video', 'audio')) not null default 'text',
  add column if not exists media_url text;

-- Add enabled_personas preference to profiles (defaults to all six enabled)
alter table profiles
  add column if not exists enabled_personas text[] default '{lecture-bestie,exam-gremlin,problem-grinder,doodle-prof,meme-lord,study-bard}';

-- Index for filtering posts by media type in the feed
create index if not exists idx_posts_media_type on posts (media_type);


-- ============================================================
-- supabase/migrations/add_media_columns_to_posts.sql
-- ============================================================
-- Add media_type and media_url columns to posts table
alter table posts
  add column if not exists media_type text
    check (media_type in ('text', 'image', 'audio', 'video'))
    not null default 'text',
  add column if not exists media_url text;

create index if not exists idx_posts_media_type on posts (media_type);


-- ============================================================
-- supabase/migrations/add_onboarding_completed.sql
-- ============================================================
alter table profiles
  add column if not exists onboarding_completed boolean not null default false;


-- ============================================================
-- supabase/migrations/add_phone_number.sql
-- ============================================================
-- =============================================
-- Scrollabus — Photon Study Companion
-- Run in Supabase SQL Editor after schema.sql
-- =============================================
-- Adds phone number and study companion opt-in to profiles.
-- Required for Photon iMessage/SMS outbound nudges.

alter table profiles
  add column if not exists phone_number text,
  add column if not exists photon_enabled boolean not null default false;

-- Index to efficiently query users opted into study companion
create index if not exists idx_profiles_photon_enabled on profiles (photon_enabled)
  where photon_enabled = true;


-- ============================================================
-- supabase/migrations/add_profile_fields.sql
-- ============================================================
-- =============================================
-- Add bio + avatar_url to profiles table
-- Run in Supabase SQL Editor
-- =============================================

alter table profiles add column if not exists bio text;
alter table profiles add column if not exists avatar_url text;

-- =============================================
-- Storage bucket for profile avatars
-- Step 1: Create the bucket in Supabase Dashboard
--   → Storage → New bucket → Name: "avatars" → Public: ON
-- Step 2: Run these RLS policies on storage.objects:
-- =============================================

create policy "Public avatar read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "Auth users upload own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Auth users update own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Auth users delete own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- supabase/migrations/add_quizzes.sql
-- ============================================================
-- =============================================
-- Scrollabus — Interactive Quizzes
-- Run in Supabase SQL Editor after schema.sql
-- =============================================

-- Quiz cards inserted into the feed, generated from user materials
create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references materials(id) on delete cascade not null,
  question_type text not null check (question_type in ('multiple_choice', 'multiple_response', 'free_text')),
  question text not null,
  -- For multiple_choice / multiple_response: array of { "id": "a", "text": "..." }
  -- Null for free_text
  options jsonb,
  -- For multiple_choice: ["a"]
  -- For multiple_response: ["a", "c"]
  -- For free_text: { "text": "model answer..." }
  correct_answer jsonb not null,
  explanation text not null,
  created_at timestamptz default now()
);

-- One response per user per quiz
create table if not exists quiz_responses (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  -- Selected option IDs (array of strings) or { "text": "..." } for free_text
  answer jsonb not null,
  -- true/false for MCQ/MR (auto-graded), null for free_text (subjective)
  is_correct boolean,
  created_at timestamptz default now(),
  unique (quiz_id, user_id)
);

-- Persisted persona hint/explanation chat for a quiz
create table if not exists quiz_messages (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  -- null when role = 'user'; set to persona slug when role = 'persona'
  persona_slug text,
  role text not null check (role in ('user', 'persona')),
  body text not null,
  created_at timestamptz default now()
);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

alter table quizzes enable row level security;
alter table quiz_responses enable row level security;
alter table quiz_messages enable row level security;

-- Quizzes: any authenticated user can read quizzes belonging to their own materials
create policy "quizzes_select_own_materials" on quizzes for select
  using (
    exists (
      select 1 from materials
      where materials.id = quizzes.material_id
        and materials.user_id = auth.uid()
    )
  );

-- Quizzes: only service role can insert (quiz generation happens server-side)
create policy "quizzes_insert_service" on quizzes for insert
  with check (true);

-- Quiz responses: users own their responses
create policy "quiz_responses_select_own" on quiz_responses for select
  using (auth.uid() = user_id);

create policy "quiz_responses_insert_own" on quiz_responses for insert
  with check (auth.uid() = user_id);

-- Allow upsert (update) for re-submissions (not currently used but safe to have)
create policy "quiz_responses_update_own" on quiz_responses for update
  using (auth.uid() = user_id);

-- Quiz messages: users own their chat history
create policy "quiz_messages_select_own" on quiz_messages for select
  using (auth.uid() = user_id);

create policy "quiz_messages_insert_own" on quiz_messages for insert
  with check (auth.uid() = user_id);

-- =============================================
-- INDEXES
-- =============================================

create index if not exists idx_quizzes_material_id on quizzes (material_id);
create index if not exists idx_quizzes_created_at on quizzes (created_at);
create index if not exists idx_quiz_responses_quiz_id on quiz_responses (quiz_id);
create index if not exists idx_quiz_responses_user_id on quiz_responses (user_id);
create index if not exists idx_quiz_messages_quiz_user on quiz_messages (quiz_id, user_id);
create index if not exists idx_quiz_messages_created_at on quiz_messages (created_at);


-- ============================================================
-- supabase/migrations/create_post_media_bucket.sql
-- ============================================================
-- =============================================
-- Create post-media Storage bucket
-- Run in Supabase SQL Editor (requires service role)
-- =============================================

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

-- Allow public read access
create policy "Public read access"
  on storage.objects for select
  using (bucket_id = 'post-media');

-- Allow service role (n8n) to upload
create policy "Service role upload"
  on storage.objects for insert
  with check (bucket_id = 'post-media');

-- Allow service role to update/upsert
create policy "Service role update"
  on storage.objects for update
  using (bucket_id = 'post-media');


-- ============================================================
-- supabase/migrations/add_custom_personas.sql
-- ============================================================
-- =============================================
-- Add custom persona support to personas table
-- =============================================

-- Add new columns to personas table
alter table personas
  add column if not exists created_by uuid references profiles(id) on delete set null,
  add column if not exists is_public boolean not null default false,
  add column if not exists tone text,
  add column if not exists teaching_style text;

-- Index for fast lookup of user-created personas
create index if not exists idx_personas_created_by on personas (created_by);

-- Index for browsing public community personas
create index if not exists idx_personas_is_public on personas (is_public) where is_public = true;

-- =============================================
-- Update RLS policies
-- =============================================

-- Drop the old blanket select policy
drop policy if exists "personas_select_all" on personas;

-- New select policy:
-- Anyone can see: default personas (created_by is null) + public custom personas + their own private personas
create policy "personas_select_visible" on personas
  for select using (
    created_by is null
    or is_public = true
    or created_by = auth.uid()
  );

-- Insert: authenticated users can insert their own custom personas
create policy "personas_insert_own" on personas
  for insert with check (
    auth.uid() is not null
    and created_by = auth.uid()
  );

-- Update: users can only update their own custom personas (not system defaults)
create policy "personas_update_own" on personas
  for update using (
    created_by = auth.uid()
  ) with check (
    created_by = auth.uid()
  );

-- Delete: users can only delete their own custom personas
create policy "personas_delete_own" on personas
  for delete using (
    created_by = auth.uid()
  );


-- ============================================================
-- supabase/migrations/add_persona_to_quizzes.sql
-- ============================================================
-- Add persona_slug to quizzes so each quiz card is voiced by a specific persona.
-- Null means the quiz was generated before this migration (generic educator voice).
alter table quizzes
  add column if not exists persona_slug text references personas(slug) on delete set null;

create index if not exists idx_quizzes_persona_slug on quizzes (persona_slug);


-- ============================================================
-- supabase/migrations/add_reactive_source_and_post_types.sql
-- ============================================================
-- Extend posts.source to include 'reactive' (persona-generated remedial content)
-- and 'pulse' (persona community update posts).
alter table posts
  drop constraint if exists posts_source_check;

alter table posts
  add constraint posts_source_check
    check (source in ('n8n', 'creao', 'reactive', 'pulse'));

-- Extend posts.post_type to include 'pulse' for community update posts.
alter table posts
  drop constraint if exists posts_post_type_check;

alter table posts
  add constraint posts_post_type_check
    check (post_type in ('concept', 'example', 'trap', 'review', 'recap', 'pulse'));


-- ============================================================
-- supabase/migrations/add_slideshow_media_type.sql
-- ============================================================
-- Add 'slideshow' to the media_type check constraint on posts.
-- Slideshow posts store a JSON payload in media_url containing frame image URLs,
-- an audio voiceover URL, and a frame duration.

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_media_type_check;

ALTER TABLE posts
  ADD CONSTRAINT posts_media_type_check
  CHECK (media_type IN ('text', 'image', 'audio', 'video', 'slideshow'));


-- ============================================================
-- supabase/migrations/add_teaching_plan_to_materials.sql
-- ============================================================
-- Add teaching_plan column to materials to persist Dify's pedagogical analysis.
-- Stores: { priority_personas, emphasis, first_review_concept, quiz_topic }
alter table materials
  add column if not exists teaching_plan jsonb;


-- ============================================================
-- supabase/migrations/add_telegram.sql
-- ============================================================
-- =============================================
-- Scrollabus — Telegram Study Companion
-- Run in Supabase SQL Editor after schema.sql
-- =============================================
-- Replaces Photon iMessage/SMS with Telegram bot companion.

alter table profiles
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_username text,
  add column if not exists telegram_enabled boolean not null default false,
  add column if not exists telegram_link_token text;

-- Index for cron queries (find all opted-in users)
create index if not exists idx_profiles_telegram_enabled on profiles (telegram_enabled)
  where telegram_enabled = true;

-- Index for webhook lookups (find user by chat_id)
create unique index if not exists idx_profiles_telegram_chat_id on profiles (telegram_chat_id)
  where telegram_chat_id is not null;

-- Index for deep-link token lookups
create unique index if not exists idx_profiles_telegram_link_token on profiles (telegram_link_token)
  where telegram_link_token is not null;


-- ============================================================
-- supabase/engagement-rpc.sql
-- ============================================================
-- =============================================
-- Scrollabus — Engagement Summary RPC
-- Called by n8n Workflow 3 (Engagement Sync → Google Sheet)
-- Run in Supabase SQL Editor after schema.sql
-- =============================================

create or replace function get_engagement_summary()
returns json
language sql
security definer
set search_path = ''
as $$
  select json_build_object(
    'top_topics', (
      select coalesce(json_agg(title order by impression_count desc), '[]'::json)
      from (
        select p.title, count(i.id) as impression_count
        from public.posts p
        join public.impressions i on i.post_id = p.id
        where i.created_at > now() - interval '24 hours'
          and p.title is not null
        group by p.id, p.title
        order by impression_count desc
        limit 5
      ) top_posts
    ),
    'confusion_topics', (
      select coalesce(json_agg(title order by comment_count desc), '[]'::json)
      from (
        select p.title, count(c.id) as comment_count
        from public.posts p
        join public.comments c on c.post_id = p.id
        where c.created_at > now() - interval '24 hours'
          and c.user_id is not null  -- only human comments signal confusion
          and p.title is not null
        group by p.id, p.title
        order by comment_count desc
        limit 5
      ) confused_posts
    ),
    'save_count', (
      select count(*)
      from public.saves
      where created_at > now() - interval '24 hours'
    ),
    'comment_count', (
      select count(*)
      from public.comments
      where created_at > now() - interval '24 hours'
        and user_id is not null  -- only human comments
    )
  );
$$;

grant execute on function get_engagement_summary() to authenticated, service_role;

-- =============================================
-- Scrollabus — Quiz Failure Hotspots RPC
-- Returns quiz questions with the highest failure rates across all users.
-- Used by the reactive content workflow to identify where students struggle most.
-- =============================================

create or replace function get_quiz_failure_hotspots(
  p_limit int default 5,
  p_min_attempts int default 2
)
returns json
language sql
security definer
set search_path = ''
as $$
  select coalesce(json_agg(row_to_json(h) order by h.failure_rate desc), '[]'::json)
  from (
    select
      q.id                                                        as quiz_id,
      q.question                                                  as question,
      q.question_type                                             as question_type,
      m.title                                                     as material_title,
      q.material_id                                               as material_id,
      count(r.id)                                                 as total_attempts,
      count(r.id) filter (where r.is_correct = false)            as wrong_count,
      round(
        count(r.id) filter (where r.is_correct = false)::numeric
        / nullif(count(r.id), 0) * 100
      , 1)                                                        as failure_rate,
      -- Collect a sample of wrong answers for the persona prompt
      array_agg(r.answer order by r.created_at desc) filter (
        where r.is_correct = false
      )                                                           as wrong_answers
    from public.quizzes q
    join public.materials m on m.id = q.material_id
    join public.quiz_responses r on r.quiz_id = q.id
    where r.is_correct is not null  -- exclude free-text (ungraded)
    group by q.id, q.question, q.question_type, m.title, q.material_id
    having count(r.id) >= p_min_attempts
    order by failure_rate desc
    limit p_limit
  ) h;
$$;

grant execute on function get_quiz_failure_hotspots(int, int) to authenticated, service_role;


-- ============================================================
-- supabase/community-rpc.sql
-- ============================================================
-- =============================================
-- Scrollabus — Community & Explore RPCs
-- Run in Supabase SQL Editor after schema.sql
-- =============================================

-- Add interests column if not already present (idempotent)
alter table profiles add column if not exists interests text[] default '{}';

-- =============================================
-- get_trending_posts
-- Returns posts ranked by engagement (saves + comments),
-- optionally filtered by interest keywords matched against
-- post title/body.
-- =============================================
create or replace function get_trending_posts(
  limit_count int default 20,
  interest_keywords text[] default null,
  exclude_user_id uuid default null
)
returns table (
  id uuid,
  material_id uuid,
  persona_id uuid,
  post_type text,
  title text,
  body text,
  source text,
  sort_order int,
  created_at timestamptz,
  save_count bigint,
  comment_count bigint,
  engagement_score bigint
)
language sql
security definer
set search_path = ''
as $$
  select
    p.id,
    p.material_id,
    p.persona_id,
    p.post_type,
    p.title,
    p.body,
    p.source,
    p.sort_order,
    p.created_at,
    count(distinct s.user_id)  as save_count,
    count(distinct c.id)       as comment_count,
    count(distinct s.user_id) + count(distinct c.id) as engagement_score
  from public.posts p
  left join public.saves s    on s.post_id = p.id
  left join public.comments c on c.post_id = p.id
  -- exclude posts from the requesting user's own materials
  left join public.materials m on m.id = p.material_id
  where
    (exclude_user_id is null or m.user_id is distinct from exclude_user_id)
    and (
      interest_keywords is null
      or interest_keywords = '{}'
      or exists (
        select 1
        from unnest(interest_keywords) kw
        where
          p.title ilike '%' || kw || '%'
          or p.body  ilike '%' || kw || '%'
      )
    )
  group by p.id
  order by engagement_score desc, p.created_at desc
  limit limit_count;
$$;

-- =============================================
-- get_similar_users
-- Returns other users whose interests overlap
-- with the provided array, ordered by overlap count.
-- =============================================
create or replace function get_similar_users(
  user_interests text[],
  exclude_user_id uuid default null,
  limit_count int default 20
)
returns table (
  id uuid,
  display_name text,
  interests text[],
  overlap_count bigint
)
language sql
security definer
set search_path = ''
as $$
  select
    pr.id,
    pr.display_name,
    pr.interests,
    (
      select count(*)
      from unnest(pr.interests) i
      where i = any(user_interests)
    ) as overlap_count
  from public.profiles pr
  where
    (exclude_user_id is null or pr.id <> exclude_user_id)
    and pr.interests is not null
    and pr.interests <> '{}'
    and exists (
      select 1
      from unnest(pr.interests) i
      where i = any(user_interests)
    )
  order by overlap_count desc
  limit limit_count;
$$;

-- Grant execute to authenticated users
grant execute on function get_trending_posts(int, text[], uuid) to authenticated;
grant execute on function get_similar_users(text[], uuid, int) to authenticated;


-- ============================================================
-- supabase/external-content-rpc.sql
-- ============================================================
-- =============================================
-- Scrollabus — External Content RPC
-- Run in Supabase SQL Editor after add_external_content.sql
-- =============================================

-- =============================================
-- get_external_content
-- Returns external social content filtered by platform
-- and/or interest tags, ordered by recency.
-- =============================================
create or replace function get_external_content(
  limit_count int default 20,
  platform_filter text default null,
  interest_keywords text[] default null,
  before_published_at timestamptz default null
)
returns table (
  id uuid,
  platform text,
  external_id text,
  title text,
  description text,
  thumbnail_url text,
  embed_url text,
  author_name text,
  author_avatar_url text,
  view_count bigint,
  like_count bigint,
  tags text[],
  duration_seconds int,
  published_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    ec.id,
    ec.platform,
    ec.external_id,
    ec.title,
    ec.description,
    ec.thumbnail_url,
    ec.embed_url,
    ec.author_name,
    ec.author_avatar_url,
    ec.view_count,
    ec.like_count,
    ec.tags,
    ec.duration_seconds,
    ec.published_at,
    ec.created_at
  from public.external_content ec
  where
    (platform_filter is null or ec.platform = platform_filter)
    and (before_published_at is null or ec.published_at < before_published_at)
    and (
      interest_keywords is null
      or interest_keywords = '{}'
      or exists (
        select 1
        from unnest(interest_keywords) kw
        where
          ec.title ilike '%' || kw || '%'
          or ec.description ilike '%' || kw || '%'
          or kw = any(ec.tags)
      )
    )
  order by ec.published_at desc nulls last, ec.created_at desc
  limit limit_count;
$$;

-- Grant execute to authenticated users
grant execute on function get_external_content(int, text, text[], timestamptz) to authenticated;


-- ============================================================
-- supabase/persona-affinity-rpc.sql
-- ============================================================
-- =============================================
-- Scrollabus — Persona Affinity RPC
-- Computes a per-persona engagement score for a given user.
-- Used by the adaptive feed to bias content toward personas the student
-- has shown genuine interest in (likes, saves, dwell time, comments).
--
-- Score formula (per persona, for this user):
--   +3 per like on that persona's posts
--   +3 per save on that persona's posts
--   +1 per significant impression (dwell >= 2 000 ms) on that persona's posts
--   +2 per human comment the user left on that persona's posts
-- =============================================

create or replace function get_persona_affinity(p_user_id uuid)
returns table(
  persona_id    uuid,
  persona_slug  text,
  affinity_score float
)
language sql
security definer
set search_path = ''
as $$
  select
    p.id                                                     as persona_id,
    p.slug                                                   as persona_slug,
    coalesce(l.like_score,       0)
    + coalesce(s.save_score,     0)
    + coalesce(i.dwell_score,    0)
    + coalesce(c.comment_score,  0)                         as affinity_score
  from public.personas p

  -- Likes: +3 each
  left join (
    select po.persona_id, count(*) * 3.0 as like_score
    from public.likes lk
    join public.posts po on po.id = lk.post_id
    where lk.user_id = p_user_id
    group by po.persona_id
  ) l on l.persona_id = p.id

  -- Saves: +3 each
  left join (
    select po.persona_id, count(*) * 3.0 as save_score
    from public.saves sv
    join public.posts po on po.id = sv.post_id
    where sv.user_id = p_user_id
    group by po.persona_id
  ) s on s.persona_id = p.id

  -- Dwell impressions (>= 2 000 ms): +1 each
  left join (
    select po.persona_id, count(*) * 1.0 as dwell_score
    from public.impressions im
    join public.posts po on po.id = im.post_id
    where im.user_id = p_user_id
      and im.duration_ms >= 2000
    group by po.persona_id
  ) i on i.persona_id = p.id

  -- Human comments: +2 each
  left join (
    select po.persona_id, count(*) * 2.0 as comment_score
    from public.comments cm
    join public.posts po on po.id = cm.post_id
    where cm.user_id = p_user_id
    group by po.persona_id
  ) c on c.persona_id = p.id

  order by affinity_score desc;
$$;

grant execute on function get_persona_affinity(uuid) to authenticated, service_role;

