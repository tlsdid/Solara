# Solara（光域）

> 一个基于 Cloudflare Pages Functions 与免费音乐聚合接口的现代化网页音乐播放器。支持搜索、播放、歌词、下载、收藏、歌单管理、跨设备同步、主题切换，以及外部歌单转换为 Solara 可导入 JSON。

![Preview](./Preview.gif)

## 项目概览

Solara 是一个纯网页音乐播放器，适合部署在 Cloudflare Pages 上使用。项目以轻量前端为主体，结合 Cloudflare Pages Functions 处理音频代理、数据存储和歌单转换。桌面端提供完整播放器布局，移动端提供适配手机浏览器和添加到主屏后的竖屏体验。

本仓库是在原 Solara 基础上的自定义改造版本，重点增强了主题视觉、移动端适配、列表管理、Cloudflare D1 同步、网页歌单转换器与 QQ 音乐歌单转酷我源的导入流程。

## 新增与改造功能

### 主题与视觉更新

- 固定透明主题配色：透明效果保留，但不再根据封面动态改变整体配色，减少歌曲切换时的视觉跳变。
- 浅色模式重做：保留原有主色方向，将偏蓝辅助色调整为更克制的黑灰体系。
- 深色模式重做：保留主色方向，将辅助色调整为白色 / 浅灰体系，提升层次与可读性。
- 深色模式可读性修复：修复部分文字、按钮、输入框在深色模式下不可见或对比度不足的问题。
- 去发光化处理：弱化强蓝色和明显发光效果，整体转向更简洁的高级灰玻璃风格。
- 玻璃拟态统一：统一面板、按钮、搜索框、列表项、歌词区域的透明度、边框和阴影。
- 字体更新：使用现代系统字体栈，提升 Windows、macOS、iOS、Android 下的中英文显示稳定性。
- 桌面端尺寸优化：整体页面略微放大，减少四周空白，使播放器更接近填满窗口。
- 桌面端操作区修复：修复播放列表 / 收藏列表 / 歌单页新增按钮后出现的按钮重叠、吞键、错位问题。
- 移动端歌单操作区优化：移动端保留简洁操作区，调整歌单页按钮布局，不破坏原有手机端视觉结构。

### 播放与列表增强

- 播放列表排序：支持按加入时间升序 / 降序排序。
- 收藏列表排序：支持按加入时间升序 / 降序排序。
- 自定义歌单排序：支持按加入时间升序 / 降序排序。
- 播放列表导入 / 导出：可导入或导出 Solara JSON。
- 收藏列表导入 / 导出：可导入或导出 Solara JSON。
- 歌单歌曲导入：自定义歌单页面新增导入歌曲功能，可将外部 JSON 导入当前歌单。
- 搜索结果导入歌单：搜索结果导入目标新增“导入歌单”，可直接把搜索结果写入指定歌单。
- 新收藏置顶：新加入收藏的歌曲显示在收藏列表顶部。
- 歌单管理完善：支持新建、重命名、删除自定义歌单。

### 跨设备同步

- Cloudflare D1 支持：可绑定 Cloudflare D1 数据库，同步播放状态、播放列表、收藏、歌单等数据。
- 自动降级 localStorage：未绑定 D1 或远程存储不可用时，自动使用浏览器本地存储。
- 多设备恢复：不同设备打开站点时，可从 D1 恢复播放列表、收藏列表和歌单数据。
- 刷新循环修复：修复早期 D1 启动恢复逻辑导致页面不断刷新的问题。

### 歌单转换器

- 网页歌单转换器：新增 `/converter.html`，手机端可直接使用。
- 网易云歌单转换：粘贴网易云歌单链接，转换为 Solara 可导入 JSON。
- QQ 音乐歌单转换：粘贴 QQ 音乐歌单链接，读取 QQ 歌单后匹配酷我源歌曲，输出 `source: "kuwo"` 的可播放格式。
- 未匹配报告：转换失败或未匹配的歌曲会写入 not-found 报告，便于后续手动补充。
- 本地转换脚本更新：`tools/convert-playlist-to-solara.mjs` 同步支持 QQ 歌单转酷我源、本地 Cookie 读取、未匹配报告输出。
- QQ 本地转换限制说明：本地 Node.js 脚本读取 QQ 歌单时可能触发 `check privacy error`，推荐优先使用网页转换器。

## 主要特性

- 桌面端三栏播放器布局。
- 移动端自适应竖屏布局。
- 浅色 / 深色主题切换。
- 固定高级灰玻璃拟态主题。
- 网易云、酷我等来源搜索。
- 歌曲播放、下载、收藏、加入播放列表。
- 播放列表、收藏列表、自定义歌单管理。
- 歌单导入 / 导出。
- 搜索结果批量导入。
- 动态歌词显示。
- Media Session 锁屏控制。
- Cloudflare D1 跨设备数据恢复。
- 手机端网页歌单转换器。
- 本地歌单转换脚本。

## 在线使用

主播放器：

```txt
https://你的域名/
```

歌单转换器：

```txt
https://你的域名/converter.html
```

## 快速部署

推荐部署到 Cloudflare Pages。

1. Fork 或克隆本仓库。
2. 在 Cloudflare Pages 新建项目。
3. 连接 GitHub 仓库。
4. Framework preset 选择 `None`。
5. Build command 留空。
6. Output directory 使用仓库根目录。
7. 部署完成后访问 Pages 域名。

## Cloudflare D1 数据同步

Solara 可选绑定 Cloudflare D1 数据库，用于跨设备保存播放、收藏和歌单数据。

### 1. 创建 D1 数据库

在 Cloudflare Dashboard 进入：

```txt
Workers & Pages → D1 → Create
```

建议数据库名：

```txt
solara-db
```

### 2. 绑定到 Pages 项目

进入 Pages 项目：

```txt
Settings → Functions → Bindings → Add binding → D1 Database
```

填写：

```txt
Binding name: DB
D1 Database: 选择你的数据库
```

`Binding name` 必须是：

```txt
DB
```

### 3. 初始化数据表

进入 D1 数据库的 Query 页面，执行：

```sql
CREATE TABLE IF NOT EXISTS playback_store (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS favorites_store (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 4. 重新部署

绑定完成后重新部署 Pages。前端会优先使用 D1；未绑定或接口不可用时，会自动回退到 localStorage。

## 歌单转换器

页面地址：

```txt
/converter.html
```

支持：

- 网易云歌单链接
- QQ 音乐歌单链接
- 酷我搜索转换
- 下载 Solara JSON
- 下载未匹配报告

使用流程：

1. 打开 `/converter.html`。
2. 粘贴歌单链接。
3. 来源选择 `自动识别`。
4. 选择最多转换数量。
5. 点击开始转换。
6. 下载 Solara JSON。
7. 回到播放器，在播放列表、收藏列表或歌单中导入该 JSON。

说明：

- QQ 音乐歌单不会直接输出腾讯源。
- QQ 音乐歌单会先读取歌名和歌手，再匹配酷我源歌曲。
- 最终输出格式为 `source: "kuwo"`。
- 无法匹配的歌曲会进入未匹配报告。
- 转换结果是否能播放取决于目标音乐源是否可用。
- 推荐优先使用网页转换器处理 QQ 音乐歌单。

## 本地歌单转换脚本

脚本位置：

```txt
tools/convert-playlist-to-solara.mjs
```

QQ 音乐歌单转 Solara：

```powershell
node ".\tools\convert-playlist-to-solara.mjs" --url "https://y.qq.com/n/ryqq/playlist/7847944808" --mode qq
```

网易云歌单转 Solara：

```powershell
node ".\tools\convert-playlist-to-solara.mjs" --url "https://music.163.com/playlist?id=歌单ID" --mode netease
```

酷我源转换：

```powershell
node ".\tools\convert-playlist-to-solara.mjs" --input ".\playlist.json" --mode kuwo
```

指定输出文件：

```powershell
node ".\tools\convert-playlist-to-solara.mjs" --url "歌单链接" --mode qq --output ".\solara-playlist.json"
```

### QQ 音乐本地转换限制

QQ 音乐歌单在本地 Node.js 脚本中可能无法直接读取。

常见报错：

```txt
check privacy error
```

原因是 QQ 音乐接口会校验请求环境和登录上下文。本地 Node.js 请求不一定具备浏览器里的 QQ 音乐登录态，因此同一个歌单可能出现：

```txt
网页转换器可用
本地脚本不可用
```

推荐优先使用网页转换器：

```txt
/converter.html
```

如果必须使用本地脚本，可尝试传入 QQ 音乐网页 Cookie：

```powershell
$env:QQ_MUSIC_COOKIE = @'
你的 y.qq.com Cookie
'@

node ".\tools\convert-playlist-to-solara.mjs" --url "https://y.qq.com/n/ryqq/playlist/歌单ID" --mode qq
```

转换后清除 Cookie：

```powershell
Remove-Item Env:QQ_MUSIC_COOKIE
```

不要把 Cookie 写进代码，不要提交到 GitHub。

说明：QQ 音乐歌单不会直接输出 `source: "tencent"`。Solara 当前不使用腾讯播放源，QQ 歌单会尽量匹配酷我源并输出 `source: "kuwo"`。

## 使用方法

1. 在顶部搜索框输入歌曲、歌手或专辑关键词。
2. 选择音乐来源。
3. 点击搜索。
4. 在搜索结果中播放、下载、加入播放列表、收藏或导入歌单。
5. 在中间列表区域切换播放列表、收藏列表、歌单。
6. 使用列表顶部按钮进行导入、导出、清空、排序、歌单管理。
7. 在右侧歌词区域查看歌词。
8. 使用底部控制栏播放、暂停、上一首、下一首、随机、循环、调节音质和音量。

## 移动端使用

- 手机浏览器访问主站会自动切换移动端布局。
- 可将网页添加到主屏幕使用。
- 移动端支持播放、收藏、列表切换、歌词查看。
- 移动端保留简化后的歌单操作区。
- `/converter.html` 可在手机端直接粘贴外部歌单链接并下载 JSON。

## 主题说明

Solara 当前主题以固定配色为主，不再使用封面动态取色控制整体主题。

### 浅色模式

- 主体为浅灰 / 白色玻璃面板。
- 辅助色由原蓝色调整为黑灰色。
- 控件边框和阴影更弱，整体更干净。
- 按钮与标签保持轻量对比。

### 深色模式

- 主体为深灰 / 黑色玻璃面板。
- 辅助色调整为白色和浅灰。
- 修复文字、按钮、输入框在深色模式下可读性不足的问题。
- 减少蓝色高亮和发光效果。

### 字体

使用现代系统字体栈，兼顾 Windows、macOS、iOS、Android 的中英文显示：

```css
-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif
```

## 配置项

### 访问口令

Cloudflare Pages 环境变量：

```txt
PASSWORD=你的访问口令
```

设置后，未登录访问者会进入 `/login.html`。

删除该环境变量并重新部署即可关闭访问控制。

### 英文界面

Cloudflare Pages 环境变量：

```txt
LANGUAGE=ENG
```

设置后站点切换为英文界面。删除或修改该变量后重新部署即可恢复中文。

### 探索雷达分类

修改：

```txt
js/index.js
```

搜索：

```txt
EXPLORE_RADAR_GENRES
```

可删除或新增探索分类。

## 项目结构

```txt
Solara/
├── css/
│   ├── desktop.css                    # 桌面端布局与组件样式
│   ├── mobile.css                     # 移动端适配样式
│   └── style.css                      # 公共主题、变量与基础样式
├── functions/
│   ├── _middleware.ts                 # Cloudflare Pages Functions 中间件
│   ├── api/
│   │   ├── convert-playlist.ts        # 网页歌单转换器后端
│   │   └── storage.ts                 # D1 存储接口
│   ├── lib/                           # 请求封装与工具模块
│   ├── palette.ts                     # 封面取色相关逻辑
│   └── proxy.ts                       # 音频直链代理
├── js/
│   ├── index.js                       # 播放器核心逻辑与状态管理
│   └── mobile.js                      # 移动端交互逻辑
├── tools/
│   └── convert-playlist-to-solara.mjs # 本地歌单转换脚本
├── converter.html                     # 网页歌单转换器
├── index.html                         # 主播放器页面
├── login.html                         # 访问控制登录页
├── favicon.png
├── favicon.svg
└── README.md
```

## JSON 导入格式

Solara 可导入 JSON 的基本结构：

```json
{
  "meta": {
    "app": "Solara",
    "version": 1,
    "exportedAt": "2026-05-11T00:00:00.000Z",
    "itemCount": 1
  },
  "items": [
    {
      "id": "123456789",
      "name": "示例歌曲名",
      "artist": ["示例歌手名"],
      "album": "示例专辑名",
      "pic_id": "120/example/path.jpg",
      "url_id": "123456789",
      "lyric_id": "123456789",
      "source": "kuwo"
    }
  ]
}
```

可播放歌曲源示例：

```txt
source: netease
source: kuwo
```

QQ 音乐歌单需要转换为酷我源后导入，不应直接使用：

```txt
source: tencent
```

## 常见问题

### 搜索没有结果

切换音乐来源后重试。免费接口可能临时不可用。

### QQ 歌单转换后部分歌曲缺失

QQ 歌单会匹配酷我源歌曲。酷我没有对应歌曲或匹配失败时，会进入未匹配报告。

### QQ 歌单转换出来不能播放

检查 JSON 中每首歌的 `source`。应为：

```txt
kuwo
```

如果是：

```txt
tencent
```

说明使用了旧版转换逻辑，需要重新转换。

### 本地脚本读取 QQ 歌单失败

如果出现：

```txt
check privacy error
```

说明 QQ 音乐接口要求登录上下文。使用网页转换器，或给本地脚本传入 QQ 音乐 Cookie。

### 多设备数据不同步

检查：

```txt
Cloudflare Pages → Settings → Functions → Bindings
```

确认 D1 Binding name 是：

```txt
DB
```

再确认 D1 中已创建：

```txt
playback_store
favorites_store
```

### 如何重置本地数据

浏览器开发者工具中清理 localStorage。  
如果启用了 D1，还需要在 D1 数据库中清理对应 key。

## 致谢

- 感谢 GD 音乐台提供免费音乐聚合接口。
- 感谢 Linux.do 社区相关项目与讨论提供灵感。
- 本项目基于原 Solara 项目继续改造。

## 许可证

本项目采用 CC BY-NC-SA 协议，禁止商业化使用。任何衍生项目必须保留本项目地址并以相同协议开源。
