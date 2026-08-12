import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import PickerModal from "./PickerModal";

const OPTIONS = [
  { label: "Payee", value: "payee" },
  { label: "Category", value: "category" },
];

describe("PickerModal", () => {
  it("renders nothing selectable when not visible", async () => {
    await render(<PickerModal visible={false} title="If" options={OPTIONS} onSelect={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByText("Payee")).toBeNull();
  });

  it("lists all options with the title when visible", async () => {
    await render(<PickerModal visible={true} title="If" options={OPTIONS} onSelect={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText("If")).toBeTruthy();
    expect(screen.getByText("Payee")).toBeTruthy();
    expect(screen.getByText("Category")).toBeTruthy();
  });

  it("selecting an option calls onSelect with its value and then onClose", async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    await render(<PickerModal visible={true} title="If" options={OPTIONS} onSelect={onSelect} onClose={onClose} />);
    await fireEvent.press(screen.getByText("Category"));
    expect(onSelect).toHaveBeenCalledWith("category");
    expect(onClose).toHaveBeenCalled();
  });

  it("tapping Cancel calls onClose without onSelect", async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    await render(<PickerModal visible={true} title="If" options={OPTIONS} onSelect={onSelect} onClose={onClose} />);
    await fireEvent.press(screen.getByTestId("picker-cancel-button"));
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("tapping inside the sheet itself doesn't dismiss it (only the backdrop/Cancel do)", async () => {
    const onClose = jest.fn();
    await render(<PickerModal visible={true} title="If" options={OPTIONS} onSelect={jest.fn()} onClose={onClose} />);
    await fireEvent.press(screen.getByText("If"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
