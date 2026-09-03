import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AnalysisResult } from '../types';

interface AnalysisContextValue {
  result: AnalysisResult | null;
  setResult: (r: AnalysisResult | null) => void;
  clearResult: () => void;
}

const AnalysisContext = createContext<AnalysisContextValue | undefined>(
  undefined,
);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [result, setResultState] = useState<AnalysisResult | null>(null);

  const setResult = useCallback((r: AnalysisResult | null) => {
    setResultState(r);
  }, []);

  const clearResult = useCallback(() => setResultState(null), []);

  const value = useMemo<AnalysisContextValue>(
    () => ({ result, setResult, clearResult }),
    [result, setResult, clearResult],
  );

  return (
    <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>
  );
}

export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext);
  if (!ctx) {
    throw new Error('useAnalysis must be used inside <AnalysisProvider>');
  }
  return ctx;
}
