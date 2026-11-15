import type { PersonRef } from "@/lib/people";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  askQuestion,
  sendFeedback,
  ApiError,
  type AnswerChoice,
  type AnswerScope,
  type AnswerSource,
  type TitledTable,
} from "@/lib/api-service";
import type { ResultChartSpec, ResultTableData } from "@/lib/result-data";

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  /** Exactly the text received from the backend; this is what goes into `history`. */
  content: string;
  /** Display-only extras for assistant messages. Never sent back to the backend. */
  table?: ResultTableData;
  chart?: ResultChartSpec;
  /** Whose data the backend says this answer covers (small caption). Never goes into `history`. */
  scope?: AnswerScope;
  /** Which path answered ("sql", "rag" ...), for the small badge. Never goes into `history`. */
  route?: string;
  /** Documents behind the answer (chips). Never goes into `history`. */
  sources?: AnswerSource[];
  /** Clickable replies for a "which one?" question. Never goes into `history`. */
  choices?: AnswerChoice[];
  /** Short question shown instead of the answer text above "which one?" choices. */
  choice_prompt?: string;
  /** Who each letter is, in a several-people answer. Never goes into `history`. */
  people?: PersonRef[];
  /** People from the "which one?" list not in this answer ("+N more"). Never goes into `history`. */
  people_more?: PersonRef[];
  /** Several titled tables for "everything about a person" answers. Never goes into `history`. */
  tables?: TitledTable[];
  /** When the message was added (ms since 1970), for the small time label. */
  createdAt?: number;
  /** Id of this answer, used to send feedback. */
  request_id?: string;
  /** How long the backend took, in milliseconds. */
  elapsed_ms?: number;
  /** The user's 👍/👎 for this answer. */
  rating?: "up" | "down";
  /** For a user message sent by clicking a choice: the text to show (`content` is the value sent). */
  display?: string;
}

export interface ChatError {
  /** The question that failed, so it can be retried. */
  question: string;
  /** Human-readable reason shown in the UI. */
  message: string;
}

type ChatStatus = "idle" | "thinking";

const STORAGE_PREFIX = "closemore-chat:";
/** One saved conversation per browser tab (sessionStorage), kept across page loads in that tab. */
const STORAGE_KEY = "current";

interface StoredChat {
  sessionId: string;
  messages: ChatMessage[];
}

/** Reads this tab's saved chat. Anything damaged is ignored (a fresh chat starts). */
function loadChat(key: string | null): StoredChat | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const text = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!text) return null;
    const data: unknown = JSON.parse(text);
    if (typeof data !== "object" || data === null) return null;
    const { sessionId, messages } = data as Record<string, unknown>;
    if (typeof sessionId !== "string" || !sessionId || !Array.isArray(messages)) return null;
    const valid = messages.filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as ChatMessage).id === "string" &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string",
    );
    return { sessionId, messages: valid };
  } catch {
    return null;
  }
}

function saveChat(key: string | null, chat: StoredChat): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(chat));
  } catch {
    // Storage full or blocked: the chat still works, it just won't survive a reload.
  }
}

/**
 * Forgets this tab's saved conversation. The website calls it on logout (CloseMoreCopilot.reset())
 * so the next person on the same browser tab never sees the previous chat.
 */
export function clearStoredChat(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_PREFIX + STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was saved.
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Owns the conversation state: messages, the thinking indicator,
 * error handling and the clear action.
 */
export function useChat() {
  // Per browser tab (sessionStorage, not localStorage): a reload or a page change on the website
  // keeps this tab's conversation and session id.
  const storageKey = STORAGE_KEY;
  const [saved] = useState(() => loadChat(storageKey));
  const [messages, setMessages] = useState<ChatMessage[]>(() => saved?.messages ?? []);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<ChatError | null>(null);
  const inFlight = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(saved?.messages ?? []);

  // One id per chat session (new page load, or after "Clear conversation"); the backend logs per session.
  const sessionIdRef = useRef<string>(saved?.sessionId ?? "");
  if (sessionIdRef.current === "") sessionIdRef.current = createId();

  // Always-current copy of the conversation, readable from inside `send`.
  useEffect(() => {
    messagesRef.current = messages;
    saveChat(storageKey, { sessionId: sessionIdRef.current, messages });
  }, [messages, storageKey]);

  /** `display` is only for the chat bubble (a clicked choice shows its label); `question` is what is sent. */
  const send = useCallback(async (rawQuestion: string, display?: string) => {
    const question = rawQuestion.trim();
    // Guard: ignore empty questions entirely.
    if (!question || inFlight.current) return;

    // No history is sent: the AI keeps the conversation itself, per session id.
    // A Retry of a failed question reuses the question already on screen instead of adding it twice.
    const last = messagesRef.current.at(-1);
    const isRetry = last?.role === "user" && last.content === question;
    inFlight.current = true;
    setError(null);
    if (!isRetry)
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "user",
          createdAt: Date.now(),
          content: question,
          ...(display && display !== question ? { display } : {}),
        },
      ]);
    setStatus("thinking");

    try {
      const {
        answer,
        table,
        chart,
        scope,
        route,
        sources,
        choices,
        tables,
        request_id,
        elapsed_ms,
        people,
        people_more,
        choice_prompt,
      } = await askQuestion(question, sessionIdRef.current);
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          createdAt: Date.now(),
          content: answer,
          ...(table ? { table } : {}),
          ...(chart ? { chart } : {}),
          ...(scope ? { scope } : {}),
          ...(route ? { route } : {}),
          ...(sources ? { sources } : {}),
          ...(choices ? { choices } : {}),
          ...(tables ? { tables } : {}),
          ...(request_id ? { request_id } : {}),
          ...(people ? { people } : {}),
          ...(people_more ? { people_more } : {}),
          ...(choice_prompt ? { choice_prompt } : {}),
          ...(elapsed_ms !== undefined ? { elapsed_ms } : {}),
        },
      ]);
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : "Something went wrong while getting the answer. Please try again.";
      setError({ question, message });
    } finally {
      setStatus("idle");
      inFlight.current = false;
    }
  }, []);

  /** Retries the question that produced the last error. */
  const retry = useCallback(() => {
    if (!error) return;
    const question = error.question;
    // Drop the failed exchange marker; the original user message stays visible.
    setError(null);
    void send(question);
  }, [error, send]);

  /**
   * 👍/👎 for one answer. The icon changes at once; if saving fails it goes back and this returns false.
   * `"none"` removes the rating. A comment can be added later by sending the same rating again.
   */
  const rate = useCallback(
    async (messageId: string, rating: "up" | "down" | "none", comment?: string) => {
      const target = messagesRef.current.find((m) => m.id === messageId);
      if (!target?.request_id) return false;
      const before = target.rating;
      const apply = (value: "up" | "down" | undefined) =>
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const { rating: _old, ...rest } = m;
            return value ? { ...rest, rating: value } : rest;
          }),
        );
      apply(rating === "none" ? undefined : rating);
      try {
        await sendFeedback({
          requestId: target.request_id,
          rating,
          ...(comment ? { comment } : {}),
          sessionId: sessionIdRef.current,
        });
        return true;
      } catch {
        apply(before);
        return false;
      }
    },
    [],
  );

  /** Clears the whole conversation. */
  const clear = useCallback(() => {
    sessionIdRef.current = createId();
    saveChat(storageKey, { sessionId: sessionIdRef.current, messages: [] });
    setMessages([]);
    setError(null);
    setStatus("idle");
  }, [storageKey]);

  return { messages, status, error, send, retry, clear, rate };
}
