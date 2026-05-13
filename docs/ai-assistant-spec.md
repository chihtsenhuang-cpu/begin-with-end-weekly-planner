# AI 助理需求草稿

> 狀態：討論中草稿，尚未進入實作。
> 用途：把 AI 助理的方向定下來，再決定動哪些程式。

## 1. 目標

在週計畫 App 裡加一個 AI 助理，鎖定兩個用途：

1. **提醒型**：日常被動回答「我還有哪些事沒處理」「這週要追誰」這類查詢，並支援「今日簡報」這種主動推播。
2. **桿弟型**：在業務流程中扮演教練／桿弟的角色，提醒使用者沒注意到的事，給策略性建議。

兩個用途共用兩套知識基礎：

- **使用者層知識**（第 3 節）：方法論、業務畫像、教練筆記。讓 AI 懂這位使用者。
- **客戶層工作記憶**（第 4 節）：每個客戶各自一份 confirmed_facts／open_questions／last_recommended_actions。讓 AI 懂某一位客戶當下的狀態。

## 2. 兩個用途的範圍

### 2.1 提醒型（含今日簡報）

特性：低風險、高頻率、規則為主，AI 主要負責自然語言入口。

可回答的問題類型：

- 過期未跟進的客戶（`nextFollowUp` 已過今天）
- 停在某階段太久的客戶（例如初步聯繫 > 30 天）
- 最近 N 天沒互動的成交客戶（保服風險）
- 本週行程空缺、本週尚未完成的「今日要事」
- 自然語言查詢：「上半年成交客戶平均見面幾次」這類資料統計

實作原則：

- AI 不直接讀客戶資料，由 LangGraph 後端提供「資料查詢函式」清單（tools），AI 只負責把問題翻譯成函式呼叫＋整理輸出，避免幻覺。
- 今日簡報 = 提醒型查詢的固定組合（每天早上自動跑一次）。

### 2.2 桿弟型

特性：主動性高、需要使用者脈絡、容錯空間大。

三個觀察維度：

1. **客戶層**：「這個客戶見了 5 次還停在說明階段，比你其他成交客戶平均 2.3 次多，可能的卡點？」
2. **使用者自身層**：「最近 4 週都集中在新客初步聯繫，建議書階段沒推進，是不是該收一收？」
3. **賽前簡報**：在行程開始前自動整理該客戶的歷史脈絡、上次承諾事項、可能的話題。

實作原則：

- 主動性分級：被動回答 → 每日簡報 → 行程前主動跳提醒。一開始只做前兩級。
- 桿弟允許「逆耳建議」，需要在 system prompt 設定 tone：誠實＞客套。

## 3. 三層知識架構

讓 AI 從「通用版」變成「懂這位使用者」，需要三層知識：

### 3.1 方法論文件（人工撰寫，最後做）

- 檔案：`docs/業務方法論.md`（暫定路徑）
- 內容：階段判準、紅旗訊號、禁忌、典型成交路徑、時間配置原則
- 用途：每次 AI 回答前注入 system prompt
- 關鍵：要「很你」，不是抄業界範本

### 3.2 業務畫像（AI 自動產生，先做）

定義：從 CRM 歷史資料自動算出來的統計檔，讓 AI 知道「你的正常長怎樣」。沒有這個基準，AI 沒辦法判斷什麼叫異常。

- 檔案：`業務畫像.json`（每週重算）
- 來源：CRM 歷史資料
- 用途：AI 每次回答時當 context 帶入，作為判斷「異常」的基準

內容範例：

```json
{
  "更新日": "2026-05-13",
  "資料範圍": "近 12 個月",
  "成交客戶平均見面次數": 3.2,
  "成交客戶平均週期天數": 47,
  "各階段停留中位數天數": {
    "初步聯繫": 12,
    "財務&保單分析": 18,
    "說明與口頭": 9,
    "建議書": 14
  },
  "各階段流失率": {
    "初步聯繫→財務&保單分析": "32%",
    "財務&保單分析→說明與口頭": "21%",
    "說明與口頭→建議書": "45%"
  },
  "成交率最高客戶分類": "原有客戶轉介",
  "你慣用的拜訪方式": { "面訪": "58%", "LINE": "22%", "電話": "20%" },
  "你的整體初步聯繫→成交轉換率": "18%"
}
```

有這份檔，AI 才能說「A 客戶見了 5 次還沒推進，比你成交基準的 3.2 次多」這種有對照、有根據的話。

### 3.3 教練筆記（互動累積，中期做）

- 資料表：Supabase 新增 `ai_coach_notes`
- 來源：
  - 使用者對 AI 建議的反饋（採納／否決＋理由）
  - 使用者主動下指令：「以後遇到 X 情況請提醒我 Y」
- 用途：每次 AI 回答時帶入最近 N 條筆記
- **注意**：這層需要自己設計儲存與檢索，不能直接抄 labor-consultant-v3 的 case_memory。case_memory 是「每輪重生」的單案件工作記憶，會把舊事實覆寫掉；教練筆記必須是「append-only 累積」的長期素材，邏輯相反。

## 4. 客戶層工作記憶（per-client memory）

這層概念直接對應 labor-consultant-v3 的 `case_memory`，只是把「個案」換成「客戶」。

### 4.1 結構

每位客戶各自一份 memory，三個欄位：

- `confirmed_facts`：這個客戶已確認的事（家庭、收入、保單、心理素質、上次承諾事項）
- `open_questions`：還沒問到、會影響判斷的事（預算上限？決策權在誰？配偶是否參與？）
- `last_recommended_actions`：上一輪 AI 建議你對這客戶做什麼

### 4.2 資料表設計

新開一張 `crm_account_memory`，與 `crm_accounts` 1:1：

```sql
create table crm_account_memory (
  account_id uuid primary key references crm_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  confirmed_facts jsonb not null default '[]',
  open_questions jsonb not null default '[]',
  last_recommended_actions jsonb not null default '[]',
  generated_at timestamptz,
  generator_version text,
  updated_at timestamptz default now()
);

alter table crm_account_memory enable row level security;
create policy "own memory" on crm_account_memory
  for all using (auth.uid() = user_id);
```

選擇獨立表（而非加欄位到 `crm_accounts`）的理由：

- 人工輸入的客戶資料與 AI 生成的工作記憶分開
- schema 改版不動主檔
- 可以乾淨地「全砍重練」AI 記憶而不影響 CRM 資料

### 4.3 重生時機（lazy 模式）

不要每件事都重生，成本會爆。建議：

| 時機 | 行為 |
|---|---|
| 新增拜訪紀錄 | 標記 memory 為 stale，不立刻重生 |
| 點開該客戶賽前簡報 | 檢查 stale → 是就重生（同步） |
| 按「刷新記憶」按鈕 | 強制重生 |
| 每週業務畫像更新 | 批次重生最近 30 天有互動的客戶 |

客戶數很多時可加門檻：超過 14 天沒互動的客戶不主動重生。

### 4.4 Clarification 流程

可原封不動套用 labor-consultant-v3 的 prepare/complete 兩段式：

1. 重生後若 `open_questions` 非空 → 前端跳 modal 列出問題
2. 使用者選擇答／略過 → 答案併入下一輪重生
3. 新 memory 把答完的事升級到 `confirmed_facts`、消化掉已解的 `open_questions`

詳細流程參考 labor-consultant-v3 的 `CASE_MEMORY_CLARIFICATION_FLOW.md`。

### 4.5 成本估算

每次重生 ≈ 1 次 Haiku 呼叫，輸入約 3K tokens ≈ $0.003。
50 個活躍客戶 × 每週每人 2 次 ≈ 月支 $1.2。可忽略。

## 5. 分階段順序

### Phase 1：業務畫像（純資料分析）

- 不需要使用者輸入文字
- 跑一次就能看到「自己的業務樣貌」
- 也是後面所有功能的基準

### Phase 2：提醒型 ＋ 今日簡報 ＋ 賽前簡報 ＋ 客戶記憶 ＋ 筆記累積

- 上線可用的 MVP
- 此時建 `crm_account_memory` 表，賽前簡報走 case_memory 重生流程
- 同步開始累積教練筆記
- 桿弟型功能此時還在「被動回答」級別

### Phase 3：季度整理後升級桿弟

- 累積 1–3 個月筆記後，先做季度整理（見第 6 節）
- 整理出第一版方法論文件
- 桿弟型升級到「主動推送建議」

## 6. 累積與整理節奏

### 每週（5 分鐘，AI 主動跑）

- 本週給了幾條建議、採納幾條、否決幾條
- 否決理由的關鍵字統計
- 不需要使用者動作，看完即可

### 每月（30 分鐘，需要使用者參與）

- AI 把本月教練筆記分群：重複主題 vs. 單次事件
- 使用者對「重複主題」逐條判斷：對／不對／要修正成這樣
- 通過的升級為「方法論候選條目」

### 每季（1–2 小時，整合）

- 把方法論候選 + 業務畫像的季度變化整理成新版方法論文件
- 砍掉過時的舊條目
- 重新計算業務畫像基準

> 設計理念：這個節奏跟 App 既有的週／季／年 review 流程一致，AI 自我訓練塞進既有 review，不是額外負擔。

## 7. 技術備忘

- **後端架構**：AI 邏輯走 LangGraph，部署在 Railway 上的新專案（不與 `labor-consultant-v3` 同 graph，但共用 Railway 帳號）。前端 `fetch()` 直接打 Railway endpoint。
- **API key 安全**：key 存在 Railway 環境變數，前端永遠不接觸。原本構想的 Supabase Edge Function 改由 LangGraph endpoint 取代。
- **Supabase 的角色**：純 Auth + 資料表（CRM 主檔、AI 記憶、教練筆記）。AI 推論不經 Supabase。
- **模型選擇**：日常查詢用 `claude-haiku-4-5-20251001`（快、便宜）；桿弟型建議用 `claude-sonnet-4-6` 或更高（需要推理）。
- **程式組織**：`app.js` 已逾 100KB，前端 AI 模組獨立成 `ai-assistant.js`，不再往主檔塞。
- **新資料表**（Supabase）：
  - `crm_account_memory`：客戶層工作記憶（見第 4 節）
  - `ai_coach_notes`：教練筆記
  - `ai_interactions`（待定）：互動紀錄，供每週統計與每月分群
- **可從 labor-consultant-v3 複用**：
  - `case_memory` 重生邏輯與 schema → 用於 `crm_account_memory`
  - `CASE_MEMORY_CLARIFICATION_FLOW.md` 的 prepare/complete 兩段式 → 用於賽前簡報補資料
  - `retrievers/`、`tools/`、`graphs/` subgraph 結構、prompts 管理方式
  - 不可複用：教練筆記層（邏輯與 case_memory 相反，要自己設計）
- **資料查詢函式層**：在 LangGraph 後端寫成 tools（`getOverdueFollowUps()` 等），AI 透過 function calling 呼叫，避免直接讀資料造成幻覺。

## 8. 已決事項與未決事項

已決：

- **後端架構走 LangGraph + Railway，不用 Supabase Edge Function**。原因：使用者已有 `labor-consultant-v3` 在 Railway 上跑，學習與基礎設施成本為零，且 case_memory 等模式可複用。
- **新開獨立 LangGraph 專案**，不與 `labor-consultant-v3` 同 graph（領域不同、資料敏感度不同）。
- **主動推送通知走網頁版**：使用瀏覽器 Notification API，不綁 LINE。LINE 整合是另案，不阻擋 AI 助理進度。
- **客戶層工作記憶採獨立表**（`crm_account_memory`），不加欄位到 `crm_accounts`。

未決：

- 「業務畫像」每週重算的觸發點：手動按鈕 vs. Railway cron vs. 開 App 時自動
- 教練筆記是否需要分類（客戶層／自身層）以利日後檢索
- 是否需要「匿名化」客戶資料後才送進 AI（隱私考量）
- 客戶層 memory 重生時是否要對「不活躍客戶」設門檻（例如 14 天沒互動就不主動重生）

## 9. 不在這次範圍

- 自動寫信／自動排程／自動撥電話這類「代理寫入」動作
- 與 LINE 通知整合（另案）
- 客戶端的語音互動
- **節奏層觀察**（從行程資料分析工作節奏）：因為行事曆包含許多非工作行程，資料不完整會導致分析失真。除非未來進展成全方位助理（含家庭、運動、私人行程都納管），否則不做。

---

下一步：本文件穩定之後，再針對 Phase 1（業務畫像）拆出具體實作清單。
