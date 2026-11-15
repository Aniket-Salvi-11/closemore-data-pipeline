import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceChips } from "@/components/chat/SourceChips";

const sources = [
  {
    n: 2,
    document: "Security policy",
    page: 7,
    doc_id: null,
    snippet: "Runs in our own data centres.",
  },
  { n: 3, document: "Old handbook", page: null, doc_id: null, snippet: null },
];

describe("SourceChips", () => {
  it("numbers chips like the answer text and shows the page", () => {
    render(<SourceChips sources={sources} />);
    expect(
      screen.getByRole("button", { name: /Source 2 · Security policy · p\. 7/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Source 3 · Old handbook" })).toBeInTheDocument();
  });

  it("opens and closes the matching text on click", () => {
    render(<SourceChips sources={sources} />);
    const chip = screen.getByRole("button", { name: /Source 2/ });
    fireEvent.click(chip);
    expect(screen.getByText("Runs in our own data centres.")).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.queryByText("Runs in our own data centres.")).not.toBeInTheDocument();
  });

  it("disables a chip that has no text to show, and renders nothing for no sources", () => {
    const { container, rerender } = render(<SourceChips sources={sources} />);
    expect(screen.getByRole("button", { name: /Source 3/ })).toBeDisabled();
    rerender(<SourceChips sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
