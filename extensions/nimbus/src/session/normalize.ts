import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { NimbusEvent } from '../events'

const TOOL_RESULT_PREVIEW_LIMIT = 500

function toolResultPreview(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, TOOL_RESULT_PREVIEW_LIMIT)
  try {
    return JSON.stringify(content).slice(0, TOOL_RESULT_PREVIEW_LIMIT)
  } catch {
    return '[unserializable tool result]'
  }
}

/**
 * SDK の生メッセージを Nimbus 正規化イベントに変換する（§3 設計原則 3）。
 * SDK の型変更の影響はこのファイルに閉じ込める。
 * sessionId は Nimbus 内部 ID（SDK の session_id とは別。init で対応づける）。
 */
export function normalizeSdkMessage(
  msg: SDKMessage,
  sessionId: string,
  now: () => number = Date.now
): NimbusEvent[] {
  const timestamp = now()

  switch (msg.type) {
    case 'system': {
      switch (msg.subtype) {
        case 'init':
          return [
            {
              kind: 'session-init',
              sessionId,
              timestamp,
              claudeSessionId: msg.session_id,
              claudeCodeVersion: msg.claude_code_version,
              model: msg.model,
              cwd: msg.cwd,
              permissionMode: msg.permissionMode,
              apiKeySource: msg.apiKeySource,
              tools: msg.tools,
              mcpServers: msg.mcp_servers.map((s) => ({ name: s.name, status: s.status })),
              plugins: msg.plugins.map((p) => ({ name: p.name, version: p.version })),
              skills: msg.skills,
              slashCommands: msg.slash_commands,
              agents: msg.agents
            }
          ]

        // フックの発火（T-027）。3 つの段階を 1 種類のイベントにまとめる
        case 'hook_started':
          return [
            {
              kind: 'hook',
              sessionId,
              timestamp,
              phase: 'started',
              hookId: msg.hook_id,
              hookName: msg.hook_name,
              hookEvent: msg.hook_event
            }
          ]
        case 'hook_progress':
          return [
            {
              kind: 'hook',
              sessionId,
              timestamp,
              phase: 'progress',
              hookId: msg.hook_id,
              hookName: msg.hook_name,
              hookEvent: msg.hook_event,
              output: msg.output,
              stderr: msg.stderr
            }
          ]
        case 'hook_response':
          return [
            {
              kind: 'hook',
              sessionId,
              timestamp,
              phase: 'response',
              hookId: msg.hook_id,
              hookName: msg.hook_name,
              hookEvent: msg.hook_event,
              outcome: msg.outcome,
              exitCode: msg.exit_code,
              output: msg.output,
              stderr: msg.stderr
            }
          ]

        // サブエージェント（T-018）。親には最終サマリーしか返らないので、ここで拾わないと中が見えない
        case 'task_started':
          return [
            {
              kind: 'subagent',
              sessionId,
              timestamp,
              phase: 'started',
              taskId: msg.task_id,
              description: msg.description,
              subagentType: msg.subagent_type,
              prompt: msg.prompt
            }
          ]
        case 'task_progress':
          return [
            {
              kind: 'subagent',
              sessionId,
              timestamp,
              phase: 'progress',
              taskId: msg.task_id,
              description: msg.description,
              subagentType: msg.subagent_type,
              lastToolName: msg.last_tool_name,
              summary: msg.summary,
              usage: {
                totalTokens: msg.usage.total_tokens,
                toolUses: msg.usage.tool_uses,
                durationMs: msg.usage.duration_ms
              }
            }
          ]
        case 'task_updated':
          return [
            {
              kind: 'subagent',
              sessionId,
              timestamp,
              phase: 'updated',
              taskId: msg.task_id,
              description: msg.patch.description,
              status: msg.patch.status,
              error: msg.patch.error
            }
          ]

        // コンパクション（T-022）。黙って起きると履歴が飛んだように見える
        case 'compact_boundary':
          return [
            {
              kind: 'compaction',
              sessionId,
              timestamp,
              trigger: msg.compact_metadata.trigger,
              preTokens: msg.compact_metadata.pre_tokens,
              postTokens: msg.compact_metadata.post_tokens,
              durationMs: msg.compact_metadata.duration_ms
            }
          ]

        default:
          return []
      }
    }

    case 'assistant': {
      // サブエージェント由来（parent_tool_use_id あり）は Phase 0 では主表示しない
      if (msg.parent_tool_use_id !== null) return []
      const events: NimbusEvent[] = []
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          events.push({ kind: 'assistant-text', sessionId, timestamp, text: block.text })
        } else if (block.type === 'thinking') {
          events.push({ kind: 'assistant-thinking', sessionId, timestamp, text: block.thinking })
        } else if (block.type === 'tool_use') {
          events.push({
            kind: 'tool-use',
            sessionId,
            timestamp,
            toolUseId: block.id,
            toolName: block.name,
            input: block.input
          })
        }
      }
      return events
    }

    case 'user': {
      // resume 時の履歴リプレイ（SDKUserMessageReplay, isReplay: true）は
      // 新規イベントとして再流出させない（履歴表示は Step 3 の永続化層が担う）
      if ('isReplay' in msg && msg.isReplay) return []
      // ツール実行結果は user ロールの tool_result ブロックとして流れてくる
      if (msg.parent_tool_use_id !== null) return []
      const content = msg.message.content
      if (!Array.isArray(content)) return []
      const events: NimbusEvent[] = []
      for (const block of content) {
        if (typeof block === 'object' && block !== null && block.type === 'tool_result') {
          events.push({
            kind: 'tool-result',
            sessionId,
            timestamp,
            toolUseId: block.tool_use_id,
            isError: block.is_error ?? false,
            preview: toolResultPreview(block.content)
          })
        }
      }
      return events
    }

    case 'result': {
      // sdk.d.ts 実測: total_cost_usd / usage は success・error 両サブタイプで必須。
      // totalCostUsd は「その時点までの累積」（クラッシュ時はゼロの場合あり→消費側で単調ガード）。
      // usage は per-turn かつメインループのみ（累積ではない。正確な集計は modelUsage を使う）
      return [
        {
          kind: 'turn-result',
          sessionId,
          timestamp,
          subtype: msg.subtype,
          isError: msg.is_error,
          numTurns: msg.num_turns,
          durationMs: msg.duration_ms,
          totalCostUsd: msg.total_cost_usd,
          usage: msg.usage
            ? {
                inputTokens: msg.usage.input_tokens,
                outputTokens: msg.usage.output_tokens,
                cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? undefined,
                cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? undefined
              }
            : undefined,
          resultText: msg.subtype === 'success' ? msg.result : undefined
        }
      ]
    }

    default:
      // その他のメッセージ種別（stream_event, hook_*, task_* 等）は Phase 0 では未使用。
      // 必要になった時点でここに正規化を追加する。
      return []
  }
}
