# 博客本地写作

当前公开页面使用 `JournalLayout`。Markdown/MDX 沿用现有 Astro、Expressive Code、提示块和数学公式管线；下列组件无需新增依赖。本站没有在线写入后台，保存文件、构建和发布是不同操作。

## 创建草稿

在项目根目录运行：

```powershell
pnpm new-post notes/my-guide.md --title "我的教程" --description "解决什么问题，以及适用条件" --category "开发记录" --tags "Astro,教程" --date 2026-11-25
```

文件创建在 `src/content/posts`，默认 `draft: true`。可以使用 `.mdx`；不能使用绝对路径、`..`、Windows 保留文件名或符号链接目录。已有同名文件不会被覆盖，`.md` 与 `.mdx` 同名也会拒绝。参数说明见 `pnpm new-post --help`。编辑后预览，确认内容再改为 `draft: false`；这个命令不提交 Git，也不发布。

教程应写清实际环境和版本、准备项、成本前提、预期结果、每步验证方法及失败处理。不要把只适用于本机的路径、密码或私人照片写入公开文章。

## 真实封面

frontmatter 可以使用文章目录内的图片或 `public` 下的绝对站内路径：

```yaml
image: ./images/cover.webp
imageAlt: 实际界面的说明
imagePosition: top
```

`imagePosition` 可选 `center`、`top`、`bottom`、`left`、`right`。构建时读取图片真实尺寸。支持 JPG、PNG、WebP、AVIF、GIF；这里不请求外部图片。无图或无效资源保留无封面卡片，既有真实项目截图仍可使用；加密和模板示例封面不参与公开发现。`image` 是文章封面，外观面板里的图片是访客本地壁纸，两者用途不同。

## 教程读前说明

文章摘要会显示在横幅中。需要说明读者和前提时，可额外添加：

```yaml
readingGuide:
  audience: 正在按协议调试 HID 设备的开发者。
  preparation:
    - 支持 WebHID 的浏览器和可授权设备。
    - 目标设备的协议资料。
  outcome: 知道怎样核对报文与实际效果。
```

三项均为非空内容，准备条件至少一项。没有配置时保留简短文章导读；加密文章在解锁前不展示这份说明。只能填写实际前提和结果，不把浏览器支持或演示模式写成设备验证通过。

## 步骤与代码分组

外层容器必须比内层使用更多冒号。步骤必须直接放在 `steps` 中，且具有非空标题及内容；代码分组的每个 `tab` 必须恰好包含一个围栏代码块：

````markdown
::::::steps
:::::step[检查环境]
先确认本机已有运行环境。

```sh
node --version
```

验证：输出版本号；没有输出时先检查安装与 PATH。
:::::
:::::step[选择命令]
::::codegroup[启动方式]
:::tab[pnpm]
```sh
pnpm dev
```
:::
:::tab[npm]
```sh
npm run dev
```
:::
::::
:::::
::::::
````

代码分组提供“复制当前代码”。方向键、Home、End 切换选项，焦点与可见内容同步；复制失败会提供可选中的文本。隐藏面板中的标题不会进入当前目录，切换后目录重新生成。普通代码块继续由 Expressive Code 处理。

## 提示块内的内容选项

```markdown
:::::note[按系统阅读]
::::tabs[系统说明]
:::tab[Windows]
使用 PowerShell。
:::
:::tab[其他系统]
使用终端。
:::
::::
:::::
```

无 JavaScript 时各面板内容按顺序显示；启用后增强为标签页。错误嵌套、缺少标题或代码块会在构建时给出内容位置，不能用空面板凑出功能。完整非公开测试样例在 `tests/authoring/primitives.md`，不会生成一篇公开演示文章。

站内链接继续使用普通 Markdown 的稳定路径，如 `[设备专题](/series/device-lab/)`。本轮没有引入 WikiLink 或在线图片上传后台。

## 本地验收

```powershell
pnpm check
pnpm build
pnpm check:journal --built
```

行为检查覆盖教程解析、MDX、键盘切换、当前代码复制与失败回退、草稿路径和覆盖保护；不能替代真实浏览器的触摸、屏幕阅读器和窄屏视觉验收。构建完成后仍需单独执行原有发布流程，并验证实际网址。
