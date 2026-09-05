import "server-only";

import { buildFallbackReply, findRelevantDocuments, type Employee, type DocumentRecord } from "@/lib/domain";

type LlmResult = { content: string; citations: string[]; provider: "ollama" | "local fallback" };

function trimForPrompt(value: string, length = 1600) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export async function generateEmployeeReply(
  employee: Employee,
  message: string,
  documents: DocumentRecord[],
): Promise<LlmResult> {
  const relevant = findRelevantDocuments(documents, message);
  const citations = relevant.length > 0 ? relevant.map((document) => document.name) : ["Employee system prompt"];
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";
  const context = relevant.map((document) => `SOURCE: ${document.name}\n${trimForPrompt(document.content)}`).join("\n\n");

  if (process.env.DISABLE_OLLAMA !== "true") {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature: 0.35 },
          messages: [
            { role: "system", content: `${employee.systemPrompt}\n\nUse only the workspace context below when it is relevant. If it is not enough, say so. Finish with one clear next action.\n\n${context || "No matching workspace context was found."}` },
            { role: "user", content: message },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        const payload = (await response.json()) as { message?: { content?: string } };
        const content = payload.message?.content?.trim();
        if (content) return { content, citations, provider: "ollama" };
      }
    } catch {
      // Offline fallback is intentional: the product must stay usable without a model daemon.
    }
  }

  const fallback = buildFallbackReply(employee, message, documents);
  return { ...fallback, provider: "local fallback" };
}
