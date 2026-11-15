import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnswerText } from "@/components/chat/AnswerText";

describe("AnswerText", () => {
  it("renders bold text and lists", () => {
    render(<AnswerText text={"See **Source 2, page 7**.\n\n- one\n- two"} />);
    expect(screen.getByText("Source 2, page 7").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps single line breaks", () => {
    const { container } = render(
      <AnswerText text={"Two owners.\nInterpreted as: deals by owner"} />,
    );
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(container.textContent).toContain("Interpreted as: deals by owner");
  });

  it("never renders raw HTML or images", () => {
    const { container } = render(
      <AnswerText text={"Hi <script>alert(1)</script><b>x</b> ![pic](http://e.com/a.png)"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens links safely in a new tab", () => {
    render(<AnswerText text="[docs](https://example.com)" />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
