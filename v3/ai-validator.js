/**
 * AI Validator Module — Gemini API Integration
 * =============================================
 * Validates user ESG responses against TWSE 115年 evaluation criteria.
 *
 * 本模組的「AI 檢核」功能，會以該指標既有的 ✨ AI 填答建議 (Gemini)
 * （suggestions_output_fixed.json 中的 ai_suggestion）作為主要檢核依據，
 * 並嚴格要求 Gemini 不得捏造任何要件或案例，避免 AI 幻覺。
 */

// Reference data: loaded from reference_data.json
let referenceData = null;

async function loadReferenceData() {
  if (referenceData) return referenceData;
  try {
    const resp = await fetch('reference_data.json?t=' + Date.now());
    referenceData = await resp.json();
    return referenceData;
  } catch (e) {
    console.warn('Failed to load reference_data.json:', e);
    return {};
  }
}

/**
 * 將 ai_suggestion 物件整理成可放進 prompt 的純文字。
 * 只引用實際存在的欄位，避免 prompt 中出現空白或誤導內容。
 */
function buildSuggestionContext(aiSuggestion) {
  if (!aiSuggestion || aiSuggestion.error || aiSuggestion.parse_error) {
    return null;
  }

  const core = aiSuggestion['核心要求白話文'] || aiSuggestion['核心要求'] || '';
  const diff = aiSuggestion['差異分析或現況診斷'] || aiSuggestion['差異分析'] || '';
  const actionsRaw = aiSuggestion['具體行動與揭露清單'];
  const actions = Array.isArray(actionsRaw)
    ? actionsRaw.map((a, i) => `${i + 1}. ${a}`).join('\n')
    : (actionsRaw || '');
  const refExamples = aiSuggestion['官方參考與較佳案例'] || '';

  // 若所有欄位都是空的，視為無建議
  if (!core && !diff && !actions && !refExamples) return null;

  const parts = [];
  if (core)        parts.push(`【核心要求白話文】\n${core}`);
  if (diff)        parts.push(`【差異分析／現況診斷】\n${diff}`);
  if (actions)     parts.push(`【具體行動與揭露清單】\n${actions}`);
  if (refExamples) parts.push(`【官方參考與較佳案例】\n${refExamples}`);

  return parts.join('\n\n');
}

/**
 * Validate a user's response against the indicator requirements using Gemini.
 * @param {Object} indicator - The indicator data object
 * @param {string} userResponse - The user's qualitative response
 * @param {string} evidenceUrl - The user's evidence URL/reference
 * @param {string} status - The user's status selection
 * @param {string} apiKey - Gemini API key
 * @param {Object} [aiSuggestion] - 該指標的 ai_suggestion 物件（主要檢核依據）
 * @returns {Promise<Object>} validation result
 */
async function validateWithAI(indicator, userResponse, evidenceUrl, status, apiKey, aiSuggestion) {
  if (!apiKey) {
    throw new Error('請先設定 Gemini API Key');
  }

  const refs = await loadReferenceData();
  const code = indicator['編號'];
  const ref = refs[code] || {};

  const requirementsText = ref.requirements || '（無對應得分要件資料）';

  // 主要檢核依據：本指標既有的 AI 填答建議
  const suggestionContext = buildSuggestionContext(aiSuggestion);
  const suggestionSection = suggestionContext
    ? suggestionContext.substring(0, 3000)
    : '（本指標沒有可參照的 AI 填答建議資料。請僅依下方「115年得分要件」進行檢核；'
      + '若得分要件也無法判斷，請於 missing_items 中標註「無 AI 填答建議可參照，資訊不足以判定」，不得自行臆測。）';

  // Build the prompt
  const systemPrompt = `你是證交所 ESG 評鑑指標的填答審查專家，熟悉 115 年度（第一屆）ESG 評鑑的所有得分要件與參考範例。

你的任務：嚴格依據下方提供的【AI 填答建議】內容（這是本指標的主要、權威檢核依據），檢核使用者填答是否符合要求。

【嚴格規則 — 防止 AI 幻覺，務必遵守】
1. 你只能引用【AI 填答建議】與【115年得分要件】中「明確出現」的文字作為檢核依據。
2. 嚴禁自行捏造任何要件、條文、案例、年度數字、法規名稱、公司名稱或統計數據。
3. matched_items 中列出的每一項，都必須是【AI 填答建議】的「具體行動與揭露清單」或「核心要求白話文」中真實存在、且使用者填答內容明確涵蓋的項目。
4. missing_items 中列出的每一項，也必須對應【AI 填答建議】中真實存在、但使用者未提及或未充分說明的項目。
5. 若某項要件，使用者填答內容過於簡短或模糊，無法判定是否符合，請放入 missing_items 並註明「資訊不足，無法判定」，不要猜測。
6. suggestions 必須直接源自【AI 填答建議】的具體行動清單，不得另行發明新的建議方向。
7. 若【AI 填答建議】顯示為「（本指標沒有可參照的 AI 填答建議資料…）」，則 matched_items 與 missing_items 應留空或僅放「無 AI 填答建議可參照」一項，並在 summary 中註明「無建議可比對」。
8. 回覆必須是合法 JSON，僅輸出 JSON，不得加入任何 markdown 標記或前後文字。`;

  const userPrompt = `請依據下方【AI 填答建議】內容，檢核使用者對本 ESG 指標的填答：

【指標編號】${code}
【評鑑指標】${(indicator['評鑑指標'] || '').replace(/\n/g, ' ')}
【題型】${indicator['題型'] || ''}
【評鑑資訊依據】${indicator['評鑑資訊依據'] || ''}

===== ✨ AI 填答建議（本次檢核的主要依據，請以此為準） =====
${suggestionSection}

===== 115年得分要件（輔助參考，不得作為虛構要件的來源） =====
${requirementsText.substring(0, 1500)}

===== 使用者填答 =====
【質性說明】${userResponse}
【佐證來源】${evidenceUrl || '（未提供）'}
【揭露狀態】${status || '（未選擇）'}

===== 請輸出以下 JSON（嚴格遵守上方防幻覺規則） =====
{
  "compliance": "full 或 partial 或 non",
  "score": 0到100的整數,
  "matched_items": ["（必須對應 AI 填答建議中真實存在的具體文字）"],
  "missing_items": ["（必須對應 AI 填答建議中真實存在的具體文字；資訊不足時填「資訊不足，無法判定」）"],
  "suggestions": ["（必須直接來自 AI 填答建議的具體行動清單）"],
  "summary": "一句話總評（20字內）"
}

只回覆 JSON，不要加任何前後文字或 markdown。`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [{ text: userPrompt }]
    }],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      // 降低溫度以最大幅度減少生成隨機性與幻覺
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    }
  };

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    if (resp.status === 400) throw new Error('API Key 無效或請求格式錯誤');
    if (resp.status === 429) throw new Error('API 呼叫次數已達上限，請稍後再試');
    throw new Error(`Gemini API 錯誤 (${resp.status}): ${errText.substring(0, 200)}`);
  }

  const data = await resp.json();

  // Extract text from Gemini response
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini 回傳格式異常');
  }

  // Parse JSON response
  try {
    // Clean up possible markdown wrapping
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse Gemini response:', text);
    throw new Error('AI 回覆解析失敗，請重試');
  }
}
