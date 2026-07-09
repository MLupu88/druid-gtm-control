import { createContext, useContext, useState, type ReactNode } from "react";

export type ViewMode = "live" | "sample";

interface SampleModeCtx {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
}

const SampleModeContext = createContext<SampleModeCtx>({
  viewMode: "live",
  setViewMode: () => {},
});

export function SampleModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  return (
    <SampleModeContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </SampleModeContext.Provider>
  );
}

export function useSampleMode() {
  return useContext(SampleModeContext);
}
