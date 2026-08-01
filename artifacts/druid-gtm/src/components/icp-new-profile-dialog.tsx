import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  createIcpProfile,
  icpProfilesListQueryKey,
  IcpProfilesApiError,
} from "@/lib/icp-profiles-api";
import { buildStarterProfileConfig } from "@/lib/icp-profile-config-editing";

// Creation flow for a brand-new ICP profile: name + description only —
// the initial draft's config is always buildStarterProfileConfig() (see
// that function's own comment: empty rule collections, one required
// fallback band each for fit and intent). Nothing about fit/intent/
// actionability/eligibility criteria is ever guessed here; the author
// adds real rules afterward in the draft editor. On success, navigates
// straight to the new profile's detail page so the draft editor is the
// very next thing the user sees.

export function NewIcpProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createIcpProfile({
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        config: buildStarterProfileConfig(),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: icpProfilesListQueryKey() });
      onOpenChange(false);
      setName("");
      setDescription("");
      createMutation.reset();
      navigate(`/settings/icp-profiles/${result.profile.id}`);
    },
  });

  const canCreate = name.trim().length > 0 && !createMutation.isPending;

  function handleOpenChange(next: boolean) {
    if (!next) {
      createMutation.reset();
      setName("");
      setDescription("");
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-border bg-background">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-base font-semibold font-display">
            New ICP profile
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            This creates the profile and an initial draft with no rules yet —
            you&apos;ll define fit, buying intent, ability to act, and eligibility
            criteria next.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="new-profile-name" className="text-sm font-medium">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Enterprise SaaS"
              className="h-9 text-sm bg-input border-border focus-visible:ring-primary"
              disabled={createMutation.isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-profile-description" className="text-sm font-medium">
              Description
            </Label>
            <Textarea
              id="new-profile-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — what this ICP profile is for"
              className="resize-none h-20 text-sm bg-input border-border focus-visible:ring-primary"
              disabled={createMutation.isPending}
            />
          </div>

          {createMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Could not create this profile</AlertTitle>
              <AlertDescription>
                {createMutation.error instanceof IcpProfilesApiError
                  ? createMutation.error.message
                  : "Could not reach the server. Try again."}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4 gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createMutation.isPending}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canCreate}
            className="flex-1 bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {createMutation.isPending ? "Creating…" : "Create profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
