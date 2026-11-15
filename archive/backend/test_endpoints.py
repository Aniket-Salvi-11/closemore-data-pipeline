import os, requests, time

ENDPOINTS = {
    "BASE (Llama 3 8B)": os.environ["SQL_RAG_URL"],
    "FINE-TUNED (Llama 3.1 8B)": os.environ["BRAIN_URL"],
}

QUESTIONS = [
    "What is ARR and how is it calculated?",
    "[Sales] How do I follow up with a lead who has gone cold?",
]

for question in QUESTIONS:
    print("\n" + "=" * 80)
    print("QUESTION:", question)
    for name, url in ENDPOINTS.items():
        payload = {
            "messages": [{"role": "user", "content": question}],
            "max_tokens": 150,
            "temperature": 0.2,
        }
        start = time.time()
        try:
            r = requests.post(url, json=payload, timeout=300)
            r.raise_for_status()
            answer = r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            answer = f"ERROR: {e}"
        print(f"\n--- {name} ({time.time() - start:.1f}s) ---")
        print(answer)