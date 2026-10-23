# Fairy Ⅲ · 绝区零 H.D.D 皮肤（DSH Web 插件）

把 DeepSeek Harness 的 Web 界面整个换成绝区零「Fairy」的 H.D.D 终端：

- **开机动画**：`拓展版HDD开机动画1.mp4` 满屏播放，叠 HUD（kicker、版本号、进度条、百分比、SKIP、四角角标）。
- **居中问好**：动画结束立即淡入 H.D.D 圆形徽记（深蓝环 / 白环 / 蓝盘 / 紫芯 / 白色彗星点，整枚缓慢自转 + 扫描光带），背后是蓝光晕图，三行问候逐行浮现，同时播放预生成的 Fairy 语音。
- **坞底图**：缩到左下后，光晕图作为坞的底图保留（柔边、叠色发光），徽记正好压在图片最亮的光点上。
- **收缩成坞**：问候播完约 1.9s 后，核心飞向左下角变成 64px 悬浮球，光晕图淡出；点击悬浮球打开 H.D.D 面板。
- **语音回复**：消息朗读按钮 + 自动朗读（可在面板里关），走本机 GPT-SoVITS 的 Fairy 音色（`Fairy_e10_s870.pth`）。
- **主题**：深蓝玻璃 + 青蓝霓虹 token、星云/网格/扫描线壁纸、H.D.D 风滚动条与焦点光。

## 组成

| 文件 | 作用 |
| --- | --- |
| `index.js` | host 半边：`/fairy-zzz/assets`、`/fairy-zzz/audio/<sha1>.wav`、`/fairy-zzz/health`、`/fairy-zzz/tts`；负责拉起/复用 TTS 引擎、串行排队、磁盘缓存 |
| `client.js` | 客户端半边：主题 token、壁纸、开机/问好/坞三阶段状态机、语音动作按钮、坞面板；CSS 用 `<style data-plugin>` 注入 |
| `cordis.patch.yml` | 插入皮肤插件行 + `Fairy 模式` agent 预设（persona 走 `@deepseek-ai/dsh-persona`，覆盖默认人设） |
| `assets/` | `boot.mp4`（压过的开机动画）、`poster.jpg`、`hero.png`（蓝光晕）、`voice/greet.wav`、`build.txt`（构建看守） |
| `locale/` | 插件元数据的中英文标题与描述 |

## 依赖

- TTS 引擎：`D:\Fairy\tts\fairy_server.py`（GPT-SoVITS，CPU，启动加载约 20s）。插件会自动 spawn：

  ```
  D:\Fairy\tts\py311\python.exe D:\Fairy\tts\fairy_server.py --port 9800
  ```

  已有实例在 9800 上时直接复用（`/health` ready 即通过）。
- 引擎只是"能说话"还不够，音色权重 `D:\Fairy\tts\models\Fairy_e10_s870.pth` + `Fairy-e10.ckpt` + 参考 wav 由引擎自己加载。

## 安装

```powershell
# 在 DSH 会话里让 agent 执行
plugin_manager install_bundle  target=E:\Fairy\fairy-zzz
```

装好后整页刷新一次（Ctrl+R 在桌面壳里不生效，见下）：插件自带构建看守，
改 `assets/build.txt` 的内容就会触发 `location.reload()`。

## 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/fairy-zzz/health` | `{ok, engine, voice, speed}`，1.5s 超时探测引擎 |
| GET | `/fairy-zzz/assets/<path>` | 静态资源（含 Range，路径穿越已挡） |
| GET | `/fairy-zzz/audio/<sha1>.wav` | 合成缓存（Range 支持，供 `<audio>` 拖动） |
| POST | `/fairy-zzz/tts` | `{text}` → `{url, cached}`；清洗 markdown/代码/链接，截 500 字，sha1 缓存 |

## 开发提示

- **客户端 HMR**：改 `client.js` 会自动重挂插件（phase 回到 boot）。
- **整页刷新**：改 `assets/build.txt`（内容任意变化），客户端 3s 轮询一次后 `location.reload()`；
  桌面壳不转发 Ctrl+R，也没有 `--remote-debugging-port`，这是唯一不杀会话的刷新通道。
- **样式注入**：`window.__ModuleLoader__.load` 的工厂只拿到 `require`，`styles` 不存在；
  必须自己 `document.createElement('style')` + `data-plugin-css` 去重，并用 `ctx.effect` 在卸载时移除
  （`client.js` 里 `guard('styles', ...)` 一段）。
- 关闭其它会抢角落的插件（`dsh-whale-widget`、`dsh-pet-remielle` 等），否则会和左下坞/右下 SKIP 打架。

## 已知取舍

- `sidebar.brand.mark` / `sidebar.brand.name` 是 `single` 槽，宿主先注册者常驻，后来者 `active:false`，
  所以侧栏仍显示官方 deepseek 字标；皮肤以主题 + 壁纸 + 开机/问好/坞来做视觉。
- 问候语音是预生成的 `greet.wav`（改文案要重新合成）；后续每条消息的朗读才是实时合成。

## 第二轮修正（v3.1）

- **语音爆音**：根因在 TTS 服务端——GPT-SoVITS 浮点峰值 >1，`soundfile` 写 PCM16 时直接硬削波（旧问候语 82% 采样点贴在 0 dB）。已在 `D:\Fairy\tts\fairy_server.py` 写盘前加峰值归一化到 -1 dBFS + 首尾 6ms 淡入淡出，重启引擎后重新合成 `assets/voice/greet.wav`（实测 mean -17.0 dB / max -1.0 dB）。旧的 `cache/*.wav` 已清空。
- **图标**：改成参考视频里的圆形唱片徽记（深蓝外环 / 白色厚环 / 蓝盘 / 紫芯 / 白色彗星点），品牌小图标同步成同心圆。
- **动效**：主体 34s 慢转 + 外环光带 7s 扫描 + 白点 11s 绕轴心运行 + greet 期呼吸；dock 期放慢到 46s / 9s。
- **坞位置**：从 composer 左侧挪进侧栏红圈位置（`--fz3-dock-x:142px`、`top:calc(100% - 220px)`、直径 72px），铭牌在右，**不再有光晕**。

## 图标与风格（v3.2）

- **图标素材**：改用官方素材而非自绘——ZZZ 维基 Fairy 词条里的「眼睛」徽记原图（`https://wiki.biligame.com/zzz/Fairy`），裁切 → 去预乘透明 → 按半径拆成「外环 / 眼芯」两张 PNG（`assets/fairy-eye-ring.png`、`assets/fairy-eye-core.png`），边缘做径向羽化，不留方形裁切边。
- **动效**：外环 96s 慢转 + 眼芯 7.4s 眨一次眼（`scaleY` 压扁）+ 7.2s 上下浮动 + 光晕 4.6s 呼吸 + 9.4s 扫描线；全部是分层 CSS 动画，不是一张静态图。
- **风格**：按 BV1wGH46iEun 的配色收紧——近黑底、靛蓝/紫的星云辉光、`#4f78ff` 主色、面板更深；问好页加了 `HOLLOW DEEP DIVE SYSTEM` 标题＋倒影＋「空 洞 潜 水 系 统」小字。

## 图标 v3.3：绿幕素材

- 素材：B 站 BV1Kc8BeQEzd 分 P2「Fairy 绿幕」原片（852x480），取 20-26s 段，裁 (280,80,300,300)。
- 处理：colorkey 去绿 + despill 去绿边 → 正反拼接成 12s 无缝循环 → 20fps / 360px → 动画 WebP（`assets/fairy-eye-alpha.webp`，RGBA + 循环）。
- 附 `assets/fairy-eye-green.png`（首帧静图，兜底）与 `assets/fairy-eye-green-128.png`（侧栏品牌小图）。
- 组件只放一张 `<img class="fz3-eye-glyph">`，动画由素材本身提供，CSS 只保留光晕与投影。

## 图标 v3.4：矢量分层 + 状态动画

- 素材：`E:\Fairy\animation\assets\fairy.svg`（Apache-2.0，Adapted from Fairy-DSH, Copyright 2026 Chengzhibense），
  已复制为 `assets/fairy-eye.svg` 并内联进客户端；署名见 `NOTICE-fairy-dsh.md`。
- 分层：`#outer-halo / #outer-disc / #corners / #sclera / #iris-outer / #iris-blue / #pupil / #highlight`，
  每层 `transform-box:view-box`、`transform-origin:80px 80px`，缩放相位来自 `idle-motion.json`（breathMs 1500 / rotationMs 12000）。
- 动效来自宿主 mood 接口：
  - `GET /fairy-zzz/mood` → `{ mood: idle | thinking | working | done, running, elapsed, doneAt }`
  - 宿主监听 `api-session/status`、`agent/status`、`agent/assistant-stream`、`session/event`；
    running 前 2.5s 记为 thinking，之后 working；停下后 2.4s 内 done。
- 四态表现（CSS，`data-mood` 挂在 `.fz3-layer`）：
  - idle：四层呼吸 1.5s + 外环 12s 旋转 + 高光 3.6s
  - thinking：眼球左右扫视 2.4s + 外环加速 4s
  - working：瞳孔收紧 1.1s + 扫描带下行 + 外环 1.9s
  - done：整体 `fz3-celebrate`（1→1.14→0.97→1）+ 一次性爆闪
- 绿幕版 `assets/fairy-eye-alpha.webp` 仍保留，需要时可切回（把 `.fz3-eye-glyph` 的 img 换回即可）。

## 视觉复刻（v4，参考 BV1wGH46iEun）

- 配色：`bg-base rgba(7,6,16,.86)`、`layer-1 rgba(12,10,26,.90)`、`layer-2 rgba(18,15,36,.94)`、`brand #6f5bff`、`sidebar rgba(8,7,18,.88)`、`bubble rgba(26,22,48,.92)`。
- 背景：`body::before` 靛紫星云 + `repeating-linear-gradient(-24deg,…)` 斜向光带；`Atmos` 追加 `.fz3-rim`（左上紫光）与 `.fz3-bay`（底部蓝光）。
- 侧栏装饰：`.fz3-sb-brand` 实体底板盖住官方字标，换成 34px 矢量眼标 + 衬线斜体 `Fairy` + 副标题「Ⅲ型总序式集成泛用人工智能」。
- 输入区装饰：`.fz3-wave` 红点 + 12 根呼吸声波条（`@keyframes fz3-bar`）+ 两条渐变滑杆，贴在右下角。
- 图标：`assets/fairy-eye.svg`（Apache-2.0，源自 Fairy-DSH / Chengzhibense）内联为 `FAIRY_EYE_SVG`，四态动效见「状态动画」。
- 插件边界：`sidebar.brand.*` 是 single 槽且被官方占用，只能覆盖不能替换；窗口标题栏与侧栏条目标题属于应用外壳，插件改不了。

## v4.2 / v4.3：移植到 Web 端（127.0.0.1:3080）

### 安装（web profile）

1. `C:\Users\<用户>\.dsh\profiles\web\node_modules\@local\dsh-fairy-zzz` → 目录联接（Junction）指向 `E:\Fairy\fairy-zzz`。
2. 在 `profiles\web\cordis.patch.yml` 末尾追加：

   ```yaml
   - insert:
       - id: fairy-zzz-skin
         name: '@local/dsh-fairy-zzz'
   ```
3. 同一文件里补上深色偏好（web profile 默认跟随系统，系统是浅色时正文会变成深色字＋深色底）：

   ```yaml
   - id: ui-theme
     name: "@deepseek-ai/dsh-client-ui-theme"
     config:
       preference: dark
   ```
4. 宿主插件热加载；浏览器刷新一次即可看到开机动画。

### 这一轮修掉的问题

- **整页变黑／什么都没有**：旧的“隐藏官方字标”逻辑按 `textContent` 匹配 `deepseek`，会在布局未稳定时命中整个 frame 容器
  （宽高为 0 的瞬间绕过了尺寸判断），给它加了 `visibility:hidden`，于是整个应用被隐藏。
  现在改为纯 CSS 隐藏 —— 官方字标是 SVG（`_brandName` / `_brandMark`），根本没有文本节点。
- **字标位置**：官方字标是 SVG，改用 `[class*="_brandIdentity"]` 量出矩形，把 `.fz3-sb-brand` 钉在同一位置，无底板、无边框。
- **开机画面**：`object-fit: contain`（原来是 cover，画面被裁掉两侧），并隐藏 `.fz3-corner` 角标（旧选择器写成了 `.fz3-boot-corner`，没生效）。
- **去掉遮罩**：dock 阶段不再渲染 `.fz3-veil`，浅色叠加层会把官方界面压暗。
- **眼标**：保留素材原本的四角装饰（`#corners`，12s 一圈；thinking 4s、working 1.9s 加速）。
- **字幕**：`空 洞 深 潜 系 统`。

### 自检

客户端加载后会在 4s / 26s / 44s 各 POST 一次 `/fairy-zzz/diag`，宿主把每行 JSON 追加到 `E:\Fairy\_diag\client-diag.log`：
`{ phase, mood, frameVisible, blink, glance, blinks, textLen, nodes, errs }`。`frameVisible` 必须是 `visible`；
`blinks` 是累计眨眼次数，`blink` 恰为 `1` 时说明抓到了闭眼那一帧。

### v4.4：待机小动作

素材（`E:\Fairy\animation\`）里没有眨眼帧，用 CSS 变形实现，不额外加图片：

- **随机眨眼**：dock（待机）阶段每 3.4–8.6s 随机闭一次眼，约 18% 概率连眨第二下；
  `@keyframes fz3-eyelid` 把整只眼纵向压到 `scaleY(.09)`（26%–46% 保持），光环 `fz3-eyelid-halo` 同时轻微扩散变淡，300ms 完成。
- **随机瞟一眼**：约 22% 概率在两次眨眼之间把虹膜组（`#iris-outer` / `#iris-blue` / `#pupil`）横移 6%，720ms 回位。
- 状态由 `.fz3-eye` 的 `data-blink` / `data-glance` 驱动；`BLINK_TEST = true` 时 1.4s 后强制闭眼一次，
  配合 `E:\Fairy\_diag\blink-test.html`（由 `mkblink.js` 生成，冻结 35% / 44% 两帧）可离线核对造型。
- 只做 CSS 变形、不改 SVG 结构，素材的 `#corners` 装饰与旋转动画不受影响。

### v4.5：开机与问候页自适应
参考视频 BV1SD4C63EZz（橙汁本色《可能是全网最还原的Fairy（动画）》）的构图：眼标居中偏上、中文题字压在英文标题上方、英文标题下方带一层翻转渐隐的镜面倒影。

- **统一几何变量**：`:root` 新增 `--fz3-eye`（眼标直径 `clamp(128px,min(38vmin,42vh),280px)`）、`--fz3-eye-cy`（眼标中心 `47vh`）、`--fz3-eye-gap`。`.fz3-core` 与 `.fz3-copy` 都由这三个变量推导，复制块永远贴着眼标往下排，窗口压扁也不会互相压住。
- **字号全部 clamp**：kicker / 中文题字 / 英文标题 / 问候语 / 页脚都按 `min(vw, vh)` 取小值。
- **镜面倒影**：`.fz3-copy-title::after{content:attr(data-text);transform:scaleY(-1);mask:linear-gradient(...)}`。
- **矮视口**（`max-height:620px`）：隐藏 kicker 与页脚行；`max-height:460px` 再隐藏倒影与中文题字，并把眼标收到 180px。
- **窄视口**（`max-width:820px`）：问候语 `clamp(11px,2.55vw,15px)` + `line-break:strict`，避免「是需 / 要我陪着」这种把词拆开的换行。
- **开机画面**：视频仍是 `object-fit:contain`，但四周黑边改成「同一段视频的模糊放大铺底」（`.fz3-boot-fill > video`，`blur(38px)` + `brightness(.42)`，`poster.jpg` 兜底），任何窗口比例都不会出现硬黑边。
- **点击提示**：`点击任意处唤起声音` 改成绝对定位在底部 `clamp(12px,5vh,44px)`，矮视口下用 `.fz3-tap` 单独保留。
- **自检扩展**：`/fairy-zzz/diag` 现在额外回传 `vp`、`core`、`copy`、`tap` 的矩形与 `fit.overflowX/overflowY`，换机器/换分辨率后可直接看日志判断有没有溢出。

离线核对：`node E:\Fairy\_diag\mkresp.js` 生成 `greet.html` / `boot.html`，再用 headless Edge 在 1920x1080 / 1366x768 / 1024x700 / 800x600 / 520x900 / 1600x420 六个尺寸截图（`E:\Fairy\_diag\resp-greet-*.png`）。

### 仍受插件边界限制

- 窗口标题栏、侧栏条目文案、右侧面板图标属于应用外壳/其它插件，Fairy 插件改不了。
- 右下角鲸鱼挂件与右侧小圆钮来自 `dsh-whale-widget`（非本插件），如需完全统一的观感可在插件管理里单独关掉。

## v4.6：思考 / 眨眼 / 扩散环（按参考视频的实现复刻）

参考视频 BV1SD4C63EZz（橙汁本色，178s）的作者开源了整套代码 Chengzhibense/Fairy-DSH（Apache-2.0），本轮直接按其参数复现，而不是凭观感自创。

- **眼睑几何**：与官方 	hinking-eye-clip 同源。SVG 里新增 #fz3-lid-cover（clip-path:url(#fz3-lid-cover-clip)，r=56 的圆）与一条 M20 60 Q80 90 140 60 V-40 H20 Z 的盖子路径，	ransform-box:view-box;transform-origin:80px 60px。
- **思考态**（data-mood="thinking|working" → data-lid="think"）：@keyframes fz3-lid-think{from{translateY(14.5px) scaleY(.55)}to{translateY(15.5px) scaleY(1)}}，.72s cubic-bezier(.72,0,.28,1) infinite alternate —— 上眼睑压到半闭并轻微呼吸，就是视频里“在思考”的那只眼。
- **眨眼**（待机随机，3.4–8.6s；连续眨 24% 概率）：data-lid="blink" 300ms，z3-lid-blink 从全开 	ranslateY(-60px) 扫到 	ranslateY(16px) 再抬回，同时 .fz3-eye-halo 轻微收放。比“整只眼压成一条缝”更接近真实眼睑。
- **扩散光环**：.fz3-eye-ring（2px gba(201,248,255,.86) 描边）按官方 dsh-fairy-lash-pulse 的 4s 节奏——0–27% 由 scale(.98) 扩散到 scale(2.78) 并淡出，其余时间不可见。
- **完成态**（data-mood="done" → data-lid="soft"）：z3-lid-soft 在 	ranslateY(-7px)→1px 之间轻扫，对应官方 comforting clip。

离线核对：
ode E:\Fairy\_diag\mkpose.js → ile:///E:/Fairy/_diag/pose.html（E:\Fairy\_diag\pose2.png 一次看到 idle / ring 12-20-30% / think 0-100% / blink closed 七种姿态）。
注意：**headless 截图里 CSS 动画时间轴不推进**，只能靠手动摆姿（inline transform）核对形态，真实动效要在应用里看。

## v4.8：语音引擎可移植化（本机已迁到 D:\Fairy\tts）

GPT-SoVITS 有两三 GB、各机器路径不同，**不随包分发**；插件改为"能找到就用，找不到就不朗读"。

- 引擎定位优先级：`FAIRY_VOICE_HOME` → `<插件目录>\voice-home.txt` → 插件同级 `../voice` → `FAIRY_TTS_DIR` → `D:\Fairy\tts`（本机默认）。
- 布局自适应：`voice\python\python.exe`（便携包）或 `voice\py311\python.exe`（旧安装）都能认。
- 宿主新增 `/fairy-zzz/engine?action=status|start|stop`：`start` 后台拉起引擎并最多等 180s（日志写 `<引擎目录>\server.log`）；
  `stop` 只结束"由本插件 spawn 的"进程（`engineManaged`），不会误杀别人启动的引擎。
- `/fairy-zzz/health` 增加 `engineState`（ready/loading/error/dead）、`engineError`、`engineHome`、`engineManaged`。
- 设置 → Fairy 新增 `启动引擎 / 停止引擎 / 刷新状态`，状态点新增琥珀色"加载中"。
- 安装脚本 `-VoiceHome` / `-TtsDir` 可登记引擎目录（写 `voice-home.txt` + 设环境变量）。

实测（本机，纯 CPU）：引擎加载模型 1.2–2.0s；1.7s 的语音合成耗时 1.6s。
> 注：v3.3 的绿幕素材（`fairy-eye-alpha.webp` / `fairy-eye-green*.png`，约 3 MB）只是当时做动图的中间产物，代码已全部改用内联 SVG，4.8.0 起不再随包分发。

## v4.9：语音引擎目录交给用户自己指定

之前默认值写死成 E:\Fairy\tts（后来又改成 D:\Fairy\tts），换台机器就失效。现在由用户指定，插件不带任何盘符假设。

- **查找顺序**（eadVoiceHome()）：<插件目录>\voice-home.txt → FAIRY_VOICE_HOME → 插件同级 ..\voice → FAIRY_TTS_DIR → 空（不朗读）。
  oice-home.txt 排第一，因为它是设置面板保存的「用户选择」，任何环境变量都不该覆盖它。
- **设置面板**：新增「语音引擎目录」一行——输入框 + 保存 / 检测 / 清除。保存即写入 oice-home.txt，立刻 syncVoiceHome()，不用重启宿主。
- **新路由**：GET /fairy-zzz/voice-home 读状态；POST /fairy-zzz/voice-home {home} 保存（{home, probe:true} 只校验不保存；home:'' 清除）。
  返回 { ok, home, source: settings|env|portable|legacy|none, python, server, models, reason }，eason 直接给面板当提示文案。
- **路径清洗**：cleanHome() 去引号、合并重复分隔符、Windows 下统一反斜杠 —— "D://Fairy//tts" 会存成 D:\Fairy\tts。
- **引擎脚本自包含**：airy_server.py 里 HERE = dirname(abspath(__file__))，ROOT = HERE/GPT-SoVITS、MODELS = HERE/models，
  并在 uild_pipeline() 里把 ert / hubert / t2s / vits 四个路径全部按 HERE 重算（不再依赖 	ts_infer.yaml 里的绝对路径）。
  整个引擎目录搬到任意盘符都能直接跑，验证方式：D:\Fairy\tts\py311\python.exe D:\Fairy\tts\fairy_server.py --port 9800 → /health 返回 ready → POST /tts 出声。
- **安装脚本**：不再写 FAIRY_VOICE_HOME 环境变量（只写 oice-home.txt），并顺手把旧的用户级变量清掉，避免「文件说 A、变量说 B」。