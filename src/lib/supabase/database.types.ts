// Hand-written to match supabase/migrations/*.sql. If the
// schema changes, regenerate with `supabase gen types typescript` instead of
// hand-editing where possible.

export type ProfileRow = {
  id: string;
  username: string | null;
  total_points: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  created_at: string;
};

export type DailyTopicRow = {
  id: string;
  topic_date: string;
  title: string;
  prompt: string;
  category: string | null;
  sources: unknown;
  created_at: string;
};

export type SoloDebateRow = {
  id: string;
  user_id: string;
  topic_id: string;
  side: string;
  status: string;
  round_count: number;
  total_score: number | null;
  created_at: string;
  completed_at: string | null;
};

export type SoloDebateTurnRow = {
  id: string;
  debate_id: string;
  round_number: number;
  ai_message: string;
  user_message: string | null;
  input_mode: string;
  scores: unknown;
  turn_score: number | null;
  feedback: string | null;
  assessment: unknown;
  created_at: string;
};

export type PvpQueueRow = {
  id: string;
  user_id: string;
  topic_id: string;
  joined_at: string;
};

export type PvpMatchRow = {
  id: string;
  topic_id: string;
  player_a: string;
  player_b: string;
  player_a_side: string;
  status: string;
  round_limit: number;
  current_round: number;
  current_turn_player: string | null;
  turn_started_at: string | null;
  winner_id: string | null;
  judge_verdict: unknown;
  created_at: string;
  completed_at: string | null;
};

export type PvpTurnRow = {
  id: string;
  match_id: string;
  player_id: string;
  round_number: number;
  message: string;
  input_mode: string;
  created_at: string;
};

export type RateLimitRow = {
  key: string;
  count: number;
  reset_at: string;
};

export type BenchmarkCorpusRow = {
  id: string;
  transcript: string;
  human_winner: string;
  rater_verdicts: unknown;
  rater_ids: string[];
  human_rationale: string;
  topic: string | null;
  is_synthetic: boolean;
  provenance: string;
  provenance_record: unknown;
  created_at: string;
};

export type MatchAppealRow = {
  id: string;
  match_id: string;
  filed_by: string;
  reason: string;
  note: string;
  status: string;
  corrected_winner: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type ReportRow = {
  id: string;
  target_user_id: string;
  match_id: string | null;
  filed_by: string;
  reason: string;
  note: string;
  created_at: string;
};

export type CorpusItemRow = {
  id: string;
  transcript: string;
  topic: string | null;
  source_type: string;
  source_id: string | null;
  contributor_id: string;
  side_mapping: unknown;
  length_bucket: string;
  subject_category: string | null;
  ability_band: string;
  topic_id: string | null;
  topic_title: string;
  topic_prompt: string;
  status: string;
  created_at: string;
};

export type CorpusRatingRow = {
  id: string;
  corpus_id: string;
  rater_id: string;
  scores_a: unknown;
  scores_b: unknown;
  winner: string;
  confidence: number | null;
  rationale: string;
  created_at: string;
};

type TableDef<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      profiles: TableDef<ProfileRow>;
      daily_topics: TableDef<DailyTopicRow>;
      solo_debates: TableDef<SoloDebateRow>;
      solo_debate_turns: TableDef<SoloDebateTurnRow>;
      pvp_queue: TableDef<PvpQueueRow>;
      pvp_matches: TableDef<PvpMatchRow>;
      pvp_turns: TableDef<PvpTurnRow>;
      rate_limits: TableDef<RateLimitRow>;
      benchmark_corpus: TableDef<BenchmarkCorpusRow>;
      match_appeals: TableDef<MatchAppealRow>;
      reports: TableDef<ReportRow>;
      corpus_items: TableDef<CorpusItemRow>;
      corpus_ratings: TableDef<CorpusRatingRow>;
    };
    Views: Record<string, never>;
    Functions: {
      increment_rate_limit: {
        Args: { p_key: string; p_window_ms: number };
        Returns: { new_count: number; new_reset_at: string }[];
      };
      increment_total_points: {
        Args: { p_user_id: string; p_points: number; p_points_per_level: number };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

