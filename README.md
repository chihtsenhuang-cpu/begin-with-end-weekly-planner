# 以終為始週計畫表

這是一個依照原 Excel「以終為始週計畫表 & 10 大正向情緒」整理出的網頁原型。

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
- 行程可設定：
  - 標題
  - 日期
  - 開始時間
  - 結束時間
  - 所屬角色組
- 角色組背景色可用十六進位色碼設定
- 10 大正向情緒記錄
- 本週統計與 AI 回饋草稿
- 瀏覽器通知測試介面
- Supabase Auth Magic Link 登入
- Supabase `weekly_plans` JSON 同步

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
- `emotion_logs`
- `notification_settings`

## 新對話接續方式

在新對話中提供這個資料夾路徑：

`/Users/vincent/Documents/Codex/2026-05-03/files-mentioned-by-the-user-10/begin-with-end-weekly-planner`

並說明要繼續做：

- LINE Messaging API 通知
- GitHub repo 初始化與推送
