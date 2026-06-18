export type TenderVerdict =
  | 'ELIGIBLE'
  | 'PARTIAL'
  | 'INELIGIBLE'
  | 'EXCLUDED'
  | 'PENDING'

export interface TenderRun {
  id: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed' | 'partial'
  keywords_total: number
  keywords_succeeded: number
  keywords_failed: number
  tenders_found: number
  tenders_qualified: number
  tenders_excluded: number
  triggered_by: 'scheduled' | 'manual' | 'chat' | 'test'
}

export interface ChatMessage {
  id: string
  role: 'agent' | 'user' | 'system'
  content: string
  type: 'text' | 'success' | 'error' | 'info'
  timestamp: string
  combined_url?: string
  combined_name?: string
  executive_url?: string
  executive_name?: string
  eligibility_url?: string
  eligibility_name?: string
}
