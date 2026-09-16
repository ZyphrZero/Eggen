# 豆包后台生图任务

火山方舟的 `POST /api/v3/images/generations` 同步返回图片或流式结果，没有本文档所述接口对应的任务查询 API。蛋壳在 Cloudflare Workers 部署中增加应用自己的任务 ID，由 Durable Object alarm 执行请求，前端刷新后继续查询这个任务，不会再次调用生成接口。

## 部署与使用

```bash
npm run deploy:cf
```

Wrangler 会部署 `worker/arkTasks.ts`、`ARK_TASKS` 绑定及 SQLite Durable Object migration。Cloudflare 账号需要启用 Workers 和 SQLite Durable Objects。API 路由必须经过 Worker，不能仅上传 `dist/`。

导入仓库的 `doubao-ark-config.json`，每位用户填写自己的豆包 API Key。当自定义供应商使用 `https://ark.cn-beijing.volces.com/api/v3/` 下的 JSON `images/generations` 接口时，自动使用后台任务。无需配置共享 Key 或 Worker Secret。其他服务商沿用现有请求方式。

新任务开始前会先将应用任务 ID 保存到浏览器 IndexedDB。后台受理后，刷新或关闭页面不会取消生成。再次打开同一站点、使用同一 API 配置和 Key，可以继续查询和保存结果。升级前已经中断的同步请求无法补回。

## 余额查询

豆包预置配置通过 `balance.params.proxyPath: /api/ark/balance` 使用同源余额代理，避免浏览器被火山 OpenAPI 的跨域响应限制拦截。查询所需的 Access Key ID / Secret Access Key 与生图 API Key 不同，仍在余额设置中分别填写。

签名在浏览器内完成，Secret Access Key 不发送到 Worker。签名参数通过 POST 请求体提交，Worker 固定转发到 `open.volcengineapi.com` 的 `billing:QueryBalanceAcct`，不接受其他接口或任意目标地址。余额响应不缓存、不持久化，也不会创建 Durable Object。火山返回的权限、凭证和签名错误会原样显示。

## 数据与隔离

- API Key 通过 HTTPS 请求头传入本站 Worker，再转发到火山方舟；部署管理员因此属于凭据处理的信任边界。
- Key 和输入内容只在任务执行期间的内存中使用，不写入 Durable Object 存储或应用日志。
- 任务按 API Key 的 SHA-256 摘要和随机 UUID 隔离。查询和下载都需使用原来的 Key；不同 Key 无法读取对方任务。
- 后台只保存任务状态、请求摘要和火山返回的图片链接，不保存原图。记录在提交后 24 小时清理，图片链接本身也有有效期。
- 图片通过经过鉴权的 Worker 路由流式转发，解决火山图片链接的 CORS 限制。前端下载后继续存入本地 IndexedDB。
- 提交和查询响应均不缓存。上游错误会保留；连接中断或刷新只会重新查询，不自动重发付费生成请求。

## 执行边界

- 后台请求遵循 API 配置中的超时，最高 840 秒，为 alarm 的 15 分钟执行上限留出余量。
- 不保存 Key 意味着无法在 Cloudflare 实例重启后重新执行任务。部署更新或平台重启若打断任务，会显示明确错误；为避免重复计费，不自动重发。页面刷新本身不会重启后台任务。
- 若刷新发生在请求尚未上传或受理时，会显示任务不存在。此时不能据此确认上游已开始生成。
- 请求体最多 32 MiB，超出时会明确拒绝；参考图较多或很大时，应先压缩。仅保存最多 128 KiB 的上游 JSON 结果，因此后台强制使用 `response_format: url` 和非流式输出。
- 修改 Key、清除浏览器数据、切换站点域名后，无法凭原来的本地任务记录自动恢复。
- 删除前端任务记录不会撤回已提交的火山请求，后台记录会按到期时间清理。

## Cloudflare 开销

生成计算仍发生在火山引擎，Worker 不处理或编码原图。每个生成任务使用独立 Durable Object，每 5 秒查询一次；后台只在状态变化时写入少量数据，图片下载按需流式转发，不做整图持久化。

主要消耗是任务等待期间 Durable Object 的活跃时长、Worker/对象请求数、少量 SQLite 写入与存储，以及图片转发流量。网络等待不计 CPU 时间，但计入对象活跃时长。多人高并发使用应监控额度，公开站点可在 Cloudflare 配置访问控制和速率限制。

具体配额以 [Durable Objects 计费](https://developers.cloudflare.com/durable-objects/platform/pricing/) 和 [执行限制](https://developers.cloudflare.com/durable-objects/platform/limits/) 为准，不能按纯静态站点的成本估算。

## 本地验证

先构建，然后分别运行后台和前端：

```bash
npm run build
npm run dev:worker
```

```bash
npm run dev
```

Vite 将 `/api/ark/` 转发到本机 `8787` 端口。需要验证刷新恢复且不调用真实豆包时，用 `npm run mock:ark` 代替 `npm run dev:worker`。该命令在真实 workerd 中执行任务逻辑，只将上游替换为延迟 15 秒返回项目图标的测试接口；控制台打印提交次数，不打印 Key。

```bash
npm test
```

测试覆盖提交前持久化任务 ID、刷新后恢复、下载断线重试、丢失提交回执、重复提交保护、API Key 隔离、错误透传及真实 workerd 中的 alarm 执行。
