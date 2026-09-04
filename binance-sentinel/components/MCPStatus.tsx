"use client";

import { useEffect, useState } from "react";

type AgentStatus = { connected: boolean; mcp: "ready" | "starting" | "offline" };
type AuthStatus = { bound: boolean; authStatus: string; error?: string };

// 头部 MCP 状态灯 + 登录/登出按钮。
// 状态以币安 OAuth 绑定（/api/mcp/status）为主，agent 会话就绪（/api/agent/status）为辅：
// 未绑定 → 灰灯 + 登录；已绑定且跑通过 turn → 绿灯 MCP Online + 登出。
export default function MCPStatus() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState<"login" | "logout" | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d: AuthStatus = await fetch("/api/mcp/status").then((r) =>
          r.json()
        );
        if (alive) setAuth(d);
      } catch {
        // 保持旧状态，下一轮再试
      }
      try {
        const s: AgentStatus = await fetch("/api/agent/status").then((r) =>
          r.json()
        );
        if (alive) setAgent(s);
      } catch {
        // 保持旧状态
      }
    };
    poll();
    const t = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const bound = auth?.bound ?? null;

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 6000);
  };

  const doLogin = async () => {
    if (busy) return;
    setBusy("login");
    try {
      const r = await fetch("/api/mcp/login", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.authorizationUrl) {
        window.open(d.authorizationUrl, "_blank", "noopener");
        flash("已打开币安授权页，完成授权后状态自动刷新");
      } else {
        flash(`登录失败：${d.error ?? r.status}`);
      }
    } catch {
      flash("登录请求失败，请重试");
    } finally {
      setBusy(null);
    }
  };

  const doLogout = async () => {
    if (busy) return;
    if (
      !window.confirm(
        "确认登出币安账户授权？登出后行情/余额/交易工具将不可用，可随时重新登录。"
      )
    )
      return;
    setBusy("logout");
    try {
      const r = await fetch("/api/mcp/logout", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setAuth({ bound: false, authStatus: "loggedOut" });
        flash("已登出币安账户");
      } else {
        flash(`登出失败：${d.error ?? r.status}`);
      }
    } catch {
      flash("登出请求失败，请重试");
    } finally {
      setBusy(null);
    }
  };

  let dot: string;
  let label: string;
  let text: string;
  let title: string;
  if (bound === false) {
    dot = "bg-zinc-600";
    label = "MCP 未绑定";
    text = "text-zinc-500";
    title = "币安账户未授权，点击登录完成 OAuth 绑定";
  } else if (bound === true) {
    const st = agent?.mcp ?? "offline";
    if (st === "ready") {
      dot = "bg-green-400";
      label = "MCP Online";
      text = "text-green-400";
      title = "币安 MCP 已就绪（行情/余额/挂单/下单工具可用）";
    } else if (st === "starting") {
      dot = "bg-yellow-400";
      label = "MCP 连接中";
      text = "text-yellow-400";
      title = "币安 MCP 注册中，请稍候";
    } else {
      dot = "bg-zinc-400";
      label = "MCP 待命";
      text = "text-zinc-400";
      title = "账户已绑定，发一条消息点亮工具服务";
    }
  } else {
    dot = "bg-zinc-600";
    label = "MCP 检测中";
    text = "text-zinc-500";
    title = "正在检测币安 MCP 状态";
  }

  const pulse = bound === true && agent?.mcp !== "offline" && agent?.mcp !== undefined;

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="flex items-center gap-2" title={title}>
        <span className={`relative flex w-2 h-2 ${dot} rounded-full`}>
          {pulse && (
            <span
              className={`absolute inset-0 ${dot} rounded-full animate-ping opacity-40`}
            />
          )}
        </span>
        <span className={text}>{label}</span>
      </span>

      {bound === true && (
        <button
          onClick={doLogout}
          disabled={busy !== null}
          className="px-2.5 py-1 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-40"
        >
          {busy === "logout" ? "登出中…" : "登出"}
        </button>
      )}
      {bound === false && (
        <button
          onClick={doLogin}
          disabled={busy !== null}
          className="px-2.5 py-1 rounded-lg border border-[#00e5ff]/30 text-[#00e5ff] hover:bg-[#00e5ff]/10 transition-colors disabled:opacity-40"
        >
          {busy === "login" ? "登录中…" : "登录"}
        </button>
      )}

      {notice && (
        <span className="text-zinc-500 max-w-[280px] truncate">{notice}</span>
      )}
    </div>
  );
}
