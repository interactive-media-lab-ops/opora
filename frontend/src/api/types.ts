/** Типи відповідей API (дзеркало схем бекенду). */
export type Role = 'ADMIN' | 'METHODOLOGIST' | 'HR' | 'CANDIDATE'
export type MethodologyStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
export type FieldType = 'TEXT' | 'TEXTAREA' | 'DATE' | 'NUMBER' | 'SELECT'
export type QuizType = 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE'
export type Stage = 'IN_PROGRESS' | 'PROCESSING' | 'DONE'
export type Verdict = 'IN_REVIEW' | 'RECOMMENDED' | 'REJECTED'
export type AnalysisStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'

export interface User {
  id: number
  email: string
  name: string
  role: Role
  is_active: boolean
  is_demo?: boolean
  totp_enabled?: boolean
}

/** BR-7 / H2: 2FA обовʼязкова, але ще не налаштована — токенів немає, лише токен налаштування. */
export interface MfaSetupRequired {
  mfa_setup_required: true
  setup_token: string
}

export interface MfaRequired {
  mfa_required: true
  mfa_token: string
}

export interface TwoFAStatus {
  available: boolean
  enabled: boolean
}

export interface Tokens {
  access_token: string
  refresh_token: string
}

export interface ProfileField {
  id: number
  label: string
  type: FieldType
  options: string[] | null
  required: boolean
  order: number
}

export interface QuizQuestion {
  id: number
  text: string
  type: QuizType
  options: (string | number)[] | null
  order: number
}

export interface InterviewQuestion {
  id: number
  text: string
  hint: string
  max_duration_sec: number
  order: number
}

export interface MethodologyListItem {
  id: number
  title: string
  description: string
  status: MethodologyStatus
  version: number
  created_at: string
}

export interface Methodology extends MethodologyListItem {
  invite_code: string
  allow_rerecord: boolean
  max_record_attempts: number
  profile_fields: ProfileField[]
  quiz_questions: QuizQuestion[]
  interview_questions: InterviewQuestion[]
  recommendation_questions: RecommendationQuestion[]
  /** BR-4: назви етапів від методолога; null — типова назва */
  profile_title?: string | null
  quiz_title?: string | null
  interview_title?: string | null
}

export interface AssessmentEvent {
  id: number
  created_at: string
  kind: 'STAGE_SUBMITTED' | 'STAGE_UPDATED' | 'STAGE_RETAKEN' | 'ANALYSIS_RESTARTED'
  stage: StageKey | null
  methodology_version: number | null
  // STAGE_UPDATED: { changes }, STAGE_RETAKEN: знімок попередньої спроби, ANALYSIS_RESTARTED: { reason }
  details: Record<string, unknown> | null
}

export interface RecommendationQuestion {
  id: number
  text: string
  hint: string
  order: number
  /** BR-15 */
  required?: boolean
  max_length?: number | null
}

export interface GraphNode {
  id: number
  name: string
  prompt_text: string
  returns_score: boolean
  axis: string | null
  source: AnalyticsSourceKey | null
  position_x: number
  position_y: number
}

export type AnalyticsSourceKey = 'SELF' | 'CONVERSATION' | 'REVIEWS'

export interface Analytics {
  configured: boolean
  fallback: boolean
  mode: 'radar' | 'bars'
  scale_max: number
  axes: string[]
  sources: { key: string; label: string; hint: string; has_data: boolean }[]
  series: { source: string; values: Record<string, number | null> }[]
  sources_total: number
  sources_with_data: number
}

export interface GraphEdge {
  id: number
  source_node_id: number
  target_node_id: number
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface PersonalInvite {
  id: number
  methodology_id: number
  code: string
  candidate_email: string
  used_at: string | null
  created_at: string
}

export interface VoiceStatus {
  question_id: number
  attempts_used: number
  attempts_left: number
  can_rerecord: boolean
  duration_sec: number
  kind: 'VOICE' | 'TEXT' | null
  text: string
  can_record: boolean
}

export type StageKey = 'PROFILE' | 'QUIZ' | 'INTERVIEW'

export interface StageInfo {
  key: StageKey
  title: string
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED'
  updated_at: string | null
  methodology_version: number | null
  question_count: number
  can_edit: boolean
  can_retake: boolean
}

export interface CandidateAssessment {
  recommendations_enabled?: boolean
  methodology_version: number
  processing_problem?: boolean
  stages: StageInfo[]
  id: number
  stage: Stage
  methodology_title: string
  allow_rerecord: boolean
  max_record_attempts: number
  profile_fields: ProfileField[]
  profile_answers: Record<string, string>
  quiz_questions: QuizQuestion[]
  quiz_answers: Record<string, unknown>
  interview_questions: InterviewQuestion[]
  voice: VoiceStatus[]
}

export interface CandidateRow {
  id: number
  candidate_name: string
  candidate_email: string
  methodology_id: number
  methodology_title: string
  stage: Stage
  submitted_at: string | null
  verdict: Verdict | null
  summary_score: number | null
  failed_steps: number | null
  /** BR-5: прогрес етапів, остання зміна, частка поданих етапів 0..1 */
  stages?: { key: string; title: string; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' }[]
  updated_at?: string | null
  completeness?: number | null
}

export interface Dashboard {
  total: number
  by_stage: Record<Stage, number>
  awaiting_verdict: number
  submitted_last_7_days: number
}

export interface VoiceItem {
  voice_answer_id: number
  question: string
  duration_sec: number
  transcript: string
  transcript_status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'
  transcript_error: string | null
  kind?: 'VOICE' | 'TEXT'
}

export interface DetailBase {
  id: number
  candidate_name: string
  candidate_email: string
  methodology_title: string
  stage: Stage
  submitted_at: string | null
  profile: { label: string; value: string }[]
  quiz: { question: string; value: unknown }[]
  voice: VoiceItem[]
  summary_score: number | null
  verdict: Verdict | null
  verdict_note: string
  /** BR-4: назви розділів профілю від методолога (PROFILE / QUIZ / INTERVIEW) */
  stage_titles?: Partial<Record<'PROFILE' | 'QUIZ' | 'INTERVIEW', string>>
}

export interface VerdictChange {
  id: number
  changed_at: string
  author_name: string | null
  old_verdict: Verdict | null
  new_verdict: Verdict | null
  old_note: string
  new_note: string
}

/** BR-6: нотатка HR; бачить лише автор. */
export interface HRNote {
  id: number
  author_id: number
  author_name: string
  text: string
  created_at: string
  updated_at: string
}

export interface HRDetail extends DetailBase {
  final_conclusions: { node_name: string; output: string; score: number | null }[]
  history: VerdictChange[]
  recommendations: RecommendationReview[]
  events: AssessmentEvent[]
  analytics: Analytics
}

export interface NodeResult {
  node_id: number
  node_name: string
  prompt_text: string
  returns_score: boolean
  is_terminal: boolean
  status: AnalysisStatus
  output: string
  score: number | null
  error: string
  model: string
  input_tokens: number
  output_tokens: number
}

export interface RecommendationReview {
  role: 'MANAGER' | 'COLLEAGUE' | 'SUBORDINATE'
  role_label: string
  answers: { question: string; text: string }[]
}

export interface MethodologistDetail extends DetailBase {
  results: NodeResult[]
  recommendations: RecommendationReview[]
  events: AssessmentEvent[]
  analytics: Analytics
}

export interface HRList {
  id: number
  name: string
  is_default: boolean
  assessment_ids: number[]
}

export interface HRListDetail {
  id: number
  name: string
  is_default: boolean
  rows: CandidateRow[]
}

export interface DeletionRequest {
  id: number
  status: 'NEW' | 'DONE'
  created_at: string
  processed_at: string | null
}

export interface AdminDeletionRequest extends DeletionRequest {
  user_id: number
  user_name: string
  user_email: string
  user_role: Role
  user_is_active: boolean
  processed_by_name: string | null
}

export interface RecommendationLink {
  slot: number
  status: 'PENDING' | 'USED'
  token: string | null
  expires_at: string | null
  expired: boolean
}

export interface CandidateRecommendations {
  enabled: boolean
  total: number
  used: number
  links: RecommendationLink[]
}

export interface PublicRecommendation {
  organization: string
  roles: { id: 'MANAGER' | 'COLLEAGUE' | 'SUBORDINATE'; label: string }[]
  questions: { id: number; text: string; hint: string; required?: boolean; max_length?: number | null }[]
  /** Ім’я та посада кандидата для кроків R3 / R4 (мок, D-10: не на вступі). Поля ще немає в API — BR-14. */
  candidate?: { name: string; post?: string | null } | null // BR-14
}
