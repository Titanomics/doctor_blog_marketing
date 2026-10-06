// 슬랙 메시지 전송. 둘 중 설정된 방식을 쓴다.
//   1) SLACK_WEBHOOK_URL                      — 인커밍 웹훅 (채널이 웹훅에 고정)
//   2) SLACK_BOT_TOKEN + SLACK_CHANNEL_ID     — 봇 토큰으로 chat.postMessage (chat:write 권한 필요)
// 아무것도 없으면 보내지 않고 { sent: false, reason: "not_configured" } 를 돌려준다.

export type SlackResult = { sent: true } | { sent: false; reason: string };

// 환경변수를 붙여 넣을 때 끝에 줄바꿈·공백이 딸려 오면 헤더 값으로 쓸 수 없어 전송이 실패한다. 항상 다듬어서 쓴다.
function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

// 봇 토큰. 값이 여러 번 붙여 넣어져 공백으로 이어진 경우(실제로 있었음)에는 토큰 모양(xoxb-/xoxp-)인 첫 조각을 쓴다.
function botToken(): string | undefined {
  const raw = env("SLACK_BOT_TOKEN");
  if (!raw) return undefined;
  if (!/\s/.test(raw)) return raw;
  return raw.split(/\s+/).find((piece) => /^xox[bp]-/.test(piece)) ?? raw;
}

// 설정 점검용. 값은 내보내지 않고 길이·형식만 알려준다.
//   token: "ok" | "missing" | "non_ascii" | "has_whitespace" | "unexpected_prefix"
export function slackConfigStatus(): { mode: "webhook" | "bot" | "none"; token: string; tokenLength: number; channel: string } {
  if (env("SLACK_WEBHOOK_URL")) return { mode: "webhook", token: "ok", tokenLength: 0, channel: "ok" };
  const token = botToken();
  const channel = env("SLACK_CHANNEL_ID");
  if (!token || !channel) return { mode: "none", token: token ? "ok" : "missing", tokenLength: token?.length ?? 0, channel: channel ? "ok" : "missing" };
  const tokenStatus = /[^!-~]/.test(token)
    ? /\s/.test(token)
      ? "has_whitespace"
      : "non_ascii"
    : /^xox[bp]-/.test(token)
      ? "ok"
      : "unexpected_prefix";
  return { mode: "bot", token: tokenStatus, tokenLength: token.length, channel: /^[A-Z0-9]+$/.test(channel) ? "ok" : "unexpected_format" };
}

export function slackConfigured(): boolean {
  return !!env("SLACK_WEBHOOK_URL") || !!(botToken() && env("SLACK_CHANNEL_ID"));
}

export async function sendSlack(text: string): Promise<SlackResult> {
  try {
    const webhook = env("SLACK_WEBHOOK_URL");
    if (webhook) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10000),
      });
      // 성공하면 200 + 본문 "ok"
      if (res.ok) return { sent: true };
      return { sent: false, reason: `webhook ${res.status}: ${(await res.text()).slice(0, 100)}` };
    }

    const token = botToken();
    const channel = env("SLACK_CHANNEL_ID");
    if (token && channel) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel, text }),
        signal: AbortSignal.timeout(10000),
      });
      // 이 API는 실패해도 HTTP 200을 주고 본문의 ok 로 성공 여부를 알린다
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (data?.ok) return { sent: true };
      return { sent: false, reason: `chat.postMessage: ${data?.error ?? `HTTP ${res.status}`}` };
    }

    return { sent: false, reason: "not_configured" };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
