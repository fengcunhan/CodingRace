import { spawn } from 'node:child_process'
import { registerTranscript } from './cursors'
import { ensureDirs } from './paths'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function spawnDetachedWorker(): void {
  const selfPath = process.argv[1]
  if (!selfPath) return
  const child = spawn(process.execPath, [selfPath, 'worker'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

// hook 入口约束（验收标准 S3）：登记 transcript + 甩出后台 worker 后立即退出，
// 绝不在 Claude Code 的 hook 等待路径上做解析或网络请求
export async function runHook(): Promise<void> {
  ensureDirs()

  try {
    const payload = JSON.parse(await readStdin()) as Record<string, unknown>
    const transcriptPath = payload.transcript_path
    if (typeof transcriptPath === 'string' && transcriptPath.length > 0) {
      registerTranscript(transcriptPath, new Date())
    }
  } catch {
    // stdin 不可解析时仍然触发 worker（扫描已登记会话）
  }

  spawnDetachedWorker()
}
