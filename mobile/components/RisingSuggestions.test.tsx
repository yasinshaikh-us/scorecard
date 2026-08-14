import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import RisingSuggestions from "./RisingSuggestions";

// Only useReducedMotion is swapped -- everything else is the real
// library, so this exercises the actual Animated.View render path rather
// than a stub of it. `default` has to be re-attached by hand: spreading
// the ESM namespace object alone drops it, and it is what Animated.View
// comes from.
const mockUseReducedMotion = jest.fn(() => false) as jest.Mock<any>;
jest.mock("react-native-reanimated", () => {
  const actual: any = jest.requireActual("react-native-reanimated");
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    useReducedMotion: () => mockUseReducedMotion(),
  };
});

const SUGGESTIONS = ["How much did I spend on dining last month?", "Top 10 expenses this month", "Show me my recent transactions"];

describe("RisingSuggestions", () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it("renders one tappable line per suggestion", async () => {
    await renderWithTheme(<RisingSuggestions suggestions={SUGGESTIONS} onPick={jest.fn()} />);
    expect(screen.getAllByTestId("ask-suggestion")).toHaveLength(SUGGESTIONS.length);
    for (const s of SUGGESTIONS) expect(screen.getByText(s)).toBeTruthy();
  });

  it("passes the tapped suggestion's own text to onPick", async () => {
    const onPick = jest.fn();
    await renderWithTheme(<RisingSuggestions suggestions={SUGGESTIONS} onPick={onPick} />);
    await fireEvent.press(screen.getByText(SUGGESTIONS[1]));
    expect(onPick).toHaveBeenCalledWith(SUGGESTIONS[1]);
  });

  it("doesn't fire onPick while disabled (data not ready)", async () => {
    const onPick = jest.fn();
    await renderWithTheme(<RisingSuggestions suggestions={SUGGESTIONS} disabled onPick={onPick} />);
    await fireEvent.press(screen.getByText(SUGGESTIONS[0]));
    expect(onPick).not.toHaveBeenCalled();
  });

  // The drifting layout stacks absolutely-positioned items in one space,
  // so "the same layout, held still" would render all of them on top of
  // each other. Reduce-motion is a different layout, and it still has to
  // offer every suggestion and still have to work.
  describe("with reduce motion enabled", () => {
    beforeEach(() => {
      mockUseReducedMotion.mockReturnValue(true);
    });

    it("renders every suggestion as a plain static column", async () => {
      await renderWithTheme(<RisingSuggestions suggestions={SUGGESTIONS} onPick={jest.fn()} />);
      expect(screen.getAllByTestId("ask-suggestion")).toHaveLength(SUGGESTIONS.length);
      for (const s of SUGGESTIONS) expect(screen.getByText(s)).toBeTruthy();
    });

    it("is still tappable", async () => {
      const onPick = jest.fn();
      await renderWithTheme(<RisingSuggestions suggestions={SUGGESTIONS} onPick={onPick} />);
      await fireEvent.press(screen.getByText(SUGGESTIONS[2]));
      expect(onPick).toHaveBeenCalledWith(SUGGESTIONS[2]);
    });

    it("still honours disabled", async () => {
      const onPick = jest.fn();
      await renderWithTheme(<RisingSuggestions suggestions={SUGGESTIONS} disabled onPick={onPick} />);
      await fireEvent.press(screen.getByText(SUGGESTIONS[0]));
      expect(onPick).not.toHaveBeenCalled();
    });
  });
});
