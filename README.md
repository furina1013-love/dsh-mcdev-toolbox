# dsh-mcdev-toolbox

> 面向 **Minecraft Java Edition** 模组开发的 DeepSeek Harness Host 插件：新对话里只暴露一个很小的控制工具；AI 判断这是 MC 模组任务后，按需激活项目、资源、数据、代码、诊断五组工具。工具在**下一次请求**通过 DSH 的 `tool-addition` 开发者消息追加到会话末尾，旧会话和已恢复会话不会被修改。

## 为什么不是把 7 个工具直接挂上去

Minecraft 模组开发常用工具不少，但一个对话通常只需要其中一两组：

- 看项目结构、跑 Gradle：`project`
- 加方块/物品、修模型：`assets`
- 写配方、标签、掉落表：`data`
- 写 Mixin、查映射：`code`
- 看崩溃日志：`diagnostics`

本插件默认只注册 `mcdev_toolbox` 一个控制工具（约 300 schema tokens）。系统提示词末尾有一段简短指引，要求 AI 仅在任务确实是 Minecraft Java 模组开发时调用它，并只选择需要的组。激活后，组内工具在**下一步**才注册；DSH 会把它记录成 conversation 末尾的 `developer/message` + `tool-addition`，而不是重写历史前缀。

## 新会话 / 旧会话

`agent/created` 时检查 Session：

- 没有 `request/header`、没有 `turn/start`、不是 fork/seed、不是 subagent（默认）→ 新对话，安装控制工具和指引 section。
- 已有模型请求、已 fork、已 seed、或 `includeSubagents=false` 的 subagent → 完全跳过，不注册任何工具、不添加任何提示文本。

因此：

- 插件安装/升级不会给正在进行的旧会话补工具；
- 恢复旧会话时也不会出现“工具被追加到旧历史”的情况；
- 只有之后新建的对话才会看到 `mcdev_toolbox`。

## 工具组

| 组 | 工具 | 用途 |
|---|---|---|
| `project` | `mcdev_project` | 识别 Fabric/NeoForge/Forge/Architectury，读取 MC 版本、Java、mappings、mod id、元数据、mixin 配置；`validate` 检查 `fabric.mod.json`、`mods.toml`、`pack.mcmeta`、源码根和 mixin 类。 |
| `project` | `mcdev_build` | 在项目根目录运行**一个** Gradle task（`build`、`compileJava`、`runData`、`genSources`、`runClient` 等），硬超时、输出截断、错误行提取、构建产物列表。 |
| `assets` | `mcdev_assets` | 校验/生成 item、block 的 model、blockstate、lang；检查本地 parent/texture/model 引用；1.21.4+ 自动生成 `assets/<ns>/items/*.json` item model definition。 |
| `data` | `mcdev_data` | 生成/校验 shaped、shapeless、熔炉、高炉、烟熏、营火、切石、锻造配方；生成 item/block tag 与简单方块 loot table；按 1.21 数据包目录和 `id`/`item` 结果键自动切换。 |
| `code` | `mcdev_mappings` | 搜索本地 Tiny/TSRG/ProGuard 映射文件（项目 `.gradle`、`build`、`mappings`、Gradle 缓存），返回 official/named 类、方法、字段。 |
| `code` | `mcdev_mixin` | 校验 `*.mixins.json`、package、mixin 源类、refmap；列出所有 `@Mixin` target。 |
| `diagnostics` | `mcdev_log` | 分析 `run/logs/latest.log`、`logs/latest.log` 或最新 crash report，识别 Mixin、依赖、重复 mod、registry、class version、NoSuchMethod 等签名并给出下一步。 |

所有工具只使用本地文件、JDK/Gradle；不联网、不上传源码。输出都做了长度上限，避免把整个日志/模型文件倒进上下文。

## 安装

在 Harness 中：

```json
{
  "action": "install_bundle",
  "target": "dsh-mcdev-toolbox"
}
```

或通过 `cords` CLI/Plugin Manager 安装本地 bundle。安装后从**新对话**开始生效。

## 配置

`cordis.patch.yml` 默认值：

| 字段 | 默认 | 说明 |
|---|---:|---|
| `enabled` | `true` | 关闭后不安装任何工具/提示。 |
| `maxOutputChars` | `12000` | 单个工具结果（Gradle 日志、校验报告等）的字符上限。 |
| `gradleTimeoutMs` | `180000` | 单次 Gradle 任务的硬超时（5s–15min）。 |
| `includeSubagents` | `false` | 是否也为新 subagent 会话安装；默认关闭，避免每个子代理都带 MC 指引。 |

## 开发

```sh
cd dsh-mcdev-toolbox
npm test
```

测试不依赖真实 Minecraft 或 Gradle：用临时目录构造 Fabric 项目、资源、配方、mixin、mapping 和日志 fixture。

### 目录

```text
index.js              Host apply：新会话识别、per-agent 安装、动态工具注册
src/tool-defs.js      控制工具 + 五组工具的 wire schema
src/project.js        Gradle/MC/loader/metadata 检测与校验
src/build.js          Gradle 子进程、超时、输出压缩
src/assets.js         model/blockstate/lang 校验与生成
src/data.js           recipe/tag/loot 生成与校验
src/mappings.js       Tiny/TSRG/ProGuard 映射搜索
src/mixin.js          mixin config/source 校验
src/log.js            crash/log 签名分析
src/session.js        新会话 vs 旧会话判定
test/                 node:test 单测
```

## 设计边界

- **不做**完整 Minecraft 注册表/客户端启动验证；这些工具是开发期静态辅助，最终仍以 Gradle build / 游戏内测试为准。
- **不重写** DSH 的 tool-addition 历史；只使用公开的 `ctx.tools.register` / dispose，让 DSH 自己记录工具增删。
- **不修改** 旧会话：旧会话没有本插件的 scoped 注册，也没有指引 section。
- **不联网**：mapping 搜索只读本地缓存；如果找不到 mapping 文件，会明确返回提示而不是猜。
- **版本差异**：配方/数据目录和 1.21.4 item model definition 已做自动分支；更早/更晚的快照版本仍建议先跑 `mcdev_project validate` + `mcdev_build build`。
