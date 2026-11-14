"""
DEMO ACT 2 -- Orchestrator routing, live.

Story: ask questions in plain English, watch the system decide whether it
needs SQL data, document data, or both -- then watch it answer.

IMPORTANT, say this out loud during the demo: the SQL Agent itself is not
built yet. When a question correctly routes to "sql" or "both", that
proves the ROUTING decision is correct -- the structured-data lookup is
still a stub today. Don't let the room assume a finished SQL answer came
back; the honest, still-impressive claim is "it correctly recognized this
needs database data."

Run:
    python demo_act2_orchestrator.py
"""

import time

from orchestrator import handle_user_query

DEMO_QUESTIONS = [
    # Clearly RAG-shaped: answerable from ingested documents only.
    "What does the CloseMore onboarding guide say about role-based access control?",
    # Clearly SQL-shaped: routing should say "sql" or "both". The SQL Agent
    # stub means no structured data actually comes back yet -- that's the
    # expected, honest behavior today, not a bug.
    "What is the deal value for Acme Corp?",
]


def banner(text):
    width = 70
    print("\n" + "=" * width)
    print(text.center(width))
    print("=" * width + "\n")


def run_demo_question(question):
    print(f'Question: "{question}"\n')

    t0 = time.time()
    result = handle_user_query(question)
    elapsed = time.time() - t0

    print(f"  Routing decision: {result['route'].upper()}")
    if result["route"] in ("sql", "both"):
        if result["sql_result"] is None:
            print("    (SQL Agent not built yet -- routing correctly identified this")
            print("     needs structured data; no structured lookup ran)")
    if result["route"] in ("rag", "both"):
        status = "found matching document(s)" if result["rag_result"] else "no matching documents found"
        print(f"    (Document search: {status})")

    print(f"\n  Answer ({elapsed:.2f}s):\n")
    for line in result["answer"].splitlines():
        print(f"    {line}")
    print()


if __name__ == "__main__":
    banner("ACT 2 -- ORCHESTRATOR: ROUTE -> RETRIEVE -> SYNTHESIZE")
    print("Each question below is routed automatically to SQL, documents, or both.\n")

    for q in DEMO_QUESTIONS:
        print("-" * 70)
        run_demo_question(q)

    banner("END OF ACT 2")
    print("Routing + document retrieval + answer synthesis: all live today.")
    print("SQL Agent (Postgres) integration is the next build.\n")
