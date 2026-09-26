import { corsHeadersFor, corsJson } from "@/lib/cors";
import type { HeadlessChatResult } from "@/lib/headless-chat";

export function apiError(message: string, status = 400, request?: Request) {
  return corsJson({ error: { message, type: status === 429 ? "rate_limit_error" : "invalid_request_error", code: status } }, { status }, request);
}

export function tokenEstimate(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function openAiResponse(result: HeadlessChatResult, request: Request, stream: boolean) {
  const id = `chatcmpl_${result.employeeId}_${Date.now()}`;
  const usage = { prompt_tokens: tokenEstimate(result.content), completion_tokens: tokenEstimate(result.content), total_tokens: tokenEstimate(result.content) * 2 };
  if (!stream) {
    return corsJson({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: result.model, choices: [{ index: 0, message: { role: "assistant", content: result.content }, finish_reason: "stop" }], usage, perpendicular: { employee_id: result.employeeId, employee: result.employeeName, provider: result.provider, citations: result.citations, timings: result.timings } }, undefined, request);
  }
  const encoder = new TextEncoder();
  const chunks = [
    { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: result.model, choices: [{ index: 0, delta: { role: "assistant", content: result.content }, finish_reason: null }] },
    { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: result.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
  const streamBody = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(streamBody, { headers: { ...corsHeadersFor(request), "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}

export function anthropicResponse(result: HeadlessChatResult, request: Request) {
  return corsJson({ id: `msg_${result.employeeId}_${Date.now()}`, type: "message", role: "assistant", model: result.model, content: [{ type: "text", text: result.content }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: tokenEstimate(result.content), output_tokens: tokenEstimate(result.content) }, perpendicular: { employee_id: result.employeeId, employee: result.employeeName, provider: result.provider, citations: result.citations, timings: result.timings } }, undefined, request);
}
