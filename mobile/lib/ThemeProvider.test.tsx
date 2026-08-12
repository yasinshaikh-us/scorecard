import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { renderHook, waitFor, act } from "@testing-library/react-native";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { lightColors, darkColors } from "./theme";

// Mocking the specific internal module react-native's own `useColorScheme`
// export lazily requires (rather than jest.mock("react-native") itself,
// which re-triggers RN's native-module-registering lazy getters at mock-
// factory time and breaks the whole test environment) so the rest of
// react-native's real exports stay untouched.
const mockUseColorScheme = jest.fn() as jest.Mock<any>;
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockUseColorScheme(),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe("ThemeProvider", () => {
  beforeEach(() => {
    mockUseColorScheme.mockReset();
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    (AsyncStorage.getItem as jest.Mock<any>).mockReset().mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock<any>).mockReset().mockResolvedValue(undefined);
  });

  it("useTheme() throws when used outside a ThemeProvider", async () => {
    await expect(renderHook(() => useTheme())).rejects.toThrow("useTheme() must be called within a ThemeProvider");
  });

  it("follows the system color scheme (dark) when there's no stored override", async () => {
    mockUseColorScheme.mockReturnValue("dark");
    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });

    expect(result.current.mode).toBe("dark");
    expect(result.current.colors).toEqual(darkColors);
  });

  it("follows the system color scheme (light) when there's no stored override", async () => {
    mockUseColorScheme.mockReturnValue("light");
    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });

    expect(result.current.mode).toBe("light");
    expect(result.current.colors).toEqual(lightColors);
  });

  it("an unrecognized system scheme (null) falls back to dark", async () => {
    mockUseColorScheme.mockReturnValue(null);
    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });

    expect(result.current.mode).toBe("dark");
  });

  it("a stored override wins over the system scheme", async () => {
    mockUseColorScheme.mockReturnValue("dark");
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    (AsyncStorage.getItem as jest.Mock<any>).mockResolvedValue("light");

    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });

    await waitFor(() => expect(result.current.mode).toBe("light"));
  });

  it("toggleTheme() flips the mode and persists the override", async () => {
    mockUseColorScheme.mockReturnValue("dark");
    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    await waitFor(() => expect(result.current.mode).toBe("dark"));

    await act(async () => {
      result.current.toggleTheme();
    });

    expect(result.current.mode).toBe("light");
    expect(result.current.colors).toEqual(lightColors);
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("theme", "light");
  });
});
