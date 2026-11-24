export const toolCategories = [
	{ id: "all", label: "全部" },
	{ id: "online", label: "在线工具" },
	{ id: "script", label: "浏览器脚本" },
	{ id: "project", label: "项目内工具" },
	{ id: "desktop", label: "桌面应用" },
] as const;
export const tools = [
	{
		id: "hid",
		title: "WebHID 调试工具",
		category: "online",
		icon: "usb",
		description: "选择设备、发送指令并观察回包。",
		href: "/tools/hid/",
		action: "打开工具",
		note: "WebHID · 浏览器授权",
		guide: "/posts/webhid-tool-guide/",
		keywords: "HID USB 键盘 鼠标 协议 报文 调试",
	},
	{
		id: "anxiu",
		title: "Anxiu 键鼠配置",
		category: "online",
		icon: "keyboard",
		description: "改键、宏与性能配置，无设备也能体验。",
		href: "https://anxiu.vercel.app/",
		action: "体验演示",
		note: "演示模式 · 键鼠配置",
		guide: "/posts/anxiu-demo/",
		keywords: "Anxiu DPI 宏 配置 演示",
	},
	{
		id: "workbench",
		title: "WebHID 抓包脚本",
		category: "script",
		icon: "capture",
		description: "记录网页报文、保存快照并导出 JSON。",
		href: "/tools/webhid-workbench/",
		action: "安装与使用",
		note: "油猴脚本 · WebHID Workbench",
		guide: "/posts/webhid-workbench/",
		keywords:
			"油猴 Tampermonkey Userscript Workbench 抓包 快照 JSON OUT Feature 安装 复刻 回放",
	},
	{
		id: "align",
		title: "RK 键位对齐工具",
		category: "project",
		icon: "align",
		description: "对照键盘背景图调整位置、尺寸与整行布局。",
		href: "/tools/key-align/",
		action: "查看工具与源码",
		note: "Vue + Vite · 在原工程内使用",
		guide: "/posts/rk-key-align/",
		keywords:
			"键盘 背景图 按键 对齐 布局 offset offsetY keyStore key.vue Vue Pinia Vite 多选 源码 下载",
	},
	{
		id: "todo",
		title: "桌面待办",
		category: "desktop",
		icon: "todo",
		description: "快捷添加、步骤清单与完成日历，让待办留在桌面。",
		href: "/projects/desktop-todo/",
		action: "查看项目",
		note: "Windows 桌面应用",
		guide: "/posts/desktop-todo/",
		keywords:
			"TODO Windows Electron React TypeScript 待办 任务 效率 快捷键 桌面 日历 标签 等待 便携版 下载",
	},
];

export const projectNotes = [
	{
		title: "雾镇夜行",
		description:
			"Three.js 实现的雨夜古镇探索与逃生小游戏，可在线试玩或离线游玩。",
		url: "/projects/fog-town/",
		type: "项目",
		text: "雾镇 夜行 游戏 Three.js WebGL 3D 雨夜 古镇 躲藏 解谜 逃生 Fable 5.2 离线 HTML",
	},
	{
		title: "食刻",
		description: "开发中的饮食记录项目，支持照片与文字记餐、本地记录和备份。",
		url: "/projects/shike/",
		type: "项目",
		text: "食刻 饮食 记餐 照片 文字 Vue IndexedDB Capacitor Android 备份",
	},
	{
		title: "GlassBoard 维护实践",
		description: "Windows 桌面面板、Dock 与组件的维护和适配。",
		url: "/projects/glassboard/",
		type: "项目",
		text: "GlassBoard Windows Dock 桌面 分组 排序 组件 维护 .NET",
	},
];
