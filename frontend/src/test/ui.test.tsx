import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import App from "../app/App";
import { CoverArt } from "../components/CoverArt";
import i18n from "../i18n";
import { RepositoryError } from "../repositories/errors";
import { repository } from "../repositories/localRepository";
import { uiError } from "../features/shared/errors";

describe("critical UI flows", () => {
  beforeEach(async () => {
    repository.reset();
    await i18n.changeLanguage("en");
  });

  it("renders demo login and signs in a selected account", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );
    await user.click(
      screen.getByRole("button", { name: /Use a demo account/i }),
    );
    await user.click(screen.getByRole("button", { name: /Nila · Basic/i }));
    expect(await screen.findByText("Recently played")).toBeInTheDocument();
  });

  it("redirects unauthenticated protected routes to login", () => {
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("enforces the admin route gate for listeners", async () => {
    repository.login("listener.gold@sonora.demo", "DemoPass123!");
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("This space is not available for your account."),
    ).toBeInTheDocument();
  });

  it("switches the visible UI language and persists it", async () => {
    repository.login("listener.gold@sonora.demo", "DemoPass123!");
    const view = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    const language = screen.getByLabelText("Language");
    fireEvent.change(language, { target: { value: "de" } });
    expect(
      await screen.findByRole("heading", { name: "Einstellungen" }),
    ).toBeInTheDocument();
    expect(repository.sessionUser()?.locale).toBe("de");
    view.unmount();
  });

  it("restores persisted locale and theme when the app shell mounts", async () => {
    repository.login("listener.gold@sonora.demo", "DemoPass123!");
    repository.updateSettings({ locale: "fr", theme: "light" });
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Réglages" }),
    ).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ships complete key coverage for all six UI dictionaries", () => {
    const languages = ["en", "es", "de", "fr", "ru", "zh-CN"];
    const english = Object.keys(i18n.getResourceBundle("en", "translation"));
    languages.forEach((language) =>
      expect(
        Object.keys(i18n.getResourceBundle(language, "translation")).sort(),
      ).toEqual([...english].sort()),
    );
  });

  it("renders exact locale labels and rejects mojibake in UI dictionaries", () => {
    expect(i18n.getDataByLanguage("en")).toBeTruthy();
    const labels = [
      "English",
      "Español",
      "Deutsch",
      "Français",
      "Русский",
      "简体中文",
    ];
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen
        .getAllByRole("option")
        .map((option) => option.textContent)
        .filter((text) => labels.includes(text ?? "")),
    ).toEqual(labels);
    const suspicious = /[\u0600-\u06ff]|â|Ã|ن½|ç®|و–/;
    ["en", "es", "de", "fr", "ru", "zh-CN"].forEach((language) => {
      const bundle = i18n.getResourceBundle(language, "translation") as Record<
        string,
        unknown
      >;
      Object.entries(bundle).forEach(([key, value]) => {
        if (typeof value === "string")
          expect(value, `${language}.${key}`).not.toMatch(suspicious);
      });
    });
  });

  it("translates high-risk UI areas without falling back to English copy", () => {
    const keys = [
      "settingsTitle",
      "checkoutTitle",
      "profileImageTitle",
      "notificationTitle",
      "ticketGate",
      "admin",
      "studio",
      "artist",
      "playerError",
      "logoutConfirmTitle",
      "loggedOutToast",
    ];
    const english = i18n.getResourceBundle("en", "translation") as Record<
      string,
      string
    >;
    ["es", "de", "fr", "ru", "zh-CN"].forEach((language) => {
      const bundle = i18n.getResourceBundle(language, "translation") as Record<
        string,
        string
      >;
      keys.forEach((key) =>
        expect(bundle[key], `${language}.${key}`).not.toBe(english[key]),
      );
    });
  });

  it("does not expose raw internal API error codes in user-facing errors", () => {
    expect(
      uiError(new RepositoryError("api_error", "Request failed."), i18n.t),
    ).toBe("The request could not be completed.");
    expect(
      uiError(new RepositoryError("api_unavailable", "Bad gateway."), i18n.t),
    ).toBe("The Sonora API is not responding correctly.");
    expect(
      uiError(new RepositoryError("network_error", "Failed to fetch."), i18n.t),
    ).toBe(
      "Sonora cannot reach the server. Check that the backend is running.",
    );
    expect(
      uiError(
        new RepositoryError("unknown_internal_code", "traceback-ish"),
        i18n.t,
      ),
    ).toBe("Something went wrong");
  });

  it("keeps integrated media and API repository boundaries explicit", () => {
    const viteConfig = readFileSync(
      join(process.cwd(), "vite.config.ts"),
      "utf8",
    );
    const apiRepository = readFileSync(
      join(process.cwd(), "src", "repositories", "apiRepository.ts"),
      "utf8",
    );
    expect(viteConfig).toContain('"/media":');
    expect(viteConfig).toContain("http://127.0.0.1:8000");
    expect(apiRepository).toContain(
      'request<Payment>("/subscription/purchases/"',
    );
    expect(apiRepository).toContain("download-tickets/");
    expect(apiRepository).not.toContain("safe<");
    expect(apiRepository).not.toContain("fallback.updateAvatar");
    expect(apiRepository).toContain(
      'throw new RepositoryError("backend_upload_required"',
    );
    const trackRow = readFileSync(
      join(process.cwd(), "src", "components", "TrackRow.tsx"),
      "utf8",
    );
    const serializers = readFileSync(
      join(process.cwd(), "..", "backend", "api", "serializers.py"),
      "utf8",
    );
    expect(trackRow).toContain("downloadSource");
    expect(trackRow).not.toContain("href={track.audioUrl}");
    expect(serializers).toContain("return None");
  });

  it("does not ship integrated checkout copy that claims local demo storage", () => {
    const bundle = JSON.stringify(i18n.getResourceBundle("en", "translation"));
    expect(bundle).toContain("Development mock payment provider");
    expect(bundle).toContain("Django records a test Payment and Subscription");
    expect(bundle).not.toMatch(
      /DEMO SIMULATION|local demo storage|local demo checkout|selected paid tier immediately in local/i,
    );
  });

  it("uses the vinyl cover fallback only when a cover is intentionally absent", () => {
    const { container, rerender } = render(
      <CoverArt src={null} alt="Missing cover" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Missing cover" })).toHaveClass(
      "vinyl",
    );
    rerender(<CoverArt src="/media/covers/release-1.svg" alt="Seed cover" />);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/media/covers/release-1.svg",
    );
  });

  it("keeps light mode connected to shell, player, mobile, and modal theme variables", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "styles", "global.css"),
      "utf8",
    );
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).toContain("--shell-bg");
    expect(css).toContain("background:var(--shell-bg)");
    expect(css).toContain("background:var(--player-bg)");
    expect(css).toContain("background:var(--mobile-shell-bg)");
    expect(css).toContain("background:var(--full-player-bg)");
  });

  it("keeps search focus to one premium treatment without the old double lime halo", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "styles", "global.css"),
      "utf8",
    );
    expect(css).toContain(".search-box:has(input:focus-visible)");
    expect(css).toContain(
      ".search-box input:focus,.search-box input:focus-visible",
    );
    expect(css).not.toContain("0 0 0 3px var(--bg), 0 0 0 5px var(--lime)");
    expect(css).not.toContain(
      ".search-box:focus-within { border-color:var(--lime); box-shadow",
    );
  });

  it("logs out from desktop, redirects to login, remains logged out after reload, and preserves data for re-login", async () => {
    const user = userEvent.setup();
    repository.login("listener.basic@sonora.demo", "DemoPass123!");
    repository.createPlaylist("Kept local playlist");
    const view = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    await user.click(
      screen.getByLabelText("Sign out from desktop account menu"),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Sign out of Sonora?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/logged out/i);
    expect(repository.sessionUser()).toBeNull();
    view.unmount();

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
    expect(repository.sessionUser()).toBeNull();
    repository.login("listener.basic@sonora.demo", "DemoPass123!");
    expect(
      repository
        .visiblePlaylists()
        .some((playlist) => playlist.title === "Kept local playlist"),
    ).toBe(true);
  });

  it("redirects protected routes to login after logout", () => {
    repository.login("admin@sonora.demo", "DemoPass123!");
    repository.logout();
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Admin console" }),
    ).not.toBeInTheDocument();
  });

  it("exposes logout from desktop, mobile account menu, and account settings", async () => {
    const user = userEvent.setup();
    repository.login("listener.gold@sonora.demo", "DemoPass123!");
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByLabelText("Sign out from desktop account menu"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sign out from account settings"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /More/i }));
    expect(
      screen.getByLabelText("Sign out from mobile account menu"),
    ).toBeInTheDocument();
  });

  it("logs support users out without leaving staff navigation visible", async () => {
    const user = userEvent.setup();
    repository.login("support@sonora.demo", "DemoPass123!");
    render(
      <MemoryRouter initialEntries={["/support"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Support desk" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByLabelText("Sign out from desktop account menu"),
    );
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Sign out of Sonora?" }),
      ).getByRole("button", { name: "Sign out" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Support desk" }),
    ).not.toBeInTheDocument();
  });

  it("shows field-specific registration validation instead of a detached required banner", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByText("Enter a password.")).toBeInTheDocument();
    expect(screen.getByText("Confirm your password.")).toBeInTheDocument();
    expect(
      screen.getByText("Accept the privacy policy to continue."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This field is required."),
    ).not.toBeInTheDocument();
  });

  it("keeps registration password bindings and maps mismatch/email/privacy errors to fields", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("Display name"), "Browser Tester");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    fireEvent.change(screen.getByLabelText("Birth date"), {
      target: { value: "1994-04-03" },
    });
    await user.type(screen.getByLabelText("Password"), "LongPass123!");
    await user.type(screen.getByLabelText("Confirm password"), "Different123!");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: /Email/i }));
    await user.type(
      screen.getByRole("textbox", { name: /Email/i }),
      "listener.basic@sonora.demo",
    );
    const confirmPassword =
      document.querySelector<HTMLInputElement>("#confirmPassword")!;
    await user.clear(confirmPassword);
    await user.type(confirmPassword, "LongPass123!");
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(
      await screen.findByText("An account already uses this email."),
    ).toBeInTheDocument();
    expect(repository.sessionUser()).toBeNull();
  });

  it("registers listener and artist accounts with visibly typed passwords", async () => {
    const user = userEvent.setup();
    const listener = render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("Display name"), "Typed Listener");
    await user.type(
      screen.getByLabelText("Email"),
      "typed-listener@example.com",
    );
    fireEvent.change(screen.getByLabelText("Birth date"), {
      target: { value: "1994-04-03" },
    });
    await user.type(screen.getByLabelText("Password"), "LongPass123!");
    await user.type(screen.getByLabelText("Confirm password"), "LongPass123!");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(await screen.findByText("Popular right now")).toBeInTheDocument();
    expect(repository.sessionUser()?.email).toBe("typed-listener@example.com");
    listener.unmount();

    repository.logout();
    render(
      <MemoryRouter initialEntries={["/register/artist"]}>
        <App />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("Display name"), "Typed Artist");
    await user.type(screen.getByLabelText("Stage name"), "Typed Stage");
    await user.type(screen.getByLabelText("Email"), "typed-artist@example.com");
    fireEvent.change(screen.getByLabelText("Birth date"), {
      target: { value: "1994-04-03" },
    });
    await user.type(screen.getByLabelText("Password"), "ArtistPass123!");
    await user.type(
      screen.getByLabelText("Confirm password"),
      "ArtistPass123!",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(await screen.findByText("Popular right now")).toBeInTheDocument();
    expect(repository.sessionUser()?.artistProfile?.stageName).toBe(
      "Typed Stage",
    );
  });

  it("requires explicit test payment confirmation before activating a subscription", async () => {
    const user = userEvent.setup();
    repository.login("listener.basic@sonora.demo", "DemoPass123!");
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /Explore plans/i }));
    const oneMonthSilver = screen
      .getAllByRole("button", { name: /Silver/i })
      .find((button) => button.textContent?.includes("· 1 "));
    expect(oneMonthSilver).toBeDefined();
    await user.click(oneMonthSilver!);
    expect(repository.sessionUser()?.subscription.tier).toBe("basic");
    expect(screen.getByText(/Final amount/i)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Confirm test payment/i }),
    );
    expect(repository.sessionUser()?.subscription.tier).toBe("silver");
    expect(
      await screen.findByRole("heading", { name: "Payment history" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Succeeded/i)).toBeInTheDocument();
  });

  it("renders playlists library overview", () => {
    repository.login("listener.basic@sonora.demo", "DemoPass123!");
    render(
      <MemoryRouter initialEntries={["/library"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Playlists" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your playlists" }),
    ).toBeInTheDocument();
  });

  it("blocks Basic profile image edits and persists a validated local image for Silver", async () => {
    const user = userEvent.setup();
    repository.login("listener.basic@sonora.demo", "DemoPass123!");
    const basicView = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    await user.click(
      screen.getByRole("button", { name: /Change profile image/i }),
    );
    expect(
      screen.getAllByText("Profile images require Silver or Gold.").length,
    ).toBeGreaterThan(0);
    basicView.unmount();

    repository.logout();
    repository.login("listener.silver@sonora.demo", "DemoPass123!");
    const silverView = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    const file = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10])],
      "avatar.png",
      { type: "image/png" },
    );
    const fileInput = silverView.container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, file);
    const dialog = await screen.findByRole("heading", {
      name: "Preview selected image",
    });
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use this image" }));
    expect(
      repository.sessionUser()?.avatarUrl?.startsWith("data:image/png;base64,"),
    ).toBe(true);
  });

  it("redirects staff home to internal tools and omits the consumer player", async () => {
    repository.login("support@sonora.demo", "DemoPass123!");
    const view = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Support desk" }),
    ).toBeInTheDocument();
    expect(view.container.querySelector("audio")).toBeNull();
  });
});
