export const series = [
  {slug:'device-lab', title:'键鼠与设备联调', description:'从发送第一条指令，到抓包、改键和键位布局。', icon:'usb', posts:['webhid-tool-guide','webhid-workbench','anxiu-demo','rk-key-align']},
  {slug:'desktop-tools', title:'桌面工具开发', description:'待办挂件、桌面面板，以及 Windows 上的维护记录。', icon:'todo', posts:['desktop-todo','glassboard-maintenance']},
  {slug:'web-experiments', title:'网页与应用实验', description:'一个雨夜探索游戏，一个还在开发的饮食记录应用。', icon:'keyboard', posts:['fog-town-nightwalk','shike-local-records']},
];

// 收藏与参考来源，不表示已与对方互换友链。
export const bookmarks = [
  {name:'Hyde Blog', url:'https://seasir.top/', description:'Firefly 主题实践、开源项目，以及友链文章聚合。', tags:['博客','Astro'], initial:'H', feed:'https://seasir.top/rss.xml', reason:'朋友圈标出文章来源与快照状态，适合研究博客之间怎样相互发现。', entry:{title:'友链朋友圈',url:'https://seasir.top/moments/'}},
  {name:'宇阳', url:'https://liuyuyang.net/', description:'ThriveX 作者的开发记录与生活随笔。', tags:['博客','项目'], initial:'宇', reason:'既写项目的演进，也写开发中的取舍；可以从他整理的博主清单继续逛。', entry:{title:'博主与网站推荐',url:'https://liuyuyang.net/article/2295'}},
  {name:'像风 Blog', url:'https://astro.cchaoka.cn/', description:'Firefly 主题功能记录，包含系列、归档与书签导航。', tags:['博客','Astro'], initial:'风', reason:'适合对照 Astro 博客的内容入口，看看主题功能怎样组织在一起。', entry:{title:'进入博客',url:'https://astro.cchaoka.cn/'}},
  {name:"THW’s Blog", url:'https://blog.tianhw.top/', description:'编程开发、技术教程与项目实践。', tags:['博客','技术'], initial:'T', feed:'https://blog.tianhw.top/rss.xml', reason:'可以从技术教程和项目记录入手，找实际开发中的问题与处理方式。', entry:{title:'进入博客',url:'https://blog.tianhw.top/'}},
  {name:'Anthony Fu', url:'https://antfu.me/', description:'开源项目、技术文章与个人记录。', tags:['技术','开源'], initial:'A', reason:'项目按开发方向分组，每个项目用一句话讲用途，并给出真实入口。', entry:{title:'项目目录',url:'https://antfu.me/projects'}},
  {name:'Sukka’s Blog', url:'https://blog.skk.moe/', description:'前端、网络与网站性能相关的技术文章。', tags:['技术','前端'], initial:'S', reason:'遇到前端、网络或性能问题时，可以按具体主题查找技术记录。', entry:{title:'进入博客',url:'https://blog.skk.moe/'}},
  {name:'Firefly', url:'https://firefly.cuteleaf.cn/', description:'本博客使用的 Astro 主题，保留原项目署名。', tags:['Astro','开源'], initial:'F', reason:'需要了解原主题的功能与用法时，从主题站点查看，和本站的个人内容区分开。', entry:{title:'主题站点',url:'https://firefly.cuteleaf.cn/'}},
  {name:'张洪 Heo', url:'https://blog.zhheo.com/', description:'产品、设计、开发与软件使用经验。', tags:['博客','设计','项目'], initial:'H', reason:'精选、项目和经验栏目分开，适合研究个人作品如何与文章互相引导。', entry:{title:'博客精选',url:'https://blog.zhheo.com/'}},
  {name:'Josh W. Comeau', url:'https://www.joshwcomeau.com/', description:'CSS、React 与交互式前端教程。', tags:['技术','前端','交互'], initial:'J', reason:'用可以拖动、切换的例子解释原理，阅读时就能验证自己的理解。', entry:{title:'交互式 Flexbox 教程',url:'https://www.joshwcomeau.com/css/interactive-guide-to-flexbox/'}},
  {name:'阮一峰的网络日志', url:'https://www.ruanyifeng.com/blog/', description:'技术文章、教程与科技爱好者周刊。', tags:['技术','周刊'], initial:'阮', reason:'周刊和历史文章入口清楚，适合发现工具，也适合学习持续整理资料。', entry:{title:'网络日志',url:'https://www.ruanyifeng.com/blog/index.html'}},
  {name:'潮流周刊', url:'https://weekly.tw93.fun/', description:'Tw93 整理的工具、技术与生活记录。', tags:['技术','周刊','工具'], initial:'T', reason:'每期用照片与具体说明开头，再进入分享，个人表达比模板口号更自然。', entry:{title:'按期浏览周刊',url:'https://weekly.tw93.fun/'}},
  {name:'overreacted', url:'https://overreacted.io/', description:'Dan Abramov 的编程思考与技术文章。', tags:['技术','前端'], initial:'O', reason:'标题、日期和短摘要直接进入内容，适合学习如何把一个技术问题讲透。', entry:{title:'文章列表',url:'https://overreacted.io/'}},
];

export const updates = [
  {id:'discovery', date:'2026-11-23', category:'博客', title:'把工具、文章和作品串起来', text:'按设备联调、桌面工具、网页实验整理了专题；新增站点收藏，可以按标签查找。', links:[{title:'查看专题',href:'/series/'},{title:'站点收藏',href:'/friends/'}]},
  {id:'sky-theme', date:'2026-11-23', category:'博客', title:'博客换成天蓝色', text:'撤掉生成插画，封面改用项目实际界面。首页、阅读页和工具页统一配色，手机上收起较长的侧栏。', links:[{title:'查看文章',href:'/archive/'}]},
  {id:'tool-notes', date:'2026-11-23', category:'工具', title:'给开发工具补上使用入口', text:'整理了 WebHID 调试、抓包脚本和 RK 键位对齐工具的说明、源码与下载；雾镇夜行也有了试玩和离线包。', links:[{title:'开发工具',href:'/tools/'},{title:'雾镇夜行',href:'/projects/fog-town/'}]},
];

export const discoveryRecords = [
  {title:'专题阅读',description:'按设备联调、桌面工具和网页实验阅读已有文章。',url:'/series/',type:'页面',text:'系列 专题 导读 WebHID Windows'},
  {title:'开发动态',description:'博客和工具的简短更新记录。',url:'/updates/',type:'页面',text:'动态 更新 时间线'},
  {title:'友链与站点收藏',description:'收藏的博客和开源站点，可按关键词和标签查找。',url:'/friends/',type:'页面',text:bookmarks.map(b=>b.name+' '+b.tags.join(' ')).join(' ')},
];
