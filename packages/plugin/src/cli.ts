import { spawnSync } from 'node:child_process'
import { runHook } from './hook'
import { runInstall, runUninstall } from './install'
import { needsProxyEnv, reporterEnv } from './proxy'
import { runStatus } from './status'
import { runWorker } from './worker'

// 手动 `codingrace worker` 且环境走代理时，重启自身补上 NODE_USE_ENV_PROXY
// （该开关必须在进程启动时注入，无法运行时生效）
function reexecWorkerWithProxy(): number {
  const result = spawnSync(process.execPath, [process.argv[1] ?? '', 'worker'], {
    env: reporterEnv(),
    stdio: 'inherit',
  })
  return result.status ?? 0
}

const HELP = `codingrace — CodingRace reporter plugin for Claude Code

用法:
  codingrace install --code <cr_live_...> [--endpoint <url>]   安装并注册 hooks
  codingrace status                                             查看队列与上报状态
  codingrace uninstall                                          移除 hooks（保留数据目录）

隐私：只上报 token 计数、模型名、时间戳与会话标识；
绝不读取或上传对话内容、代码、文件路径。源码可审计。
`

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv

  switch (command) {
    case 'install':
      await runInstall(rest)
      return
    case 'uninstall':
      runUninstall()
      return
    case 'status':
      runStatus()
      return
    case 'hook':
      await runHook()
      return
    case 'worker':
      if (needsProxyEnv()) {
        process.exitCode = reexecWorkerWithProxy()
        return
      }
      await runWorker()
      return
    default:
      process.stderr.write(HELP)
      process.exitCode = command ? 1 : 0
  }
}

main().catch((error) => {
  process.stderr.write(`codingrace: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
