import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const maxUploadBytes = 8 * 1024 * 1024;
const maxExtractedCharacters = 100_000;

function decodeBase64(value: string) {
  const payload = value.replace(/^data:[^;]+;base64,/, "").trim();
  if (!payload || !/^[A-Za-z0-9+/=_-]+$/.test(payload)) throw new Error("The uploaded file encoding is invalid.");
  const buffer = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (!buffer.length || buffer.length > maxUploadBytes) throw new Error("Keep uploaded sources under 8 MB.");
  return buffer;
}

function runPdfTextExtraction(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("pdftotext", ["-layout", filePath, "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", () => reject(new Error("PDF extraction is unavailable on the Dell. Install poppler-utils or paste the document text instead.")));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`PDF extraction failed${stderr.length ? `: ${Buffer.concat(stderr).toString("utf8").slice(0, 240)}` : "."}`));
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

export async function ingestUploadedDocument(args: { content?: string; fileData?: string; fileName?: string; fileType?: string }) {
  const pasted = String(args.content || "").trim();
  if (!args.fileData) {
    if (pasted.length > maxExtractedCharacters) throw new Error("Knowledge source is too large. Keep it under 100,000 characters.");
    return pasted;
  }
  const buffer = decodeBase64(args.fileData);
  const fileName = String(args.fileName || "source").trim().toLowerCase();
  const fileType = String(args.fileType || "").toLowerCase();
  const isPdf = fileType === "application/pdf" || fileName.endsWith(".pdf");
  let content: string;
  if (isPdf) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "perpendicular-upload-"));
    const filePath = path.join(directory, "source.pdf");
    try {
      await writeFile(filePath, buffer, { mode: 0o600 });
      content = await runPdfTextExtraction(filePath);
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  } else {
    content = buffer.toString("utf8");
  }
  const normalized = content.replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error("The uploaded source did not contain readable text.");
  if (normalized.length > maxExtractedCharacters) throw new Error("Knowledge source is too large. Keep it under 100,000 characters.");
  return normalized;
}
