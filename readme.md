QNotes 云协作笔记
=================

QNotes 是一个基于 Web 的云协作笔记应用，内置 Editor.js 所见即所得编辑器，支持多人账号登录、笔记层级管理以及编辑互斥锁，确保同一时间只有一位用户可以编辑同一篇笔记，其余用户仍可实时查看内容。

主要特性
--------

* 👥 账号系统：支持注册、登录与退出，密码采用 `bcrypt` 哈希存储。
* 🗂️ 层级目录：左侧展示树状笔记列表，可在当前笔记下快速创建子笔记。
* 📝 Editor.js：右侧使用 Editor.js 作为富文本编辑器，支持标题、段落、列表等常见块。
* 🔒 编辑锁：同一篇笔记只允许一人编辑，其他人进入时将看到锁定提示；编辑锁会定期续期并在保存或退出后自动释放。
* 💾 SQLite 存储：使用 `better-sqlite3` 作为嵌入式数据库，便于部署与备份。

快速开始
--------

1. 安装依赖

   ```bash
   npm install
   ```

2. 启动服务

   ```bash
   npm start
   ```

3. 浏览器访问 `http://localhost:3000`，注册账号后即可开始使用。

环境变量
--------

| 变量名                | 说明                               | 默认值                 |
| --------------------- | ---------------------------------- | ---------------------- |
| `PORT`                | Express 服务监听端口               | `3000`                 |
| `JWT_SECRET`          | 用于签发与校验 JWT 的密钥          | `super-secret-qnotes-key` |
| `DB_FILE`             | SQLite 数据库文件路径              | `./data/qnotes.db`     |
| `LOCK_DURATION_SECONDS` | 编辑锁默认持续时间（秒）          | `300`                  |

前端构建位于 `public/` 目录，后端 API 由 `src/server.js` 提供，可根据需要扩展权限体系、共享逻辑或实时同步等能力。

Windows 安装说明（Node 22 + better-sqlite3）
-----------------------------------------

在 Windows 上使用 Node 22 运行本项目时，`better-sqlite3` 可能出现原生绑定加载失败或需要从源码编译的情况（例如报错“Could not locate the bindings file”或 `node-gyp` 提示缺少 Visual Studio）。按以下步骤配置即可：

1. 安装 Visual Studio 2022 Build Tools（含 C++ 工作负载）

   - 使用 PowerShell（管理员）一键安装：

   ```powershell
   winget install --id Microsoft.VisualStudio.2022.BuildTools --source winget --silent --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart"
   ```

   - 如需手动安装，请前往微软官网下载安装“Build Tools for Visual Studio 2022”，并勾选“Desktop development with C++”工作负载。

2. 重新安装 `better-sqlite3`

   - 先尝试直接安装最新版（可能获取到 Node 22 的预编译二进制）：

   ```powershell
   npm i better-sqlite3@latest
   ```

   - 若出现网络超时或仍需从源码构建，可强制本地编译（当前 PowerShell 会话有效）：

   ```powershell
   $env:npm_config_msvs_version = '2022'
   $env:npm_config_build_from_source = 'true'
   # 如有占用和残留，先清理
   Stop-Process -Name node -Force -ErrorAction SilentlyContinue
   Remove-Item -Recurse -Force node_modules\better-sqlite3 -ErrorAction SilentlyContinue
   npm i better-sqlite3@latest
   ```

3. 启动服务

   ```powershell
   npm start
   ```

故障排查提示
------------

- 若看到 `prebuild-install warn install Request timed out`：可能是下载预编译二进制超时，按上面“强制本地编译”步骤处理。
- 若 `node-gyp` 提示 “Could not find any Visual Studio installation to use”：确认已安装 VS 2022 Build Tools 且包含 C++ 工作负载，并设置了 `npm_config_msvs_version=2022`（在 PowerShell 会话里设置即可）。
- 若遇到 `EPERM` 删除失败：确保没有正在运行的 `node` 进程，使用 `Stop-Process -Name node -Force` 后再删除模块目录。