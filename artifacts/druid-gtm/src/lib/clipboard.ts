// Tiny, side-effect-scoped helpers for the activation composer's Copy/Download controls.
// No network calls — these only ever touch the local clipboard/filesystem-download APIs.

// Strips path separators and control characters from a server- or operator-supplied
// filename before it's used in a download attribute — defends against an unexpected
// artifact_filename/export_filename shape without blocking the download outright.
export function sanitizeFilename(name: string, fallback = "message.txt"): string {
  const cleaned = String(name ?? "")
    .replace(/[\\/]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  return cleaned || fallback;
}

// Copies text to the clipboard. Returns whether it succeeded so callers can show
// their own feedback (e.g. a transient "Copied" label) — this never throws.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path below
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

// Triggers a client-side, plain-text download of `text` as `filename` — no network
// request, no external dispatch. Purely a local file save.
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFilename(filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
