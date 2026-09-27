export function containsUnsubscribeRequest(subject: string, body: string) {
  const text = `${subject}\n${body}`.replace(/\s+/g, " ").trim();
  return /\b(?:unsubscribe|opt[- ]?out|remove me|take me off|stop (?:emailing|contacting) me|do not (?:email|contact) me)\b/i.test(text);
}
