import { createSeedDatabase } from "../data/seed";
import {
  canEditAvatar,
  canOpenTicket,
  getTrackLock,
  localDay,
  playlistLimit,
} from "../domain/entitlements";
import type {
  Database,
  DraftRelease,
  Locale,
  Notification,
  Playlist,
  PublicProfile,
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
const SEED_VERSION = 8;
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
      return structuredClone(current());
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
  ): { user: User; profile: PublicProfile; playlists: Playlist[] } | null {
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
    if (me.streamDates[trackId] === day) return false;
    me.streamDates[trackId] = day;
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
  purchase(planId: string): void {
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
    if (me.kind !== "consumer") ticket.status = "answered";
    save(db);
  },
  claimTicket(ticketId: string): void {
    const db = load();
    const me = current(db);
    if (me.kind === "consumer")
      throw new RepositoryError("forbidden", "Staff access required.");
    const ticket = db.tickets.find((t) => t.id === ticketId);
    if (ticket)
      ticket.claimedById = ticket.claimedById === me.id ? null : me.id;
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
  moderateRelease(releaseId: string, reason: string): void {
    const db = load();
    const me = current(db);
    if (me.kind !== "admin")
      throw new RepositoryError("forbidden", "Admin access required.");
    const release = db.releases.find((candidate) => candidate.id === releaseId);
    if (!release) return;
    const before = release.status;
    release.status = "archived";
    db.auditEvents.push({
      id: id("audit"),
      actorId: me.id,
      action: "release.archived",
      target: release.id,
      before,
      after: `archived: ${reason}`,
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
  updateRelease(
    releaseId: string,
    patch: { title?: string; status?: "published" | "archived" },
  ): void {
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
    Object.assign(release, patch);
    if (patch.title)
      release.trackIds.forEach((trackId) => {
        const track = db.tracks.find((candidate) => candidate.id === trackId);
        if (track) track.releaseTitle = patch.title!;
      });
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
