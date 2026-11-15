import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useDemoUsers = vi.fn();
// Radix Select needs real pointer events; a plain stand-in keeps the test about our logic.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    disabled,
    onValueChange,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onValueChange?: (v: string) => void;
  }) => (
    <div data-disabled={disabled} data-testid="select">
      <button
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label="Choose a user"
        onClick={() => onValueChange?.("seed-u-5")}
      />
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/hooks/use-demo-users", () => ({ useDemoUsers: () => useDemoUsers() }));

import { UserPicker } from "@/components/demo/UserPicker";
import { getActiveUser, setActiveUser } from "@/lib/active-user";
import { MOCK_USERS } from "@/lib/mock-users";

beforeEach(() => {
  setActiveUser(null);
  useDemoUsers.mockReset();
});

describe("UserPicker", () => {
  it("shows a disabled picker while loading", () => {
    useDemoUsers.mockReturnValue({ state: { status: "loading" }, retry: vi.fn() });
    render(<UserPicker />);
    expect(screen.getByRole("combobox", { name: "Choose a user" })).toBeDisabled();
    expect(screen.getByText("Loading users…")).toBeInTheDocument();
  });

  it("shows the error with a working Retry", () => {
    const retry = vi.fn();
    useDemoUsers.mockReturnValue({
      state: { status: "error", message: "Couldn't load the list of users. Try again." },
      retry,
    });
    render(<UserPicker />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the list of users");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("selecting a person makes them the active user", () => {
    useDemoUsers.mockReturnValue({
      state: { status: "ready", users: MOCK_USERS },
      retry: vi.fn(),
    });
    render(<UserPicker />);
    expect(screen.getByText(/In production this will be a real login/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Choose a user" }));
    expect(getActiveUser()?.user_id).toBe("seed-u-5");
  });

  it("hides the demo note when no person is in demo mode", () => {
    useDemoUsers.mockReturnValue({
      state: { status: "ready", users: MOCK_USERS.map((u) => ({ ...u, demo_mode: false })) },
      retry: vi.fn(),
    });
    render(<UserPicker />);
    expect(screen.queryByText(/real login/)).not.toBeInTheDocument();
  });
});
