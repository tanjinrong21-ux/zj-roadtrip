/**
 * 湛江自驾路线站 · 留言后端（Cloudflare Worker + KV）
 *
 * 接口
 *   GET  /comments                      → {comments:[{id,name,type,text,time,status}]}
 *   POST /comment  {name,type,text}     → 追加一条留言，返回 {ok:true,id}
 *   POST /moderate {id,status,token}    → 标记为“已整理/已并入页面”（需整理口令）
 *   POST /delete   {id,token}           → 删除（需整理口令）
 *
 * 绑定：KV 命名空间 COMMENTS
 * 变量：ADMIN_TOKEN（整理口令，可选；不设则 /moderate 与 /delete 关闭）
 * 说明：只允许白名单来源跨域访问；写入做长度与频率限制；无需任何账号即可被访客使用。
 */

const ALLOW_ORIGINS = [
  "https://tanjinrong21-ux.github.io",
  "http://127.0.0.1:8931",
  "http://localhost:8931"
];
const MAX_TEXT = 500;
const MAX_NAME = 24;
const MAX_TYPE = 20;
const MAX_ITEMS = 500;          // 保留最近 500 条
const RATE_LIMIT_PER_HOUR = 20; // 同一 IP 每小时最多 20 条

function cors(origin) {
  const allow = ALLOW_ORIGINS.indexOf(origin) >= 0 ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store"
  };
}
function json(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, cors(origin))
  });
}
function clean(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}
function now() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function loadAll(env) {
  const raw = await env.COMMENTS.get("comments");
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
async function saveAll(env, list) {
  await env.COMMENTS.put("comments", JSON.stringify(list.slice(-MAX_ITEMS)));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    if (request.method === "GET" && path === "/comments") {
      return json({ comments: await loadAll(env) }, origin);
    }

    if (request.method === "POST" && path === "/comment") {
      let body;
      try { body = await request.json(); } catch (e) { return json({ ok: false, error: "请求格式错误" }, origin, 400); }
      const text = clean(body.text, MAX_TEXT);
      if (!text) return json({ ok: false, error: "留言内容不能为空" }, origin, 400);

      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = `rl:${ip}`;
      const used = parseInt((await env.COMMENTS.get(rlKey)) || "0", 10);
      if (used >= RATE_LIMIT_PER_HOUR) return json({ ok: false, error: "提交过于频繁，请稍后再试" }, origin, 429);
      await env.COMMENTS.put(rlKey, String(used + 1), { expirationTtl: 3600 });

      const list = await loadAll(env);
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: clean(body.name, MAX_NAME) || "匿名游客",
        type: clean(body.type, MAX_TYPE) || "其他",
        text,
        time: now(),
        status: ""
      };
      list.push(item);
      await saveAll(env, list);
      return json({ ok: true, id: item.id }, origin);
    }

    if (request.method === "POST" && (path === "/moderate" || path === "/delete")) {
      const admin = env.ADMIN_TOKEN;
      if (!admin) return json({ ok: false, error: "未配置整理口令" }, origin, 403);
      let body;
      try { body = await request.json(); } catch (e) { return json({ ok: false, error: "请求格式错误" }, origin, 400); }
      if (body.token !== admin) return json({ ok: false, error: "口令错误" }, origin, 403);
      let list = await loadAll(env);
      if (path === "/moderate") {
        list = list.map(c => (c.id === body.id ? Object.assign({}, c, { status: clean(body.status, 40) }) : c));
      } else {
        list = list.filter(c => c.id !== body.id);
      }
      await saveAll(env, list);
      return json({ ok: true }, origin);
    }

    return json({ ok: false, error: "未知接口", routes: ["GET /comments", "POST /comment", "POST /moderate", "POST /delete"] }, origin, 404);
  }
};
