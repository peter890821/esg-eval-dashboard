# ESG 評鑑看板 V3 升級紀錄與架構說明 (Chat Summary)

本文件紀錄了將 ESG 評鑑看板 V2 升級至 V3（整合部門填答與 AI 檢核）的完整開發過程與系統架構，作為未來維護或交接的參考。

## 🌟 升級目標
在 V2 既有的功能（包含：指標分類、年度差異說明、填答建議_簡要、多部門負責列表、揭露平台篩選器）基礎上，新增**線上自助填答**與**即時 AI 檢核**功能，並將填答資料自動送入 Google Sheets。

---

## 🛠️ 新增核心功能

1. **登入機制 (Login Overlay)**
   - 剛進入網頁時，會出現毛玻璃背景的登入視窗。
   - 使用者需選擇「部門」（選項由 V2 `suggestions_output_fixed.json` 中的 `負責部門列表` 動態產生）與輸入「姓名」。
   - 提供「Gemini API Key」選填欄位，用以啟用 AI 檢核功能。
   - 登入狀態與 API Key 會保存在瀏覽器的 `localStorage` (`esg_login`) 中。

2. **結構化填答表單 (Structured Fill-in Form)**
   - 點擊看板卡的「詳細」按鈕後，Modal 底部會出現「📝 115年度自評填答」區塊。
   - 包含三個新欄位：
     - **揭露狀態**：下拉式選單（已揭露 / 規劃中 / 不適用）。
     - **質性說明**：Textarea，讓部門同仁填寫具體目標、措施與數據。
     - **佐證來源/連結**：Input 欄位，供附上公開資訊連結或報告書頁碼。
   - **自動暫存**：輸入內容時會即時轉存到 `localStorage` (`esg_draft_{指標編號}`)，關閉再開也不會遺失。

3. **AI 檢核引擎 (Gemini 2.0 Flash)**
   - 點擊「🤖 AI 檢核」按鈕，前端會串接 Gemini API。
   - 分析邏輯位於新創建的 `ai-validator.js` 中。
   - **依據**：程式會從 `reference_data.json`（取自 115 年證交所官方參考範例）提取該題的**得分要件**與**參考範例**，並對比使用者的自評草稿。
   - **回傳**：符合度（完全符合/部分符合/不符合）、符合要件清單、缺漏項目清單、具體改善建議。

4. **後端資料表擴充 (Google Sheets & GAS)**
   - 點擊「📤 送出到 Google Sheets」後，會將資料透過 `fetch` 打給 GAS webhook。
   - 資料欄位擴充至 13 欄，包含使用者輸入的「揭露狀態」、「自評草稿」、「佐證來源」，以及由 AI 產生的「AI檢核結果」、「AI缺漏項目」與「AI建議」。

5. **UI / UX 全面升級 (Light Theme)**
   - 將原本的深色（Dark）主題重構為**高對比度的明亮主題（Light Theme）**。
   - 背景使用柔和的 `f8fafc`（灰白），看板與 Modal 使用純白 `#ffffff`，搭配重新設計的 Box-shadow 與透明度（`rgba`）遮罩。
   - 表單欄位擁有 focus 時的光暈效果，AI 檢核與送出按鈕加上了對應的漸層色。
   - 卡片上會動態顯示「✅ 已填答」或「📝 有草稿」的 Badge 標籤。

---

## 📁 檔案結構異動

- **`index.html`**
  - 加入了 `<div class="login-overlay">`。
  - Header 加入了 `userInfo`（顯示目前登入者）與 `filterFilled`（填答狀態篩選器）。
  - 引入 `ai-validator.js`。
- **`app.js`**
  - **保留 V2 邏輯**：維持按「合規度」分成四個看板欄位；Modal 中保留了 `填答建議_簡要` 與 `年度差異說明` 的讀取；支援陣列格式的 `負責部門列表`。
  - **新增邏輯**：實踐 `initLogin()`, `openModal()` 追加表單渲染, `autoSaveDraft()`, `runAIValidation()`, `submitDraft()` 等新方法。
- **`style.css`**
  - CSS Variables 完全重寫為 Light Theme。
  - 針對表單元素 (`.draft-*`)、AI 檢核區塊 (`.ai-validation-result`) 撰寫新樣式。
- **`ai-validator.js`** (新增)
  - 負責處理與 `generativelanguage.googleapis.com` 的溝通，以及建構系統提示詞 (System Prompt)。
- **`reference_data.json`** (新增)
  - 儲存 75 題 115 年度指標的「得分要件」與「參考範例」，做為 AI 進行 Few-shot 檢核的知識庫。

---

## 📝 後續維護建議 / Next Steps

1. **Google Apps Script 佈署**
   - 新的資料結構比原本多出多個欄位。如果之後部門同仁反應送出失敗，請至 Google Apps Script 編輯器檢查 `gas_script.js`，確認 `sheet.appendRow([...])` 內的變數長度與順序是否有對齊這 13 個欄位，並記得**新增部署作業**。

2. **API Key 安全性**
   - 目前採「使用者自行在網頁填寫 Gemini API Key」的方式運作。
   - 這是為了避免將實體的 API Key 直接寫死在放置於 GitHub Pages（公開）的靜態前端網頁中，導致 Key 被盜刷。
   - 未來若不希望部門同仁自己找 Key，可考慮架設 Cloudflare Worker 做 Proxy Server 中繼轉發。

3. **參考範例資料維護**
   - 每一年若證交所有更新，只要抽換或編輯 `reference_data.json` 即可更新 AI 檢核的知識庫核心，不需要動到 JavaScript 本身的邏輯。
