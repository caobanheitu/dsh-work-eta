# 发布与收录清单 · dsh-work-eta

包名 `dsh-work-eta`（npm 上已核实未被占用）；GitHub 目标仓库 `caobanheitu/dsh-work-eta`。
本机 DSH 版本 `0.2.2-rc.3`，`engines.dsh` 已按实测下界填写。

> 本机 `work-eta/` 是已安装的本地版（包名 `@local/work-eta`），**不要动它**；
> 本目录是独立的发布快照，包名 `dsh-work-eta`，`client.js` 的模块 id 与
> `cordis.patch.yml` 的行名都已同步。

发布分三件事：**① GitHub 仓库 → ② npm 包 → ③ 社区市场收录 PR**。
浏览器里登录 GitHub 只覆盖网页；命令行 `git push` 由 Git Credential Manager
在首次推送时弹浏览器授权，用已登录的账号确认即可，无需 gh CLI 或手动 token。

---

## 0. 本地已完成的准备（无需再做）

- [x] `package.json`：公开包名、`license`、`repository`/`homepage`/`bugs`、`keywords`、`engines.dsh`
- [x] `LICENSE`（MIT）、`README.md`、中英 `locale/*.json`、原创 `icon.svg`
- [x] `dsh.bundle.patch` + `dsh.client`，根目录 `cordis.patch.yml`
- [x] `test/verify.mjs` 回归测试（`node test/verify.mjs` → ALL CHECKS PASSED）
- [x] `market/caobanheitu__dsh-work-eta.yml` 收录条目
- [x] `market/index.json` 自建索引样例、`market/PR-body.md` PR 正文
- [x] `.gitignore`
- [x] 本目录已 `git init` 并做过首次提交（见下）

---

## 1. 建 GitHub 仓库并推送

先在 GitHub 网页建一个 **public**、**空**仓库（不要勾选初始化 README / .gitignore / license）：
<https://github.com/new> → Repository name: `dsh-work-eta` → Public → Create repository。

然后（PowerShell，工作目录为本发布目录）：

```powershell
cd C:\Users\FSM15\Documents\deepseek-harness\default-workspace\dsh-work-eta

# 若首次提交尚未建立，先做（本清单交付时已做好，可跳过）
git init -b main
git add -A
git commit -m "dsh-work-eta 1.0.0"

git remote add origin https://github.com/caobanheitu/dsh-work-eta.git
git push -u origin main
```

首次 `git push` 会弹出 Git Credential Manager 的浏览器授权窗口，用刚登录的
`caobanheitu` 账号确认即可。

**必须加 topic**（市场 CI 硬要求）：仓库页 → 右侧 About → 齿轮 → Topics 填 `dsh-plugin`，
或命令行（需 gh CLI，本机未装，走网页更省事）：

```sh
gh repo edit caobanheitu/dsh-work-eta --add-topic dsh-plugin
```

---

## 2. 发 npm 包（可选但不做也能上架；做了能显示下载量）

本机 PATH 里没有 npm，用 bundled Node + pnpm：

```powershell
$node = 'C:\Users\FSM15\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm = 'C:\Users\FSM15\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'

& $node $pnpm login          # 按提示在浏览器完成 npm 账号授权
& $node $pnpm publish --access public --no-git-checks
```

发布后验证：

```powershell
& $node $pnpm view dsh-work-eta version   # 应输出 1.0.0
```

注意：已发布包的 `repository` 必须指回被收录的仓库（已填好），否则两者不关联。
收录 YAML 里**不要**手写 `npm:` 字段，映射由列表 CI 自动采集。

不发 npm 的替代方案：把 `pnpm pack` 产出的 tgz 挂到 GitHub Release，并在条目里加
`tarball: https://github.com/caobanheitu/dsh-work-eta/releases/latest/download/dsh-work-eta.tgz`
（资产名不要带版本号）。

---

## 3. 提社区市场收录 PR

市场列表**不在市场仓库里**：`dshmarket` / `awesome-dsh-plugin.com` 实时拉取
[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
的 `data/plugins/*.yml`。所以「上架」= 给该仓库提一个只新增一个文件的 PR。

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin` 到 `caobanheitu` 名下。
2. 在 fork 的 `main` 上开分支，例如 `add-dsh-work-eta`。
3. 把 [`market/caobanheitu__dsh-work-eta.yml`](market/caobanheitu__dsh-work-eta.yml)
   原样放到 `data/plugins/caobanheitu__dsh-work-eta.yml`。
4. 用 [`market/PR-body.md`](market/PR-body.md) 作正文开 PR，标题 `Add dsh-work-eta`。

字段规范（依据上游 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）：

- 文件名必须等于 URL 的 slug：`owner__repo`（这里是 `caobanheitu__dsh-work-eta.yml`）
- `name` 必须是 `owner/repo`；`category` 取自固定集合（本条目 `workflow`）
- 只允许 `url` / `name` / `category` / `description` / `tarball` 这几个键
- `description.en` 必填且以句号结尾；含 `: ` 时必须加引号（已加）
- 一个 PR 最多 3 条；**不要手工改生成的 README**（`data/plugins/*.yml` 是唯一数据源）

**硬门槛**：CI 要求被收录仓库存在且**创建满 1 天**、带 `dsh-plugin` topic、
仓库 `package.json` 声明 `dsh.bundle`。所以第 3 步至少等第 1 步完成满 24 小时再做。
CI 还会用 `scripts/check-submission.mjs` 校验条目与代码描述是否一致，别夸大。

合并后站点自动重建，`plugins.json` 每日刷新，市场通常一天内出现；用户安装命令：

```
dsh plugin --profile desktop add github:caobanheitu/dsh-work-eta
```

---

## 4. 可选：自建 DSH「发现」索引源

DSH「插件 → 发现」不内置任何索引源，只读你自己添加的 `index.json`。
把 [`market/index.json`](market/index.json) 和 `icon.svg` 放到任意静态 HTTPS 主机
（GitHub Pages 即可），在「发现 → 添加索引源」填入该 URL，就能在发现页看到并安装。

> `index.json` 里的 `publishTimestamp` 是占位值（Unix 秒），正式发布后改成实际时间戳；
> `source.type: npm` 需要第 2 步真的发过 npm 包，否则改成 `git` 来源或改用 tarball。

---

## 5. 版本升级

1. 改 `package.json` 的 `version`、必要时调 `engines.dsh` 下界
2. `node test/verify.mjs` 全绿
3. `git commit -am "vX.Y.Z" && git push`
4. `pnpm publish --access public --no-git-checks`
5. 若自建索引，同步 `market/index.json` 的 `versions`；社区列表的 `npm` 版本由 CI 自动采集，无需改 YAML
