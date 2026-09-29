# 留言后端部署（丙方案：轻量后端 + 实时可见）

目标：任意访客在页面上留言后，**所有访问者刷新即可看到**；路飞每小时读取这些留言，整理后经 Tommy 确认再更新网页内容。

技术选型：Cloudflare Worker + Workers KV（免费额度 10 万请求/天，本项目远远用不到；不需要服务器、不需要域名）。

## 两种部署方式（二选一）

### 方式一：把代码交给路飞部署（需要 API Token）

1. 注册/登录 Cloudflare（免费）：https://dash.cloudflare.com/sign-up
2. 创建 API Token：My Profile → API Tokens → Create Token → 使用模板 **Edit Cloudflare Workers**
   - 权限：Account · Workers KV Storage · Edit；Account · Workers Scripts · Edit
3. 把 Token 交给路飞（或自己在电脑上执行 `npx wrangler login` 走浏览器授权，也可以）
4. 路飞执行：
   ```
   npx wrangler kv namespace create COMMENTS     # 取得命名空间 id
   # 把 id 填入 wrangler.toml
   npx wrangler deploy                            # 得到 https://zj-roadtrip-comments.<account>.workers.dev
   ```
5. 把 worker 地址填回 `data.js` 的 `commentApi` 字段，提交后页面自动切换为“实时模式”。

### 方式二：自己在 Cloudflare 控制台粘贴（不需要交出 Token）

1. 登录 Cloudflare → Workers & Pages → Create → Worker（名字 `zj-roadtrip-comments`）
2. 把 `worker.js` 的内容整段粘贴进在线编辑器，Deploy
3. 该 Worker → Settings → Variables → KV Namespace Bindings → 新建绑定：变量名 `COMMENTS`，新建一个 KV 命名空间
4. （可选）Settings → Variables → 添加变量 `ADMIN_TOKEN` = 你自定的一串口令，用于标记“已整理/已并入页面”
5. 复制 Worker 的访问地址，告诉路飞填入 `data.js`

## 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/comments` | 读取全部留言 |
| POST | `/comment` | 提交留言 `{name,type,text}` |
| POST | `/moderate` | 标记留言状态 `{id,status,token}`（需 ADMIN_TOKEN） |
| POST | `/delete` | 删除留言 `{id,token}`（需 ADMIN_TOKEN） |

## 防护措施（已内置）

- 跨域白名单：只有本站（GitHub Pages 域名 + 本机预览）可调用
- 长度限制：内容 500 字、署名 24 字、类型 20 字
- 频率限制：同一 IP 每小时最多 20 条
- 上限：只保留最近 500 条
- 无敏感信息：页面不含任何密钥；管理操作需口令

## 路飞的每小时整理流程（部署后启用）

1. 定时任务读取 `GET /comments`，过滤出未整理（`status` 为空）的留言
2. 归并同类需求、识别可执行项与信息纠错
3. 生成“待确认更新清单”推送给 Tommy
4. Tommy 确认后：更新 `data.js`（方案数据/住宿/工具/seedComments）→ 提交推送 → 用 `/moderate` 标记这些留言状态为“已并入页面”
