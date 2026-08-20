import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  CanUseTool,
  McpServerConfig,
  McpServerStatus,
  Options,
  Query,
  RewindFilesResult,
  SDKControlGetContextUsageResponse,
  SDKControlGetUsageResponse,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { NimbusEvent, SessionStatus, SessionSummary } from '../events'
import { AsyncMessageQueue } from './AsyncMessageQueue'
import { normalizeSdkMessage } from './normalize'
import type { SdkModelInfo } from '../core/runSettings'

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
  /** 最初のメッセージに添える画像（T-040） */
  firstImages?: readonly MessageImage[]
  /** 再開時に指定する Claude セッション ID（options.resume に渡す） */
  resumeClaudeSessionId?: string
  /** 再開時に Nimbus セッション ID を引き継ぐ（イベント・DB のキーを安定させる） */
  reuseSessionId?: string
  /** セッション個別の追加オプション（スモーク/撮影などメイン内部用途） */
  extraOptions?: Partial<Options>
}

const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set(['completed', 'error'])

/** 緊急停止で中断の返事を待つ上限。止めたいときに止まらないのが一番困る */
const INTERRUPT_TIMEOUT_MS = 3000

/** 返ってこない Promise で全体を止めないための待ち上限 */
async function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** テスト注入用に query() と同シグネチャの関数型を切り出す */
export type QueryFn = typeof query

/** 添付画像（`core/attachments.ts` の Attachment と構造互換） */
export interface MessageImage {
  mediaType: string
  /** base64（データ URL のヘッダは含めない） */
  data: string
}

function userMessage(text: string, images?: readonly MessageImage[]): SDKUserMessage {
  // SDK 0.3.226 sdk.d.ts 実測: SDKUserMessage = { type:'user', message: MessageParam, parent_tool_use_id, ... }
  // 画像を添えるときだけブロック配列にする（文字列のままのほうが素直なので、既定は変えない）。
  // 画像を先に置くのは、Anthropic API が「画像 → それについての指示」の順を推奨しているため
  const content = images?.length
    ? [
        ...images.map((image) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: image.mediaType as 'image/png', data: image.data }
        })),
        { type: 'text' as const, text }
      ]
    : text
  return {
    type: 'user',
    message: { role: 'user', content },
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
      queue.push(userMessage(input.firstMessage, input.firstImages))
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

  /**
   * いま入力を受け付けられるか。`isActive` は「Map にある」だけなので、
   * 停止済み・終了済みのセッションでも true を返す。送信先を決めるときはこちらを見る
   * （見ないと、緊急停止のあとにコックピットへ打った文がエラーになって落ちる）。
   */
  isAccepting(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    return session !== undefined && !session.queue.isClosed && !TERMINAL_STATUSES.has(session.status)
  }

  /** @param images 添付画像（T-040）。省略時の振る舞いは従来どおり */
  sendMessage(sessionId: string, text: string, images?: readonly MessageImage[]): void {
    const session = this.mustGet(sessionId)
    if (TERMINAL_STATUSES.has(session.status) || session.queue.isClosed) {
      // 終了済みセッションへの送信は黙殺せず IPC エラーとして返す（レビュー指摘 #1）
      throw new Error(`Session ${sessionId} is not accepting input (status: ${session.status})`)
    }
    // push が成功してから user-text を記録する（幻のメッセージを残さない）
    session.queue.push(userMessage(text, images))
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

  /**
   * 緊急停止（tasks.md T-057）。走っている全セッションに中断を投げてから入力を閉じる。
   * `closeAll` との違いは「いま実行中のターンを止める」こと — 入力を閉じるだけでは
   * 進行中のツール実行はそのまま最後まで走ってしまう。
   * 中断に失敗しても閉じるところまでは必ず進める（止まらないほうが困る）。
   * @returns 停止したセッション数
   */
  async stopAll(): Promise<number> {
    const targets = [...this.sessions.values()]
    await Promise.allSettled(
      targets.map(async (session) => withTimeout(session.handle.interrupt(), INTERRUPT_TIMEOUT_MS))
    )
    for (const session of targets) {
      session.queue.close()
    }
    return targets.length
  }

  /**
   * 枠の消費（5 時間・週）とセッションの累積コスト（T-017 / T-037）。
   *
   * SDK 側で **EXPERIMENTAL** と明記されている API なので、名前の変更・削除に備えて
   * ここ 1 箇所に閉じ込め、失敗しても undefined を返すだけにする
   * （使用量が取れないことを、セッションが動かない理由にしない）。
   * API キー利用・Bedrock・Vertex では枠の概念が無く `rate_limits` は null で返る。
   */
  async getUsage(sessionId: string): Promise<SDKControlGetUsageResponse | undefined> {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    try {
      return await session.handle.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
    } catch {
      return undefined
    }
  }

  /** いま文脈をどれだけ使っているか（T-020）。取れなければ undefined */
  async getContextUsage(sessionId: string): Promise<SDKControlGetContextUsageResponse | undefined> {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    try {
      return await session.handle.getContextUsage()
    } catch {
      return undefined
    }
  }

  /**
   * チェックポイントへの巻き戻し（T-025）。
   * `dryRun` で「何が変わるか」だけを先に取れるので、**見せてから戻す**ことができる。
   * 戻せない理由（`canRewind: false` + `error`）もそのまま返し、黙って成功にしない。
   */
  async rewind(
    sessionId: string,
    messageUuid: string,
    dryRun: boolean
  ): Promise<RewindFilesResult | undefined> {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    try {
      return await session.handle.rewindFiles(messageUuid, { dryRun })
    } catch (error) {
      return { canRewind: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 使えるモデルの一覧（T-232 の割り当て・T-291 の切り替えで候補に出す）。
   *
   * **SDK が返すのは `value`**（`id` ではない）。名前・説明・使えるエフォートの段まで
   * 付いてくるので、そのまま渡す — 手で並べた一覧は必ず古くなる。
   */
  async supportedModels(sessionId: string): Promise<SdkModelInfo[]> {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    try {
      return (await session.handle.supportedModels()) as SdkModelInfo[]
    } catch {
      return []
    }
  }

  /**
   * いま話しているセッションのモデルを変える（T-291）。
   * **次の応答から効く**（走っている最中でも受け付ける）。
   */
  async setModel(sessionId: string, model?: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    try {
      await session.handle.setModel(model)
      session.model = model ?? session.model
      return true
    } catch {
      // 変えられなかったことは呼び手が画面に出す（ここは黙って false）
      return false
    }
  }

  /**
   * エフォート（思考量）を変える（T-291）。
   *
   * 専用の口は無いが、`applyFlagSettings` の `effortLevel` が**セッションの残りに効く**。
   * `max` はセッション限りで、設定ファイルには残らない（SDK の約束）。
   */
  async setEffort(sessionId: string, effort: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    try {
      await session.handle.applyFlagSettings({ effortLevel: effort as never })
      return true
    } catch {
      return false
    }
  }

  /** 接続中の MCP サーバーの状態と提供ツール（T-029 / T-042） */
  async mcpServers(sessionId: string): Promise<McpServerStatus[]> {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    try {
      return await session.handle.mcpServerStatus()
    } catch {
      return []
    }
  }

  /** つながらなかったサーバーを繋ぎ直す（T-029）。セッションを作り直さずに済ませる */
  async reconnectMcpServer(sessionId: string, name: string): Promise<void> {
    await this.sessions.get(sessionId)?.handle.reconnectMcpServer(name)
  }

  /** サーバーの有効・無効を切り替える（T-029） */
  async toggleMcpServer(sessionId: string, name: string, enabled: boolean): Promise<void> {
    await this.sessions.get(sessionId)?.handle.toggleMcpServer(name, enabled)
  }

  /** サーバー構成を丸ごと差し替える（T-029 の追加・削除はこれで行う） */
  async setMcpServers(sessionId: string, servers: Record<string, McpServerConfig>): Promise<void> {
    await this.sessions.get(sessionId)?.handle.setMcpServers(servers)
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
