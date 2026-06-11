// 桿弟 agent — Supabase Edge Function
// 前端傳 { messages: [{role, content}] }，本函式跑 Claude 工具迴圈後回 { reply }
// 環境變數：ANTHROPIC_API_KEY（自行設定）；SUPABASE_URL / SUPABASE_ANON_KEY（平台自動注入）

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SYSTEM_PROMPT, PLAYBOOK_SEEDS } from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTIVE_STAGES = ["初步聯繫", "財務＆保單分析", "說明與口頭", "建議書"];
const STAGNANT_DAYS = 7;
const MAX_TOOL_ITERATIONS = 8;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_week_plan",
    description:
      "取得使用者某一週的週計畫：角色目標與完成狀況、每日重要事項與完成狀況。不帶參數時回傳本週。",
    input_schema: {
      type: "object",
      properties: {
        week_start: {
          type: "string",
          description: "週起始日（週日），格式 YYYY-MM-DD。省略則為本週。",
        },
      },
    },
  },
  {
    name: "get_crm_overview",
    description:
      "取得 CRM pipeline 總覽：各階段客戶數、停滯客戶清單（活躍階段超過 7 天未聯絡）、逾期追蹤清單、pipeline 廣度（近 7 天有動的活躍客戶數）。",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_account",
    description: "用姓名查單一客戶：基本資料、進行中商品、最近 10 筆拜訪紀錄。",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "客戶姓名（可部分比對）" },
      },
      required: ["name"],
    },
  },
  {
    name: "search_accounts",
    description:
      "條件搜尋客戶，回傳精簡清單（最多 100 筆，回傳會標明總數）。keyword 同時比對客戶主檔（姓名、職業、類別、地區、保單、背景、備註、下一步）與拜訪紀錄（摘要、結果）；stage 篩目前階段；idle_days 篩最後聯絡距今達 N 天以上（從未聯絡也算）。條件可組合，至少給一個。",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "關鍵字（部分比對）" },
        stage: {
          type: "string",
          enum: [
            "尚未聯絡",
            "初步聯繫",
            "財務＆保單分析",
            "說明與口頭",
            "建議書",
            "成交",
            "轉介紹",
            "保服",
            "理賠",
            "暫緩",
          ],
        },
        idle_days: { type: "number", description: "最後聯絡距今 ≥ 此天數" },
      },
    },
  },
  {
    name: "read_playbook",
    description:
      "讀取 playbook 全文。談到話術設計、企業主傳承退休、反對問題、團隊輔導時，先讀對應的 playbook 再回答。",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: ["對話技巧", "企業主傳承與退休", "反對問題拆解", "團隊輔導"],
        },
      },
      required: ["name"],
    },
  },
  {
    name: "append_playbook",
    description:
      "把對話中拆解出的新結論追加到 playbook 末尾。寫入前必須先向使用者提議並取得同意。",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: ["對話技巧", "企業主傳承與退休", "反對問題拆解", "團隊輔導"],
        },
        content: { type: "string", description: "要追加的 markdown 內容" },
      },
      required: ["name", "content"],
    },
  },
];

function taipeiNow(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function taipeiToday(): string {
  return toDateString(taipeiNow());
}

function currentWeekStart(): string {
  const now = taipeiNow();
  now.setUTCDate(now.getUTCDate() - now.getUTCDay());
  return toDateString(now);
}

function daysSince(dateString: string | null): number | null {
  if (!dateString) return null;
  const from = new Date(`${dateString}T00:00:00Z`).getTime();
  const to = new Date(`${taipeiToday()}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

// deno-lint-ignore no-explicit-any
function condenseWeekPlan(plan: any, weekStart: string) {
  const roles = (plan.roles || [])
    .map((role: { roles?: string[]; goals?: string[]; goalDone?: boolean[] }) => ({
      role: (role.roles || []).filter(Boolean).join("／"),
      goals: (role.goals || [])
        .map((text: string, index: number) => ({
          text,
          done: Boolean(role.goalDone?.[index]),
        }))
        .filter((goal: { text: string }) => goal.text),
    }))
    .filter((role: { goals: unknown[] }) => role.goals.length > 0);

  const important = (plan.important || [])
    .map((items: Array<{ text?: string; done?: boolean }>, dayIndex: number) => ({
      day: `週${DAY_NAMES[dayIndex] ?? dayIndex}`,
      items: (items || [])
        .filter((item) => item?.text)
        .map((item) => ({ text: item.text, done: Boolean(item.done) })),
    }))
    .filter((day: { items: unknown[] }) => day.items.length > 0);

  return { week_start: weekStart, roles, important };
}

// deno-lint-ignore no-explicit-any
async function runTool(supabase: any, userId: string, name: string, input: any): Promise<string> {
  if (name === "get_week_plan") {
    const weekStart = input?.week_start || currentWeekStart();
    const { data, error } = await supabase
      .from("weekly_plans")
      .select("plan, updated_at")
      .eq("week_start", weekStart)
      .maybeSingle();
    if (error) return `查詢失敗：${error.message}`;
    if (!data) return `找不到 ${weekStart} 那一週的計畫（可能還沒建立或尚未同步雲端）。`;
    return JSON.stringify(condenseWeekPlan(data.plan, weekStart));
  }

  if (name === "get_crm_overview") {
    const { data, error } = await supabase
      .from("crm_accounts")
      .select("name, current_stage, last_contact_date, next_follow_up_date, next_step")
      .is("archived_at", null);
    if (error) return `查詢失敗：${error.message}`;

    const today = taipeiToday();
    const stageCounts: Record<string, number> = {};
    const stagnant: unknown[] = [];
    const overdue: unknown[] = [];
    let activeMoving = 0;

    for (const account of data || []) {
      stageCounts[account.current_stage] = (stageCounts[account.current_stage] || 0) + 1;
      const idle = daysSince(account.last_contact_date);
      if (ACTIVE_STAGES.includes(account.current_stage)) {
        if (idle === null || idle >= STAGNANT_DAYS) {
          stagnant.push({
            name: account.name,
            stage: account.current_stage,
            days_since_contact: idle,
            next_step: account.next_step || null,
          });
        } else {
          activeMoving += 1;
        }
      }
      if (account.next_follow_up_date && account.next_follow_up_date <= today) {
        overdue.push({
          name: account.name,
          stage: account.current_stage,
          follow_up_date: account.next_follow_up_date,
          next_step: account.next_step || null,
        });
      }
    }

    return JSON.stringify({
      today,
      stage_counts: stageCounts,
      pipeline_breadth: activeMoving,
      stagnant_accounts: stagnant,
      overdue_follow_ups: overdue,
    });
  }

  if (name === "search_accounts") {
    const keyword = typeof input?.keyword === "string" ? input.keyword.trim() : "";
    const stage = typeof input?.stage === "string" ? input.stage : "";
    const idleDays = typeof input?.idle_days === "number" ? input.idle_days : null;
    if (!keyword && !stage && idleDays === null) {
      return "請至少提供一個搜尋條件（keyword / stage / idle_days）。";
    }

    const { data: accounts, error } = await supabase
      .from("crm_accounts")
      .select(
        "id, name, current_stage, occupation, category, location, policies, background, notes, next_step, last_contact_date"
      )
      .is("archived_at", null);
    if (error) return `查詢失敗：${error.message}`;

    // 拜訪紀錄的摘要／結果也納入關鍵字比對，命中的客戶帶回片段
    const visitHitsByAccount = new Map<string, unknown[]>();
    if (keyword) {
      const pattern = `%${keyword.replace(/[,()%]/g, "")}%`;
      const { data: visits, error: visitError } = await supabase
        .from("crm_visit_records")
        .select("account_id, contact_date, summary, result")
        .or(`summary.ilike.${pattern},result.ilike.${pattern}`)
        .order("contact_date", { ascending: false })
        .limit(40);
      if (visitError) return `查詢失敗：${visitError.message}`;
      for (const visit of visits || []) {
        const hits = visitHitsByAccount.get(visit.account_id) || [];
        if (hits.length < 3) {
          hits.push({
            contact_date: visit.contact_date,
            summary: visit.summary,
            result: visit.result,
          });
        }
        visitHitsByAccount.set(visit.account_id, hits);
      }
    }

    const textFields = [
      "name",
      "occupation",
      "category",
      "location",
      "policies",
      "background",
      "notes",
      "next_step",
    ];
    const lowerKeyword = keyword.toLowerCase();
    const results: unknown[] = [];
    for (const account of accounts || []) {
      if (stage && account.current_stage !== stage) continue;
      const idle = daysSince(account.last_contact_date);
      if (idleDays !== null && idle !== null && idle < idleDays) continue;
      const visitHits = visitHitsByAccount.get(account.id) || [];
      if (keyword) {
        const fieldHit = textFields.some((field) =>
          String(account[field] || "").toLowerCase().includes(lowerKeyword)
        );
        if (!fieldHit && !visitHits.length) continue;
      }
      results.push({
        name: account.name,
        stage: account.current_stage,
        occupation: account.occupation || null,
        location: account.location || null,
        last_contact_date: account.last_contact_date,
        days_since_contact: idle,
        next_step: account.next_step || null,
        ...(visitHits.length ? { matched_visits: visitHits } : {}),
      });
    }

    if (!results.length) return "沒有符合條件的客戶。";
    return JSON.stringify({ total: results.length, accounts: results.slice(0, 100) });
  }

  if (name === "get_account") {
    const { data: accounts, error } = await supabase
      .from("crm_accounts")
      .select(
        "id, name, current_stage, location, category, occupation, pretax_income, policies, policy_status, background, next_step, next_follow_up_date, notes, last_contact_date"
      )
      .ilike("name", `%${input.name}%`)
      .is("archived_at", null)
      .limit(5);
    if (error) return `查詢失敗：${error.message}`;
    if (!accounts?.length) return `找不到名字含「${input.name}」的客戶。`;
    if (accounts.length > 1) {
      return JSON.stringify({
        note: "找到多位，以下為摘要；要看完整資料請用全名再查一次。",
        matches: accounts.map((a: Record<string, unknown>) => ({
          name: a.name,
          stage: a.current_stage,
          occupation: a.occupation || null,
          location: a.location || null,
          last_contact_date: a.last_contact_date,
          next_step: a.next_step || null,
        })),
      });
    }

    const account = accounts[0];
    const [{ data: products }, { data: visits }] = await Promise.all([
      supabase
        .from("crm_account_products")
        .select("product_type, note")
        .eq("account_id", account.id),
      supabase
        .from("crm_visit_records")
        .select("contact_date, method, summary, result, next_step, stage_after")
        .eq("account_id", account.id)
        .order("contact_date", { ascending: false })
        .limit(10),
    ]);

    const { id: _id, ...accountFields } = account;
    return JSON.stringify({
      account: accountFields,
      products: products || [],
      recent_visits: visits || [],
    });
  }

  if (name === "read_playbook") {
    const { data, error } = await supabase
      .from("caddie_playbooks")
      .select("content")
      .eq("name", input.name)
      .maybeSingle();
    if (error) return `讀取失敗：${error.message}`;
    if (data) return data.content;

    const seed = PLAYBOOK_SEEDS[input.name];
    if (!seed) return `沒有名為「${input.name}」的 playbook。`;
    await supabase
      .from("caddie_playbooks")
      .insert({ user_id: userId, name: input.name, content: seed });
    return seed;
  }

  if (name === "append_playbook") {
    const { data } = await supabase
      .from("caddie_playbooks")
      .select("content")
      .eq("name", input.name)
      .maybeSingle();
    const base = data?.content ?? PLAYBOOK_SEEDS[input.name];
    if (base === undefined) return `沒有名為「${input.name}」的 playbook。`;
    const updated = `${base}\n\n---\n\n### 補充（${taipeiToday()}）\n\n${input.content}`;
    const { error } = await supabase
      .from("caddie_playbooks")
      .upsert(
        { user_id: userId, name: input.name, content: updated, updated_at: new Date().toISOString() },
        { onConflict: "user_id,name" }
      );
    if (error) return `寫入失敗：${error.message}`;
    return `已寫入 playbook「${input.name}」。`;
  }

  return `未知的工具：${name}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "未登入" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const history = Array.isArray(body?.messages) ? body.messages.slice(-30) : [];
    if (!history.length) {
      return new Response(JSON.stringify({ error: "messages 不可為空" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const messages: Anthropic.MessageParam[] = history.map(
      (message: { role: string; content: string }) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: String(message.content),
      })
    );

    const usedTools: string[] = [];
    let response: Anthropic.Message | null = null;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      response = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason !== "tool_use") break;

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        usedTools.push(block.name);
        let result: string;
        try {
          result = await runTool(supabase, userId, block.name, block.input);
        } catch (toolError) {
          result = `工具執行錯誤：${(toolError as Error).message}`;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    const reply = (response?.content || [])
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return new Response(
      JSON.stringify({ reply: reply || "（沒有產生回覆，請再試一次）", tools_used: usedTools }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
