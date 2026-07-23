import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../data/seed";
import {
  finalPriceRial,
  getTrackLock,
  localDay,
  playlistLimit,
} from "../domain/entitlements";
import type { RegistrationInput } from "../domain/types";
import { RepositoryError, repository } from "../repositories/localRepository";

const registration: RegistrationInput = {
  displayName: "Test Listener",
  email: "test@example.com",
  password: "LongPass123!",
  birthDate: "1995-02-10",
  gender: "non_binary",
  locale: "en",
  timezone: "Asia/Tehran",
};

describe("local repository contract", () => {
  beforeEach(() => repository.reset());

  it("logs in every seeded persona with the local-only password", () => {
    const accounts = [
      "listener.basic@sonora.demo",
      "listener.silver@sonora.demo",
      "listener.gold@sonora.demo",
      "artist.unverified@sonora.demo",
      "artist.verified@sonora.demo",
      "support@sonora.demo",
      "admin@sonora.demo",
    ];
    accounts.forEach((email) => {
      expect(repository.login(email, DEMO_PASSWORD).email).toBe(email);
      repository.logout();
    });
  });

  it("rejects invalid credentials with a controlled repository error", () => {
    expect(() =>
      repository.login("listener.basic@sonora.demo", "wrong"),
    ).toThrow(RepositoryError);
  });

  it("registers and persists a Basic consumer", () => {
    const user = repository.register(registration, false);
    expect(user.subscription.tier).toBe("basic");
    expect(user.artistProfile).toBeNull();
    expect(repository.sessionUser()?.id).toBe(user.id);
    repository.logout();
    expect(repository.login(registration.email, registration.password).id).toBe(
      user.id,
    );
  });

  it("logs out by clearing only the active local session while preserving account data", () => {
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    repository.createPlaylist("Still here after logout");
    repository.updateSettings({ theme: "light", locale: "fr" });
    repository.logout();
    expect(repository.sessionUser()).toBeNull();
    const user = repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    expect(user.theme).toBe("light");
    expect(user.locale).toBe("fr");
    expect(
      repository
        .visiblePlaylists()
        .some((playlist) => playlist.title === "Still here after logout"),
    ).toBe(true);
  });

  it("registers an artist as a consumer with an unverified ArtistProfile", () => {
    const user = repository.register(
      {
        ...registration,
        email: "artist@example.com",
        stageName: "Test Signal",
      },
      true,
    );
    expect(user.kind).toBe("consumer");
    expect(user.artistProfile?.stageName).toBe("Test Signal");
    expect(user.artistProfile?.verifiedAt).toBeNull();
  });

  it("enforces Basic, Silver, and Gold playlist limits", () => {
    expect(playlistLimit("basic")).toBe(6);
    expect(playlistLimit("silver")).toBe(100);
    expect(playlistLimit("gold")).toBe(Infinity);
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    for (let index = 0; index < 5; index++)
      repository.createPlaylist(`List ${index}`);
    expect(() => repository.createPlaylist("Seventh")).toThrow(/limit/i);
  });

  it("adds and removes tracks across multiple owned playlists", () => {
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    const first = repository.createPlaylist("Sync A");
    const second = repository.createPlaylist("Sync B");
    repository.syncTrackPlaylists(["track-1"], [first.id, second.id]);
    expect(repository.playlist(first.id)?.trackIds).toContain("track-1");
    expect(repository.playlist(second.id)?.trackIds).toContain("track-1");
    repository.syncTrackPlaylists(["track-1"], [first.id]);
    expect(repository.playlist(first.id)?.trackIds).toContain("track-1");
    expect(repository.playlist(second.id)?.trackIds).not.toContain("track-1");
  });

  it("keeps private playlists invisible to visitors", () => {
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    expect(repository.playlist("playlist-3")).toBeNull();
    expect(repository.playlist("playlist-1")?.visibility).toBe("public");
  });

  it("saves public playlists as live references and removes them when private", () => {
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    repository.savePlaylist("playlist-1");
    expect(repository.library().saved.map((p) => p.id)).toContain("playlist-1");
    repository.logout();
    repository.login("artist.verified@sonora.demo", DEMO_PASSWORD);
    repository.updatePlaylist("playlist-1", {
      title: "Renamed live",
      visibility: "private",
    });
    repository.logout();
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    expect(repository.library().saved).toHaveLength(0);
    expect(
      repository
        .notifications()
        .some((n) => n.title.includes("Saved playlist")),
    ).toBe(true);
  });

  it("toggles likes through the private virtual Liked Songs collection", () => {
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    expect(
      repository.library().liked.some((track) => track.id === "track-1"),
    ).toBe(true);
    repository.like("track-1");
    expect(
      repository.library().liked.some((track) => track.id === "track-1"),
    ).toBe(false);
  });

  it("locks explicit tracks for minors and adults who disable them", () => {
    const track = repository
      .database()
      .tracks.find((item) => item.id === "track-9")!;
    const adult = repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    expect(getTrackLock(adult, track, new Date("2026-07-06"))).toBeNull();
    adult.explicitContentEnabled = false;
    expect(getTrackLock(adult, track, new Date("2026-07-06"))).toBe(
      "explicit_restricted",
    );
    adult.explicitContentEnabled = true;
    adult.birthDate = "2012-01-01";
    expect(getTrackLock(adult, track, new Date("2026-07-06"))).toBe(
      "explicit_restricted",
    );
  });

  it("counts a valid stream only once per local day", () => {
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    const date = new Date("2026-07-06T12:00:00Z");
    expect(repository.recordValidStream("track-1", date)).toBe(true);
    expect(repository.recordValidStream("track-1", date)).toBe(false);
  });

  it("applies the Basic 60-stream cap to new tracks", () => {
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    const raw = JSON.parse(localStorage.getItem("sonora:phase1:database:v2")!);
    const user = raw.users.find(
      (item: { id: string }) => item.id === "user-basic",
    );
    const day = localDay("Asia/Tehran");
    for (let index = 0; index < 60; index++)
      user.streamDates[`counted-${index}`] = day;
    localStorage.setItem("sonora:phase1:database:v2", JSON.stringify(raw));
    const viewed = repository.tracks();
    expect(
      viewed.every(
        (track) =>
          track.lockReason === "daily_stream_limit" ||
          track.lockReason === "explicit_restricted" ||
          track.lockReason === "gold_required",
      ),
    ).toBe(true);
  });

  it("preserves critical notifications when preference is muted", () => {
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    repository.updateSettings({ notificationPreference: "muted" });
    const notices = repository.notifications();
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((notice) => notice.kind === "critical")).toBe(true);
  });

  it("collects notification overflow into a digest without silent loss", () => {
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    repository.updateSettings({ notificationPreference: "max_five_daily" });
    const raw = JSON.parse(localStorage.getItem("sonora:phase1:database:v2")!);
    for (let index = 0; index < 7; index++)
      raw.notifications.push({
        id: `overflow-${index}`,
        userId: "user-gold",
        title: `Update ${index}`,
        body: "Demo",
        kind: "social",
        readAt: null,
        createdAt: `2026-07-06T1${index}:00:00.000Z`,
      });
    localStorage.setItem("sonora:phase1:database:v2", JSON.stringify(raw));
    const notices = repository.notifications();
    expect(notices.some((notice) => notice.id === "digest-2026-07-06")).toBe(
      true,
    );
    expect(
      notices.filter((notice) => notice.createdAt.startsWith("2026-07-06")),
    ).toHaveLength(6);
  });

  it("updates locale and other settings in persistent storage", () => {
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    repository.updateSettings({
      locale: "de",
      theme: "light",
      explicitContentEnabled: false,
    });
    repository.logout();
    const user = repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    expect(user.locale).toBe("de");
    expect(user.theme).toBe("light");
    expect(user.explicitContentEnabled).toBe(false);
  });

  it("enforces avatar tier and username cooldown gates", () => {
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    expect(() =>
      repository.updateAvatar("/media/avatars/user-gold.svg"),
    ).toThrow(/Silver/i);
    repository.updateUsername("nila_new");
    expect(() => repository.updateUsername("nila_again")).toThrow(/30 days/i);
    repository.logout();
    repository.login("listener.silver@sonora.demo", DEMO_PASSWORD);
    repository.updateAvatar("/media/avatars/user-gold.svg");
    expect(repository.sessionUser()?.avatarUrl).toContain("user-gold.svg");
  });

  it("blocks same-tier subscription stacking and Gold downgrades", () => {
    repository.login("listener.silver@sonora.demo", DEMO_PASSWORD);
    expect(() => repository.purchase("plan-silver-3")).toThrow(/stacked/i);
    repository.logout();
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    expect(() => repository.purchase("plan-silver-1")).toThrow(/expires/i);
  });

  it("upgrades Silver to Gold immediately without stacking remaining time", () => {
    repository.login("listener.silver@sonora.demo", DEMO_PASSWORD);
    const oldExpiry = repository.sessionUser()!.subscription.expiresAt;
    repository.purchase("plan-gold-3");
    const user = repository.sessionUser()!;
    expect(user.subscription.tier).toBe("gold");
    expect(user.subscription.expiresAt).not.toBe(oldExpiry);
    expect(repository.database().payments[0]).toMatchObject({
      tier: "gold",
      durationMonths: 3,
      provider: "demo",
      status: "succeeded",
    });
  });

  it("calculates authoritative integer-rial prices", () => {
    expect(finalPriceRial(790_000, 12, 18)).toBe(7_773_600);
    expect(
      repository.database().plans.find((plan) => plan.id === "plan-gold-6")
        ?.finalPriceRial,
    ).toBe(6_966_000);
  });

  it("lets verified artists open tickets even on Basic", () => {
    repository.login("artist.verified@sonora.demo", DEMO_PASSWORD);
    repository.createTicket(
      "Catalog question",
      "Please inspect this metadata.",
    );
    expect(
      repository
        .tickets()
        .some((ticket) => ticket.subject === "Catalog question"),
    ).toBe(true);
  });

  it("blocks Basic listeners from ticket creation", () => {
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    expect(() => repository.createTicket("Help", "Question")).toThrow(
      /Silver/i,
    );
  });

  it("stores artist upload metadata without binary file objects", () => {
    repository.login("artist.verified@sonora.demo", DEMO_PASSWORD);
    repository.saveDraft({
      title: "Local Draft",
      type: "single",
      genre: "Ambient",
      year: 2026,
      releaseDate: "2026-09-01",
      lyrics: "",
      collaborators: "",
      earlyAccess: false,
      audioFileInfo: "demo.wav · audio/wav · 100 bytes",
      coverFileInfo: null,
    });
    const raw = localStorage.getItem("sonora:phase1:database:v2")!;
    expect(raw).toContain("demo.wav");
    expect(raw).not.toContain("blob:");
  });

  it("requires staff for verification decisions and appends an audit event", () => {
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    expect(() => repository.decideVerification("verify-1", true, "OK")).toThrow(
      /Staff/i,
    );
    repository.logout();
    repository.login("support@sonora.demo", DEMO_PASSWORD);
    const before = repository.database().auditEvents.length;
    repository.decideVerification("verify-1", true, "Identity confirmed");
    expect(repository.database().auditEvents).toHaveLength(before + 1);
    expect(
      repository.database().users.find((user) => user.id === "user-artist-u")
        ?.artistProfile?.verifiedAt,
    ).not.toBeNull();
  });

  it("soft-deletes a listener and hides owned public playlists", () => {
    repository.login("artist.verified@sonora.demo", DEMO_PASSWORD);
    repository.deleteAccount();
    expect(repository.sessionUser()).toBeNull();
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    expect(repository.profile("novaserein")).toBeNull();
    expect(repository.playlist("playlist-1")).toBeNull();
  });
});
