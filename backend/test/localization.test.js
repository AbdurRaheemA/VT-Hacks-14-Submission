import assert from "node:assert/strict";
import test from "node:test";

import { createCurrencyService } from "../src/currency.js";
import { createTranslationService } from "../src/translation.js";

test("uses GPT-5.6 Luna structured output for stateless chat translation", async () => {
  let request;
  const service = createTranslationService({
    apiKey: "test-key",
    fetch: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return Response.json({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({ source_language: "en", translated_text: "Hola" }),
          }],
        }],
      });
    },
  });

  const result = await service.translate("Hello", "es");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(request.body.model, "gpt-5.6-luna");
  assert.equal(request.body.store, false);
  assert.equal(request.body.reasoning.effort, "none");
  assert.equal(request.body.text.format.type, "json_schema");
  assert.deepEqual(result, {
    sourceLanguage: "en",
    translatedText: "Hola",
    translated: true,
  });
});

test("loads and caches a free Frankfurter USD exchange rate", async () => {
  let calls = 0;
  const service = createCurrencyService({
    fetch: async (url) => {
      calls += 1;
      assert.equal(url, "https://api.frankfurter.dev/v2/rate/USD/EUR");
      return Response.json({ date: "2026-09-18", base: "USD", quote: "EUR", rate: 0.84 });
    },
  });

  assert.equal((await service.rate("EUR")).rate, 0.84);
  assert.equal((await service.rate("EUR")).rate, 0.84);
  assert.equal(calls, 1);
  assert.equal((await service.rate("USD")).rate, 1);
});
