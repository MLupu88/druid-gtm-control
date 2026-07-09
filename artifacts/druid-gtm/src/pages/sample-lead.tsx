import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

interface N8nStatusResponse {
  configured: boolean;
  reachable: boolean | null;
}
interface ConfigResponse {
  config: Record<string, string>;
  usingSampleData: boolean;
}

const PRESETS = [
  {
    id: "us_person",
    label: "A person from a US company visits our site",
    data: { country: "US", stream: "us", resolution_level: "person", source: "rb2b" },
  },
  {
    id: "eu_company",
    label: "A company in Europe visits our site",
    data: { country: "DE", stream: "emea", resolution_level: "company", source: "dealfront" },
  },
  {
    id: "eu_contact",
    label: "A company in Europe visits and we find a likely contact",
    data: {
      country: "DE",
      stream: "emea",
      resolution_level: "reconstructed",
      source: "dealfront",
    },
  },
  {
    id: "anonymous",
    label: "Someone browses anonymously",
    data: { resolution_level: "anonymous", source: "posthog" },
  },
  {
    id: "crm_contact",
    label: "A known contact from our CRM engages",
    data: {
      resolution_level: "known_crm_contact",
      source: "hubspot",
      known_crm: true,
    },
  },
  {
    id: "internal",
    label: "One of our own team members",
    data: { resolution_level: "person", source: "posthog", is_internal: true },
  },
  {
    id: "personal_email",
    label: "A visitor with a personal email address",
    data: { resolution_level: "person", source: "rb2b", personal_email: true },
  },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];
type Phase = "idle" | "loading" | "success" | "error";

export default function SampleLeadPage() {
  const [selectedPreset, setSelectedPreset] = useState<PresetId | null>(null);
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [submittedQueueWriteOn, setSubmittedQueueWriteOn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const n8nQ = useQuery<N8nStatusResponse>({
    queryKey: ["n8n", "status"],
    queryFn: () =>
      fetch("/api/n8n/status", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<N8nStatusResponse>,
    staleTime: 60_000,
  });

  const configQ = useQuery<ConfigResponse>({
    queryKey: ["sheets", "config"],
    queryFn: () =>
      fetch("/api/sheets/config", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<ConfigResponse>,
    staleTime: 30_000,
  });

  const n8nReachable = n8nQ.data?.reachable === true;
  const n8nConfigured = n8nQ.data?.configured === true;
  const accountQueueWriteOn =
    (configQ.data?.config?.account_queue_write ?? "off") === "on";

  const canSubmit =
    selectedPreset !== null && n8nReachable && phase === "idle";

  async function handleSubmit() {
    if (!selectedPreset || !canSubmit) return;

    const preset = PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) return;

    const writeOnAtSubmit = accountQueueWriteOn;

    setPhase("loading");
    try {
      const res = await fetch("/api/n8n/test-signal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: preset.id,
          preset_label: preset.label,
          notes: notes.trim() || undefined,
          ...preset.data,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || data.error) {
        setErrorMessage(
          data.error ??
            "Something went wrong sending the sample. Please try again.",
        );
        setPhase("error");
        return;
      }

      setSubmittedQueueWriteOn(writeOnAtSubmit);
      setPhase("success");
    } catch {
      setErrorMessage(
        "Could not reach the server. Please check your connection and try again.",
      );
      setPhase("error");
    }
  }

  function handleReset() {
    setSelectedPreset(null);
    setNotes("");
    setPhase("idle");
    setSubmittedQueueWriteOn(false);
    setErrorMessage("");
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
          Try a Sample Lead
        </h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Sends a test lead to the automation engine to see how it would be
          scored. This is different from the sample data view on the Dashboard
          and Review Queue, which shows the interface without touching the
          automation engine.
        </p>
      </div>

      {/* Context note */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border">
        <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          The automation is still being set up, so a sample sent here may not
          always create a visible row in the queue yet. Nothing is sent to
          anyone.
        </p>
      </div>

      {/* Connection warning */}
      {!n8nQ.isLoading && (!n8nConfigured || !n8nReachable) && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-300">
              {!n8nConfigured
                ? "Automation engine not connected"
                : "Automation engine not responding"}
            </p>
            <p className="text-xs text-amber-300/70 mt-0.5 leading-relaxed">
              {!n8nConfigured
                ? "The automation engine URL isn't configured, so sample leads can't be sent right now."
                : "The automation engine isn't responding. Sample leads can't be sent until it's reachable."}
            </p>
          </div>
        </div>
      )}

      {/* Success state */}
      {phase === "success" ? (
        <Card className="border-border bg-card rounded-xl">
          <CardContent className="p-6 flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-primary" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">
                Sample accepted
              </p>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-sm">
                {submittedQueueWriteOn
                  ? "The sample is going through the scoring system. Check the Review Queue in a few seconds to see the result."
                  : "The sample was sent. Queue writing is currently off — it won't appear in the review list until you turn it on in Settings."}
              </p>
            </div>

            {!submittedQueueWriteOn && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-left w-full">
                <AlertCircle className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-300 leading-relaxed">
                  To see this result in the list, turn queue writing on in Settings.
                </p>
              </div>
            )}

            <div className="flex gap-3 flex-wrap justify-center">
              <Button variant="outline" onClick={handleReset}>
                Send another
              </Button>
              <Button
                asChild
                className="bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20"
              >
                <a href="/queue">Go to Review Queue</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border bg-card rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground font-display flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-primary" />
              Choose a scenario
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setSelectedPreset(preset.id)}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-lg border transition-all text-sm",
                    selectedPreset === preset.id
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border bg-muted/20 text-foreground hover:bg-white/[0.04] hover:border-border/80",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                        selectedPreset === preset.id
                          ? "border-primary bg-primary/30"
                          : "border-border",
                      )}
                    >
                      {selectedPreset === preset.id && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span>{preset.label}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Optional notes */}
            <div className="space-y-1.5">
              <Label
                htmlFor="sample-notes"
                className="text-xs text-muted-foreground"
              >
                Notes (optional)
              </Label>
              <Textarea
                id="sample-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add context for this test run…"
                className="resize-none h-16 text-sm bg-input border-border focus-visible:ring-primary"
              />
            </div>

            {/* Error */}
            {phase === "error" && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{errorMessage}</p>
              </div>
            )}

            {/* Submit */}
            <div className="pt-1">
              <Button
                onClick={phase === "error" ? handleReset : handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  "w-full h-11 font-semibold",
                  canSubmit
                    ? "bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20"
                    : "",
                )}
              >
                {phase === "loading" ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                    Sending…
                  </span>
                ) : phase === "error" ? (
                  "Try again"
                ) : !n8nReachable && n8nConfigured ? (
                  "Engine not responding — can't send"
                ) : !n8nConfigured ? (
                  "Engine not connected"
                ) : !selectedPreset ? (
                  "Choose a scenario above"
                ) : (
                  "Send sample lead"
                )}
              </Button>
              {!n8nReachable && (
                <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
                  {!n8nConfigured
                    ? "The connection is not enabled yet — contact Mihai to set it up."
                    : "The automation engine isn't responding right now. Check the Settings page."}
                </p>
              )}
            </div>

            {/* Queue writing off note */}
            {!accountQueueWriteOn && n8nReachable && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <AlertCircle className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-300 leading-relaxed">
                  Queue writing is currently off. You can send a sample through
                  the scoring system, but it will not appear in the review list
                  until queue writing is turned on in Settings.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
