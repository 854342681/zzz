import { createReadStream, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Fairy Ⅲ · H.D.D Skin — Host half.
 *
 *   GET  /fairy-zzz/assets/<file>   boot.mp4 / poster.jpg / hero.png / voice/greet.wav
 *   GET  /fairy-zzz/audio/<hash>.wav synthesized voice cache (Range capable)
 *   POST /fairy-zzz/tts             { text } -> { url, cached, seconds }
 *   GET  /fairy-zzz/voice-home      { ok, home, source, reason }
 *   POST /fairy-zzz/voice-home      { home, probe? } -> 保存/校验引擎目录
 *   GET  /fairy-zzz/health          { ok, engine, voice }
 *
 * The Client half owns every pixel; this half owns bytes, cache and the local
 * GPT-SoVITS process (already resident on 127.0.0.1:9800 in the usual case).
 */
export const name = 'fairy-zzz'
export const inject = ['webServer']

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ASSETS = join(HERE, 'assets')
const CACHE = join(HERE, 'cache')

const TTS_PORT = Number(process.env.FAIRY_TTS_PORT || 9800)

/* 语音引擎位置由用户自己指定，优先级：
   1. voice-home.txt（设置面板里填的目录，与插件同目录）—— 用户选择永远优先
   2. FAIRY_VOICE_HOME 环境变量（安装脚本 / 进阶用户）
   3. 插件同级 voice/（免安装便携包自带引擎）
   4. 旧版 FAIRY_TTS_DIR 环境变量（兼容早期安装）
   都没有就返回空串：皮肤照常工作，只是不朗读，设置面板会提示去指定目录。
   （问候语是预录 wav，不依赖引擎。） */
const VOICE_HINT = join(HERE, 'voice-home.txt')

function readVoiceHome() {
  try {
    const hint = readFileSync(VOICE_HINT, 'utf8').trim()
    if (hint) return resolve(hint)
  } catch {}
  if (process.env.FAIRY_VOICE_HOME) return resolve(process.env.FAIRY_VOICE_HOME)
  const beside = join(HERE, '..', 'voice')
  if (existsSync(join(beside, 'fairy_server.py'))) return resolve(beside)
  if (process.env.FAIRY_TTS_DIR) return resolve(process.env.FAIRY_TTS_DIR)
  return ''
}

function voiceHomeSource() {
  try {
    if (readFileSync(VOICE_HINT, 'utf8').trim()) return 'settings'
  } catch {}
  if (process.env.FAIRY_VOICE_HOME) return 'env'
  if (existsSync(join(HERE, '..', 'voice', 'fairy_server.py'))) return 'portable'
  if (process.env.FAIRY_TTS_DIR) return 'legacy'
  return 'none'
}

/* 用户填进来的路径：去引号、合并重复分隔符，Windows 下统一成反斜杠。 */
const IS_WIN = process.platform === 'win32'

function cleanHome(value) {
  let out = String(value ?? '')
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/([\\/])\1+/g, '$1')
  if (IS_WIN) out = out.replace(/\//g, '\\')
  return out
}

/* 检查一个目录是不是能跑起来的语音引擎，返回可读的诊断。 */
function inspectVoiceDir(dir) {
  const empty = { ok: false, home: '', source: voiceHomeSource(), reason: '' }
  if (!dir) return { ...empty, reason: '还没有指定语音引擎目录' }
  if (!existsSync(dir)) return { ...empty, home: dir, reason: '目录不存在：' + dir }
  const server = join(dir, 'fairy_server.py')
  if (!existsSync(server)) return { ...empty, home: dir, reason: '目录里没有 fairy_server.py' }
  const python = resolvePython(dir)
  if (!existsSync(python)) return { ...empty, home: dir, reason: '目录里没有 python\\python.exe 或 py311\\python.exe' }
  if (!existsSync(join(dir, 'GPT-SoVITS'))) return { ...empty, home: dir, reason: '目录里没有 GPT-SoVITS' }
  return {
    ok: true,
    home: dir,
    source: voiceHomeSource(),
    python,
    server,
    models: existsSync(join(dir, 'models')) ? join(dir, 'models') : '',
    reason: '',
  }
}

function saveVoiceHome(dir) {
  const clean = cleanHome(dir)
  const info = inspectVoiceDir(clean)
  if (!info.ok) return info
  try {
    writeFileSync(VOICE_HINT, clean + '\n', 'utf8')
  } catch (cause) {
    return { ...info, ok: false, reason: '写不进 voice-home.txt：' + String(cause?.message ?? cause) }
  }
  syncVoiceHome()
  return { ...inspectVoiceDir(clean), source: 'settings', saved: true }
}

let TTS_DIR = readVoiceHome()
let TTS_PY = resolvePython(TTS_DIR)
let TTS_SERVER = join(TTS_DIR, 'fairy_server.py')

function resolvePython(dir) {
  if (!dir) return ''
  return existsSync(join(dir, 'python', 'python.exe'))
    ? join(dir, 'python', 'python.exe')
    : join(dir, 'py311', 'python.exe')
}

/* 每次用到引擎前重新解析一次：改了环境变量 / voice-home.txt 之后
   不必重启宿主，下一次请求就会指向新目录。 */
function syncVoiceHome() {
  let dir = ''
  try {
    dir = readVoiceHome()
  } catch {
    return
  }
  if (dir === TTS_DIR) return
  TTS_DIR = dir
  TTS_PY = resolvePython(dir)
  TTS_SERVER = join(dir, 'fairy_server.py')
}
const TTS_SPEED = 1.04
const MAX_CHARS = 500

const MIME = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
}

const mimeOf = (file) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'

async function sizeOf(file) {
  try {
    const info = await stat(file)
    return info.isFile() ? info.size : -1
  } catch {
    return -1
  }
}

async function sendFile(req, res, file) {
  const total = await sizeOf(file)
  if (total < 0) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  const type = mimeOf(file)
  const range = req.headers.range
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1
      if (start <= end && start < total) {
        res.writeHead(206, {
          'content-type': type,
          'content-range': `bytes ${start}-${end}/${total}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
          'cache-control': 'no-cache',
        })
        createReadStream(file, { start, end }).pipe(res)
        return
      }
    }
  }
  res.writeHead(200, {
    'content-type': type,
    'accept-ranges': 'bytes',
    'content-length': total,
    'cache-control': 'no-cache',
  })
  createReadStream(file).pipe(res)
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((done, fail) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        fail(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
    req.on('error', fail)
  })
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function engineState() {
  try {
    const res = await fetch(`http://127.0.0.1:${TTS_PORT}/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return { up: false, loading: false, ready: false, error: '', state: 'dead' }
    const data = await res.json().catch(() => ({}))
    const loading = Boolean(data?.loading)
    const ready = Boolean(data?.ready)
    return { up: true, loading, ready, error: String(data?.error ?? ''), state: ready ? 'ready' : loading ? 'loading' : 'error' }
  } catch {
    return { up: false, loading: false, ready: false, error: '', state: 'dead' }
  }
}

async function pingEngine() {
  return (await engineState()).up
}

let enginePromise = null
let engineChild = null

function ensureEngine() {
  syncVoiceHome()
  if (!enginePromise) {
    enginePromise = (async () => {
      const state = await engineState()
      if (state.up) return true
      if (!existsSync(TTS_PY) || !existsSync(TTS_SERVER)) {
        throw new Error(TTS_DIR ? `语音引擎不完整：${TTS_DIR}（请在 设置 → Fairy 里重新指定目录）` : '还没有指定语音引擎目录（设置 → Fairy → 语音引擎目录）')
      }
      const logFile = join(TTS_DIR, 'server.log')
      let out = 'ignore'
      try {
        out = openSync(logFile, 'a')
      } catch {}
      const child = spawn(TTS_PY, [TTS_SERVER, '--port', String(TTS_PORT)], {
        detached: true,
        stdio: ['ignore', out, out],
        cwd: TTS_DIR,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })
      child.unref()
      engineChild = child
      for (let tick = 0; tick < 180; tick += 1) {
        await sleep(1000)
        const now = await engineState()
        if (now.up) return true
        if (child.exitCode !== null && child.exitCode !== undefined) break
      }
      throw new Error('语音引擎启动超时（日志见 voice/server.log）')
    })().catch((cause) => {
      enginePromise = null
      throw cause
    })
  }
  return enginePromise
}

async function stopEngine() {
  enginePromise = null
  const child = engineChild
  engineChild = null
  if (!child) return false
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    } else {
      child.kill('SIGTERM')
    }
    return true
  } catch {
    return false
  }
}

/** CPU 推理排队：一次只跑一句，跟引擎保持一致。 */
let queue = Promise.resolve()

function enqueue(run) {
  const task = queue.then(run, run)
  queue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

const pending = new Map()

function synthesize(text, file) {
  return enqueue(async () => {
    await ensureEngine()
    const res = await fetch(`http://127.0.0.1:${TTS_PORT}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, out: file, speed: TTS_SPEED }),
      signal: AbortSignal.timeout(240_000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`tts ${res.status}: ${data.error ?? 'unknown'}`)
    return data
  })
}

function cleanText(raw) {
  return String(raw ?? '')
    .replace(/```[\s\S]*?```/g, '。')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS)
}

export function apply(ctx) {
  const webServer = ctx.webServer
  if (!webServer) return

  /* 会话运行态：宿主事件 → 内存里的 mood 状态机（thinking / working / done） */
  const mood = { running: false, since: 0, doneAt: 0 }
    const moodSeen = { api: 0, agent: 0, stream: 0, session: 0 }
  const markRunning = (running) => {
    if (running === mood.running) return
    mood.running = running
    if (running) {
      mood.since = Date.now()
    } else {
      mood.doneAt = Date.now()
    }
  }
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('api-session/status', (_sessionId, running) => { moodSeen.api++; markRunning(Boolean(running)) })
      ctx.on('agent/status', (payload) => { moodSeen.agent++; markRunning(payload?.status === 'running') })
      // 插件中途重载时会错过 running=true 的边沿事件，用流式帧把状态补回来
      ctx.on('agent/assistant-stream', () => { moodSeen.stream++; markRunning(true) })
      ctx.on('session/event', () => { moodSeen.session++; markRunning(true) })
    }
  } catch {}

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/fairy-zzz/mood',
      handler: (req, res) => {
        const now = Date.now()
        let state = 'idle'
        if (mood.running) {
          state = now - mood.since > 2500 ? 'working' : 'thinking'
        } else if (mood.doneAt && now - mood.doneAt < 2400) {
          state = 'done'
        }
        sendJson(res, 200, {
          mood: state,
          running: mood.running,
          elapsed: mood.running ? now - mood.since : 0,
          doneAt: mood.doneAt,
        })
      },
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'prefix',
      path: '/fairy-zzz/assets',
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const rest = decodeURIComponent(url.pathname.slice('/fairy-zzz/assets'.length))
        const file = resolve(ASSETS, '.' + rest)
        if (!file.startsWith(ASSETS + sep)) {
          sendJson(res, 403, { error: 'forbidden' })
          return
        }
        return sendFile(req, res, file)
      },
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'prefix',
      path: '/fairy-zzz/audio',
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const rest = decodeURIComponent(url.pathname.slice('/fairy-zzz/audio'.length))
        if (!/^\/[a-f0-9]{40}\.wav$/.test(rest)) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        return sendFile(req, res, join(CACHE, rest.slice(1)))
      },
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/fairy-zzz/diag',
      handler: async (req, res) => {
        try {
          const raw = await readBody(req, 256 * 1024)
          const dir = process.env.FAIRY_DIAG_DIR || join(HERE, 'diag')
          const file = join(dir, 'client-diag.log')
          await mkdir(dir, { recursive: true })
          await appendFile(file, raw + '\n', 'utf8')
          sendJson(res, 200, { ok: true })
        } catch (cause) {
          sendJson(res, 500, { error: String(cause?.message ?? cause) })
        }
      },
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/fairy-zzz/health',
      handler: async (req, res) => {
        syncVoiceHome()
        const engine = await engineState()
        sendJson(res, 200, {
          ok: true,
          engine: engine.up,
          engineState: engine.state,
          engineError: engine.error,
          engineHome: TTS_DIR,
          engineManaged: Boolean(engineChild),
          voiceHome: inspectVoiceDir(TTS_DIR),
          voice: 'Fairy · Ⅲ',
          speed: TTS_SPEED,
          on: typeof ctx.on,
          seen: moodSeen,
          mood: mood.running ? 'running' : 'idle',
        })
      },
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/fairy-zzz/voice-home',
      handler: async (req, res) => {
        syncVoiceHome()
        if (req.method !== 'POST') {
          sendJson(res, 200, { ok: true, ...inspectVoiceDir(TTS_DIR) })
          return
        }
        let body = {}
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { ok: false, reason: 'bad request' })
          return
        }
        const raw = cleanHome(body?.home)
        if (body?.probe) {
          sendJson(res, 200, inspectVoiceDir(raw))
          return
        }
        if (!raw) {
          try {
            rmSync(VOICE_HINT, { force: true })
          } catch {}
          syncVoiceHome()
          sendJson(res, 200, { ok: true, ...inspectVoiceDir(TTS_DIR), cleared: true })
          return
        }
        const info = saveVoiceHome(raw)
        sendJson(res, info.ok ? 200 : 400, info)
      },
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/fairy-zzz/engine',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const action = url.searchParams.get('action') || 'status'
        syncVoiceHome()
        try {
          if (action === 'start') {
            await ensureEngine()
            sendJson(res, 200, { ok: true, engine: await engineState(), home: TTS_DIR })
            return
          }
          if (action === 'stop') {
            const stopped = await stopEngine()
            sendJson(res, 200, { ok: true, stopped, engine: await engineState(), home: TTS_DIR })
            return
          }
          sendJson(res, 200, { ok: true, engine: await engineState(), home: TTS_DIR, managed: Boolean(engineChild) })
        } catch (cause) {
          sendJson(res, 500, { ok: false, error: String(cause?.message ?? cause), home: TTS_DIR })
        }
      },
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/fairy-zzz/tts',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        let text = ''
        try {
          const body = JSON.parse(await readBody(req))
          text = cleanText(body?.text)
        } catch {
          sendJson(res, 400, { error: 'bad request' })
          return
        }
        if (!text) {
          sendJson(res, 400, { error: 'empty text' })
          return
        }
        const hash = createHash('sha1').update(text).digest('hex')
        const file = join(CACHE, `${hash}.wav`)
        const url = `/fairy-zzz/audio/${hash}.wav`
        try {
          if ((await sizeOf(file)) > 0) {
            sendJson(res, 200, { ok: true, url, cached: true })
            return
          }
          let job = pending.get(hash)
          if (!job) {
            await mkdir(CACHE, { recursive: true })
            job = synthesize(text, file).finally(() => pending.delete(hash))
            pending.set(hash, job)
          }
          const data = await job
          sendJson(res, 200, { ok: true, url, cached: false, seconds: data?.seconds ?? 0 })
        } catch (cause) {
          sendJson(res, 502, { error: String(cause?.message ?? cause) })
        }
      },
    }),
  )
}
