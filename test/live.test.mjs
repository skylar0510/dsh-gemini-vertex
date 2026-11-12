import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GeminiVertexAdapter, resolveOptions, serviceAccountAuth } from '../index.js'

const serviceAccountFile = process.env.GEMINI_VERTEX_SA
const project = process.env.GOOGLE_CLOUD_PROJECT
const live = serviceAccountFile !== undefined && serviceAccountFile.length > 0 && project !== undefined && project.length > 0

test('live: a real Vertex call returns text', { skip: !live && 'set GEMINI_VERTEX_SA and GOOGLE_CLOUD_PROJECT to run' }, async () => {
  const options = resolveOptions({
    project,
    auth: 'service-account',
    serviceAccountFile,
    model: process.env.GEMINI_VERTEX_MODEL ?? 'gemini-4-argon',
    modelName: 'live',
    thinkingLevel: 'off',
    maxTokens: 1024,
  })
  const adapter = new GeminiVertexAdapter({
    options: () => options,
    resolveAuth: () => serviceAccountAuth(options),
    resolveAttachments: () => undefined,
    imageAccess: undefined,
  })
  let text = ''
  for await (const chunk of adapter.stream({
    model: options.model,
    messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'Reply with the single word: ok' }], timestamp: Date.now() }],
    reasoningEffort: 'off',
    signal: AbortSignal.timeout(180000),
  })) {
    if (chunk.type === 'block-end' && chunk.block?.type === 'text') text += chunk.block.text
  }
  assert.ok(text.trim().length > 0, 'model returned text')
})
