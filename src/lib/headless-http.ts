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
  const pieces = result.content.match(/.{1,120}(?:\s|$)/g)?.map((piece) => piece.trim()).filter(Boolean) || [result.content];
  const created = Math.floor(Date.now() / 1000);
  type StreamChunk = { id: string; object: string; created: number; model: string; choices: Array<{ index: number; delta: { role?: string; content?: string }; finish_reason: string | null }> };
  const chunks: StreamChunk[] = pieces.map((piece, index) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model: result.model,
    choices: [{ index: 0, delta: index === 0 ? { role: "assistant", content: piece } : { content: piece }, finish_reason: null }],
  }));
  chunks.push({ id, object: "chat.completion.chunk", created, model: result.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  const streamBody = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(streamBody, { headers: { ...corsHeadersFor(request), "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}

export function anthropicResponse(result: HeadlessChatResult, request: Request, stream = false) {
  const id = `msg_${result.employeeId}_${Date.now()}`;
  const usage = { input_tokens: tokenEstimate(result.content), output_tokens: tokenEstimate(result.content) };
  if (!stream) {
    return corsJson({ id, type: "message", role: "assistant", model: result.model, content: [{ type: "text", text: result.content }], stop_reason: "end_turn", stop_sequence: null, usage, perpendicular: { employee_id: result.employeeId, employee: result.employeeName, provider: result.provider, citations: result.citations, timings: result.timings } }, undefined, request);
  }
  const encoder = new TextEncoder();
  const pieces = result.content.match(/.{1,120}(?:\s|$)/g)?.map((piece) => piece.trim()).filter(Boolean) || [result.content];
  const event = (name: string, payload: unknown) => encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
  const streamBody = new ReadableStream({
    start(controller) {
      controller.enqueue(event("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: result.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 0 } } }));
      controller.enqueue(event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
      for (const piece of pieces) controller.enqueue(event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } }));
      controller.enqueue(event("content_block_stop", { type: "content_block_stop", index: 0 }));
      controller.enqueue(event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }));
      controller.enqueue(event("message_stop", { type: "message_stop" }));
      controller.close();
    },
  });
  return new Response(streamBody, { headers: { ...corsHeadersFor(request), "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
