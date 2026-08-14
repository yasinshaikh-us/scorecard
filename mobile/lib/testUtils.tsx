import type { ReactElement } from "react";
import { render, renderHook, type RenderHookOptions } from "@testing-library/react-native";
import { SafeAreaFrameContext, SafeAreaInsetsContext, type Metrics } from "react-native-safe-area-context";
import { ThemeProvider } from "./ThemeProvider";

// Fixed, non-zero insets rather than the real device's. `SafeAreaView`
// degrades quietly without a provider, but `useSafeAreaInsets()` throws
// ("No safe area value available"), and app/login.tsx needs it: that
// screen is a plain centred View, so its absolutely-positioned theme
// toggle and version have to offset themselves or they render under the
// system bars -- which a real Stage 2 screenshot caught them doing.
//
// Non-zero on purpose. Zeroes would let an inset-less regression pass
// here and only show up on a device.
const TEST_METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// The two contexts directly rather than <SafeAreaProvider>: the provider
// renders a real host view, which would make screen.toJSON() non-null and
// break every "renders nothing" assertion in the suite. A context
// provider renders nothing of its own, so those stay meaningful.
function AllProviders({ children }: { children: ReactElement }) {
  return (
    <SafeAreaFrameContext.Provider value={TEST_METRICS.frame}>
      <SafeAreaInsetsContext.Provider value={TEST_METRICS.insets}>
        <ThemeProvider>{children}</ThemeProvider>
      </SafeAreaInsetsContext.Provider>
    </SafeAreaFrameContext.Provider>
  );
}

// Every screen/component now reads theme colors via useTheme(), which
// throws outside a ThemeProvider -- these wrap render()/renderHook() with
// one (AsyncStorage, which ThemeProvider reads on mount, is mocked
// globally for all tests -- see jest.config.js) so individual test files
// don't each need to remember to supply their own wrapper.
export async function renderWithTheme(ui: ReactElement) {
  return render(<AllProviders>{ui}</AllProviders>);
}

export function renderHookWithTheme<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options?: Omit<RenderHookOptions<TProps>, "wrapper">
) {
  return renderHook(hook, { ...options, wrapper: AllProviders as never });
}

export { TEST_METRICS };
