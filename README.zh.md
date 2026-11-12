# dsh-gemini-vertex

[English](README.md) | 中文

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中接入 **Google Vertex AI** 上的 Gemini。

这是一个**只含 host 侧**的 provider 插件：只注册一条 `gemini-vertex` 路由，不带任何浏览器端代码。这是有意为之——它意味着启用它不会影响 Web 应用的启动流程，而这正是「带 client 的 provider 插件」在 DSH `0.2.2-rc.1` 上的翻车点。

- 原生 `streamGenerateContent`（`alt=sse`）：流式文本、思考摘要、用量、结束原因
- 原生 function calling，回放 `thoughtSignature`，多轮工具调用不会 400
- 其他模型产生的工具历史会自动降级为文本，切换模型不打断会话
- 支持用户消息与工具结果中的图片输入
- 认证支持服务账号 JSON（OAuth2 JWT 换取 token、缓存、401 自动刷新）**或** Express API Key
- 一条路由可挂多个模型，在模型选择器里直接切换
- 代理支持：`auto`（先读环境变量，再读 macOS 系统代理）、`direct`，或显式代理地址

## 安装

```sh
dsh plugin --profile desktop add dsh-gemini-vertex
```

安装后需要重启 DeepSeek Harness：profile 的 bundle 列表只在启动时读取。之后 provider 会显示为 **Google Vertex AI**，模型出现在模型选择器中。

## 配置

配置写在 profile 的 `cordis.patch.yml` 里（Settings 界面只内置了 DSH 自家的 provider，第三方 provider 需要通过配置文件改）。

### 服务账号（推荐）

```yaml
- id: llm-gemini-vertex
  name: "dsh-gemini-vertex"
  config:
    project: "your-project-id"          # 项目 ID 或纯数字的项目编号
    auth: service-account
    serviceAccountFile: "~/.config/gcloud/vertex-sa.json"
    location: global
    model: gemini-4-argon
    modelName: Gemini 4 Argon
    thinkingLevel: off
```

服务账号需要 `Vertex AI User` 角色，项目需要启用 Vertex AI API。`project` 未填时会依次回退到 JSON 里的 `project_id`、环境变量 `GOOGLE_CLOUD_PROJECT`。

### Express API Key

```yaml
- id: llm-gemini-vertex
  name: "dsh-gemini-vertex"
  config:
    project: "your-project-id"
    auth: api-key
    apiKeyEnv: GOOGLE_VERTEX_API_KEY     # 凭据名，或启动环境变量名
```

Key 通过 `x-goog-api-key` 头发送。请存到 DSH 的凭据服务里，不要提交到任何仓库。

### 多模型

`model` 是路由的默认模型，并且始终会被展示；`models` 里的每一项都会额外增加一个可选模型。

```yaml
    model: gemini-4-argon
    modelName: Gemini 4 Argon
    models:
      - id: gemini-3.8-flash
        name: Gemini 3.8 Flash
      - id: gemini-3.1-pro-preview
        name: Gemini 3.1 Pro (preview)
        contextWindow: 1048576
        maxTokens: 65536
```

### 配置项

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `auth` | `auto` | `auto` 表示配了服务账号就用服务账号，否则用 API Key |
| `serviceAccountFile` | 空 | 服务账号 JSON 路径，支持 `~`；未设置时回退到 `GOOGLE_APPLICATION_CREDENTIALS` |
| `serviceAccountJson` | 空 | 内联 JSON（明文保存，建议用文件） |
| `project` | 空 | 项目 ID 或项目编号 |
| `location` | `global` | Vertex 区域 |
| `model` | `gemini-4-argon` | 默认模型 id |
| `models` | `[]` | 同一路由下的其他模型 |
| `baseURL` | `https://aiplatform.googleapis.com` | HTTP 根地址，可改为私有网关 |
| `thinkingLevel` | `off` | `off` 固定到模型最低档并且不返回思考内容 |
| `streamIdleTimeoutMs` | `300000` | 超过这个时间没有数据就判定失败 |
| `proxy` | `auto` | `auto` / `direct` / 显式代理地址 |

## 行为说明

- 请求发往
  `{baseURL}/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent?alt=sse`。
- 服务账号模式下，插件用私钥签一个 RS256 JWT，到 JSON 里的 `token_uri` 换成 access token，缓存到过期前 5 分钟；收到 401 时刷新一次并重试。
- 每次响应都会把原生 `parts`（文本、思考、`functionCall`、`thoughtSignature`）存进 DSH 的 `replayState`，下一轮原样回放。
- 有些模型不接受 `thinkingBudget: 0`，这种情况下思考无法真正关闭；`off` 的含义是「模型支持的最低档，且不展示思考摘要」。

## 常见问题

| 现象 | 原因 |
| --- | --- |
| `404 ... Publisher model ... was not found` | 模型 id 或区域不对，或者项目没有该模型的访问权限 |
| `401 API keys are not supported by this API` | 把 API Key 发到了只接受 OAuth 的端点——改用 `auth: service-account` |
| `400 Function call is missing a thought_signature` | 有一条 Gemini 生成的工具调用丢了签名（历史被裁剪或 `replayState` 被破坏） |
| `429 RESOURCE_EXHAUSTED` | 配额或动态共享配额不足，稍后重试或为该模型申请配额 |
| `400 Thinking budget is not supported for this model` | 该模型只接受 thinking level；本适配器本来就只用 level |

## 测试

```sh
npm install
npm test
```

离线测试覆盖 JWT 换取、SSE 流式、API Key 请求头、模型解析、请求体构造，以及签名回放与降级。测试会在本机起一个 mock 的 token / Vertex 端点，不需要凭据也不需要联网。

真实调用测试默认跳过，只有同时设置这两个变量才会执行：

```sh
GEMINI_VERTEX_SA=~/.config/gcloud/vertex-sa.json \
GOOGLE_CLOUD_PROJECT=your-project \
npm test
```

## 来源与许可

适配器代码派生自 [`dsh-gemini-argon`](https://github.com/zh-plus/dsh-gemini-argon)（作者 maysee，MIT 许可）。本包保留了适配器，去掉了浏览器端插件，并重写了 manifest 与模型列表。详见 `LICENSE`。
