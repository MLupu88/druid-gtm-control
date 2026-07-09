import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Operator {
  name: string;
  email: string;
  role: string;
}

interface AuthState {
  authenticated: boolean;
  operator?: Operator;
}

async function fetchMe(): Promise<AuthState> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return { authenticated: false };
  if (!res.ok) throw new Error("Auth check failed");
  return res.json() as Promise<AuthState>;
}

export function useAuth() {
  const qc = useQueryClient();

  const meQuery = useQuery<AuthState>({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const loginMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Incorrect access code.");
      }
      return res.json() as Promise<AuthState>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    },
    onSuccess: () => {
      qc.setQueryData<AuthState>(["auth", "me"], { authenticated: false });
    },
  });

  return {
    isLoading: meQuery.isLoading,
    isAuthed: meQuery.data?.authenticated === true,
    operator: meQuery.data?.operator,
    login: loginMutation,
    logout: logoutMutation,
  };
}
