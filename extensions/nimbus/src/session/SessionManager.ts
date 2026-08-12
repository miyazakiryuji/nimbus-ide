import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { CanUseTool, Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { NimbusEvent, SessionStatus, SessionSummary } from '../events'
import { AsyncMessageQueue } from './AsyncMessageQueue'
import { normalizeSdkMessage } from './normalize'

interface ManagedSession {
  /** Nimbus 内部 ID（全イベント・DB のキー。SDK の session_id とは別物） */
  id: string
  claudeSessionId?: string
  status: SessionStatus
  cwd: string
  model?: string
  createdAt: number
  totalCostUsd?: number
  queue: AsyncMessageQueue<SDKUserMessage>
  handle: Query
}

export interface CreateSessionInput {
  cwd?: string
  /** 省略時（resume 時）は最初のメッセージを送らず入力待ちで開始する */
  firstMessage?: string
  /** 再開時に指定する Claude セッション ID（options.resume に渡す） */
  resumeClaudeSessionId?: string
  /** 再開時に Nimbus セッション ID を引き継ぐ（イベント・DB のキーを安定させる） */
  reuseSessionId?: string
  /** セッション個別の追加オプション（スモーク/撮影などメイン内部用途） */
  extraOptions?: Partial<Options>
}

const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set(['completed', 'error'])

/** テスト注入用に query() と同シグネチャの関数型を切り出す */
export type QueryFn = typeof query

function userMessage(text: string): SDKUserMessage {
  // SDK 0.3.226 sdk.d.ts 実測: SDKUserMessage = { type:'user', message: MessageParam, parent_tool_use_id, ... }
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null
  }
}

/**
 * Claude セッションの生成・保持・多重起動・再開（§3）。
 * 最初から Map による多重セッション管理とし、シングルトン前提の API を作らない（§3 設計原則 5）。
 */
export class SessionManager extends EventEmitter {
  private sessions = new Map<string, ManagedSession>()

  constructor(
    private readonly queryFn: QueryFn = query,
    /** F-7: アクティブプロファイル由来の追加オプション（env / バイナリパス等） */
    private readonly optionsProvider?: () => Promise<Partial<Options>>,
    /** F-3: 承認インボックス用の canUseTool を生成するファクトリ（PermissionBroker） */
    private readonly canUseToolFactory?: (sessionId: string, cwd: string) => CanUseTool
  ) {
    super()
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    const id = input.reuseSessionId ?? randomUUID()
    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} is already active`)
    }
    const cwd = input.cwd ?? process.cwd()
    const queue = new AsyncMessageQueue<SDKUserMessage>()
    const extra = (await this.optionsProvider?.()) ?? {}

    const handle = this.queryFn({
      prompt: queue,
      options: {
        // extra.env が無い場合は未指定＝親プロセス環境を継承
        // （env は「置換」なので提供側が必ず process.env をスプレッドする。§10 検証 7）
        ...extra,
        cwd,
        permissionMode: 'default',
        ...(this.canUseToolFactory ? { canUseTool: this.canUseToolFactory(id, cwd) } : {}),
        ...(input.resumeClaudeSessionId ? { resume: input.resumeClaudeSessionId } : {}),
        ...input.extraOptions
      }
    })

    const session: ManagedSession = {
      id,
      status: 'starting',
      cwd,
      createdAt: Date.now(),
      queue,
      handle
    }
    this.sessions.set(id, session)

    this.emitEvent({
      kind: 'status',
      sessionId: id,
      timestamp: Date.now(),
      status: 'starting'
    })
    if (input.firstMessage !== undefined) {
      // 最初のユーザーメッセージもイベントとして正規化ストリームに流す（表示・永続化の正はメイン側）
      queue.push(userMessage(input.firstMessage))
      this.emitEvent({
        kind: 'user-text',
        sessionId: id,
        timestamp: Date.now(),
        text: input.firstMessage
      })
    }

    void this.pump(session)
    return id
  }

  /** 指定 Nimbus セッションが現在アクティブ（Map に存在）か */
  isActive(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  sendMessage(sessionId: string, text: string): void {
    const session = this.mustGet(sessionId)
    if (TERMINAL_STATUSES.has(session.status) || session.queue.isClosed) {
      // 終了済みセッションへの送信は黙殺せず IPC エラーとして返す（レビュー指摘 #1）
      throw new Error(`Session ${sessionId} is not accepting input (status: ${session.status})`)
    }
    // push が成功してから user-text を記録する（幻のメッセージを残さない）
    session.queue.push(userMessage(text))
    this.emitEvent({
      kind: 'user-text',
      sessionId,
      timestamp: Date.now(),
      text
    })
    this.setStatus(session, 'running')
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = this.mustGet(sessionId)
    await session.handle.interrupt()
    // status はここでは変えない。中断されたターンの turn-result（error_during_execution）が
    // awaiting-input へ遷移させる（レビュー指摘: 'interrupted' の不安定さ）
  }

  /** セッションの入力を閉じてクエリを終了させる（pump が完走して terminal 状態になる） */
  close(sessionId: string): void {
    const session = this.mustGet(sessionId)
    session.queue.close()
  }

  /** アプリ終了時に全セッションの入力を閉じ、CLI サブプロセスを解放する */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.queue.close()
    }
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => this.toSummary(s))
  }

  get(sessionId: string): SessionSummary | undefined {
    const s = this.sessions.get(sessionId)
    return s ? this.toSummary(s) : undefined
  }

  private toSummary(s: ManagedSession): SessionSummary {
    return {
      sessionId: s.id,
      claudeSessionId: s.claudeSessionId,
      status: s.status,
      cwd: s.cwd,
      model: s.model,
      createdAt: s.createdAt,
      totalCostUsd: s.totalCostUsd
    }
  }

  private async pump(session: ManagedSession): Promise<void> {
    try {
      for await (const msg of session.handle) {
        const events = normalizeSdkMessage(msg, session.id)
        for (const event of events) {
          this.applyToSessionState(session, event)
          this.emitEvent(event)
        }
      }
      if (!TERMINAL_STATUSES.has(session.status)) {
        this.setStatus(session, 'completed')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emitEvent({
        kind: 'session-error',
        sessionId: session.id,
        timestamp: Date.now(),
        message
      })
      this.setStatus(session, 'error')
    } finally {
      // クエリ終了後は必ず入力を閉じる。以後の sendMessage は上のガードで拒否される
      session.queue.close()
    }
  }

  private applyToSessionState(session: ManagedSession, event: NimbusEvent): void {
    if (event.kind === 'session-init') {
      session.claudeSessionId = event.claudeSessionId
      session.model = event.model
      if (session.status === 'starting') {
        this.setStatus(session, 'running')
      }
    } else if (event.kind === 'turn-result') {
      if (event.totalCostUsd !== undefined) {
        // 累積値だが、クラッシュ系 result はゼロを載せることがある（sdk.d.ts）→ 単調増加ガード
        session.totalCostUsd = Math.max(session.totalCostUsd ?? 0, event.totalCostUsd)
      }
      this.setStatus(session, 'awaiting-input')
    }
  }

  private setStatus(session: ManagedSession, status: SessionStatus): void {
    if (session.status === status) return
    session.status = status
    this.emitEvent({
      kind: 'status',
      sessionId: session.id,
      timestamp: Date.now(),
      status
    })
  }

  private emitEvent(event: NimbusEvent): void {
    this.emit('event', event)
  }

  private mustGet(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    return session
  }
}
