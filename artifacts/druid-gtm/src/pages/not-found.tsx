import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-full w-full items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border border-status-danger-border bg-status-danger">
              <AlertCircle className="size-4 text-status-danger-foreground" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              404 Page Not Found
            </h1>
          </div>

          <p className="text-sm leading-5 text-muted-foreground">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
