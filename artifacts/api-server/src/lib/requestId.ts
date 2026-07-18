import crypto from "node:crypto";

// Server-generated correlation id for a single Decision/Action/Activation request.
// Must be generated before calling n8n (not only for the response) so the outgoing
// n8n payload, the API logs, and the returned lifecycle envelope all share the same id
// — otherwise an accepted-but-not-persisted request could never be correlated later.
export function generateRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}
