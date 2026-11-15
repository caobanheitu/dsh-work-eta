# market/ 目录说明

本目录是「发布到社区市场 / 自建索引」所需的材料，不属于插件运行时文件
（`package.json` 的 `files` 未包含它，npm 包里不会带上）。

| 文件 | 用途 |
|---|---|
| `caobanheitu__dsh-work-eta.yml` | 提交到 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的 `data/plugins/` 收录条目。文件名必须等于 URL 的 slug。 |
| `PR-body.md` | 上面那个收录 PR 的正文，直接复制即可。 |
| `index.json` | 可选：自建 DSH「发现」索引源样例（`format: 1`）。把本文件与 `icon.svg` 放到任意静态 HTTPS 主机，然后在 插件 → 发现 → 添加索引源 填入 URL。纯 JSON，不能写注释；`publishTimestamp` 是占位值，正式发布后改成实际 Unix 秒；`source.type: npm` 需要先发过 npm 包，否则改用 git/tarball 来源。 |

DSH 官方不内置任何索引源；社区市场（dshmarket / awesome-dsh-plugin.com）
另从 awesome-dsh-plugin 仓库的 `data/plugins/*.yml` 生成自己的数据。
完整流程见根目录 [`PUBLISHING.md`](../PUBLISHING.md)。
