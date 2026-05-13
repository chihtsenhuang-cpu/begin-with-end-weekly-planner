# 以終為始週計畫表

這是一個依照原 Excel「以終為始週計畫表」整理出的網頁原型。

## 目前狀態

- 純前端靜態網頁，可直接開啟 `index.html`
- 已加入 PWA manifest 與 service worker，可用本機伺服器開啟後安裝到主畫面
- 資料會先儲存在瀏覽器 `localStorage`
- 可設定 Supabase URL / anon key，用 Magic Link 登入後同步每週計畫
- 尚未接 LINE 通知

## 目前功能

- 週起始日設定
- 角色組與三個目標
- 每日五格今日要事
- 類 Google Calendar 的週行程時間軸
- 獨立 CRM 客戶狀況與拜訪紀錄工作台
- 獨立業務漏斗頁，可用年份與上下半年檢視階段分布
- 行程可設定：
  - 標題
  - 日期
  - 開始時間
  - 結束時間
  - 所屬角色組
- 角色組背景色可用十六進位色碼設定
- 三個勝利
- 週反思
- 回顧本
- 本週統計
- 瀏覽器通知測試介面
- Supabase Auth Magic Link 登入
- Supabase `weekly_plans` JSON 同步

## CRM 拜訪

CRM 拜訪頁籤是獨立工作台，不會自動寫入週計畫行程。第一版支援：

- 新增、編輯、刪除客戶
- 依姓名、分類、備註搜尋
- 依客戶階段篩選
- 查看客戶基本資料、目前階段、下一步、下次追蹤日
- 客戶資料會顯示整個流程的佣金稅前收入，並用匯入見面次數加上拜訪方式為「面訪」的紀錄計算見面次數
- 新增拜訪紀錄，並更新客戶階段與下一步
- 編輯或刪除既有拜訪紀錄，修正寫錯的內容
- 查看同一位客戶的歷史拜訪時間軸
- 匯入舊 Google Sheet / Excel 匯出的 CSV 或 TSV 初始資料
- 依上半年 / 下半年檢視銷售漏斗：尚未聯絡、初步聯繫、財務＆保單分析、說明與口頭、建議書、成交；漏斗統計實際留下的階段紀錄次數，不自動補中間步驟，成交率分母為初步聯繫

CRM 的正式 Supabase 表結構已放在 `supabase-schema.sql`，包含：

- `crm_accounts`：客戶主檔
- `crm_account_products`：客戶已有險種
- `crm_visit_records`：拜訪紀錄
- `crm_stage_history`：階段歷史，供後續精準漏斗分析使用
- `crm_import_batches`：匯入批次
- `crm_import_rows`：匯入原始列

匯入舊資料時，請從 Google Sheet 或 Excel 匯出 CSV/TSV，或貼上含表頭的資料列。匯入器會用 `0姓名`、`0.所在地`、`分類`、`生日`、`職業`、`已有險種`、`保單狀態`、`尚未聯絡` 到 `理賠`、`見面次數`、`税前收入`、`客戶背景`、`行動計劃`、`備註` 這些表頭做欄位對應。

## 本機啟動

PWA 與 service worker 需要透過 HTTP/HTTPS 開啟。可在此資料夾執行：

```bash
python3 -m http.server 8000
```

然後打開：

```text
http://localhost:8000
```

## Supabase 設定

1. 建立 Supabase project。
2. 到 SQL Editor 執行 `supabase-schema.sql`。
3. 到 Authentication > URL Configuration，將本機或部署網址加入 Site URL / Redirect URLs。
4. 在 App 的「提醒與 AI」頁面填入：
   - Project URL
   - Anon public key
   - 登入 Email
5. 按「儲存設定」，再按「寄送登入連結」。
6. 用同一個瀏覽器打開信中的 Magic Link。

登入後，儲存或編輯內容會自動同步到 Supabase 的 `weekly_plans`。
CRM 設定完成並登入後，可在設定頁按「同步 CRM 到雲端」手動確認本機 CRM 已寫入 Supabase。

## 檔案

- `index.html`：頁面結構
- `styles.css`：介面樣式
- `app.js`：互動、資料、統計、行程邏輯
- `manifest.webmanifest`：PWA 設定
- `service-worker.js`：離線快取 app shell
- `icons/icon.svg`：PWA 圖示
- `supabase-schema.sql`：Supabase 建表與 RLS policy

## 下一步規劃

1. 接 LINE 通知
   - 使用 LINE Messaging API
   - 透過 Supabase Edge Function 定時查詢即將提醒的行程
   - 發送 LINE 訊息到使用者手機

2. 擴充資料表

- `profiles`
- `role_groups`
- `goals`
- `important_items`
- `calendar_events`
- `daily_wins`
- `weekly_reflections`
- `notification_settings`

## 新對話接續方式

在新對話中提供這個資料夾路徑：

`/Users/vincent/Documents/Codex/2026-05-03/files-mentioned-by-the-user-10/begin-with-end-weekly-planner`

並說明要繼續做：

- LINE Messaging API 通知
- GitHub repo 初始化與推送
