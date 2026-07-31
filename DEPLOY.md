# 安秀博客部署指南（Cloudflare Pages）

本地开发就绪后，按下列步骤部署。域名自行准备并绑定。

## 前置条件

- GitHub 仓库（将本目录 `website/` 推送到你的仓库）
- Cloudflare 账号
- 自定义域名（可选，之后绑定）

## Cloudflare Pages 配置

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → 连接 GitHub 仓库。
2. 构建配置：

| 项 | 值 |
|---|---|
| Framework preset | Astro（或 None） |
| Build command | `pnpm run build` |
| Build output directory | `dist` |
| Root directory | `/`（若仓库根就是 website） |
| Node.js version | `22` 或更高 |

3. 环境变量（如需要）：

| 名 | 值 |
|---|---|
| `NODE_VERSION` | `22` |
| `PNPM_VERSION` | `9.14.4` |

4. 首次部署成功后，在 **Custom domains** 绑定你的域名（自动 HTTPS）。
5. 把 [`src/config/siteConfig.ts`](src/config/siteConfig.ts) 里的 `site_url` 从 `https://example.com` 改成正式域名，再推送触发重新部署。

## 本地生产构建自检

```bash
pnpm run build
pnpm preview
```

确认：

- 首页标题为「安秀」
- 导航「HID工具」可进入工具页
- `dist/tools/hid/index.html` 存在

## 其他平台（备选）

Firefly 也带有 `vercel.json`。若改用 Vercel / Netlify：

- Build command: `pnpm run build`
- Output: `dist`
- Install: `pnpm install`

## 注意

- WebHID 仅支持 Chrome / Edge，且需要 **HTTPS**（localhost 除外）。
- 工具页是独立 SPA，不套博客顶栏；页内有「返回安秀博客」链接。
