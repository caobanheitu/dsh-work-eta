Add dsh-work-eta

## 插件简介

`dsh-work-eta` 在输入框下方实时显示「本回合还要多久」，只在回合运行时出现、结束即消失。

- 有 todo 计划时：按本会话实测的每项耗时给整份计划定价，并随计划已用时间**连续倒计时**（工具调用不会冻结或重启读数）。
- 无计划时：用本会话已完成回合的平均时长；两者都没有时只显示已用时间，不编数字。
- 假设态带「估 / est.」标记，超出预估时如实说明；进度条与剩余时间同源。
- 架构：Host 侧 `sessionProjections` 纯函数折叠 + Client 侧 `conversation.composer.dock` 槽位；宿主机无定时器、无额外模型请求、零运行时依赖、无构建步骤。

## 自检

- [x] 根目录 `package.json` 声明 `dsh.bundle.patch` 与 `dsh.client`，`cordis.patch.yml` 就位
- [x] 中英双语 `meta.title` / `meta.description`、原创 SVG 图标
- [x] `LICENSE`（MIT）、`README.md`、`test/verify.mjs` 回归测试（合成时序 + 真实会话日志回放，全部通过）
- [x] `engines.dsh` 写实测下界 `>=0.2.2-rc.3 <0.3.0-0`（本机 DSH 版本）
- [x] repository / homepage / bugs 指回本仓库，npm 包名 `dsh-work-eta` 已核实未被占用
- [x] 分类 `workflow`：本插件按 todo 计划与回合耗时做进度预测，属于工作流辅助

## 条目文件

`data/plugins/caobanheitu__dsh-work-eta.yml`（本 PR 唯一新增文件；未改动生成的 README）

安装命令（收录后）：

```
dsh plugin --profile desktop add github:caobanheitu/dsh-work-eta
```
