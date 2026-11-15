import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageView } from "@/components/chat/ChatMessage";
import { ChoiceButtons } from "@/components/chat/ChoiceButtons";
import { ResultTable } from "@/components/chat/ResultTable";
import { askQuestion, parseChoices } from "@/lib/api-service";
import { letterColumns, narrowedFollowUp, parsePeople } from "@/lib/people";

const choices = parseChoices([
  {
    label: "A. Aman Kapoor · Sales rep · Indore · 3 deals",
    value: "A",
    kind: "person",
    letter: "A",
  },
  { label: "B. Aman Mehta · Sales rep · Pune · 2 deals", value: "B", kind: "person", letter: "B" },
  { label: "C. Aman Shah · Executive · Japan · 2 deals", value: "C", kind: "person", letter: "C" },
  { label: "All 3", value: "all", kind: "all" },
]);

describe("parsing", () => {
  it("reads kind and letter on choices, and the people list", () => {
    expect(choices[0]).toMatchObject({ kind: "option", letter: "A" });
    // "person" (the first name of this kind) is still understood.
    expect(choices[1]).toMatchObject({ kind: "option", letter: "B" });
    expect(choices[3]).toMatchObject({ kind: "all" });
    expect(parseChoices([{ label: "Show their deals", value: "x", kind: "weird" }])[0]).toEqual({
      label: "Show their deals",
      value: "x",
    });
    expect(
      parsePeople([
        { letter: "A", name: "Aman Kapoor", label: "Sales rep · Indore" },
        { letter: "" },
        5,
      ]),
    ).toEqual([{ letter: "A", name: "Aman Kapoor", label: "Sales rep · Indore" }]);
  });

  it("narrows a follow-up to selected letters, in A–Z order", () => {
    expect(narrowedFollowUp("deals", new Set(["C", "A"]))).toBe("Show deals of A, C");
    expect(narrowedFollowUp("everything", new Set(["C"]))).toBe("Show everything about C");
    expect(narrowedFollowUp("contacts", new Set())).toBeNull();
    expect(narrowedFollowUp("unknown", new Set(["A"]))).toBeNull();
  });
});

describe("person picker", () => {
  it("clicking a person row sends that letter", () => {
    const onPick = vi.fn();
    render(<ChoiceButtons choices={choices} active onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /^B\. Aman Mehta/ }));
    expect(onPick).toHaveBeenCalledWith({ value: "B", label: choices[1]?.label });
  });

  it("Show selected appears with 2+ ticks and sends the letters in list order", () => {
    const onPick = vi.fn();
    render(<ChoiceButtons choices={choices} active onPick={onPick} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Select C\./ }));
    expect(screen.queryByRole("button", { name: /Show selected/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select A\./ }));
    fireEvent.click(screen.getByRole("button", { name: "Show selected (2)" }));
    expect(onPick.mock.calls[0]?.[0].value).toBe("A, C");
  });

  it("ticking everyone sends 'all'", () => {
    const onPick = vi.fn();
    render(<ChoiceButtons choices={choices} active onPick={onPick} />);
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Show selected (3)" }));
    expect(onPick.mock.calls[0]?.[0].value).toBe("all");
  });

  it("the All button and follow-up buttons stay normal buttons", () => {
    const onPick = vi.fn();
    render(<ChoiceButtons choices={choices} active onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "All 3" }));
    expect(onPick).toHaveBeenCalledWith({ value: "all", label: "All 3" });
  });

  it("everything is disabled on an older message", () => {
    render(<ChoiceButtons choices={choices} active={false} onPick={vi.fn()} />);
    for (const el of [...screen.getAllByRole("checkbox"), ...screen.getAllByRole("button")]) {
      expect(el).toBeDisabled();
    }
  });
});

describe("several-people answers", () => {
  it("shows the short choice prompt instead of the full answer text", () => {
    render(
      <ChatMessageView
        message={{
          id: "1",
          role: "assistant",
          content: "I found 3 people named Aman:\nA. ...\nB. ...",
          choice_prompt: "I found 3 people named Aman. Which one?",
          choices,
        }}
        onChoose={vi.fn()}
        choicesActive
      />,
    );
    expect(screen.getByText("I found 3 people named Aman. Which one?")).toBeInTheDocument();
    expect(screen.queryByText(/A\. \.\.\./)).not.toBeInTheDocument();
  });

  it("shows the people key and the Person column as coloured letter badges", () => {
    const people = [
      { letter: "A", name: "Aman Kapoor", label: "Sales rep · Indore" },
      { letter: "C", name: "Aman Shah", label: "Executive · Japan" },
    ];
    render(
      <ChatMessageView
        message={{
          id: "1",
          role: "assistant",
          content: "Showing results for 2 people.",
          people,
          table: {
            columns: ["Person", "Deal Name", "Deal Value"],
            rows: [
              ["A", "Alpha Steel", 9000],
              ["C", "Tokyo Rail", 7500],
            ],
            truncated: false,
          },
        }}
      />,
    );
    const key = screen.getByRole("list", { name: "People in this answer" });
    expect(key).toHaveTextContent("AAman Kapoor · Sales rep · Indore");
    const badge = within(screen.getByRole("table")).getByTitle("Aman Shah");
    expect(badge).toHaveTextContent("C");
  });

  it("without people, a Person column is plain text", () => {
    render(
      <ResultTable table={{ columns: ["Person", "X"], rows: [["A", 1]], truncated: false }} />,
    );
    // The letter is plain text in the cell, not a badge.
    expect(screen.getByText("A").tagName).toBe("TD");
  });
});

describe("v2: groups and letter columns", () => {
  const grouped = parseChoices([
    { label: "A. Aman Kapoor · Sales rep", value: "A", kind: "option", letter: "A", group: "Aman" },
    { label: "B. Aman Mehta · Sales rep", value: "B", kind: "option", letter: "B", group: "Aman" },
    { label: "C. Sales rep · Indore", value: "C", kind: "option", letter: "C", group: "Neha Rao" },
    { label: "D. Sales rep · Pune", value: "D", kind: "option", letter: "D", group: "Neha Rao" },
    { label: "All 4", value: "all", kind: "all" },
  ]);

  it("shows a heading per name, in the order received", () => {
    render(<ChoiceButtons choices={grouped} active onPick={vi.fn()} />);
    expect(screen.getByRole("list", { name: "Aman" })).toHaveTextContent("Aman Kapoor");
    expect(screen.getByRole("list", { name: "Neha Rao" })).toHaveTextContent("Pune");
  });

  it("Show selected waits until every name has a tick, then sends the letters", () => {
    const onPick = vi.fn();
    render(<ChoiceButtons choices={grouped} active onPick={onPick} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Select A\./ }));
    expect(screen.getByRole("button", { name: "Show selected (1)" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Also pick one for: Neha Rao");
    fireEvent.click(screen.getByRole("checkbox", { name: /Select C\./ }));
    fireEvent.click(screen.getByRole("button", { name: "Show selected (2)" }));
    expect(onPick.mock.calls[0]?.[0].value).toBe("A, C");
  });

  it("reads people[].kind and finds the Person and Deal letter columns", () => {
    const people = parsePeople([
      { letter: "A", name: "Aman Kapoor", label: "Sales rep", kind: "user" },
      { letter: "C", name: "Alpha Steel", label: "Proposal", kind: "deal" },
      { letter: "Z", name: "x", kind: "spaceship" },
    ]);
    expect(people.map((p) => p.kind)).toEqual(["user", "deal", undefined]);
    const cols = letterColumns(["Person", "Deal", "Deal Value"], people);
    expect([...cols.keys()]).toEqual([0, 1]);
    expect(cols.get(1)?.get("C")?.name).toBe("Alpha Steel");
  });

  it("an ordinary Deal column is never turned into badges", () => {
    const people = [{ letter: "A", name: "Aman Kapoor", label: "", kind: "user" as const }];
    expect(letterColumns(["Person", "Deal"], people).has(1)).toBe(false);
    render(
      <ResultTable
        table={{ columns: ["Person", "Deal"], rows: [["A", "A"]], truncated: false }}
        people={people}
      />,
    );
    expect(screen.getAllByTitle("Aman Kapoor")).toHaveLength(1);
  });

  it("with people and deals, the key has a heading per kind", () => {
    render(
      <ChatMessageView
        message={{
          id: "1",
          role: "assistant",
          content: "x",
          people: [
            { letter: "A", name: "Aman Kapoor", label: "Sales rep", kind: "user" },
            { letter: "C", name: "Alpha Steel", label: "Proposal", kind: "deal" },
          ],
        }}
      />,
    );
    expect(screen.getByRole("list", { name: "People" })).toHaveTextContent("Aman Kapoor");
    expect(screen.getByRole("list", { name: "Deals" })).toHaveTextContent("Alpha Steel");
  });
});

describe("v3: follow-ups narrowed by selected people", () => {
  const people = [
    { letter: "A", name: "Aman Kapoor", label: "Sales rep", kind: "user" as const },
    { letter: "C", name: "Aman Shah", label: "Executive", kind: "user" as const },
  ];
  const followups = parseChoices([
    { label: "Show their deals", value: "Show deals of A, C", kind: "followup", action: "deals" },
    {
      label: "Show everything",
      value: "Show everything about A, C",
      kind: "followup",
      action: "everything",
    },
  ]);
  const message = {
    id: "1",
    role: "assistant" as const,
    content: "Showing results for 2 people.",
    people,
    choices: followups,
  };

  it("parses kind followup and action", () => {
    expect(followups[0]).toMatchObject({ kind: "followup", action: "deals" });
  });

  it("with nothing selected, a follow-up sends its value as is", () => {
    const onChoose = vi.fn();
    render(<ChatMessageView message={message} onChoose={onChoose} choicesActive />);
    fireEvent.click(screen.getByRole("button", { name: "Show their deals" }));
    expect(onChoose).toHaveBeenCalledWith({
      value: "Show deals of A, C",
      label: "Show their deals",
    });
  });

  it("selecting a chip narrows the buttons; clicking sends the narrowed text and clears the selection", () => {
    const onChoose = vi.fn();
    render(<ChatMessageView message={message} onChoose={onChoose} choicesActive />);
    const chip = screen.getByRole("button", { name: /Aman Shah/ });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show deals of C" }));
    expect(onChoose).toHaveBeenCalledWith({ value: "Show deals of C", label: "Show deals of C" });
    expect(screen.getByRole("button", { name: /Aman Shah/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("chips are not selectable on an older answer, and a newer answer clears the selection", () => {
    const { rerender } = render(
      <ChatMessageView message={message} onChoose={vi.fn()} choicesActive />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Aman Shah/ }));
    rerender(<ChatMessageView message={message} onChoose={vi.fn()} choicesActive={false} />);
    expect(screen.queryByRole("button", { name: /Aman Shah/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show everything" })).toBeDisabled();
  });
});

describe("picker cascade", () => {
  const grouped = parseChoices([
    { label: "A. Aman Kapoor", value: "A", kind: "option", letter: "A", group: "Aman" },
    { label: "B. Aman Mehta", value: "B", kind: "option", letter: "B", group: "Aman" },
    { label: "C. Priya Nair", value: "C", kind: "option", letter: "C", group: "Priya" },
  ]);

  it("headings and rows cascade in order for a new answer", () => {
    render(<ChoiceButtons choices={grouped} active onPick={vi.fn()} animate />);
    const delays = [
      screen.getByText("Aman"),
      ...screen.getAllByRole("listitem").slice(0, 2),
      screen.getByText("Priya"),
      screen.getAllByRole("listitem")[2],
    ].map((el) => (el as HTMLElement).style.animationDelay);
    expect(delays).toEqual(["0ms", "45ms", "90ms", "135ms", "180ms"]);
  });

  it("no cascade on older answers, and ticking a box stops it at once", () => {
    const { unmount } = render(<ChoiceButtons choices={grouped} active onPick={vi.fn()} />);
    expect(screen.getAllByRole("listitem")[0]?.style.animationDelay).toBe("");
    unmount();
    render(<ChoiceButtons choices={grouped} active onPick={vi.fn()} animate />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Select A\./ }));
    expect(screen.getAllByRole("listitem")[0]?.style.animationDelay).toBe("");
  });
});

describe("v4: +N more (people_more)", () => {
  const followups = parseChoices([
    { label: "Show their deals", value: "Show deals of A", kind: "followup", action: "deals" },
  ]);
  const message = {
    id: "1",
    role: "assistant" as const,
    content: "Showing results for Aman Kapoor.",
    people: [
      { letter: "A", name: "Aman Kapoor", label: "Sales rep · Indore", kind: "user" as const },
    ],
    people_more: [
      { letter: "B", name: "Aman Mehta", label: "Sales rep · Indore", kind: "user" as const },
      { letter: "D", name: "Aman Jain", label: "Sales rep · East", kind: "user" as const },
    ],
    choices: followups,
  };

  it("is read from the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            answer: "x",
            people_more: [{ letter: "B", name: "Aman Mehta", label: "" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const r = await askQuestion("q");
    expect(r.people_more?.[0]?.name).toBe("Aman Mehta");
    vi.unstubAllGlobals();
  });

  it("shows a collapsed +2 more chip that expands to the other people", () => {
    render(<ChatMessageView message={message} onChoose={vi.fn()} choicesActive />);
    const more = screen.getByRole("button", { name: "+2 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Aman Jain")).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.getByRole("list", { name: "Also in the list" })).toHaveTextContent("Aman Jain");
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText("Aman Jain")).not.toBeInTheDocument();
  });

  it("the faded chips are selectable and narrow the follow-ups, together with the key chips", () => {
    const onChoose = vi.fn();
    render(<ChatMessageView message={message} onChoose={onChoose} choicesActive />);
    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
    fireEvent.click(screen.getByRole("button", { name: /Aman Jain/ }));
    expect(screen.getByRole("button", { name: "Show deals of D" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^A Aman Kapoor/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show deals of A, D" }));
    expect(onChoose).toHaveBeenCalledWith({
      value: "Show deals of A, D",
      label: "Show deals of A, D",
    });
  });
});

describe("step 24: lists A–Z", () => {
  const letters = "ABCDEFGHIJKLMNOPQRST".split("");

  it("keeps all 20 options plus All", () => {
    const raw = [
      ...letters.map((l) => ({ label: `${l}. Person ${l}`, value: l, kind: "option", letter: l })),
      { label: "All 20", value: "all", kind: "all" },
    ];
    const parsed = parseChoices(raw);
    expect(parsed).toHaveLength(21);
    render(<ChoiceButtons choices={parsed} active onPick={vi.fn()} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(20);
    expect(screen.getByRole("button", { name: "All 20" })).toBeInTheDocument();
  });

  it("keeps people after the 26th (numbers instead of letters) and sorts them after the letters", () => {
    const many = Array.from({ length: 28 }, (_, i) => ({
      letter: i < 26 ? String.fromCharCode(65 + i) : String(i + 1),
      name: `P${i + 1}`,
      label: "",
    }));
    const people = parsePeople(many);
    expect(people).toHaveLength(28);
    expect(people[27]?.letter).toBe("28");
    expect(narrowedFollowUp("deals", new Set(["28", "B", "27"]))).toBe("Show deals of B, 27, 28");
  });
});
