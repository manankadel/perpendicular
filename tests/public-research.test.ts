import test from "node:test";
import assert from "node:assert/strict";
import { parsePublicKeywordResults } from "../src/lib/public-search-parser";

test("parses DuckDuckGo result links and unwraps provider redirects", () => {
  const html = `
    <div class="result__body">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcompany&amp;rut=abc">Example &amp; Co</a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcompany">Evidence &amp; context</a>
    </div>`;

  assert.deepEqual(parsePublicKeywordResults(html), [{
    title: "Example & Co",
    url: "https://example.com/company",
    snippet: "Evidence & context",
  }]);
});

test("ignores unsupported result destinations and caps the result set", () => {
  const items = Array.from({ length: 12 }, (_, index) => `
    <a class="result__a" href="https://example.com/${index}">Result ${index}</a>
    <a class="result__snippet">Snippet ${index}</a>`).join("\n");

  const results = parsePublicKeywordResults(`${items}<a class="result__a" href="javascript:alert(1)">unsafe</a><a class="result__snippet">unsafe</a>`);
  assert.equal(results.length, 10);
  assert.equal(results[0]?.url, "https://example.com/0");
  assert.equal(results.at(-1)?.url, "https://example.com/9");
});
