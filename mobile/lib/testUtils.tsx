import type { ReactElement } from "react";
import { render, renderHook, type RenderHookOptions } from "@testing-library/react-native";
import { ThemeProvider } from "./ThemeProvider";

// Every screen/component now reads theme colors via useTheme(), which
// throws outside a ThemeProvider -- these wrap render()/renderHook() with
// one (AsyncStorage, which ThemeProvider reads on mount, is mocked
// globally for all tests -- see jest.config.js) so individual test files
// don't each need to remember to supply their own wrapper.
export async function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

export function renderHookWithTheme<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options?: Omit<RenderHookOptions<TProps>, "wrapper">
) {
  return renderHook(hook, { ...options, wrapper: ThemeProvider });
}
