import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  publishIcpProfileDraft,
  activateIcpProfileVersion,
  cloneIcpProfileVersionIntoDraft,
  icpProfileDetailQueryKey,
  icpProfilesListQueryKey,
  IcpProfilesApiError,
  type IcpProfileVersion,
} from "@/lib/icp-profiles-api";

// Publish / Activate / Clone-into-draft — the three profile lifecycle
// mutations this slice adds. Each is confirm-gated (never a single-click
// destructive-ish action), invalidates both the profile detail and the
// profiles list on success (both surfaces show lifecycle-derived badges
// — see ../lib/icp-profile-presentation.ts's deriveProfileBadges), and
// reports pending/success/human-readable-failure states inline near its
// own button rather than only inside the dialog, so the outcome stays
// visible after the dialog closes.

function invalidateProfileQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  profileId: string,
) {
  void queryClient.invalidateQueries({ queryKey: icpProfileDetailQueryKey(profileId) });
  void queryClient.invalidateQueries({ queryKey: icpProfilesListQueryKey() });
}

// ---------------------------------------------------------------------
// Shared confirm dialog shell
// ---------------------------------------------------------------------
function LifecycleConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  pendingLabel,
  onConfirm,
  isPending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  onConfirm: () => void;
  isPending: boolean;
  error: unknown;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md rounded-2xl border border-border bg-background">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-base font-semibold font-display">{title}</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div className="text-sm text-foreground leading-relaxed space-y-2">{children}</div>
          {error !== null && <LifecycleErrorAlert error={error} />}
        </div>
        <DialogFooter className="border-t border-border pt-4 gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20"
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LifecycleErrorAlert({ error }: { error: unknown }) {
  const message =
    error instanceof IcpProfilesApiError
      ? error.message
      : error instanceof Error
        ? "Could not reach the server. Try again."
        : "Something went wrong.";
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Action failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function InlineOutcome({ outcome, successLabel }: { outcome: "success" | "error" | null; successLabel: string }) {
  if (outcome === "success") {
    return (
      <div className="flex items-center gap-1 text-[11px] text-primary">
        <CheckCircle2 className="w-3 h-3" />
        {successLabel}
      </div>
    );
  }
  if (outcome === "error") {
    return (
      <div className="flex items-center gap-1 text-[11px] text-red-400">
        <AlertCircle className="w-3 h-3" />
        Failed — see above to retry
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------
// Publish draft
// ---------------------------------------------------------------------
export interface PublishDraftActionProps {
  profileId: string;
  /** Gate computed by the caller from the SAME live schema-backed validation + dirty state the draft editor already tracks — never re-derived here. */
  disabled: boolean;
  disabledReason: string | null;
}

export function PublishDraftAction({
  profileId,
  disabled,
  disabledReason,
}: PublishDraftActionProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"success" | "error" | null>(null);

  const mutation = useMutation({
    mutationFn: () => publishIcpProfileDraft(profileId),
    onSuccess: () => {
      setOutcome("success");
      setOpen(false);
      invalidateProfileQueries(queryClient, profileId);
    },
    onError: () => {
      setOutcome("error");
    },
  });

  function handleOpenChange(next: boolean) {
    if (next) {
      setOutcome(null);
      mutation.reset();
    }
    setOpen(next);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => handleOpenChange(true)}
        disabled={disabled}
      >
        Publish draft
      </Button>
      {disabled && disabledReason && (
        <p className="text-[11px] text-muted-foreground">{disabledReason}</p>
      )}
      <InlineOutcome outcome={outcome} successLabel="Published." />

      <LifecycleConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Publish this draft?"
        confirmLabel="Publish"
        pendingLabel="Publishing…"
        onConfirm={() => mutation.mutate()}
        isPending={mutation.isPending}
        error={mutation.isError ? mutation.error : null}
      >
        <p>
          Publishing turns this draft into an immutable published version — once
          published, its rules, tiers, and disqualifiers can never be edited
          again. You&apos;ll still be able to view it, activate it, or clone it
          into a new draft.
        </p>
        <p className="text-muted-foreground">
          Publishing does not make this version active. Existing evaluations
          keep using whichever version is currently active until you explicitly
          activate this one.
        </p>
      </LifecycleConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------
// Activate a published version
// ---------------------------------------------------------------------
export interface ActivateVersionActionProps {
  profileId: string;
  version: IcpProfileVersion;
  isActive: boolean;
}

export function ActivateVersionAction({
  profileId,
  version,
  isActive,
}: ActivateVersionActionProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"success" | "error" | null>(null);

  const mutation = useMutation({
    mutationFn: () => activateIcpProfileVersion(profileId, version.id),
    onSuccess: () => {
      setOutcome("success");
      setOpen(false);
      invalidateProfileQueries(queryClient, profileId);
    },
    onError: () => {
      setOutcome("error");
    },
  });

  function handleOpenChange(next: boolean) {
    if (next) {
      setOutcome(null);
      mutation.reset();
    }
    setOpen(next);
  }

  // Never shown/enabled for a draft — only ../pages/icp-profile-detail.tsx
  // renders this action, and only when version.status === "published".
  // Disabled (not hidden) for the already-active version — the backend
  // itself would accept a no-op re-activation, but re-offering it as a
  // live action invites confusion about what clicking it would do.
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => handleOpenChange(true)}
        disabled={isActive}
      >
        {isActive ? "Currently active" : "Activate version"}
      </Button>
      <InlineOutcome outcome={outcome} successLabel="Activated." />

      <LifecycleConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={`Activate version ${version.versionNumber}?`}
        confirmLabel="Activate"
        pendingLabel="Activating…"
        onConfirm={() => mutation.mutate()}
        isPending={mutation.isPending}
        error={mutation.isError ? mutation.error : null}
      >
        <p>
          From now on, official evaluations for this profile will use version{" "}
          {version.versionNumber} instead of whichever version is currently
          active.
        </p>
        <p className="text-muted-foreground">
          Evaluations already saved on existing accounts are not automatically
          recalculated — they keep whatever result they already recorded.
          Nothing about existing accounts changes just by activating this
          version.
        </p>
      </LifecycleConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------
// Clone a published version into a new draft
// ---------------------------------------------------------------------
export interface CloneVersionActionProps {
  profileId: string;
  version: IcpProfileVersion;
}

export function CloneVersionAction({ profileId, version }: CloneVersionActionProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"success" | "error" | null>(null);

  const mutation = useMutation({
    mutationFn: () => cloneIcpProfileVersionIntoDraft(profileId, version.id),
    onSuccess: () => {
      setOutcome("success");
      setOpen(false);
      // The draft editor is rendered whenever the profile has a draft
      // (see ../pages/icp-profile-detail.tsx) — invalidating here is
      // what makes it appear immediately, no separate "open" step needed.
      invalidateProfileQueries(queryClient, profileId);
    },
    onError: () => {
      setOutcome("error");
    },
  });

  function handleOpenChange(next: boolean) {
    if (next) {
      setOutcome(null);
      mutation.reset();
    }
    setOpen(next);
  }

  // Only ever rendered by the caller when the profile currently has no
  // draft (cloneVersionIntoDraft rejects with draft_already_exists
  // otherwise) — this component itself does not re-check that, it
  // trusts the caller's condition, matching how
  // ../pages/icp-profile-detail.tsx already gates the draft editor vs.
  // NoDraftMessage on the same fact.
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant="outline" onClick={() => handleOpenChange(true)}>
        Clone into new draft
      </Button>
      <InlineOutcome outcome={outcome} successLabel="Draft created." />

      <LifecycleConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={`Clone version ${version.versionNumber} into a new draft?`}
        confirmLabel="Clone"
        pendingLabel="Cloning…"
        onConfirm={() => mutation.mutate()}
        isPending={mutation.isPending}
        error={mutation.isError ? mutation.error : null}
      >
        <p>
          This creates a new editable draft with an exact copy of version{" "}
          {version.versionNumber}&apos;s rules, tiers, and disqualifiers. Version{" "}
          {version.versionNumber} itself is never changed.
        </p>
      </LifecycleConfirmDialog>
    </div>
  );
}
