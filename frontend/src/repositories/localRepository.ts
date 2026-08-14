import { createSeedDatabase } from "../data/seed";
import {
  canEditAvatar,
  canOpenTicket,
  getTrackLock,
  localDay,
  playlistLimit,
  rewardAmountRial,
} from "../domain/entitlements";
import type {
  AdminReports,
  Database,
  DraftRelease,
  ListeningStats,
  Locale,
  Notification,
  Playlist,
  PublicProfile,
  Payout,
  QueueState,
  RegistrationInput,
  SubscriptionPlan,
  Ticket,
  TrackView,
  User,
  VerificationRequest,
} from "../domain/types";
import { createDjangoApiRepository } from "./apiRepository";
import { RepositoryError } from "./errors";
export { RepositoryError } from "./errors";

const DB_KEY = "sonora:phase1:database:v7";
const SEED_VERSION = 9;
const SESSION_KEY = "sonora:phase1:session";
const QUEUE_KEY = "sonora:phase1:queue";
const listeners = new Set<() => void>();
let revision = 0;
const id = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

const load = (): Database => {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    const seeded = createSeedDatabase();
    localStorage.setItem(DB_KEY, JSON.stringify(seeded));
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw) as Database;
    if ((parsed.version ?? 0) < SEED_VERSION) {
      const seeded = createSeedDatabase();
      localStorage.setItem(DB_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return parsed;
  } catch {
    const seeded = createSeedDatabase();
    localStorage.setItem(DB_KEY, JSON.stringify(seeded));
    return seeded;
  }
};

const save = (db: Database) => {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  revision += 1;
  listeners.forEach((listener) => listener());
};

const reportingPeriod = () => new Date().toISOString().slice(0, 7);

const artistCatalogTotals = (db: Database, ownerId: string) => {
  const owned = db.releases.filter(
    (release) =>
      release.ownerUserId === ownerId && release.status !== "archived",
  );
  const tracks = db.tracks.filter((track) =>
    owned.some((release) => release.trackIds.includes(track.id)),
  );
  return {
    owned,
    tracks,
    uniqueListeners: tracks.reduce(
      (sum, track) => sum + track.uniqueListenerCount,
      0,
    ),
    validStreams: tracks.reduce((sum, track) => sum + track.streamCount, 0),
  };
};

const buildArtistLedger = (db: Database): Payout[] => {
  const period = reportingPeriod();
  return db.users
    .filter((user) => user.artistProfile?.verifiedAt)
    .map((user) => {
      const { uniqueListeners, validStreams } = artistCatalogTotals(
        db,
        user.id,
      );
      const existing = db.payouts.find(
        (payout) => payout.artistUserId === user.id && payout.period === period,
      );
      return {
        id: existing?.id ?? `ledger-${user.id}-${period}`,
        artistUserId: user.id,
        artistName: user.artistProfile!.stageName,
        username: user.username,
        uniqueListeners,
        validStreams,
        amountRial:
          existing?.status === "settled"
            ? existing.amountRial
            : rewardAmountRial(uniqueListeners, validStreams),
        status:
          existing?.status === "settled"
            ? "settled"
            : rewardAmountRial(uniqueListeners, validStreams) > 0
              ? (existing?.status ?? "pending")
              : "none",
        period,
      };
    });
};

const buildAdminReports = (db: Database): AdminReports => {
  const mix = { basic: 0, silver: 0, gold: 0 };
  const active = db.users.filter(
    (user) => !user.deletedAt && user.subscription.status === "active",
  );
  active.forEach((user) => {
    mix[user.subscription.tier] += 1;
  });
  const period = reportingPeriod();
  const succeeded = db.payments.filter(
    (payment) => payment.status === "succeeded",
  );
  const buckets = new Map<string, number>();
  succeeded.forEach((payment) => {
    const key = payment.createdAt.slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + payment.finalPriceRial);
  });
  const [year, month] = period.split("-").map(Number);
  const revenueByMonth = Array.from({ length: 6 }, (_, index) => {
    const shifted = year * 12 + (month - 1) - (5 - index);
    const key = `${Math.floor(shifted / 12).toString().padStart(4, "0")}-${String((shifted % 12) + 1).padStart(2, "0")}`;
    return { period: key, revenueRial: buckets.get(key) ?? 0 };
  });
  return {
    period,
    timezone: "Asia/Tehran",
    subscriptions: active.length,
    subscriptionMix: [
      { tier: "basic", count: mix.basic },
      { tier: "silver", count: mix.silver },
      { tier: "gold", count: mix.gold },
    ],
    revenueRial: succeeded.reduce(
      (sum, payment) => sum + payment.finalPriceRial,
      0,
    ),
    monthRevenueRial: succeeded
      .filter((payment) => payment.createdAt.slice(0, 7) === period)
      .reduce((sum, payment) => sum + payment.finalPriceRial, 0),
    revenueByMonth,
    pendingPayoutsRial: db.payouts
      .filter((payout) => payout.status === "pending" && payout.amountRial > 0)
      .reduce((sum, payout) => sum + payout.amountRial, 0),
    validStreams: db.tracks.reduce((sum, track) => sum + track.streamCount, 0),
  };
};

const current = (db = load()): User => {
  const userId = localStorage.getItem(SESSION_KEY);
  const user = db.users.find(
    (candidate) => candidate.id === userId && !candidate.deletedAt,
  );
  if (!user)
    throw new RepositoryError("unauthenticated", "Please sign in to continue.");
  if (
    user.subscription.tier !== "basic" &&
    user.subscription.expiresAt &&
    new Date(user.subscription.expiresAt) <= new Date()
  ) {
    user.subscription.status = "expired";
    user.subscription = {
      id: id("sub"),
      tier: "basic",
      status: "active",
      startsAt: new Date().toISOString(),
      expiresAt: null,
      canUpgradeToGold: true,
    };
    save(db);
  }
  return user;
};

const usernameFrom = (displayName: string, users: User[]): string => {
  const base =
    displayName
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase()
      .slice(0, 18) || "listener";
  let candidate = base;
  let suffix = 1;
  while (users.some((user) => user.username === candidate))
    candidate = `${base}${suffix++}`;
  return candidate;
};

const dayKeyFor = (timezone: string, daysAgo: number, now = new Date()) => {
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  return localDay(timezone, date);
};

const computeListeningStats = (
  user: User,
  tracks: { id: string; durationSeconds: number }[],
  now = new Date(),
): ListeningStats => {
  const entries = Object.entries(user.streamDates);
  const today = localDay(user.timezone, now);
  const days = new Set(Object.values(user.streamDates));
  let listeningStreak = 0;
  for (let ago = 0; ago < 365; ago += 1) {
    if (!days.has(dayKeyFor(user.timezone, ago, now))) break;
    listeningStreak += 1;
  }
  const weekBars = Array.from({ length: 7 }, (_, index) => {
    const day = dayKeyFor(user.timezone, 6 - index, now);
    return Object.values(user.streamDates).filter((value) => value === day)
      .length;
  });
  const weekDays = new Set(
    Array.from({ length: 7 }, (_, index) =>
      dayKeyFor(user.timezone, index, now),
    ),
  );
  const minutesListened = Math.round(
    entries.reduce((sum, [trackId, day]) => {
      if (!weekDays.has(day)) return sum;
      const track = tracks.find((item) => item.id === trackId);
      return sum + (track?.durationSeconds ?? 180);
    }, 0) / 60,
  );
  return {
    minutesListened,
    dailyStreams: entries.filter(([, day]) => day === today).length,
    listeningStreak,
    weekBars,
  };
};

const publicProfile = (
  user: User,
  viewer: User | null,
  db: Database,
): PublicProfile => ({
  id: user.id,
  username: user.username,
  displayName: user.artistProfile?.stageName ?? user.displayName,
  avatarUrl: user.avatarUrl,
  kind: user.artistProfile ? "artist" : "consumer",
  followerCount: user.followerIds.length,
  followingCount: user.followingIds.length,
  isFollowing: viewer?.followingIds.includes(user.id) ?? false,
  publicPlaylistCount: db.playlists.filter(
    (playlist) =>
      playlist.ownerId === user.id && playlist.visibility === "public",
  ).length,
});

export const localRepository = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  revision(): number {
    return revision;
  },
  authReady(): boolean {
    return true;
  },
  database(): Database {
    return structuredClone(load());
  },
  reset(): void {
    localStorage.setItem(DB_KEY, JSON.stringify(createSeedDatabase()));
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(QUEUE_KEY);
    revision += 1;
    listeners.forEach((listener) => listener());
  },
  sessionUser(): User | null {
    try {
      const db = load();
      const user = current(db);
      return structuredClone({
        ...user,
        listeningStats: computeListeningStats(user, db.tracks),
      });
    } catch {
      return null;
    }
  },
  login(email: string, password: string): User {
    const db = load();
    const user = db.users.find(
      (candidate) =>
        candidate.email.toLowerCase() === email.trim().toLowerCase() &&
        !candidate.deletedAt,
    );
    if (!user || user.password !== password)
      throw new RepositoryError(
        "invalid_credentials",
        "Email or password is incorrect.",
      );
    localStorage.setItem(SESSION_KEY, user.id);
    revision += 1;
    listeners.forEach((listener) => listener());
    return structuredClone(user);
  },
  requestPasswordReset(email: string): void {
    void email;
  },
  logout(): void {
    localStorage.removeItem(SESSION_KEY);
    revision += 1;
    listeners.forEach((listener) => listener());
  },
  register(input: RegistrationInput, artist: boolean): User {
    const db = load();
    if (
      db.users.some(
        (user) => user.email.toLowerCase() === input.email.toLowerCase(),
      )
    )
      throw new RepositoryError(
        "email_exists",
        "An account already uses this email.",
      );
    const userId = id("user");
    const user: User = {
      id: userId,
      email: input.email.trim().toLowerCase(),
      password: input.password,
      kind: "consumer",
      username: usernameFrom(input.stageName || input.displayName, db.users),
      displayName: input.displayName.trim(),
      avatarUrl: null,
      birthDate: input.birthDate,
      gender: input.gender,
      locale: input.locale,
      timezone: input.timezone,
      theme: "dark",
      explicitContentEnabled: true,
      notificationPreference: "all",
      subscription: {
        id: id("sub"),
        tier: "basic",
        status: "active",
        startsAt: new Date().toISOString(),
        expiresAt: null,
        canUpgradeToGold: true,
      },
      artistProfile: artist
        ? {
            id: id("artist"),
            stageName: input.stageName!.trim(),
            bio: "",
            verifiedAt: null,
            genre: "",
          }
        : null,
      followerIds: [],
      followingIds: [],
      likedTrackIds: [],
      savedPlaylistIds: [],
      recentlyPlayedIds: [],
      recentlyPlayedPlaylistIds: [],
      streamDates: {},
      usernameChangedAt: null,
      deletedAt: null,
    };
    db.users.push(user);
    db.notifications.push({
      id: id("notice"),
      userId,
      title: "Welcome to Sonora",
      body: "Your listening space is ready.",
      titleKey: "noticeWelcomeTitle",
      bodyKey: "noticeWelcomeBody",
      kind: "important",
      readAt: null,
      createdAt: new Date().toISOString(),
    });
    if (artist && user.artistProfile) {
      const stageName = user.artistProfile.stageName;
      for (const staff of db.users.filter(
        (candidate) =>
          (candidate.kind === "support" || candidate.kind === "admin") &&
          !candidate.deletedAt,
      )) {
        db.notifications.push({
          id: id("notice"),
          userId: staff.id,
          title: "New artist registration",
          body: `${stageName} joined Sonora and needs verification.`,
          titleKey: "noticeArtistRegisteredTitle",
          bodyKey: "noticeArtistRegisteredBody",
          values: { name: stageName, email: user.email },
          kind: "important",
          readAt: null,
          createdAt: new Date().toISOString(),
        });
      }
    }
    save(db);
    localStorage.setItem(SESSION_KEY, user.id);
    revision += 1;
    listeners.forEach((listener) => listener());
    return structuredClone(user);
  },
  users(): User[] {
    return structuredClone(load().users.filter((user) => !user.deletedAt));
  },
  profile(
    username: string,
  ): {
    user: User;
    profile: PublicProfile;
    playlists: Playlist[];
  } | null {
    const db = load();
    const viewer = this.sessionUser();
    const user = db.users.find(
      (candidate) => candidate.username === username && !candidate.deletedAt,
    );
    if (!user || user.kind !== "consumer") return null;
    return {
      user: structuredClone(user),
      profile: publicProfile(user, viewer, db),
      playlists: structuredClone(
        db.playlists.filter(
          (playlist) =>
            playlist.ownerId === user.id && playlist.visibility === "public",
        ),
      ),
    };
  },
  follow(userId: string): void {
    const db = load();
    const me = current(db);
    const target = db.users.find((user) => user.id === userId);
    if (!target || target.kind !== "consumer" || target.deletedAt)
      throw new RepositoryError(
        "not_followable",
        "This profile cannot be followed.",
      );
    if (target.id === me.id)
      throw new RepositoryError("self_follow", "You cannot follow yourself.");
    const following = me.followingIds.includes(target.id);
    me.followingIds = following
      ? me.followingIds.filter((x) => x !== target.id)
      : [...me.followingIds, target.id];
    target.followerIds = following
      ? target.followerIds.filter((x) => x !== me.id)
      : [...target.followerIds, me.id];
    save(db);
  },
  tracks(): TrackView[] {
    const db = load();
    const me = current(db);
    return db.tracks.map((track) => {
      const lockReason = getTrackLock(me, track);
      return {
        ...track,
        isPlayableForViewer: !lockReason,
        lockReason,
        isLiked: me.likedTrackIds.includes(track.id),
      };
    });
  },
  like(trackId: string): void {
    const db = load();
    const me = current(db);
    me.likedTrackIds = me.likedTrackIds.includes(trackId)
      ? me.likedTrackIds.filter((x) => x !== trackId)
      : [...me.likedTrackIds, trackId];
    save(db);
  },
  recordRecentlyPlayed(trackId: string): void {
    const db = load();
    const me = current(db);
    me.recentlyPlayedIds = [
      trackId,
      ...me.recentlyPlayedIds.filter((x) => x !== trackId),
    ].slice(0, 20);
    save(db);
  },
  recordRecentlyPlayedPlaylist(playlistId: string): void {
    const db = load();
    const me = current(db);
    me.recentlyPlayedPlaylistIds = [
      playlistId,
      ...me.recentlyPlayedPlaylistIds.filter((x) => x !== playlistId),
    ].slice(0, 20);
    save(db);
  },
  recordValidStream(trackId: string, now = new Date()): boolean {
    const db = load();
    const me = current(db);
    const day = localDay(me.timezone, now);
    const track = db.tracks.find((item) => item.id === trackId);
    if (!track) return false;
    const firstEver = me.streamDates[trackId] === undefined;
    me.streamDates[trackId] = day;
    track.streamCount += 1;
    if (firstEver) track.uniqueListenerCount += 1;
    me.listeningStats = computeListeningStats(me, db.tracks, now);
    save(db);
    return true;
  },
  playlists(): Playlist[] {
    return structuredClone(load().playlists);
  },
  visiblePlaylists(): Playlist[] {
    const db = load();
    const me = current(db);
    return structuredClone(
      db.playlists.filter(
        (playlist) =>
          playlist.ownerId === me.id || playlist.visibility === "public",
      ),
    );
  },
  library(): { owned: Playlist[]; saved: Playlist[]; liked: TrackView[] } {
    const db = load();
    const me = current(db);
    const tracks = this.tracks();
    const owned = db.playlists.filter((playlist) => playlist.ownerId === me.id);
    const validSaved = db.playlists.filter(
      (playlist) =>
        me.savedPlaylistIds.includes(playlist.id) &&
        playlist.visibility === "public",
    );
    if (validSaved.length !== me.savedPlaylistIds.length) {
      me.savedPlaylistIds = validSaved.map((playlist) => playlist.id);
      db.notifications.push({
        id: id("notice"),
        userId: me.id,
        title: "Saved playlist changed",
        body: "A saved playlist is no longer public and was removed.",
        titleKey: "noticeSavedPlaylistTitle",
        bodyKey: "noticeSavedPlaylistBody",
        kind: "important",
        readAt: null,
        createdAt: new Date().toISOString(),
      });
      save(db);
    }
    return {
      owned: structuredClone(owned),
      saved: structuredClone(validSaved),
      liked: tracks.filter((track) => me.likedTrackIds.includes(track.id)),
    };
  },
  playlist(playlistId: string): Playlist | null {
    const db = load();
    const me = current(db);
    const playlist = db.playlists.find(
      (candidate) => candidate.id === playlistId,
    );
    if (
      !playlist ||
      (playlist.ownerId !== me.id && playlist.visibility !== "public")
    )
      return null;
    return structuredClone(playlist);
  },
  release(releaseId: string) {
    const release = load().releases.find(
      (item) => item.id === releaseId && item.status !== "archived",
    );
    return release ? structuredClone(release) : null;
  },
  createPlaylist(
    title: string,
    visibility: "private" | "public" = "private",
  ): Playlist {
    const db = load();
    const me = current(db);
    const count = db.playlists.filter(
      (playlist) => playlist.ownerId === me.id,
    ).length;
    if (count >= playlistLimit(me.subscription.tier))
      throw new RepositoryError(
        "playlist_limit",
        "Your plan's playlist limit has been reached.",
      );
    const playlist: Playlist = {
      id: id("playlist"),
      ownerId: me.id,
      title: title.trim(),
      description: "",
      visibility,
      coverUrl: null,
      generatedCover: true,
      trackIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.playlists.push(playlist);
    save(db);
    return structuredClone(playlist);
  },
  updatePlaylist(
    playlistId: string,
    patch: Partial<
      Pick<Playlist, "title" | "description" | "visibility" | "trackIds">
    >,
  ): Playlist {
    const db = load();
    const me = current(db);
    const playlist = db.playlists.find(
      (candidate) => candidate.id === playlistId,
    );
    if (!playlist || playlist.ownerId !== me.id)
      throw new RepositoryError(
        "forbidden",
        "Only the owner can edit this playlist.",
      );
    Object.assign(playlist, patch, { updatedAt: new Date().toISOString() });
    save(db);
    return structuredClone(playlist);
  },
  deletePlaylist(playlistId: string): void {
    const db = load();
    const me = current(db);
    const playlist = db.playlists.find(
      (candidate) => candidate.id === playlistId,
    );
    if (!playlist || playlist.ownerId !== me.id)
      throw new RepositoryError(
        "forbidden",
        "Only the owner can delete this playlist.",
      );
    db.playlists = db.playlists.filter(
      (candidate) => candidate.id !== playlistId,
    );
    db.users.forEach((user) => {
      user.savedPlaylistIds = user.savedPlaylistIds.filter(
        (saved) => saved !== playlistId,
      );
    });
    save(db);
  },
  /** Keep `trackIds` in selected owned playlists; remove from other owned ones. */
  syncTrackPlaylists(trackIds: string[], playlistIds: string[]): void {
    if (!trackIds.length) return;
    const db = load();
    const me = current(db);
    const selected = new Set(playlistIds);
    const owned = db.playlists.filter(
      (playlist) => playlist.ownerId === me.id,
    );
    let changed = false;
    owned.forEach((playlist) => {
      const shouldContain = selected.has(playlist.id);
      let next = [...playlist.trackIds];
      if (shouldContain) {
        trackIds.forEach((trackId) => {
          if (!next.includes(trackId)) next.push(trackId);
        });
      } else {
        next = next.filter((id) => !trackIds.includes(id));
      }
      if (next.length !== playlist.trackIds.length ||
        next.some((id, index) => id !== playlist.trackIds[index])
      ) {
        playlist.trackIds = next;
        playlist.updatedAt = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) save(db);
  },
  savePlaylist(playlistId: string): void {
    const db = load();
    const me = current(db);
    const playlist = db.playlists.find(
      (candidate) => candidate.id === playlistId,
    );
    if (
      !playlist ||
      playlist.visibility !== "public" ||
      playlist.ownerId === me.id
    )
      throw new RepositoryError(
        "not_saveable",
        "Only another listener's public playlist can be saved.",
      );
    me.savedPlaylistIds = me.savedPlaylistIds.includes(playlistId)
      ? me.savedPlaylistIds.filter((x) => x !== playlistId)
      : [...me.savedPlaylistIds, playlistId];
    save(db);
  },
  notifications(): Notification[] {
    const db = load();
    const me = current(db);
    const all = db.notifications
      .filter((n) => n.userId === me.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (me.notificationPreference === "all") return structuredClone(all);
    const critical = all.filter((notice) => notice.kind === "critical");
    if (me.notificationPreference === "muted") return structuredClone(critical);
    if (me.notificationPreference === "important_only")
      return structuredClone(
        all.filter(
          (notice) => notice.kind === "critical" || notice.kind === "important",
        ),
      );
    const visible: Notification[] = [];
    const overflow = new Map<string, number>();
    const daily = new Map<string, number>();
    all.forEach((notice) => {
      if (notice.kind === "critical") {
        visible.push(notice);
        return;
      }
      const day = notice.createdAt.slice(0, 10);
      const count = daily.get(day) ?? 0;
      if (count < 5) {
        visible.push(notice);
        daily.set(day, count + 1);
      } else overflow.set(day, (overflow.get(day) ?? 0) + 1);
    });
    overflow.forEach((count, day) =>
      visible.push({
        id: `digest-${day}`,
        userId: me.id,
        title: "Daily notification digest",
        body: `${count} additional updates are collected in this digest.`,
        titleKey: "noticeDigestTitle",
        bodyKey: "noticeDigestBody",
        values: { count },
        kind: "important",
        readAt: null,
        createdAt: `${day}T23:59:59.000Z`,
      }),
    );
    return structuredClone(
      visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
  readNotification(notificationId: string): void {
    const db = load();
    const me = current(db);
    const n = db.notifications.find(
      (x) => x.id === notificationId && x.userId === me.id,
    );
    if (n) n.readAt = new Date().toISOString();
    save(db);
  },
  readAllNotifications(): void {
    const db = load();
    const me = current(db);
    db.notifications
      .filter((n) => n.userId === me.id)
      .forEach((n) => {
        n.readAt = n.readAt ?? new Date().toISOString();
      });
    save(db);
  },
  deleteNotification(notificationId: string): void {
    const db = load();
    const me = current(db);
    db.notifications = db.notifications.filter(
      (n) => n.id !== notificationId || n.userId !== me.id,
    );
    save(db);
  },
  updateSettings(
    patch: Partial<
      Pick<
        User,
        | "locale"
        | "theme"
        | "explicitContentEnabled"
        | "notificationPreference"
        | "timezone"
        | "displayName"
      >
    >,
  ): void {
    const db = load();
    Object.assign(current(db), patch);
    save(db);
  },
  updateAvatar(avatar: string | File): void {
    const db = load();
    const me = current(db);
    if (!canEditAvatar(me.subscription.tier))
      throw new RepositoryError(
        "avatar_entitlement",
        "Profile image edits require Silver or Gold.",
      );
    me.avatarUrl =
      typeof avatar === "string" ? avatar : URL.createObjectURL(avatar);
    save(db);
  },
  updateUsername(username: string): void {
    const db = load();
    const me = current(db);
    const normalized = username.trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,24}$/.test(normalized))
      throw new RepositoryError(
        "username_invalid",
        "Use 3–24 lowercase letters, numbers, or underscores.",
      );
    if (
      db.users.some((user) => user.id !== me.id && user.username === normalized)
    )
      throw new RepositoryError(
        "username_taken",
        "That username is already in use.",
      );
    if (
      me.usernameChangedAt &&
      Date.now() - new Date(me.usernameChangedAt).getTime() < 30 * 86_400_000
    )
      throw new RepositoryError(
        "username_cooldown",
        "Username can be changed once every 30 days.",
      );
    me.username = normalized;
    me.usernameChangedAt = new Date().toISOString();
    save(db);
  },
  deleteAccount(): void {
    const db = load();
    const me = current(db);
    me.deletedAt = new Date().toISOString();
    db.playlists = db.playlists.filter(
      (playlist) => playlist.ownerId !== me.id,
    );
    db.users.forEach((user) => {
      user.savedPlaylistIds = user.savedPlaylistIds.filter((playlistId) =>
        db.playlists.some((playlist) => playlist.id === playlistId),
      );
    });
    if (me.artistProfile)
      db.releases
        .filter((release) => release.ownerUserId === me.id)
        .forEach((release) => {
          release.status = "archived";
        });
    save(db);
    localStorage.removeItem(SESSION_KEY);
    revision += 1;
    listeners.forEach((listener) => listener());
  },
  purchase(planId: string) {
    const db = load();
    const me = current(db);
    const plan = db.plans.find(
      (candidate) => candidate.id === planId && candidate.isAvailable,
    );
    if (!plan)
      throw new RepositoryError(
        "plan_unavailable",
        "This plan is unavailable.",
      );
    const active = me.subscription;
    if (active.tier === plan.tier && active.status === "active")
      throw new RepositoryError(
        "same_tier_active",
        "An active subscription cannot be extended or stacked.",
      );
    if (
      active.tier === "gold" &&
      plan.tier === "silver" &&
      active.expiresAt &&
      new Date(active.expiresAt) > new Date()
    )
      throw new RepositoryError(
        "downgrade_blocked",
        "Silver becomes available after your Gold plan expires.",
      );
    active.status = "superseded";
    const starts = new Date();
    const expires = new Date(starts);
    expires.setMonth(expires.getMonth() + plan.durationMonths);
    me.subscription = {
      id: id("sub"),
      tier: plan.tier,
      status: "active",
      startsAt: starts.toISOString(),
      expiresAt: expires.toISOString(),
      canUpgradeToGold: plan.tier !== "gold",
    };
    db.payments.push({
      id: id("payment"),
      userId: me.id,
      planId: plan.id,
      tier: plan.tier,
      durationMonths: plan.durationMonths,
      monthlyPriceRial: plan.monthlyPriceRial,
      discountPercent: plan.discountPercent,
      finalPriceRial: plan.finalPriceRial,
      provider: "demo",
      status: "succeeded",
      createdAt: starts.toISOString(),
    });
    db.notifications.push({
      id: id("notice"),
      userId: me.id,
      title: `${plan.tier === "gold" ? "Gold" : "Silver"} activated`,
      body: "Backend mock payment completed. No real payment was charged.",
      titleKey: "noticePaymentTitle",
      bodyKey: "noticePaymentBody",
      values: { tier: plan.tier === "gold" ? "Gold" : "Silver" },
      kind: "critical",
      readAt: null,
      createdAt: starts.toISOString(),
    });
    save(db);
    return db.payments[db.payments.length - 1];
  },
  verificationRequests(): VerificationRequest[] {
    return structuredClone(load().verificationRequests);
  },
  submitVerification(portfolioUrls: string[], note: string): void {
    const db = load();
    const me = current(db);
    if (!me.artistProfile)
      throw new RepositoryError(
        "artist_required",
        "An artist profile is required.",
      );
    if (
      db.verificationRequests.some(
        (request) => request.userId === me.id && request.status === "pending",
      )
    )
      throw new RepositoryError(
        "pending_exists",
        "You already have a pending request.",
      );
    db.verificationRequests.push({
      id: id("verify"),
      userId: me.id,
      status: "pending",
      portfolioUrls,
      note,
      reason: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    });
    const stageName = me.artistProfile.stageName;
    for (const staff of db.users.filter(
      (user) =>
        (user.kind === "support" || user.kind === "admin") && !user.deletedAt,
    )) {
      db.notifications.push({
        id: id("notice"),
        userId: staff.id,
        title: "Verification request pending",
        body: `${stageName} submitted materials for review.`,
        titleKey: "noticeVerificationPendingTitle",
        bodyKey: "noticeVerificationPendingBody",
        values: { name: stageName, note: note.slice(0, 160) },
        kind: "important",
        readAt: null,
        createdAt: new Date().toISOString(),
      });
    }
    save(db);
  },
  decideVerification(
    requestId: string,
    approved: boolean,
    reason: string,
  ): void {
    const db = load();
    const me = current(db);
    if (me.kind !== "support" && me.kind !== "admin")
      throw new RepositoryError("forbidden", "Staff access required.");
    const request = db.verificationRequests.find(
      (candidate) =>
        candidate.id === requestId && candidate.status === "pending",
    );
    if (!request)
      throw new RepositoryError("not_pending", "Request is no longer pending.");
    request.status = approved ? "approved" : "rejected";
    request.reason = reason;
    request.decidedAt = new Date().toISOString();
    const artist = db.users.find(
      (user) => user.id === request.userId,
    )?.artistProfile;
    if (approved && artist) artist.verifiedAt = request.decidedAt;
    db.auditEvents.push({
      id: id("audit"),
      actorId: me.id,
      action: `verification.${request.status}`,
      target: request.id,
      before: "pending",
      after: request.status,
      createdAt: request.decidedAt,
      requestId: id("req"),
    });
    save(db);
  },
  tickets(): Ticket[] {
    const db = load();
    const me = current(db);
    return structuredClone(
      me.kind === "consumer"
        ? db.tickets.filter((ticket) => ticket.creatorId === me.id)
        : db.tickets,
    );
  },
  createTicket(subject: string, body: string): void {
    const db = load();
    const me = current(db);
    if (!canOpenTicket(me))
      throw new RepositoryError(
        "ticket_entitlement",
        "Silver, Gold, or verified artist access is required.",
      );
    const preview =
      body.trim().length > 160 ? `${body.trim().slice(0, 157)}...` : body.trim();
    db.tickets.push({
      id: id("ticket"),
      creatorId: me.id,
      subject,
      status: "open",
      claimedById: null,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: id("message"),
          authorId: me.id,
          body,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    for (const staff of db.users.filter(
      (user) =>
        (user.kind === "support" || user.kind === "admin") && !user.deletedAt,
    )) {
      db.notifications.push({
        id: id("notice"),
        userId: staff.id,
        title: "New support ticket",
        body: `${me.displayName}: ${subject}`,
        titleKey: "noticeTicketCreatedTitle",
        bodyKey: "noticeTicketCreatedBody",
        values: {
          name: me.displayName,
          subject,
          preview,
        },
        kind: "important",
        createdAt: new Date().toISOString(),
        readAt: null,
      });
    }
    save(db);
  },
  replyTicket(ticketId: string, body: string): void {
    const db = load();
    const me = current(db);
    const ticket = db.tickets.find((t) => t.id === ticketId);
    if (!ticket || (me.kind === "consumer" && ticket.creatorId !== me.id))
      throw new RepositoryError("forbidden", "You cannot access this ticket.");
    ticket.messages.push({
      id: id("message"),
      authorId: me.id,
      body,
      createdAt: new Date().toISOString(),
    });
    if (me.kind !== "consumer") {
      ticket.status = "answered";
    } else {
      const preview =
        body.trim().length > 160
          ? `${body.trim().slice(0, 157)}...`
          : body.trim();
      for (const staff of db.users.filter(
        (user) =>
          (user.kind === "support" || user.kind === "admin") && !user.deletedAt,
      )) {
        db.notifications.push({
          id: id("notice"),
          userId: staff.id,
          title: "Ticket reply",
          body: `${me.displayName}: ${ticket.subject}`,
          titleKey: "noticeTicketReplyTitle",
          bodyKey: "noticeTicketReplyBody",
          values: {
            name: me.displayName,
            subject: ticket.subject,
            preview,
          },
          kind: "important",
          createdAt: new Date().toISOString(),
          readAt: null,
        });
      }
    }
    save(db);
  },
  closeTicket(ticketId: string): void {
    const db = load();
    const me = current(db);
    const ticket = db.tickets.find((t) => t.id === ticketId);
    if (!ticket || (me.kind === "consumer" && ticket.creatorId !== me.id))
      throw new RepositoryError("forbidden", "You cannot close this ticket.");
    ticket.status = "closed";
    save(db);
  },
  updatePlan(planId: string, patch: Partial<SubscriptionPlan>): void {
    const db = load();
    const me = current(db);
    if (me.kind !== "admin")
      throw new RepositoryError("forbidden", "Admin access required.");
    const plan = db.plans.find((p) => p.id === planId);
    if (!plan) return;
    const before = JSON.stringify(plan);
    Object.assign(plan, patch);
    plan.finalPriceRial = Math.round(
      plan.monthlyPriceRial *
        plan.durationMonths *
        (1 - plan.discountPercent / 100),
    );
    db.auditEvents.push({
      id: id("audit"),
      actorId: me.id,
      action: "plan.updated",
      target: plan.id,
      before,
      after: JSON.stringify(plan),
      createdAt: new Date().toISOString(),
      requestId: id("req"),
    });
    save(db);
  },
  settlePayout(payoutId: string): void {
    const db = load();
    const me = current(db);
    if (me.kind !== "admin")
      throw new RepositoryError("forbidden", "Admin access required.");
    const payout = db.payouts.find((p) => p.id === payoutId);
    if (payout) payout.status = "settled";
    db.payouts = buildArtistLedger(db);
    db.adminReports = buildAdminReports(db);
    db.auditEvents.push({
      id: id("audit"),
      actorId: me.id,
      action: "payout.settled",
      target: payoutId,
      before: "pending",
      after: "settled",
      createdAt: new Date().toISOString(),
      requestId: id("req"),
    });
    save(db);
  },
    saveDraft(draft: Omit<DraftRelease, "id" | "userId" | "createdAt">): void {
    const db = load();
    const me = current(db);
    if (!me.artistProfile?.verifiedAt)
      throw new RepositoryError(
        "verified_required",
        "Only verified artists can manage releases.",
      );
    db.drafts.push({
      ...draft,
      id: id("draft"),
      userId: me.id,
      createdAt: new Date().toISOString(),
    });
    save(db);
  },
  async saveRelease(
    releaseId: string | null,
    form: {
      title: string;
      type: "single" | "album";
      genre: string;
      year: number;
      releaseDate: string;
      collaborators: string;
      earlyAccess: boolean;
    },
    tracks: {
      id: string | null;
      title: string;
      lyrics: string;
      audio: File | null;
    }[],
    cover: File | null,
    removedTrackIds: string[] = [],
  ): Promise<void> {
    const db = load();
    const me = current(db);
    if (!me.artistProfile?.verifiedAt)
      throw new RepositoryError(
        "verified_required",
        "Only verified artists can manage releases.",
      );
    if (!tracks.length)
      throw new RepositoryError("invalid", "At least one track is required.");
    const publicReleaseAt = form.releaseDate
      ? new Date(form.releaseDate).toISOString()
      : new Date(`${form.year}-01-01T00:00:00.000Z`).toISOString();
    const credit = {
      artistId: me.artistProfile.id,
      username: me.username,
      stageName: me.artistProfile.stageName,
      role: "primary" as const,
    };
    void form.collaborators;

    const ensureRelease = () => {
      if (!releaseId) {
        const created = {
          id: id("release"),
          type: form.type,
          title: form.title,
          coverUrl: cover ? URL.createObjectURL(cover) : null,
          primaryArtist: credit,
          publicReleaseAt,
          isEarlyAccess: form.earlyAccess,
          status: (form.earlyAccess ? "scheduled" : "published") as
            | "scheduled"
            | "published",
          trackIds: [] as string[],
          genre: form.genre,
          ownerUserId: me.id,
        };
        db.releases.push(created);
        return created;
      }
      const release = db.releases.find((candidate) => candidate.id === releaseId);
      if (!release || release.ownerUserId !== me.id)
        throw new RepositoryError(
          "forbidden",
          "Only the verified owning artist can edit this release.",
        );
      Object.assign(release, {
        title: form.title,
        type: form.type,
        genre: form.genre,
        publicReleaseAt,
        isEarlyAccess: form.earlyAccess,
        coverUrl: cover ? URL.createObjectURL(cover) : release.coverUrl,
      });
      return release;
    };

    const release = ensureRelease();
    for (const trackId of removedTrackIds) {
      db.tracks = db.tracks.filter((track) => track.id !== trackId);
      release.trackIds = release.trackIds.filter((id) => id !== trackId);
    }

    const nextTrackIds: string[] = [];
    for (const draft of tracks) {
      if (draft.id) {
        const existing = db.tracks.find((track) => track.id === draft.id);
        if (!existing) continue;
        existing.title = draft.title;
        existing.lyrics = draft.lyrics || null;
        existing.releaseTitle = release.title;
        existing.genre = form.genre;
        existing.publicReleaseAt = publicReleaseAt;
        existing.isGoldEarlyAccess = form.earlyAccess;
        existing.coverUrl = release.coverUrl;
        if (draft.audio) existing.audioUrl = URL.createObjectURL(draft.audio);
        nextTrackIds.push(existing.id);
        continue;
      }
      if (!draft.audio)
        throw new RepositoryError("audio_required", "Audio file is required.");
      const trackId = id("track");
      db.tracks.push({
        id: trackId,
        releaseId: release.id,
        title: draft.title,
        coverUrl: release.coverUrl,
        audioUrl: URL.createObjectURL(draft.audio),
        artists: [credit],
        releaseTitle: release.title,
        durationSeconds: 45,
        isExplicit: false,
        isGoldEarlyAccess: form.earlyAccess,
        publicReleaseAt,
        genre: form.genre,
        lyrics: draft.lyrics || null,
        streamCount: 0,
        uniqueListenerCount: 0,
      });
      nextTrackIds.push(trackId);
    }
    release.trackIds = nextTrackIds;
    save(db);
  },
  updateRelease(
    releaseId: string,
    patch: {
      title?: string;
      genre?: string;
      type?: "single" | "album";
      publicReleaseAt?: string;
      earlyAccess?: boolean;
      status?: "published" | "archived" | "scheduled" | "draft";
      lyrics?: string;
      collaborators?: string;
      cover?: File | null;
      audio?: File | null;
    },
  ): void | Promise<void> {
    const db = load();
    const me = current(db);
    const release = db.releases.find((candidate) => candidate.id === releaseId);
    if (
      !release ||
      release.ownerUserId !== me.id ||
      !me.artistProfile?.verifiedAt
    )
      throw new RepositoryError(
        "forbidden",
        "Only the verified owning artist can edit this release.",
      );
    if (patch.status !== undefined) release.status = patch.status;
    if (patch.title !== undefined) release.title = patch.title;
    if (patch.genre !== undefined) release.genre = patch.genre;
    if (patch.type !== undefined) release.type = patch.type;
    if (patch.publicReleaseAt !== undefined)
      release.publicReleaseAt = patch.publicReleaseAt;
    if (patch.earlyAccess !== undefined)
      release.isEarlyAccess = patch.earlyAccess;
    if (patch.cover) release.coverUrl = URL.createObjectURL(patch.cover);
    release.trackIds.forEach((trackId) => {
      const track = db.tracks.find((candidate) => candidate.id === trackId);
      if (!track) return;
      if (patch.title) track.releaseTitle = patch.title;
      track.coverUrl = release.coverUrl;
    });
    void patch.lyrics;
    void patch.collaborators;
    void patch.audio;
    save(db);
  },
  queue(): QueueState {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw)
      return {
        trackIds: [],
        currentIndex: -1,
        repeatMode: "off",
        shuffleEnabled: false,
        volume: 0.75,
      };
    try {
      return JSON.parse(raw) as QueueState;
    } catch {
      return {
        trackIds: [],
        currentIndex: -1,
        repeatMode: "off",
        shuffleEnabled: false,
        volume: 0.75,
      };
    }
  },
  saveQueue(queue: QueueState): void {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  },
  loadSettingsData: async () => undefined,
  loadLibraryData: async () => undefined,
  loadProfileData: async (_username?: string) => undefined,
  loadCatalogData: async () => undefined,
  loadPlaylistData: async (_playlistId?: string) => undefined,
  loadReleaseData: async (_releaseId?: string) => undefined,
  loadTracksByIds: async (_ids?: string[], _options?: { deferMs?: number }) =>
    undefined,
  refreshSession: async () => undefined,
  loadNotificationsData: async () => undefined,
  refreshUnreadCount: async () => undefined,
  loadTicketsData: async () => undefined,
  loadSearchData: async () => undefined,
  loadStudioData: async () => undefined,
  loadSupportData: async () => undefined,
  loadAdminData: async () => {
    const db = load();
    const userId = localStorage.getItem(SESSION_KEY);
    const me = db.users.find(
      (user) => user.id === userId && !user.deletedAt,
    );
    if (me?.kind !== "admin") return;
    db.payouts = buildArtistLedger(db);
    db.adminReports = buildAdminReports(db);
    save(db);
  },
  async artistAnalytics() {
    const db = load();
    const me = current(db);
    db.payouts = buildArtistLedger(db);
    const { owned, tracks, uniqueListeners, validStreams } =
      artistCatalogTotals(db, me.id);
    const rewardRial = rewardAmountRial(uniqueListeners, validStreams);
    const mine = db.payouts.filter((payout) => payout.artistUserId === me.id);
    const paidRial = mine
      .filter((payout) => payout.status === "settled")
      .reduce((sum, payout) => sum + payout.amountRial, 0);
    const unpaidRial = mine.some(
      (payout) => payout.period === reportingPeriod() && payout.status === "settled",
    )
      ? 0
      : rewardRial;
    return {
      streams: validStreams,
      tracks: tracks.length,
      releases: owned.length,
      uniqueListeners,
      rewardRial,
      paidRial,
      unpaidRial,
      period: reportingPeriod(),
      verified: Boolean(me.artistProfile?.verifiedAt),
      streamsByRelease: owned.map((release) => {
        const releaseTracks = tracks.filter((track) =>
          release.trackIds.includes(track.id),
        );
        const listeners = releaseTracks.reduce(
          (sum, track) => sum + track.uniqueListenerCount,
          0,
        );
        const streams = releaseTracks.reduce(
          (sum, track) => sum + track.streamCount,
          0,
        );
        return {
          id: release.id,
          title: release.title,
          streams,
          uniqueListeners: listeners,
          rewardRial: rewardAmountRial(listeners, streams),
          trackCount: releaseTracks.length,
        };
      }),
      topTracks: [...tracks]
        .sort((left, right) => right.streamCount - left.streamCount)
        .slice(0, 8)
        .map((track) => ({
          id: track.id,
          title: track.title,
          releaseTitle: track.releaseTitle,
          coverUrl: track.coverUrl,
          streamCount: track.streamCount,
          uniqueListenerCount: track.uniqueListenerCount,
        })),
    };
  },
};

const useApiRepository =
  import.meta.env.MODE !== "test" &&
  import.meta.env.VITE_SONORA_REPOSITORY !== "local";
export const repository = (
  useApiRepository
    ? createDjangoApiRepository(localRepository)
    : localRepository
) as typeof localRepository;

export const setLocale = (locale: Locale): void =>
  repository.updateSettings({ locale });
