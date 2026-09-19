const languages = Object.freeze({
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  "zh-CN": "Simplified Chinese",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  hi: "Hindi",
  ar: "Arabic",
});

function outputText(response) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
}

export function createTranslationService({
  apiKey = process.env.OPENAI_API_KEY,
  fetch: fetchImpl = globalThis.fetch,
  model = "gpt-5.6-luna",
} = {}) {
  return Object.freeze({
    async translate(text, targetLanguage) {
      if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
      const targetName = languages[targetLanguage];
      if (!targetName) throw new Error("Unsupported target language.");
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: "none" },
          instructions: `Translate marketplace chat messages into ${targetName} (${targetLanguage}). Preserve tone, names, prices, emoji, and formatting. Report the detected source as a BCP 47 language code. Return only the requested structured result.`,
          input: text,
          max_output_tokens: 2_048,
          text: {
            format: {
              type: "json_schema",
              name: "chat_translation",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  source_language: { type: "string" },
                  translated_text: { type: "string" },
                },
                required: ["source_language", "translated_text"],
              },
            },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`OpenAI translation failed with status ${response.status}.`);
      const result = JSON.parse(outputText(await response.json()));
      const translatedText = String(result.translated_text || "").trim();
      if (!translatedText) throw new Error("OpenAI returned an empty translation.");
      const sourceLanguage = String(result.source_language || "").trim();
      const sourceBase = sourceLanguage.toLowerCase().split("-")[0];
      const targetBase = targetLanguage.toLowerCase().split("-")[0];
      return {
        sourceLanguage,
        translatedText,
        translated:
          sourceBase !== targetBase && translatedText !== text,
      };
    },
  });
}

export const supportedLanguages = languages;
