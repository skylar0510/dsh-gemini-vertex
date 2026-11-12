import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import {
  GeminiVertexAdapter,
  probeModel,
  resolveOptions,
  serviceAccountAuth,
} from '../index.js'

/** Read a request body as UTF-8 text. */
async function bodyOf(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/** Start a throwaway Vertex + OAuth mock; returns its port and a close hook. */
async function startMock(state) {
  const server = http.createServer(async (request, response) => {
    const body = await bodyOf(request)
    state.requests.push({ url: request.url, authorization: request.headers.authorization, body })

    if (request.url === '/token') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ access_token: 'test-token', expires_in: 3600, token_type: 'Bearer' }))
      return
    }
    if (request.url.includes(':countTokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ totalTokens: 42 }))
      return
    }
    if (request.url.includes(':streamGenerateContent') && request.url.includes('overflow-model')) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          error: {
            code: 400,
            message:
              'The input token count (1048716) exceeds the maximum number of tokens allowed (1048576).',
            status: 'INVALID_ARGUMENT',
          },
        }),
      )
      return
    }
    if (request.url.includes(':streamGenerateContent')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Hel' }] } }] })}\n\n`)
      response.write(
        `data: ${JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'lo' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
        })}\n\n`,
      )
      response.end()
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { code: 404, message: 'not found' } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** A syntactically valid service-account document whose key really signs. */
function serviceAccount(port) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return {
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'test@test-project.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: `http://127.0.0.1:${port}/token`,
  }
}

function makeAdapter(options) {
  return new GeminiVertexAdapter({
    options: () => options,
    resolveAuth: () => serviceAccountAuth(options),
    resolveAttachments: () => undefined,
    imageAccess: undefined,
  })
}

const userMessage = {
  id: 'm1',
  role: 'user',
  content: [{ type: 'text', text: 'ping' }],
  timestamp: Date.now(),
}

test('service account exchanges a JWT and streams text', async () => {
  const state = { requests: [] }
  const mock = await startMock(state)
  try {
    const options = resolveOptions({
      project: 'test-project',
      auth: 'service-account',
      serviceAccountJson: JSON.stringify(serviceAccount(mock.port)),
      baseURL: `http://127.0.0.1:${mock.port}`,
      model: 'gemini-test',
      proxy: 'direct',
    })
    const adapter = makeAdapter(options)

    const chunks = []
    for await (const chunk of adapter.stream({
      model: 'gemini-test',
      messages: [userMessage],
      tools: [{ name: 'get_weather', description: 'Weather', parameters: { type: 'object' } }],
      reasoningEffort: 'off',
      signal: AbortSignal.timeout(15000),
    })) {
      chunks.push(chunk)
    }

    const text = chunks
      .filter((chunk) => chunk.type === 'block-end' && chunk.block?.type === 'text')
      .map((chunk) => chunk.block.text)
      .join('')
    assert.equal(text, 'Hello')

    const finish = chunks.find((chunk) => chunk.type === 'finish')
    assert.ok(finish, 'finish chunk')
    assert.equal(finish.replayState.kind, 'gemini-vertex')

    const tokenRequest = state.requests.find((entry) => entry.url === '/token')
    assert.match(tokenRequest.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/)

    const streamRequest = state.requests.find((entry) => entry.url.includes(':streamGenerateContent'))
    assert.equal(streamRequest.authorization, 'Bearer test-token')
    assert.match(streamRequest.url, /\/v1\/projects\/test-project\/locations\/global\/publishers\/google\/models\/gemini-test/)

    const body = JSON.parse(streamRequest.body)
    assert.equal(body.contents[0].parts[0].text, 'ping')
    assert.equal(body.tools[0].functionDeclarations[0].name, 'get_weather')
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'LOW')
  } finally {
    await mock.close()
  }
})

test('probeModel hits countTokens with the same credentials', async () => {
  const state = { requests: [] }
  const mock = await startMock(state)
  try {
    const options = resolveOptions({
      project: 'test-project',
      auth: 'service-account',
      serviceAccountJson: JSON.stringify(serviceAccount(mock.port)),
      baseURL: `http://127.0.0.1:${mock.port}`,
      model: 'gemini-test',
      proxy: 'direct',
    })
    const total = await probeModel(options, await serviceAccountAuth(options))
    assert.equal(total, 42)
  } finally {
    await mock.close()
  }
})

test('an API key is sent as x-goog-api-key and no OAuth call happens', async () => {
  const state = { requests: [] }
  const mock = await startMock(state)
  try {
    const options = resolveOptions({
      project: 'test-project',
      auth: 'api-key',
      apiKeyEnv: 'GOOGLE_VERTEX_API_KEY',
      baseURL: `http://127.0.0.1:${mock.port}`,
      model: 'gemini-test',
      proxy: 'direct',
    })
    const adapter = new GeminiVertexAdapter({
      options: () => options,
      resolveAuth: async () => ({ kind: 'api-key', headers: { 'x-goog-api-key': 'test-key' } }),
      resolveAttachments: () => undefined,
      imageAccess: undefined,
    })
    for await (const _chunk of adapter.stream({
      model: 'gemini-test',
      messages: [userMessage],
      signal: AbortSignal.timeout(15000),
    })) {
      // drain
    }
    const streamRequest = state.requests.find((entry) => entry.url.includes(':streamGenerateContent'))
    assert.equal(streamRequest.authorization, undefined)
    assert.equal(state.requests.some((entry) => entry.url === '/token'), false)
  } finally {
    await mock.close()
  }
})

test('a Vertex token-budget 400 maps to CONTEXT_WINDOW_EXCEEDED', async () => {
  const state = { requests: [] }
  const mock = await startMock(state)
  try {
    const options = resolveOptions({
      project: 'test-project',
      auth: 'service-account',
      serviceAccountJson: JSON.stringify(serviceAccount(mock.port)),
      baseURL: `http://127.0.0.1:${mock.port}`,
      model: 'overflow-model',
      proxy: 'direct',
    })
    const adapter = makeAdapter(options)
    await assert.rejects(
      async () => {
        for await (const _chunk of adapter.stream({
          model: 'overflow-model',
          messages: [userMessage],
          signal: AbortSignal.timeout(15000),
        })) {
          // drain
        }
      },
      (error) => error.code === 'CONTEXT_WINDOW_EXCEEDED' && /exceeds the maximum number of tokens/.test(error.message),
    )
  } finally {
    await mock.close()
  }
})
