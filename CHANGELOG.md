# 变更记录

## 0.7.0

复审修复（外部评审 + 内部复审）：

- **不再猜测 pack_format**。版本表覆盖 1.7.10 – 1.21.4；比表新的版本标记为 `known=false` 并附 `versionRange`，只有核实过真值的版本（1.21.5 = 55/71、1.21.6 = 63/80、1.21.7–1.21.8 = 64/81）才给出数字，其余版本 `mcdev_project action=init` 直接拒绝生成 `pack.mcmeta`。
- **校验器不再用猜测值对账**：未知版本时跳过 `pack_format` 检查，正确文件不会再被判错。
- **`projectDir` 越界需授权**：会话工作目录及其上下级始终可用，其他绝对路径必须写进 `trustedRoots`，报错会给出可直接复制的配置片段；此前任意绝对路径都会执行该目录下的 `gradlew`。
- **启动游戏的任务默认拒绝**：`runClient`/`runServer`/`runGameTestServer` 等需要 `allowClientRuns: true`，运行时不再加 `--no-daemon`，超时被杀时明确说明输出是超时前的快照。
- **报告实际 Java**：`mcdev_build` 输出 `java` 字段与 `warnings`，JDK 版本低于项目要求时给出可读提示。
- 旧会话历史里仍引用控制工具时，日志会说明为什么没有注册工具。
- 测试 68 个通过。

## 0.6.0

- 新增配置 `includeExistingSessions`，可显式让已恢复的旧会话也获得控制工具与指引（默认关闭）。
- 所有工程工具支持可选 `projectDir`。

## 0.5.0

- 新增 `mcdev_jar`：inspect / list / read / class / disassemble，只读，不执行、不解包。

## 0.4.0

- `mcdev_project action=init` 可生成最小 Fabric 工程，含路径与覆盖保护。
- 工程发现支持会话工作目录下的子目录工程。
- `mcdev_build` 默认任务为 `build`。
