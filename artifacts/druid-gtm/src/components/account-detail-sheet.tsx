import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ActionModal } from "@/components/action-modal";
import { OutputTypeBadge } from "@/components/output-type-badge";
import {
  OUTPUT_TYPE_LABELS,
  IDENTITY_LABELS,
  SALES_REVIEW_REASON_LABELS,
} from "@workspace/gtm-shared";
import {
  type Row,
  type ButtonKey,
  rowOutputType,
  rowIdentityLabel,
  rowButtons,
  isButtonDisabled,
  isButtonDisabledAccount,
  safeWhyNow,
  rowCostLabel,
  blockReasonText,
} from "@/lib/queue-helpers";
import { cn } from "@/lib/utils";
import { BUTTONS } from "@workspace/gtm-shared";
import { Building2, User, Phone, Mail, Globe, AlertTriangle } from "lucide-react";

interface AccountDetailSheetProps {
  row: Row;
  source: string;
  config: Record<string, string>;
  open: boolean;
  onClose: () => void;
  onAction?: () => void;
  previewOnly?: boolean;
}

export function AccountDetailSheet({
  row,
  source,
  config,
  open,
  onClose,
  onAction,
  previewOnly = false,
}: AccountDetailSheetProps) {
  const [activeButton, setActiveButton] = useState<ButtonKey | null>(null);

  const outputType = rowOutputType(row, source);
  const outputMeta = OUTPUT_TYPE_LABELS[outputType];
  const identityInfo = rowIdentityLabel(row, source);
  const whyNow = safeWhyNow(row);
  const cost = rowCostLabel(row);
  const buttons = rowButtons(row, source);
  const isAccountQueue = String(source).toLowerCase() === "account_queue";
  const isTestRow = String(row.test_mode).toLowerCase() === "true";

  // Score dimensions (account queue only)
  const scoreFields = [
    { label: "How well do they match who we sell to?", key: "fit_score", sub: "Fit" },
    { label: "How interested do they seem?", key: "interest_score", sub: "Interest" },
    {
      label: "How confident are we who this is?",
      key: "identity_score",
      sub: "Identity",
    },
    { label: "Can we actually reach them?", key: "actionability_score", sub: "Reachability" },
    { label: "How fresh is this?", key: "timing_score", sub: "Timing" },
  ] as const;

  function getDisabled(btnKey: ButtonKey): { disabled: boolean; reason: string } {
    if (isAccountQueue) {
      const d = isButtonDisabledAccount(btnKey, row, config);
      if (d) {
        // Surface a plain reason where possible
        const blockedReason = row.block_reason
          ? blockReasonText(row.block_reason)
          : "This action isn't available right now.";
        return { disabled: true, reason: blockedReason };
      }
      return { disabled: false, reason: "" };
    }
    return isButtonDisabled(btnKey, row);
  }

  const totalScore = Number(row.account_score || row.total_score || 0) || null;

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg overflow-y-auto bg-background border-l border-border p-0"
        >
          <SheetHeader className="px-6 py-5 border-b border-border">
            <div className="flex items-start gap-3">
              <OutputTypeBadge outputType={outputType} showSub className="shrink-0 pt-0.5" />
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base font-semibold font-display text-left leading-tight">
                  {row.company_name || row.company_domain || "Unknown company"}
                </SheetTitle>
                {row.company_domain && row.company_name && (
                  <p className="text-xs text-muted-foreground mt-0.5">{row.company_domain}</p>
                )}
              </div>
              {(isTestRow || previewOnly) && (
                <Badge
                  variant="outline"
                  className="text-[10px] shrink-0 text-amber-400 border-amber-500/30 bg-amber-500/10"
                >
                  Sample data
                </Badge>
              )}
            </div>
          </SheetHeader>

          {/* Orientation */}
          <div className="px-6 py-2.5 border-b border-border bg-muted/10">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {previewOnly
                ? "This is sample data. You can preview the workflow, but no action will be sent."
                : "This page explains why the account received this recommendation and what would happen if you act."}
            </p>
          </div>

          <div className="px-6 py-5 space-y-6">
            {/* About this account */}
            <Section title="About this account">
              <MetaRow icon={<Building2 className="w-3.5 h-3.5" />} label="Company">
                {row.company_name || row.company_domain || "—"}
              </MetaRow>
              {row.company_domain && (
                <MetaRow icon={<Globe className="w-3.5 h-3.5" />} label="Domain">
                  {row.company_domain}
                </MetaRow>
              )}
              {(row.country || row.region) && (
                <MetaRow icon={null} label="Region">
                  {row.country || row.region}
                </MetaRow>
              )}
              {identityInfo && (
                <div className="mt-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border">
                  <p className="text-xs font-semibold text-foreground mb-0.5">
                    {identityInfo.label}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {identityInfo.detail}
                  </p>
                </div>
              )}
            </Section>

            {/* Why we're recommending this */}
            <Section title="Why we're recommending this">
              <p className="text-sm text-foreground leading-relaxed">{whyNow || "—"}</p>
              {outputType === "Sales Review" && row.sales_review_reason && (
                <div className="mt-2 px-3 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-xs text-yellow-300 leading-relaxed">
                    {SALES_REVIEW_REASON_LABELS[
                      row.sales_review_reason as keyof typeof SALES_REVIEW_REASON_LABELS
                    ] ?? row.sales_review_reason}
                  </p>
                </div>
              )}
              {outputMeta?.detail && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {outputMeta.detail}
                </p>
              )}
            </Section>

            {/* Score (account queue only) */}
            {isAccountQueue && totalScore !== null && (
              <Section title="How this account scores">
                <div className="space-y-3">
                  {scoreFields.map(({ label, key }) => {
                    const val = Number(row[key] ?? 0);
                    const max = 40;
                    const pct = Math.min(100, Math.round((val / max) * 100));
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">{label}</span>
                          <span className="text-xs font-semibold tabular-nums text-foreground">
                            {val}
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/60 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground pt-1">
                    Total score: <span className="font-semibold text-foreground">{totalScore}</span>
                  </p>
                </div>
              </Section>
            )}

            {/* Score (signal queue only) */}
            {!isAccountQueue && totalScore !== null && (
              <Section title="Score">
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {totalScore}
                  </span>
                  {row.score_tier && (
                    <span className="text-xs text-muted-foreground">
                      {row.score_tier.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </Section>
            )}

            {/* People / contact */}
            {(row.contact_name || row.contact_email || row.contact_phone ||
              row.best_contact_name || row.best_contact_email) && (
              <Section title="People">
                <div className="space-y-2">
                  <ContactCard
                    name={row.contact_name || row.best_contact_name}
                    email={row.contact_email || row.best_contact_email}
                    phone={row.contact_phone}
                    isPrimary
                    identityKey={
                      isAccountQueue
                        ? row.identity_resolution
                        : row.resolution_level === "person"
                        ? "identified_contact"
                        : undefined
                    }
                  />
                </div>
              </Section>
            )}

            {/* What this would cost */}
            <Section title="What this would cost">
              <div className="px-3 py-2.5 rounded-lg bg-muted/30 border border-border">
                <p className="text-sm font-medium text-foreground">{cost.label}</p>
                {cost.detail && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {cost.detail}
                  </p>
                )}
              </div>
            </Section>

            {/* Block reason (if blocked) */}
            {row.block_reason && (
              <div className="flex items-start gap-2 px-3 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-300 mb-0.5">Why this is blocked</p>
                  <p className="text-xs text-red-300/80 leading-relaxed">
                    {blockReasonText(row.block_reason)}
                  </p>
                </div>
              </div>
            )}

            {/* Call result (if call happened) */}
            {row.final_status === "called" && row.reason && (
              <Section title="What happened on the call">
                <p className="text-sm text-foreground leading-relaxed">{row.reason}</p>
              </Section>
            )}

            {/* Take action */}
            {buttons.length > 0 && (
              <Section title="Take action">
                <div className="flex flex-col gap-2">
                  {buttons.map((btnKey) => {
                    const btn = BUTTONS[btnKey];
                    if (!btn) return null;
                    const { disabled, reason } = getDisabled(btnKey);

                    if (btn.kind === "ui" && btnKey === "view_reason") {
                      return null; // already shown via block_reason section above
                    }

                    return (
                      <div key={btnKey}>
                        <Button
                          variant={
                            btnKey.startsWith("approve") ? "default" : "outline"
                          }
                          disabled={disabled}
                          onClick={() => !disabled && setActiveButton(btnKey)}
                          className={cn(
                            "w-full h-10 text-sm font-medium justify-start",
                            !disabled &&
                              btnKey.startsWith("approve") &&
                              "bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20",
                          )}
                        >
                          {btn.label}
                        </Button>
                        {disabled && reason && (
                          <p className="text-[11px] text-muted-foreground mt-1 px-1 leading-snug">
                            {reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Action confirmation modal */}
      {activeButton && (
        <ActionModal
          open={!!activeButton}
          onClose={() => setActiveButton(null)}
          buttonKey={activeButton}
          row={row}
          previewOnly={previewOnly}
          onSuccess={() => {
            setActiveButton(null);
            onAction?.();
          }}
        />
      )}
    </>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

// ─── Meta row ─────────────────────────────────────────────────────────────────
function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="text-xs font-medium text-foreground text-right max-w-[60%]">
        {children}
      </span>
    </div>
  );
}

// ─── Contact card ─────────────────────────────────────────────────────────────
function ContactCard({
  name,
  email,
  phone,
  isPrimary,
  identityKey,
}: {
  name?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
  identityKey?: string;
}) {
  const identityMeta =
    identityKey
      ? IDENTITY_LABELS[identityKey as keyof typeof IDENTITY_LABELS]
      : null;

  if (!name && !email) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1">
      {isPrimary && (
        <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">
          Recommended contact
        </p>
      )}
      {name && (
        <div className="flex items-center gap-1.5">
          <User className="w-3 h-3 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{name}</span>
        </div>
      )}
      {email && (
        <div className="flex items-center gap-1.5">
          <Mail className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{email}</span>
        </div>
      )}
      {phone && (
        <div className="flex items-center gap-1.5">
          <Phone className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{phone}</span>
        </div>
      )}
      {identityMeta && (
        <p className="text-[11px] text-muted-foreground/80 pt-0.5 leading-relaxed">
          {identityMeta.label} — {identityMeta.detail}
        </p>
      )}
    </div>
  );
}
