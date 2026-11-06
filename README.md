# dsh-mcdev-toolbox

> 面向 **Minecraft Java Edition** 模组开发的 DeepSeek Harness Host 插件：新对话里只暴露一个很小的控制工具；AI 判断任务确实与 MC 模组开发有关后，再按需激活项目、资源、数据、代码、诊断五组工具。工具在**下一次请求**由 DSH 追加到会话末尾，旧会话和已恢复会话不会被修改。

支持 Fabric、NeoForge、Forge 和 Architectury 项目。所有工具只读取本地项目文件、JDK、Gradle wrapper 和本地映射缓存，不联网、不上传源码。

## 特性

- **按需加载**：默认只注册一个控制工具 `mcdev_toolbox`，避免每个对话都携带 7 个无关工具。
- **新会话隔离**：插件安装、升级或恢复旧会话时，不会给已有历史补工具或提示词。
- **版本感知**：根据 `gradle.properties`、`fabric.mod.json`、`mods.toml` 等文件识别 Minecraft 版本，自动切换 Java 版本、数据包目录、配方结果键、ingredient 格式和 1.21.4+ item model definition。
- **本地优先**：不启动 Minecraft，不访问网络；静态检查 + Gradle 构建辅助，最终仍以游戏内测试为准。
- **输出可控**：工具结果有字符上限，Gradle 有硬超时，大日志只保留崩溃尾部和高信号片段。

## 安装

要求：

- Node.js `^22.19.0` 或 `>=24.0.0`
- DeepSeek Harness `>=0.2.0-0`
- 项目使用 Gradle Wrapper（`gradlew` / `gradlew.bat`）

```bash
git clone git@github.com:furina1013-love/dsh-mcdev-toolbox.git
```

在 Harness 中把克隆后的目录作为本地 bundle 安装：

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/to/dsh-mcdev-toolbox"
}
```

也可以通过 Harness 的 Plugin Manager 或 `cords` CLI 安装本地 bundle。安装后需要**重启 Harness**；重启后请从**新对话**开始，已有会话不会变化。

安装成功后，profile 的 `dsh.profile.bundles` 应包含 `@local/dsh-mcdev-toolbox`，`dsh --profile <profile> --dump-config` 的输出中应出现 `id: mcdev-toolbox`。

## 使用方式

新对话中，模型会先看到控制工具：

```json
{
  "action": "activate",
  "groups": ["project", "assets"],
  "reason": "Add a ruby block and its models to this Fabric project"
}
```

随后在**下一步请求**中，`project` 和 `assets` 组里的工具才会出现。支持的操作：

- `activate`：激活一个或多个组
- `deactivate`：移除指定组
- `status`：查看当前已激活的组

如果任务与 Minecraft Java 模组开发无关，模型不应调用该工具。

## 工具组

| 组 | 工具 | 主要操作 | 用途 |
|---|---|---|---|
| `project` | `mcdev_project` | `inspect` / `validate` | 识别 loader、Minecraft/Java 版本、mod id、mappings、元数据、mixin 配置和源码根；`validate` 检查 `fabric.mod.json`、`mods.toml`/`neoforge.mods.toml`、`pack.mcmeta`、mixin 类。只读。 |
| `project` | `mcdev_build` | `task` + `args` | 在项目根目录运行一个白名单 Gradle task，例如 `build`、`compileJava`、`processResources`、`runData`、`genSources`、`runClient`。硬超时、输出截断、错误行提取、构建产物列表。 |
| `assets` | `mcdev_assets` | `validate` / `item` / `block` / `lang` | 校验或生成 item、block 的 model、blockstate、lang 和 1.21.4+ item model definition；检查本地 parent/texture/model 引用和 parent 环。 |
| `data` | `mcdev_data` | `recipe` / `tag` / `loot` / `validate` | 生成或校验 shaped、shapeless、熔炉、高炉、烟熏、营火、切石、锻造配方；item/block tag 与简单方块 loot table。 |
| `code` | `mcdev_mappings` | `query` | 搜索本地 Tiny/TSRG/ProGuard 映射文件，返回 official/named 类、方法、字段。 |
| `code` | `mcdev_mixin` | `validate` / `list` / `targets` | 校验 `*.mixins.json`、package、mixin 源类和 refmap；列出所有 `@Mixin` target。 |
| `diagnostics` | `mcdev_log` | `path`（可选） | 分析 `run/logs/latest.log`、`logs/latest.log` 或最新 crash report，识别 Mixin、依赖、重复 mod、registry、class version、NoSuchMethod 等签名并给出下一步。 |

## 新会话与旧会话

插件在 `agent/created` 时检查 Session：

- 创建来源是 `startup` 或 `clear`，且没有模型请求、没有 `turn/start`、不是 fork/seed、不是 subagent（默认）→ **新对话**，安装控制工具和一段简短指引。
- 已有模型请求、已 fork、已 seed、来源是 `compact`/`resume` 等，或 `includeSubagents=false` 的 subagent → **完全跳过**，不注册工具、不添加提示文本。
- `parentSession`、`delegationDepth`、`origin=subagent` 的检查只在 `includeSubagents=true` 时放行；`isSeeded` 始终跳过。

因此插件安装或升级不会改写旧会话，恢复旧会话也不会出现工具被追加到旧历史的情况。

## 版本适配

工具从项目文件读取 Minecraft 版本，并按版本选择约定：

| Minecraft | Java | 数据目录 | 配方结果键 | 配方 ingredient | item model definition | NeoForge 元数据 |
|---|---:|---|---|---|---|---|
| 1.21.4+ | 21 | 单数（`recipe`、`item`） | `id` | 字符串 / `#tag` | 需要 `items/*.json` | `neoforge.mods.toml` |
| 1.21–1.21.3 | 21 | 单数 | `id` | 字符串 / `#tag` | 不需要 | `neoforge.mods.toml` |
| 1.20.5–1.20.6 | 21 | 复数 | `id` | 字符串 / `#tag` | 不需要 | `neoforge.mods.toml` |
| 1.20.2–1.20.4 | 17 | 复数 | `item` | `{item}` / `{tag}` | 不需要 | `mods.toml` |
| 1.18–1.20.1 | 17 | 复数 | `item` | `{item}` / `{tag}` | 不需要 | Forge 无 NeoForge 元数据 |

未知版本会退回接近的约定，并在 `mcdev_project validate` 中给出 warning。快照版本或新版本请先运行 `mcdev_project validate` 和 `mcdev_build build`。

## 配置

`cordis.patch.yml` 中可配置：

| 字段 | 默认 | 说明 |
|---|---:|---|
| `enabled` | `true` | 关闭后不安装任何工具或提示。 |
| `maxOutputChars` | `12000` | 单个工具结果的字符上限，运行时限制在 2000–16000。 |
| `gradleTimeoutMs` | `180000` | 单次 Gradle 任务的硬超时，运行时限制在 5 秒–15 分钟。 |
| `includeSubagents` | `false` | 是否也为新 subagent 会话安装；默认关闭，避免每个子代理都带 MC 指引。 |

示例：

```yaml
- insert:
    - id: mcdev-toolbox
      name: '@local/dsh-mcdev-toolbox'
      config:
        enabled: true
        maxOutputChars: 12000
        gradleTimeoutMs: 180000
        includeSubagents: false
```

## 开发

```bash
git clone git@github.com:furina1013-love/dsh-mcdev-toolbox.git
cd dsh-mcdev-toolbox
npm test
```

测试不依赖真实 Minecraft 或 Gradle，使用临时目录构造 Fabric 项目、资源、配方、mixin、mapping 和日志 fixture。当前覆盖 **41 个 `node:test` 用例**，包括工具 schema 形状、新/旧会话判定、locale 路径穿越、Gradle 参数拒绝、1.20.4/1.20.5+ ingredient 格式、模型环检测、client-only 源码根和日志尾部截断。

### 目录

```text
index.js              Host apply：新会话识别、per-agent 安装、动态工具注册
src/tool-defs.js      控制工具 + 五组工具的 wire schema（编译成标准 JSON Schema）
src/project.js        Gradle/MC/loader/metadata 检测与校验
src/build.js          Gradle 子进程、任务/参数白名单、超时、输出压缩
src/assets.js         model/blockstate/lang 校验与生成
src/data.js           recipe/tag/loot 生成与校验
src/mappings.js       Tiny/TSRG/ProGuard 映射搜索
src/mixin.js          mixin config/source 校验
src/log.js            crash/log 签名分析
src/session.js        新会话 vs 旧会话判定
test/                 node:test 单测
```

## 设计边界

- **不做**完整 Minecraft 注册表或客户端启动验证；这些工具是开发期静态辅助，最终仍以 Gradle build 和游戏内测试为准。
- **不重写** DSH 的 tool-addition 历史；只使用公开的 `ctx.tools.register` / dispose，让 DSH 自己记录工具增删。
- **不修改**旧会话：旧会话没有本插件的 scoped 注册，也没有指引 section。
- **不联网**：mapping 搜索只读本地缓存；找不到 mapping 文件时明确返回提示，不猜测。
- **不执行任意 Gradle task**：只允许常见构建/运行任务；需要自定义任务时先改白名单，而不是把 shell 命令塞进工具。
- **不输出无限内容**：所有工具结果和 Gradle 输出都有字符上限；大日志只保留尾部关键段。
