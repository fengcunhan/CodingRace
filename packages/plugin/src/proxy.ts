// Node 原生 fetch（undici）默认不读代理环境变量，走代理的用户会直连失败。
// NODE_USE_ENV_PROXY=1 启用 undici 的 EnvHttpProxyAgent，自动读 http(s)_proxy。
// 必须作为进程启动环境注入（undici 在 bootstrap 时读取，运行时改 process.env 无效）。

function hasProxyEnv(): boolean {
  return Boolean(
    process.env.https_proxy ||
      process.env.HTTPS_PROXY ||
      process.env.http_proxy ||
      process.env.HTTP_PROXY ||
      process.env.all_proxy ||
      process.env.ALL_PROXY
  )
}

// worker 子进程是否需要在启动时补上代理开关
export function needsProxyEnv(): boolean {
  return hasProxyEnv() && !process.env.NODE_USE_ENV_PROXY
}

// 给上报进程用的环境：检测到代理且未显式设置时补上 NODE_USE_ENV_PROXY。
// Node < 20.12 无 EnvHttpProxyAgent，设了会被忽略，无副作用。
export function reporterEnv(): NodeJS.ProcessEnv {
  if (needsProxyEnv()) {
    return { ...process.env, NODE_USE_ENV_PROXY: '1' }
  }
  return process.env
}
