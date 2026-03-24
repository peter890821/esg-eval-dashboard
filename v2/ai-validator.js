/**
 * AI Validator Module — Gemini API Integration
 * =============================================
 * Validates user ESG responses against TWSE 115年 evaluation criteria.
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
 * Validate a user's response against the indicator requirements using Gemini.
 * @param {Object} indicator - The indicator data object
 * @param {string} userResponse - The user's qualitative response
 * @param {string} evidenceUrl - The user's evidence URL/reference
 * @param {string} status - The user's status selection
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Object>} validation result
 */
async function validateWithAI(indicator, userResponse, evidenceUrl, status, apiKey) {
  if (!apiKey) {
    throw new Error('請先設定 Gemini API Key');
  }

  const refs = await loadReferenceData();
  const code = indicator['編號'];
  const ref = refs[code] || {};

  const requirementsText = ref.requirements || '（無對應得分要件資料）';
  const examplesText = ref.examples || '（無對應參考範例資料）';

  // Build the prompt
  const systemPrompt = `你是證交所 ESG 評鑑指標的填答審查專家，熟悉 115 年度（第一屆）ESG 評鑑的所有得分要件與參考範例。
你的任務是根據最新的得分要件與參考範例，檢核使用者的填答內容是否符合要求。
請以嚴謹但建設性的態度進行審查，給出具體可行的改善建議。
回覆必須是 JSON 格式。`;

  const userPrompt = `請檢核以下 ESG 評鑑指標的填答內容：

【指標編號】${code}
【評鑑指標】${(indicator['評鑑指標'] || '').replace(/\n/g, ' ')}
【指標說明】${(indicator['指標說明'] || '').substring(0, 800)}
【評鑑資訊依據】${indicator['評鑑資訊依據'] || ''}
【題型】${indicator['題型'] || ''}

===== 115年得分要件 =====
${requirementsText.substring(0, 2000)}

===== 參考範例 =====
${examplesText.substring(0, 1500)}

===== 使用者填答 =====
【質性說明】${userResponse}
【佐證來源】${evidenceUrl || '（未提供）'}
【揭露狀態】${status || '（未選擇）'}

===== 請回覆以下 JSON =====
{
  "compliance": "full 或 partial 或 non",
  "score": 0到100的整數,
  "matched_items": ["已符合的要件1", "已符合的要件2"],
  "missing_items": ["缺少的要件1", "缺少的要件2"],
  "suggestions": ["具體改善建議1", "具體改善建議2"],
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
      temperature: 0.3,
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
