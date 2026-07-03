import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_VERSION } from '@codingrace/schema'
import type { PluginConfig } from './config'
import { appendError } from './log'
import { deadLetterDir } from './paths'
import { listQueueFiles, readBatch } from './queue'
import { PLUGIN_NAME, PLUGIN_VERSION } from './version'

export interface SendStats {
  sent: number
  kept: number
  dead: number
}

function moveToDeadLetter(filePath: string, reason: string): void {
  appendError('sender', `batch ${path.basename(filePath)} dead-lettered: ${reason}`)
  try {
    fs.renameSync(filePath, path.join(deadLetterDir(), path.basename(filePath)))
  } catch {
    fs.rmSync(filePath, { force: true })
  }
}

// 逐批发送本地队列。临时性失败（网络 / 429 / 5xx）保留文件并停止本轮，
// 永久性失败（4xx）移入死信目录避免无限重试。
export async function sendQueued(
  config: PluginConfig,
  fetchImpl: typeof fetch = fetch
): Promise<SendStats> {
  const url = `${config.endpoint.replace(/\/+$/, '')}/api/v1/ingest`
  const stats = { sent: 0, kept: 0, dead: 0 }

  for (const filePath of listQueueFiles()) {
    const batch = readBatch(filePath)
    if (!batch || batch.events.length === 0) {
      moveToDeadLetter(filePath, 'unreadable batch file')
      stats.dead += 1
      continue
    }

    const envelope = {
      schema_version: SCHEMA_VERSION,
      batch_id: batch.batchId,
      client: {
        plugin_name: PLUGIN_NAME,
        plugin_version: PLUGIN_VERSION,
        agent: 'claude_code',
        os: process.platform,
        arch: process.arch,
      },
      events: batch.events,
    }

    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.authCode}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(envelope),
      })
    } catch (error) {
      appendError('sender', error)
      stats.kept += 1
      break
    }

    if (response.ok) {
      fs.rmSync(filePath, { force: true })
      stats.sent += 1
      continue
    }

    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      stats.kept += 1
      break
    }

    // 401/403/400 等：重试不可能成功
    moveToDeadLetter(filePath, `server rejected with ${response.status}`)
    stats.dead += 1
  }

  return stats
}
