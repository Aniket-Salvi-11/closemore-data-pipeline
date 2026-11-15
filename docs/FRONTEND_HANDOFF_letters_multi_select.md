# Frontend handoff: letters, picking several, letter columns (v4)

**Changed since v1:** `choices[].kind` is now `"option"` (was `"person"`), choices can carry a `group`, `people[]` items carry a `kind`, and the letter column can be **Person**, **Deal**, **Contact** or **Product**. Several names in one question come in ONE list (section 1b).

**New in v4:** `people_more` for faded "+N more" chips (section 3c). Small-talk replies are now instant (no frontend change).

**New in v3:** follow-up buttons use letters and can be narrowed to selected people (section 3b). Use one neutral badge colour (section 3).

Backend → frontend. All new fields are optional. Old clients keep working, because the `answer` text still has the full list.

## 1. "Which one?" response (`/ask`)

```json
{
  "answer": "I found 4 people named Aman:\nA. Aman Kapoor · Sales rep · Indore · 3 deals\nB. ...\n\nWhich one? Reply A, B, C or D, several like \"A, D\", or all.",
  "choice_prompt": "I found 4 people named Aman. Which one?",
  "choices": [
    {"label": "A. Aman Kapoor · Sales rep · Indore · 3 deals", "value": "A", "kind": "option", "letter": "A"},
    {"label": "B. Aman Mehta · Sales rep · Pune · 2 deals",    "value": "B", "kind": "option", "letter": "B"},
    {"label": "All 4", "value": "all", "kind": "all"}
  ]
}
```

- `choice_prompt` (new, optional): when it's present, show it above the buttons **instead of** `answer`, so the list doesn't appear twice. If it's missing, show `answer` as today.
- `choices[].kind` (new, optional):
  - `"option"`: a checkbox row. The letter is in `letter`.
  - `"all"`: the "All N" / "Both" button.
  - Missing (follow-up buttons such as "Show their deals"): a normal button, as today.

## 1b. Several unclear names in one question ("tell me about Aman and Neha Rao")

```json
{
  "choice_prompt": "I found several matches for 2 names. Which ones?",
  "choices": [
    {"label": "A. Aman Kapoor · Sales rep · Indore · 1 deal", "value": "A", "kind": "option", "letter": "A", "group": "Aman"},
    {"label": "B. Aman Mehta · Sales rep · Indore · 1 deal",  "value": "B", "kind": "option", "letter": "B", "group": "Aman"},
    {"label": "C. Sales rep · Indore · 0 deals",              "value": "C", "kind": "option", "letter": "C", "group": "Neha Rao"},
    {"label": "D. Sales rep · Pune · 0 deals",                "value": "D", "kind": "option", "letter": "D", "group": "Neha Rao"},
    {"label": "All 4", "value": "all", "kind": "all"}
  ]
}
```

- `group` (new, optional): when it's present, show a small heading per group ("Aman", "Neha Rao") above its rows, in the order received.
- Letters run across all groups. Picking works the same way: send the ticked letters, e.g. `A, C`.
- **Every group needs at least one pick.** Suggestion: enable **Show selected** only when each group has a tick. If the user sends only `A`, the backend asks again just for the missing name ("Which Neha Rao? Reply C or D, or all."). That answer comes back as normal text plus new `choices` for that name only.
- Deals use the same flow: "I found 2 deals named Alpha Steel:" with labels `Proposal · 9,000 · Aman Kapoor · Mar 2026`. Contacts and products work the same way.

## 2. Picking

| User action | Send as the next question (same `session_id`) |
|---|---|
| Clicks a person row (not the checkbox) | that row's `value`, e.g. `A` |
| Ticks several boxes and clicks **Show selected (n)** | letters joined with ", " in list order, e.g. `A, C` |
| Clicks **All N** | `all` |

- Show the **Show selected** button only when 2 or more boxes are ticked. With 1 ticked, send that letter. If every box is ticked, send `all`.
- Typed replies also work: `a, c`, `A and C`, `1, 3`, `b`.
- If the user sends a letter that wasn't offered (e.g. `A, K`), the backend replies "Please choose from A, B, C or D …" and the question stays open.
- The buttons belong to the latest answer only. Disable them on older messages: the backend accepts only one reply per "which one?" question.

## 3. Answer with several people

```json
{
  "answer": "Showing results for 2 people: A = Aman Kapoor, C = Aman Shah.\n\nAman Kapoor and Aman Shah own 2 deals. ...",
  "people": [
    {"letter": "A", "name": "Aman Kapoor", "label": "Sales rep · Indore", "kind": "user"},
    {"letter": "C", "name": "Aman Shah",   "label": "Executive · Japan",  "kind": "user"}
  ],
  "table": {"columns": ["Person", "Deal Name", "Deal Value", "..."], "rows": [["A", "Alpha Steel", 9000], ["C", "Tokyo Rail", 7500]]}
}
```

- `people` (new, optional): the key. Show it above the table as one chip per person, `A = Aman Kapoor · Sales rep · Indore`.
- The letter column is a normal first column holding the letter. Render it as a small badge. Its name depends on what was picked: **Person** (people), **Deal**, **Contact** or **Product**. A question about 2 people and 2 deals can have two letter columns (Person, then Deal).
- `people[].kind` (new): `user` / `contact` / `deal` / `product`. Use it to know which letter column a key chip belongs to.
  - Letters keep the ones from the list (A and C here, not A and B).
  - Sorting and search need nothing special, because the letter is part of each row.
- **Colours:** use **one neutral colour** for every letter badge and chip; the letter already tells people apart. Lists can now run A–Z (up to 20 people per question), so one neutral colour is the only practical choice.
- **Tables (`tables[]`):** "everything about all Aman" works the same way. Every titled table that has the column gets **Person** first.
- **Charts:** none are sent for multi-person tables, because repeated letters make bad bars.
- **Copy:** for now the letter is copied. Later, use `people` to copy the full name instead.
- The Role column now shows friendly names ("Sales rep" instead of "Sales_Rep"). No frontend change is needed.

## 3b. Follow-up buttons after an answer with letters

After "A, C", the overview's buttons look like this:

```json
"choices": [
  {"label": "Show their deals",    "value": "Show deals of A, C",         "kind": "followup", "action": "deals"},
  {"label": "Show their contacts", "value": "Show contacts of A, C",      "kind": "followup", "action": "contacts"},
  {"label": "Show everything",     "value": "Show everything about A, C", "kind": "followup", "action": "everything"}
]
```

- **Nothing selected:** send `value` as it is. It covers everyone in the answer.
- **Selectable key chips:** make the key chips above the table (`people`) toggleable, and optionally the letter badge in a row too.
- **Some chips selected (e.g. only C):** change the button text to show the selection ("Show deals of C") and send:

  | `action` | Send |
  |---|---|
  | `deals` | `Show deals of <letters>` |
  | `contacts` | `Show contacts of <letters>` |
  | `everything` | `Show everything about <letters>` |

  `<letters>` = the selected letters joined with ", " in alphabetical order, e.g. `Show deals of A, C`.
- **Typing works too:** "deals of c", "everything about A and C", "their deals". The backend maps each letter to the exact person it saved, so two people with the same name never mix.
- **When letters are valid:** until a newer answer brings a new list. "their / them" means the people in the very last answer only.
- **Clear the selection** when a new answer arrives.

## 3c. People from the list who are not in this answer ("+N more")

```json
"people_more": [
  {"letter": "B", "name": "Aman Mehta", "label": "Sales rep · Indore", "kind": "user"},
  {"letter": "D", "name": "Aman Jain",  "label": "Sales rep · East",   "kind": "user"}
]
```

- Sent next to `people` when the answer covers only some of the people from the "which one?" list. Missing or `null` means there's nothing more.
- Show one small chip **"+2 more"** after the key chips. Clicking it expands to faded chips (`B = Aman Mehta …`). Collapsed by default, so it takes no space.
- Faded chips are selectable like the key chips. Selected letters go into the same follow-up buttons, e.g. tick D and click "Show their deals" to send `Show deals of D`, or A + D to send `Show deals of A, D`.
- Typing works the same way: "deals of D", "everything about B and D". The backend remembers the whole list until a new "which one?" list appears.

## 4. Unchanged

- One person chosen: no `people`, no Person column.
- More than 20 matches for one name: the backend asks for the last name (buttons with full names, no `kind`), as before.

## 5. Charts (your horizontal-scroll change)

- No backend change is needed. Bar charts are sent for up to 25 bars and line charts for up to 50 points. Above that, the backend sends a table only.
- If your scrolling chart can handle more, the backend can raise the limits with no code change, through `.env`: `CHART_MAX_BAR_POINTS`, `CHART_MAX_LINE_POINTS`.
- Suggestion: give each bar a fixed width (e.g. 48–64 px) and let the chart area scroll sideways when the bars don't fit. Keep the y-axis fixed while scrolling. Show the full label in a tooltip when it's cut short.


## Update (step 24): letters A–Z, one-name-at-a-time lists
- Letters now run A–Z. The frontend needs no change: it shows whatever `letter` the server sends. A list can have up to 20 people; `people_more` can now include every person of the list who was not picked (the faded "+N more" chips).
- When one question needs more than 20 letters, the server asks one name at a time. Each step is a normal list (`choices` with `kind: "option"` + `"all"`), and `choice_prompt` starts with "(2 of 3) ". Nothing new to handle.
- A person after the 26th has a number instead of a letter in `people_more`; it cannot be typed as a letter (rare).
- Typing: "I" counts as a letter only as the reply to a list or right after of/for/about/on/from/to/with ("deals of I"). "Can I see ..." is never read as a letter.
- A letter that is not in the last list ("deals of Z") now gets a plain reply: "There is no Z in the last list. Please choose from A to K, or type the full name."
