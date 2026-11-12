import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRequestBody, GeminiVertexAdapter, resolveOptions } from '../index.js'

const adapterOf = (options) =>
  new GeminiVertexAdapter({
    options: () => options,
    resolveAuth: async () => ({ kind: 'api-key', headers: {} }),
    resolveAttachments: () => undefined,
    imageAccess: undefined,
  })

test('the default route advertises the single configured model', () => {
  const options = resolveOptions({ project: 'p' })
  assert.deepEqual(options.models.map((entry) => entry.id), ['gemini-4-argon'])
  assert.equal(options.models[0].name, 'Gemini 4 Argon')
})

test('models are appended to the default model and de-duplicated', () => {
  const options = resolveOptions({
    project: 'p',
    model: 'gemini-4-argon',
    modelName: 'Argon',
    models: [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { id: 'gemini-4-argon' },
      { id: '', name: 'ignored' },
    ],
  })
  assert.deepEqual(options.models.map((entry) => entry.id), ['gemini-4-argon', 'gemini-3.8-flash'])
  assert.deepEqual(options.models.map((entry) => entry.name), ['Argon', 'Gemini 3.8 Flash'])
})

test('an unadvertised model is rejected with UNKNOWN_MODEL', async () => {
  const adapter = adapterOf(resolveOptions({ project: 'p', models: [{ id: 'gemini-3.8-flash' }] }))
  await assert.rejects(
    adapter.resolveModel('gemini-vertex', 'gemini-nope'),
    (error) => error.code === 'UNKNOWN_MODEL' && /gemini-4-argon/.test(error.message),
  )
  const known = await adapter.resolveModel('gemini-vertex', 'gemini-3.8-flash')
  assert.equal(known.id, 'gemini-3.8-flash')
})

test('project and auth modes are validated', () => {
  // A developer shell may export these; the assertions need them absent.
  const savedProject = process.env.GOOGLE_CLOUD_PROJECT
  const savedGcloud = process.env.GCLOUD_PROJECT
  delete process.env.GOOGLE_CLOUD_PROJECT
  delete process.env.GCLOUD_PROJECT
  try {
    assert.throws(() => resolveOptions({}), /project is required/)
    assert.throws(
      () => resolveOptions({ project: 'p', auth: 'service-account' }),
      /requires serviceAccountFile/,
    )
    assert.throws(() => resolveOptions({ project: 'p', thinkingLevel: 'max' }), /thinkingLevel must be one of/)
  } finally {
    if (savedProject !== undefined) process.env.GOOGLE_CLOUD_PROJECT = savedProject
    if (savedGcloud !== undefined) process.env.GCLOUD_PROJECT = savedGcloud
  }
})

test('a foreign tool call without a signature degrades to text', () => {
  const options = resolveOptions({ project: 'p', model: 'gemini-test' })
  const body = buildRequestBody(
    {
      model: 'gemini-test',
      messages: [
        { id: 's1', role: 'system', content: [{ type: 'text', text: 'be brief' }] },
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'tool-call', id: 'c1', name: 'get_weather', arguments: '{"city":"Paris"}' }],
        },
      ],
    },
    options,
  )
  assert.equal(body.systemInstruction.parts[0].text, 'be brief')
  const modelTurn = body.contents.at(-1)
  assert.equal(modelTurn.role, 'model')
  assert.match(modelTurn.parts[0].text, /^\[Tool call get_weather\(\{"city":"Paris"\}\)/)
  assert.equal(modelTurn.parts[0].functionCall, undefined)
})

test('a signed tool call replays as a native functionCall part', () => {
  const options = resolveOptions({ project: 'p', model: 'gemini-test' })
  const body = buildRequestBody(
    {
      model: 'gemini-test',
      messages: [
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'tool-call', id: 'c1', name: 'get_weather', arguments: '{"city":"Paris"}' }],
          source: {
            replayState: {
              kind: 'gemini-vertex',
              version: 1,
              parts: [
                { functionCall: { name: 'get_weather', args: { city: 'Paris' } }, thoughtSignature: 'SIG' },
              ],
              blocks: [{ signature: 'SIG' }],
            },
          },
        },
      ],
    },
    options,
  )
  assert.deepEqual(body.contents.at(-1).parts, [
    { functionCall: { name: 'get_weather', args: { city: 'Paris' } }, thoughtSignature: 'SIG' },
  ])
})
