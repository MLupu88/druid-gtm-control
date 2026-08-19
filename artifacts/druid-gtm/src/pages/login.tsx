import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { InlineNotice } from "@/components/inline-notice";
import logoWhite from "@/assets/new_logo_white.png";
import logoBlack from "@/assets/new-druid-logo-black.png";

export default function LoginPage() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login.mutateAsync(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.07),transparent_38%)]" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src={logoWhite} alt="DRUID" className="logo-white h-7 w-auto" />
          <img src={logoBlack} alt="DRUID" className="logo-black h-7 w-auto" />
          <div className="h-6 w-px bg-border" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">Mission Control</p>
        </div>

        <Card className="bg-card/95">
          <CardContent className="p-5 sm:p-6">
            <div className="mb-5 space-y-1">
              <h1 className="text-lg font-semibold text-foreground">Sign in</h1>
              <p className="text-sm text-muted-foreground">Internal access only.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs text-muted-foreground">
                  Access code
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {error && <InlineNotice tone="danger">{error}</InlineNotice>}

              <Button
                type="submit"
                className="w-full"
                disabled={login.isPending || !password}
              >
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
