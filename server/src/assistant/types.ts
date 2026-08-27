import { z } from 'zod'

export type AssistantMode = 'student' | 'employer' | 'university'

/** Immediate injection actions the engine can return. The client executes these
 *  directly against app state or via DOM events — no confirmation card. */
export type AssistantActionType = 'inject_data' | 'navigate' | 'update_profile' | 'add_evidence' | 'create_job'

export interface AssistantAction {
  type: AssistantActionType
  /** e.g. 'job_editor', 'resume', 'shortlist', 'profile_skills', '/app/jobs' */
  target: string
  /** The actual data to be added immediately — shape varies by target. */
  data: Record<string, unknown>
}

export interface AssistantResponse {
  text: string
  session_id: string
  actions: AssistantAction[]
}

/** What Claude returns as structured output (matches RESPONSE_SCHEMA). */
export interface AssistantAIOutput {
  text: string
  actions: AssistantAction[]
}

export const ChatRequest = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  mode: z.enum(['student', 'employer', 'university']).optional(),
  context: z.record(z.any()).optional(),
})
