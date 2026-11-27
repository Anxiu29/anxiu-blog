# Vercel 部署准备

当前为 Astro 静态博客，输出目录 `dist`。不需要服务器适配器，也不要设置 `CF_WORKERS`。Vercel 仅部署博客代码和公开资源，不部署本机相册数据。

## 导入设置

- 仓库：`Anxiu29/anxiu-blog`，根目录为仓库根目录。
- Framework Preset：Astro。
- Node.js：22.x（仓库 package.json 已指定；Astro 需要至少 22.12）。
- Package Manager：pnpm 9.14.4（仓库 packageManager 已指定）。
- Install Command：`pnpm install --frozen-lockfile`。
- Build Command：`pnpm build`。
- Output Directory：`dist`。
- HID 工具在构建时安装自己的锁定依赖并生成 `public/tools/hid`，不要手动上传旧产物。

## 域名与环境变量

有正式域名时设置 `SITE_URL=https://你的域名`，必须是 HTTPS 根地址。未设置时使用 Vercel 系统变量 `VERCEL_PROJECT_PRODUCTION_URL`，再回退到已有的 `https://anxiu-blog.vercel.app`。请开启 Automatically expose System Environment Variables。canonical、RSS、sitemap、分享图共用这一个地址；绑定或更换域名后重新构建。

不要把 `CHRONOFRAME_LOCAL_URL`、相册登录信息、数据库密钥或本机路径填入 Vercel。Vercel 构建主动关闭本机相册跳转，`/photos/` 显示“相册尚未公开”。相册本体仍独立运行，博客部署不会让私人照片上线。

## 上传范围

Git 发布只上传确认过的代码及公开资源；`.gitignore` 排除 `.local`、依赖和环境变量。CLI 源码上传还使用 `.vercelignore`，排除本机相册、环境文件、依赖、文档、缓存和日志。`public` 中的文件会公开，勿将私人照片或备份放入其中。

本地上传壁纸/MP4、待办、收藏和宠物位置保存在当前浏览器，并不随博客上传、跨设备同步或迁移到新域名。需要的待办先导出备份。

## 发布前与发布后

发布前运行：`pnpm check`、`pnpm build`、`pnpm check:journal --built`。检查 Git diff，确认新文件被纳入后再提交推送。Vercel Git 集成只读取已推送到目标分支的代码；本机未提交的修改不会自动上传。

部署完成后验收首页、文章深链接刷新、搜索索引、音乐、404、favicon、RSS、sitemap；用实际手机检查菜单、滚动和音频主动播放。WebHID 工具需要支持 WebHID 的桌面浏览器，手机不能连接 HID 设备；浏览演示与教程仍可用。音乐来自第三方接口，能否播放取决于接口和歌曲可用性。

官方参考：
- [Astro on Vercel](https://vercel.com/docs/frameworks/frontend/astro)
- [Vercel 系统环境变量](https://vercel.com/docs/environment-variables/system-environment-variables)
- [.vercelignore](https://vercel.com/docs/deployments/vercel-ignore)

构建工具 `tsx` 4.23.15 与 `only-allow` 1.2.2 已加入精确版本开发依赖及 pnpm 锁文件，构建和 preinstall 不再临时调用 npx 下载它们。
