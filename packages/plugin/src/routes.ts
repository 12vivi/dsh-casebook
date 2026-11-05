// 线索板用的 HTTP 路由。挂在 DSH 连接层的 /api 下，鉴权沿用网页已有的 cookie，浏览器同源 fetch 即可。
//   GET  /api/casebook.board?session=<id>   线索板（L1）
//   POST /api/casebook.accuse              指认 { sessionId, culprit, evidence, answers }
//   POST /api/casebook.retry               重新结算最新一版正文 { sessionId }
import type { Context } from '@deepseek-ai/cordis'
import type { CasebookRuntime } from './runtime.ts'

const NO_STORE = { 'cache-control': 'no-store' }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: NO_STORE })
}

async function readBody(request: Request): Promise<{ sessionId?: unknown } & Record<string, unknown>> {
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function registerRoutes(ctx: Context, runtime: CasebookRuntime): void {
  ctx.connection.fetch.register({
    path: '/api/casebook.board',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const sessionId = new URL(request.url).searchParams.get('session')
      if (sessionId === null || sessionId === '') return json({ error: '缺少 session 参数' }, 400)
      return json(runtime.boardFor(sessionId))
    },
  })
  ctx.connection.fetch.register({
    path: '/api/casebook.accuse',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      const body = await readBody(request)
      if (typeof body.sessionId !== 'string') return json({ ok: false, errors: ['缺少 sessionId'] }, 400)
      const { sessionId, ...accusation } = body
      return json(await runtime.accuse(sessionId, accusation))
    },
  })
  ctx.connection.fetch.register({
    path: '/api/casebook.retry',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      const body = await readBody(request)
      if (typeof body.sessionId !== 'string') return json({ ok: false, errors: ['缺少 sessionId'] }, 400)
      return json(runtime.retry(body.sessionId))
    },
  })
}
