import { vi } from 'vitest'
import type { TaskBoardApiProxy } from '../src/host-runner.ts'

type ApiRequest<T> = { rpcId: string; payload: T }
type Success<T> = { result: { ok: true; value: T } }

type SessionListPayload = { cursor?: string }
type SessionListValue = { items: Array<{ sessionId: string; running: boolean }>; nextCursor?: string }
type SessionCreatePayload = { workspaceId?: string; agentPreset?: string }
type SessionCreateValue = { sessionId: string; agentPreset?: string }
type SessionRenamePayload = { sessionId: string; title: string }
type SessionRenameValue = { title: string; seq: number }
type SessionPromptPayload = { sessionId: string; mode: 'queue'; content: Array<{ type: 'text'; text: string }> }
type SessionPromptValue = { accepted: true; command?: { kind: 'success'; text?: string } }
type SessionHistoryPayload = { sessionId: string; beforeSeq?: number; maxMessages?: number }
type SessionHistoryValue = { events: Array<{ event: { type: string; seq: number; time: number; data: unknown } }>; hasMore: boolean }
type AgentPresetListValue = { presets: Array<{ id: string; broken?: string }> }

export interface ApiProxyHandlers {
  sessionsList(payload: SessionListPayload): SessionListValue | Promise<SessionListValue>
  sessionsCreate(payload: SessionCreatePayload): SessionCreateValue | Promise<SessionCreateValue>
  sessionsRename(payload: SessionRenamePayload): SessionRenameValue | Promise<SessionRenameValue>
  sessionsPrompt(payload: SessionPromptPayload): SessionPromptValue | Promise<SessionPromptValue>
  sessionsHistory(payload: SessionHistoryPayload): SessionHistoryValue | Promise<SessionHistoryValue>
  agentPresetsList(payload: Record<string, never>): AgentPresetListValue | Promise<AgentPresetListValue>
}

export type ApiProxyFake = TaskBoardApiProxy & {
  sessions: {
    list: ReturnType<typeof vi.fn<TaskBoardApiProxy['sessions']['list']>>
    create: ReturnType<typeof vi.fn<TaskBoardApiProxy['sessions']['create']>>
    rename: ReturnType<typeof vi.fn<TaskBoardApiProxy['sessions']['rename']>>
    prompt: ReturnType<typeof vi.fn<TaskBoardApiProxy['sessions']['prompt']>>
    history: ReturnType<typeof vi.fn<TaskBoardApiProxy['sessions']['history']>>
  }
  agentPresets: {
    list: ReturnType<typeof vi.fn<TaskBoardApiProxy['agentPresets']['list']>>
  }
}

function success<T>(value: T): Success<T> {
  return { result: { ok: true, value } }
}

function payload<T>(request: ApiRequest<T>): T {
  if (typeof request.rpcId !== 'string' || request.rpcId === '') throw new Error('ApiProxy request requires a non-empty rpcId')
  return request.payload
}

/** Build a typed ApiProxy fake that preserves the real RPC envelope and result shape. */
export function makeApiProxy(overrides: Partial<ApiProxyHandlers> = {}): ApiProxyFake {
  const handlers: ApiProxyHandlers = {
    sessionsList: async () => ({ items: [] }),
    sessionsCreate: async () => ({ sessionId: 'session-a' }),
    sessionsRename: async ({ title }) => ({ title, seq: 1 }),
    sessionsPrompt: async () => ({ accepted: true }),
    sessionsHistory: async () => ({ events: [], hasMore: false }),
    agentPresetsList: async () => ({ presets: [] }),
    ...overrides,
  }
  return {
    sessions: {
      list: vi.fn(async request => success(await handlers.sessionsList(payload(request)))),
      create: vi.fn(async request => success(await handlers.sessionsCreate(payload(request)))),
      rename: vi.fn(async request => success(await handlers.sessionsRename(payload(request)))),
      prompt: vi.fn(async request => success(await handlers.sessionsPrompt(payload(request)))),
      history: vi.fn(async request => success(await handlers.sessionsHistory(payload(request)))),
    },
    agentPresets: {
      list: vi.fn(async request => success(await handlers.agentPresetsList(payload(request)))),
    },
  }
}

export function failedApiResponse(code: string, message: string, details?: unknown) {
  return { result: { ok: false as const, error: { code, message, ...(details === undefined ? {} : { details }) } } }
}
