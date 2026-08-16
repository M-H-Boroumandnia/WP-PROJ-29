import type { localRepository } from "./localRepository";
import type {
  AdminReports,
  ArtistAnalytics,
  Database,
  DraftRelease,
  ListeningRoom,
  Notification,
  Payment,
  Playlist,
  PublicProfile,
  Payout,
  QueueState,
  RegistrationInput,
  Release,
  SubscriptionPlan,
  Ticket,
  TrackView,
  User,
  VerificationRequest,
} from "../domain/types";
import { createSeedDatabase } from "../data/seed";
import { RepositoryError } from "./errors";

type RepositoryShape = typeof localRepository;
type Tokens = { access: string };
type PlaybackGrant = {
  playbackSessionId: string;
  streamUrl: string;
  expiresAt: string;
  canDownload: boolean;
};
type DownloadTicket = { downloadUrl: string; expiresAt: string };

const API_BASE = import.meta.env.VITE_SONORA_API_BASE ?? "/api/v1";
const CACHE_KEY = "sonora:api:cache:v1";
const LEGACY_TOKENS_KEY = "sonora:api:tokens:v1";
const ACCESS_KEY = "sonora:api:access:v1";
const REFRESH_KEY = "sonora:api:refresh:v1";
const QUEUE_KEY = "sonora:api:queue:v1";

const emptyDatabase = (): Database => ({
  ...createSeedDatabase(),
  users: [],
  tracks: [],
  releases: [],
  playlists: [],
  notifications: [],
  verificationRequests: [],
  tickets: [],
  plans: [],
  auditEvents: [],
  payouts: [],
  payments: [],
  drafts: [],
  adminReports: null,
});

const clone = <T>(value: T): T => structuredClone(value);
const listeners = new Set<() => void>();

function pageResults<T>(payload: T[] | { results?: T[] }): T[] {
  return Array.isArray(payload) ? payload : (payload.results ?? []);
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadAccessToken(): Tokens | null {
  try {
    const access =
      sessionStorage.getItem(ACCESS_KEY) ?? localStorage.getItem(ACCESS_KEY);
    localStorage.removeItem(LEGACY_TOKENS_KEY);
    if (access && !sessionStorage.getItem(ACCESS_KEY)) {
      sessionStorage.setItem(ACCESS_KEY, access);
      localStorage.removeItem(ACCESS_KEY);
    }
    return access ? { access } : null;
  } catch {
    return null;
  }
}

function loadRefreshToken(): string | null {
  try {
    return (
      sessionStorage.getItem(REFRESH_KEY) ?? localStorage.getItem(REFRESH_KEY)
    );
  } catch {
    return null;
  }
}

function storeRefreshToken(refresh: string | null | undefined) {
  try {
    if (refresh) {
      sessionStorage.setItem(REFRESH_KEY, refresh);
      localStorage.setItem(REFRESH_KEY, refresh);
    } else {
      sessionStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }
  } catch {
    // Ignore storage failures; HTTP-only cookie may still work.
  }
}

function normalizeUser(user: User): User {
  return {
    ...user,
    locale: user.locale ?? "en",
    timezone:
      user.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    theme: user.theme ?? "dark",
    explicitContentEnabled: user.explicitContentEnabled ?? true,
    notificationPreference: user.notificationPreference ?? "all",
    followerIds: user.followerIds ?? [],
    followingIds: user.followingIds ?? [],
    likedTrackIds: user.likedTrackIds ?? [],
    savedPlaylistIds: user.savedPlaylistIds ?? [],
    recentlyPlayedIds: user.recentlyPlayedIds ?? [],
    recentlyPlayedPlaylistIds: user.recentlyPlayedPlaylistIds ?? [],
    streamDates: user.streamDates ?? {},
    listeningStats: user.listeningStats ?? {
      minutesListened: 0,
      dailyStreams: 0,
      listeningStreak: 0,
      weekBars: [0, 0, 0, 0, 0, 0, 0],
    },
    unreadNotificationCount: user.unreadNotificationCount ?? 0,
    subscription: user.subscription ?? {
      id: "unknown",
      tier: "basic",
      status: "active",
      startsAt: new Date().toISOString(),
      expiresAt: null,
      canUpgradeToGold: true,
    },
    artistProfile: user.artistProfile ?? null,
    usernameChangedAt: user.usernameChangedAt ?? null,
    deletedAt: user.deletedAt ?? null,
  };
}

function publicToUser(profile: PublicProfile, existing?: User): User {
  return normalizeUser({
    id: profile.id,
    email: existing?.email ?? "",
    password: existing?.password ?? "",
    kind: existing?.kind ?? "consumer",
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    birthDate: existing?.birthDate ?? "1990-01-01",
    gender: existing?.gender ?? "prefer_not_to_say",
    locale: existing?.locale ?? "en",
    timezone:
      existing?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    theme: existing?.theme ?? "dark",
    explicitContentEnabled: existing?.explicitContentEnabled ?? true,
    notificationPreference: existing?.notificationPreference ?? "all",
    subscription: existing?.subscription ?? {
      id: "unknown",
      tier: "basic",
      status: "active",
      startsAt: new Date().toISOString(),
      expiresAt: null,
      canUpgradeToGold: true,
    },
    artistProfile:
      profile.kind === "artist"
        ? (existing?.artistProfile ?? {
            id: profile.id,
            stageName: profile.displayName,
            bio: "",
            verifiedAt: null,
            genre: "",
          })
        : (existing?.artistProfile ?? null),
    followerIds: existing?.followerIds ?? [],
    followingIds: existing?.followingIds ?? [],
    likedTrackIds: existing?.likedTrackIds ?? [],
    savedPlaylistIds: existing?.savedPlaylistIds ?? [],
    recentlyPlayedIds: existing?.recentlyPlayedIds ?? [],
    recentlyPlayedPlaylistIds: existing?.recentlyPlayedPlaylistIds ?? [],
    streamDates: existing?.streamDates ?? {},
    listeningStats: existing?.listeningStats,
    unreadNotificationCount: existing?.unreadNotificationCount ?? 0,
    usernameChangedAt: existing?.usernameChangedAt ?? null,
    deletedAt: existing?.deletedAt ?? null,
  });
}

export function createDjangoApiRepository(
  _fallback: RepositoryShape,
): RepositoryShape {
  void _fallback;
  let revision = 0;
  let authReady = false;
  let cache = loadJson<Database>(CACHE_KEY, emptyDatabase());
  cache.users = cache.users.map((user) => normalizeUser(user));
  // Don't restore a full catalog from disk — queue/player loads tracks by id.
  cache.tracks = [];
  // Owned playlists must come from /me/library/ so deleted/stale ids don't linger.
  cache.playlists = cache.playlists.filter(
    (playlist) => playlist.visibility === "public",
  );
  let tokens = loadAccessToken();
  let activeUserId = localStorage.getItem("sonora:api:active-user");
  const grants = new Map<string, PlaybackGrant>();
  const inFlight = new Map<string, Promise<unknown>>();
  const profilePlaylists = new Map<string, Playlist[]>();
  const profileReleases = new Map<string, Release[]>();
  const profileArtistStats = new Map<
    string,
    { uniqueListeners: number; streams: number; releases: number } | null
  >();
  let studioLoaded = false;
  let queueSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const emptyQueue = (): QueueState => ({
    trackIds: [],
    currentIndex: -1,
    repeatMode: "off",
    shuffleEnabled: false,
    volume: 0.75,
  });
  const writeQueueCache = (queue: QueueState) =>
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  const readQueueCache = () => loadJson<QueueState>(QUEUE_KEY, emptyQueue());

  const saveCache = () =>
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  const saveTokens = () => {
    localStorage.removeItem(LEGACY_TOKENS_KEY);
    try {
      if (tokens?.access) {
        sessionStorage.setItem(ACCESS_KEY, tokens.access);
        localStorage.setItem(ACCESS_KEY, tokens.access);
      } else {
        sessionStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(ACCESS_KEY);
      }
    } catch {
      // Session storage can be unavailable in hardened/private contexts; the HTTP-only refresh cookie still recovers sessions.
    }
  };
  const clearSession = () => {
    tokens = null;
    activeUserId = null;
    studioLoaded = false;
    inFlight.delete("studio");
    saveTokens();
    storeRefreshToken(null);
    localStorage.removeItem("sonora:api:active-user");
    profilePlaylists.clear();
    profileReleases.clear();
    profileArtistStats.clear();
  };
  const notify = () => {
    revision += 1;
    saveCache();
    listeners.forEach((listener) => listener());
  };
  const upsertUser = (user: User) => {
    const normalized = normalizeUser(user);
    cache.users = [
      normalized,
      ...cache.users.filter((item) => item.id !== normalized.id),
    ];
  };
  const setActiveUser = (user: User) => {
    const normalized = normalizeUser(user);
    upsertUser(normalized);
    activeUserId = normalized.id;
    localStorage.setItem("sonora:api:active-user", normalized.id);
  };
  const me = () => {
    const user =
      cache.users.find((item) => item.id === activeUserId && !item.deletedAt) ??
      null;
    return user ? normalizeUser(user) : null;
  };
  const applySession = (session: Partial<User>) => {
    const current = me();
    const next = normalizeUser({
      ...(current ?? (session as User)),
      ...session,
      email: session.email ?? current?.email ?? "",
      gender: session.gender ?? current?.gender ?? "prefer_not_to_say",
      notificationPreference:
        session.notificationPreference ??
        current?.notificationPreference ??
        "all",
      followerIds: session.followerIds ?? current?.followerIds ?? [],
      followingIds: session.followingIds ?? current?.followingIds ?? [],
      likedTrackIds: session.likedTrackIds ?? current?.likedTrackIds ?? [],
      savedPlaylistIds: current?.savedPlaylistIds ?? [],
      recentlyPlayedIds: current?.recentlyPlayedIds ?? [],
      recentlyPlayedPlaylistIds: current?.recentlyPlayedPlaylistIds ?? [],
      streamDates: current?.streamDates ?? {},
      listeningStats: session.listeningStats ?? current?.listeningStats,
      unreadNotificationCount:
        session.unreadNotificationCount ??
        current?.unreadNotificationCount ??
        0,
      usernameChangedAt:
        session.usernameChangedAt ?? current?.usernameChangedAt ?? null,
      deletedAt: session.deletedAt ?? current?.deletedAt ?? null,
      password: current?.password ?? "",
    });
    setActiveUser(next);
    return next;
  };
  const setUnreadCount = (count: number) => {
    const current = me();
    if (!current || current.unreadNotificationCount === count) return;
    setActiveUser({ ...current, unreadNotificationCount: count });
    notify();
  };
  const applyProfilePayload = (payload: {
    user: Partial<User>;
    profile: PublicProfile;
    playlists: Playlist[];
    releases?: Release[];
    artistStats?: {
      uniqueListeners: number;
      streams: number;
      releases: number;
    } | null;
    followers?: PublicProfile[];
    following?: PublicProfile[];
  }) => {
    const existing = cache.users.find((item) => item.id === payload.profile.id);
    const active = me();
    const isSelf = Boolean(active && active.id === payload.profile.id);
    const payloadHasPrivate = Boolean(
      isSelf &&
        (payload.user.listeningStats ||
          payload.user.subscription ||
          payload.user.email),
    );
    // Own profile (/profiles/:username) carries complete private fields.
    const privateFields =
      isSelf && active
        ? {
            email: payload.user.email ?? active.email,
            password: active.password,
            kind: active.kind,
            birthDate: payload.user.birthDate ?? active.birthDate,
            gender: payload.user.gender ?? active.gender,
            locale: payload.user.locale ?? active.locale,
            timezone: payload.user.timezone ?? active.timezone,
            theme: payload.user.theme ?? active.theme,
            explicitContentEnabled:
              payload.user.explicitContentEnabled ??
              active.explicitContentEnabled,
            notificationPreference: active.notificationPreference,
            subscription: payloadHasPrivate
              ? (payload.user.subscription ?? active.subscription)
              : active.subscription,
            likedTrackIds: active.likedTrackIds,
            savedPlaylistIds: active.savedPlaylistIds,
            recentlyPlayedIds: active.recentlyPlayedIds,
            recentlyPlayedPlaylistIds: active.recentlyPlayedPlaylistIds,
            streamDates: active.streamDates,
            listeningStats: payloadHasPrivate
              ? (payload.user.listeningStats ?? active.listeningStats)
              : active.listeningStats,
            unreadNotificationCount: active.unreadNotificationCount,
            usernameChangedAt: active.usernameChangedAt,
          }
        : {
            email: existing?.email ?? "",
            password: existing?.password ?? "",
            kind: existing?.kind ?? "consumer",
            birthDate: existing?.birthDate ?? "1990-01-01",
            gender: existing?.gender ?? "prefer_not_to_say",
            locale: existing?.locale ?? "en",
            timezone: existing?.timezone,
            theme: existing?.theme ?? "dark",
            explicitContentEnabled: existing?.explicitContentEnabled ?? true,
            notificationPreference: existing?.notificationPreference ?? "all",
            subscription: existing?.subscription ?? payload.user.subscription,
            likedTrackIds: existing?.likedTrackIds ?? [],
            savedPlaylistIds: existing?.savedPlaylistIds ?? [],
            recentlyPlayedIds: existing?.recentlyPlayedIds ?? [],
            recentlyPlayedPlaylistIds: existing?.recentlyPlayedPlaylistIds ?? [],
            streamDates: existing?.streamDates ?? {},
            listeningStats: existing?.listeningStats,
            unreadNotificationCount: existing?.unreadNotificationCount ?? 0,
            usernameChangedAt: existing?.usernameChangedAt ?? null,
          };
    const publicUser = publicToUser(payload.profile, {
      ...existing,
      ...privateFields,
      id: payload.profile.id,
      username: payload.profile.username,
      displayName:
        payload.user.displayName ??
        existing?.displayName ??
        payload.profile.displayName,
      avatarUrl: payload.profile.avatarUrl,
      followerIds: payload.user.followerIds ?? existing?.followerIds ?? [],
      followingIds: payload.user.followingIds ?? existing?.followingIds ?? [],
      artistProfile:
        payload.user.artistProfile !== undefined
          ? (payload.user.artistProfile ?? null)
          : (existing?.artistProfile ?? null),
    } as User);
    if (isSelf) setActiveUser(publicUser);
    else upsertUser(publicUser);

    for (const person of [
      ...(payload.followers ?? []),
      ...(payload.following ?? []),
    ]) {
      if (active && person.id === active.id) continue;
      upsertUser(
        publicToUser(
          person,
          cache.users.find((item) => item.id === person.id),
        ),
      );
    }

    // Keep profile playlists scoped — never treat global /playlists/ as profile data.
    profilePlaylists.set(
      payload.profile.username,
      payload.playlists.filter((playlist) => playlist.visibility === "public"),
    );
    const artistReleases = payload.releases ?? [];
    profileReleases.set(payload.profile.username, artistReleases);
    profileArtistStats.set(
      payload.profile.username,
      payload.artistStats ?? null,
    );
    if (artistReleases.length) {
      cache.releases = [
        ...artistReleases,
        ...cache.releases.filter(
          (release) => !artistReleases.some((item) => item.id === release.id),
        ),
      ];
    }
  };

  const loadProfileData = async (username: string) => {
    if (!tokens && !(await refresh())) return;
    const active = me();
    const isOwn = Boolean(active && active.username === username);
    const key = isOwn ? `profile-own:${username}` : `profile:${username}`;
    await withOnce(key, async () => {
      const payload = await request<{
        user: Partial<User>;
        profile: PublicProfile;
        playlists: Playlist[];
        releases?: Release[];
        artistStats?: {
          uniqueListeners: number;
          streams: number;
          releases: number;
        } | null;
        followers?: PublicProfile[];
        following?: PublicProfile[];
      }>(`/profiles/${username}/`);
      applyProfilePayload(payload);
      notify();
      const publicPlaylists = payload.playlists.filter(
        (playlist) => playlist.visibility === "public",
      );
      await loadPlaylistCoverTracks(publicPlaylists);
    });
  };
  const withOnce = (key: string, task: () => Promise<unknown>) => {
    if (!inFlight.has(key))
      inFlight.set(
        key,
        task().finally(() => inFlight.delete(key)),
      );
    return inFlight.get(key);
  };

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<T> => {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData) && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    // Never attach a (possibly expired) access token to refresh — DRF JWT auth
    // rejects it with 401 before AllowAny RefreshView can run.
    const skipBearer = path === "/auth/token/refresh/";
    if (tokens?.access && !skipBearer)
      headers.set("Authorization", `Bearer ${tokens.access}`);
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        credentials: "include",
      });
    } catch {
      throw new RepositoryError(
        "network_error",
        "The Sonora server is not reachable.",
      );
    }
    if (response.status === 401 && retry) {
      const refreshed = await refresh();
      if (refreshed) return request<T>(path, init, false);
    }
    const text = await response.text();
    let payload:
      | { error?: { code?: string; message?: string; details?: unknown } }
      | T = {};
    if (text) {
      try {
        payload = JSON.parse(text) as typeof payload;
      } catch {
        throw new RepositoryError(
          response.ok ? "api_error" : "api_unavailable",
          response.ok
            ? "The server returned an unreadable response."
            : "The Sonora API returned an unreadable response.",
        );
      }
    }
    if (!response.ok) {
      const error = "error" in payload ? payload.error : undefined;
      throw new RepositoryError(
        error?.code ?? "api_error",
        error?.message ?? "Request failed.",
        error?.details ?? null,
      );
    }
    return payload as T;
  };

  const refresh = async (): Promise<boolean> => {
    const result = await withOnce("token-refresh", async () => {
      try {
        const storedRefresh = loadRefreshToken();
        const payload = await request<{
          access: string;
          refresh?: string;
          user: User;
        }>(
          "/auth/token/refresh/",
          {
            method: "POST",
            body: storedRefresh
              ? JSON.stringify({ refresh: storedRefresh })
              : JSON.stringify({}),
          },
          false,
        );
        tokens = { access: payload.access };
        saveTokens();
        if (payload.refresh) storeRefreshToken(payload.refresh);
        setActiveUser(payload.user);
        notify();
        return true;
      } catch {
        clearSession();
        notify();
        return false;
      }
    });
    return Boolean(result);
  };

  const pullRemoteQueue = async () => {
    try {
      const remoteQueue = await request<QueueState>("/me/queue/");
      writeQueueCache({
        trackIds: remoteQueue.trackIds ?? [],
        currentIndex: remoteQueue.currentIndex ?? -1,
        repeatMode: remoteQueue.repeatMode ?? "off",
        shuffleEnabled: Boolean(remoteQueue.shuffleEnabled),
        volume:
          typeof remoteQueue.volume === "number" ? remoteQueue.volume : 0.75,
      });
    } catch {
      // Keep whatever queue is already cached locally.
    }
  };

  const syncMe = async () => {
    const result = await withOnce("me", async () => {
      const user = applySession(await request<User>("/me/"));
      notify();
      return user;
    });
    return result as User;
  };

  const syncCatalog = async (parts?: {
    tracks?: boolean;
    releases?: boolean;
    playlists?: boolean;
  }) => {
    const wantTracks = parts?.tracks !== false;
    const wantReleases = parts?.releases !== false;
    const wantPlaylists = parts?.playlists !== false;
    const settled = await Promise.allSettled([
      wantTracks
        ? request<{ results: TrackView[] }>("/tracks/")
        : Promise.resolve({ results: [] as TrackView[] }),
      wantReleases
        ? request<{ results: Release[] }>("/releases/")
        : Promise.resolve({ results: [] as Release[] }),
      wantPlaylists
        ? request<{ results: Playlist[] }>("/playlists/")
        : Promise.resolve({ results: [] as Playlist[] }),
    ]);
    const value = <T>(index: number, fallback: T): T => {
      const result = settled[index];
      return result.status === "fulfilled" ? (result.value as T) : fallback;
    };
    if (wantTracks) {
      const tracks = value(0, { results: [] as TrackView[] });
      cache.tracks = pageResults(tracks).map((track) => ({
        ...track,
        audioUrl: track.audioUrl ?? "",
        hasAudio: Boolean(track.hasAudio ?? track.audioUrl),
      })) as Database["tracks"];
    }
    if (wantReleases) {
      const releases = value(1, { results: [] as Release[] });
      cache.releases = pageResults(releases);
    }
    if (wantPlaylists) {
      const playlists = value(2, { results: [] as Playlist[] });
      const remotePlaylists = pageResults(playlists);
      cache.playlists = [
        ...remotePlaylists,
        ...cache.playlists.filter(
          (playlist) =>
            !remotePlaylists.some((item) => item.id === playlist.id),
        ),
      ];
    }
    notify();
  };

  const loadCatalogData = async () => {
    if (!tokens && !(await refresh())) return;
    await withOnce("catalog", async () => {
      await syncCatalog();
    });
  };

  const mergeTracks = (incoming: TrackView[]) => {
    const byId = new Map(
      cache.tracks.map((track) => [track.id, track] as const),
    );
    for (const track of incoming) {
      byId.set(track.id, {
        ...track,
        audioUrl: track.audioUrl ?? "",
        hasAudio: Boolean(track.hasAudio ?? track.audioUrl),
      } as Database["tracks"][number]);
    }
    cache.tracks = [...byId.values()] as Database["tracks"];
  };

  /** Coalesce concurrent callers (queue + playlist covers) into one HTTP request. */
  const pendingTrackIds = new Set<string>();
  let trackBatchTimer: ReturnType<typeof setTimeout> | null = null;
  let trackBatchDelay = 0;
  let trackBatchWaiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];

  const flushTrackBatch = async () => {
    trackBatchTimer = null;
    trackBatchDelay = 0;
    const waiters = trackBatchWaiters;
    trackBatchWaiters = [];
    const batch = [...pendingTrackIds];
    pendingTrackIds.clear();
    try {
      const missing = batch.filter(
        (id) => !cache.tracks.some((track) => track.id === id),
      );
      if (missing.length) {
        if (!tokens && !(await refresh())) {
          waiters.forEach(({ resolve }) => resolve());
          return;
        }
        const stillMissing = missing.filter(
          (id) => !cache.tracks.some((track) => track.id === id),
        );
        if (stillMissing.length) {
          const payload = await request<{ results: TrackView[] }>(
            `/tracks/?ids=${stillMissing.map(encodeURIComponent).join(",")}`,
          );
          mergeTracks(pageResults(payload) as TrackView[]);
          notify();
        }
      }
      waiters.forEach(({ resolve }) => resolve());
    } catch (error) {
      waiters.forEach(({ reject }) => reject(error));
    }
    if (pendingTrackIds.size) scheduleTrackBatch(0);
  };

  const scheduleTrackBatch = (deferMs: number) => {
    // Prefer an earlier flush so playlist/profile can pull in a deferred queue load.
    if (trackBatchTimer != null) {
      if (deferMs >= trackBatchDelay) return;
      clearTimeout(trackBatchTimer);
    }
    trackBatchDelay = deferMs;
    trackBatchTimer = setTimeout(() => {
      void flushTrackBatch();
    }, deferMs);
  };

  const queueTrackIds = () => readQueueCache().trackIds;

  const loadTracksByIds = async (
    ids: string[],
    options?: { deferMs?: number },
  ) => {
    const unique = [...new Set(ids.filter(Boolean))];
    const missing = unique.filter(
      (id) => !cache.tracks.some((track) => track.id === id),
    );
    if (!missing.length) return;
    for (const id of missing) pendingTrackIds.add(id);
    return new Promise<void>((resolve, reject) => {
      trackBatchWaiters.push({ resolve, reject });
      scheduleTrackBatch(options?.deferMs ?? 0);
    });
  };

  /** Cover collage tracks + current queue — one batched /tracks/?ids= call. */
  const loadPlaylistCoverTracks = async (playlists: Playlist[]) => {
    const coverIds = playlists.flatMap((playlist) =>
      playlist.trackIds.slice(0, 4),
    );
    await loadTracksByIds([...coverIds, ...queueTrackIds()]);
  };

  const loadLibraryData = async () => {
    if (!tokens && !(await refresh())) return;
    await withOnce("library", async () => {
      const library = await request<{
        owned: Playlist[];
        saved: Playlist[];
        recent: TrackView[];
      }>("/me/library/");
      const mergedPlaylists = [...library.owned, ...library.saved];
      const mergedIds = new Set(mergedPlaylists.map((playlist) => playlist.id));
      const user = me();
      // Drop owned playlists the server no longer returns (deleted / wiped).
      cache.playlists = [
        ...mergedPlaylists,
        ...cache.playlists.filter((playlist) => {
          if (mergedIds.has(playlist.id)) return false;
          if (user && playlist.ownerId === user.id) return false;
          return true;
        }),
      ];
      const recent = library.recent.map((track) => ({
        ...track,
        audioUrl: track.audioUrl ?? "",
      }));
      for (const track of recent) {
        const index = cache.tracks.findIndex((item) => item.id === track.id);
        if (index >= 0)
          cache.tracks[index] = track as Database["tracks"][number];
        else cache.tracks.push(track as Database["tracks"][number]);
      }
      if (user) {
        user.recentlyPlayedIds = recent.map((track) => track.id);
        user.savedPlaylistIds = library.saved.map((playlist) => playlist.id);
        user.recentlyPlayedPlaylistIds = user.recentlyPlayedPlaylistIds ?? [];
        setActiveUser(user);
      }
      notify();
      await loadPlaylistCoverTracks(mergedPlaylists);
    });
  };

  const loadNotificationsData = async () => {
    if (!tokens && !(await refresh())) return;
    await withOnce("notifications", async () => {
      const notices = await request<{
        results: Notification[];
        unreadCount?: number;
      }>("/notifications/");
      cache.notifications = pageResults(notices);
      if (typeof notices.unreadCount === "number") {
        const current = me();
        if (current)
          setActiveUser({
            ...current,
            unreadNotificationCount: notices.unreadCount,
          });
      }
      notify();
    });
  };

  const refreshUnreadCount = async () => {
    if (!tokens && !(await refresh())) return;
    await withOnce("unread-count", async () => {
      const payload = await request<{ unreadCount: number }>(
        "/notifications/unread-count/",
      );
      setUnreadCount(payload.unreadCount);
    });
  };

  const loadSettingsData = async () => {
    if (!tokens && !(await refresh())) return;
    await withOnce("settings", async () => {
      const preferences = await request<User>("/me/preferences/");
      applySession(preferences);
      const plans = await request<{ results: SubscriptionPlan[] }>(
        "/subscription/plans/",
      );
      cache.plans = pageResults(plans);
      notify();
    });
  };

  const loadTicketsData = async () => {
    if (!tokens && !(await refresh())) return;
    await withOnce("tickets", async () => {
      const tickets = await request<{ results: Ticket[] }>("/tickets/");
      cache.tickets = pageResults(tickets);
      notify();
    });
  };

  const loadSearchData = async () => {
    if (!tokens && !(await refresh())) return;
    await withOnce("people-directory", async () => {
      const directory = await request<{
        people: PublicProfile[];
        artists: PublicProfile[];
      }>("/people/");
      const user = me();
      const syncedUsers = [...directory.people, ...directory.artists]
        .map((profile) =>
          publicToUser(
            profile,
            cache.users.find((item) => item.id === profile.id),
          ),
        )
        .filter((item) => item.id !== user?.id);
      const syncedIds = new Set(syncedUsers.map((item) => item.id));
      cache.users = [
        ...(user ? [user] : []),
        ...syncedUsers,
        ...cache.users.filter(
          (item) => !syncedIds.has(item.id) && item.id !== user?.id,
        ),
      ];
      notify();
    });
  };

  const loadPlaylistData = async (playlistId: string) => {
    if (!playlistId) return;
    if (!tokens && !(await refresh())) return;
    await withOnce(`playlist:${playlistId}`, async () => {
      try {
        const playlist = await request<Playlist>(`/playlists/${playlistId}/`);
        cache.playlists = [
          playlist,
          ...cache.playlists.filter((item) => item.id !== playlist.id),
        ];
        notify();
        await loadTracksByIds([...playlist.trackIds, ...queueTrackIds()]);
      } catch (error) {
        cache.playlists = cache.playlists.filter(
          (item) => item.id !== playlistId,
        );
        notify();
        throw error;
      }
    });
  };

  const loadReleaseData = async (releaseId: string) => {
    if (!releaseId) return;
    if (!tokens && !(await refresh())) return;
    await withOnce(`release:${releaseId}`, async () => {
      const fetched = await request<Release>(`/releases/${releaseId}/`);
      if (fetched.status === "archived") {
        cache.releases = cache.releases.filter((item) => item.id !== releaseId);
        notify();
        return;
      }
      cache.releases = [
        fetched,
        ...cache.releases.filter((item) => item.id !== fetched.id),
      ];
      notify();
      await loadTracksByIds([...fetched.trackIds, ...queueTrackIds()]);
    });
  };

  const loadStudioData = async (options?: { force?: boolean }) => {
    if (!tokens && !(await refresh())) return;
    if (options?.force) {
      studioLoaded = false;
      inFlight.delete("studio");
    }
    // Skip repeat fetches after Strict Mode remounts once studio is warm.
    if (studioLoaded) {
      notify();
      return;
    }
    await withOnce("studio", async () => {
      const user = me();
      if (user?.artistProfile) {
        await syncMe();
        await syncArtist();
      }
      studioLoaded = true;
      notify();
    });
  };

  const loadSupportData = async () => {
    if (!tokens && !(await refresh())) return;
    const user = me();
    if (!user) return;
    if (user.kind === "support" || user.kind === "admin") await syncStaff(user);
    await loadTicketsData();
  };

  const loadAdminData = async () => {
    if (!tokens && !(await refresh())) return;
    const user = me();
    if (user?.kind === "admin") {
      await syncStaff(user);
      await loadSettingsData();
    }
    notify();
  };

  const syncAll = async (options?: { pullQueue?: boolean }) => {
    if (!tokens && !(await refresh())) return;
    // Slim /me/ restores identity once per session bootstrap.
    // Unread badges are refreshed by AppShell, not /me/.
    await syncMe();
    if (options?.pullQueue) {
      await pullRemoteQueue();
      await import("../store/player").then((mod) => {
        mod.hydratePlayerQueue();
        return mod;
      });
      // Tracks load via Player (deferred) and/or playlist/profile cover batch.
    }
  };

  const syncArtist = async () => {
    const [requests, releases, payouts] = await Promise.all([
      request<{ results: VerificationRequest[] }>(
        "/artist/verification-requests/",
      ),
      request<{ results: (Release & { tracks?: TrackView[] })[] }>(
        "/artist/releases/",
      ),
      request<{ results: Payout[] }>("/artist/payouts/"),
    ]);
    cache.verificationRequests = pageResults(requests);
    const own = pageResults(releases).filter(
      (release) => release.status !== "archived",
    );
    const ownerId = me()?.id;
    cache.releases = [
      ...own.map(({ tracks: _tracks, ...release }) => release as Release),
      ...cache.releases.filter((release) => {
        if (own.some((item) => item.id === release.id)) return false;
        // Drop owned releases that disappeared from studio (archived/deleted).
        if (ownerId && release.ownerUserId === ownerId) return false;
        return true;
      }),
    ];
    for (const release of own) {
      for (const track of release.tracks ?? []) {
        const normalized = {
          ...track,
          audioUrl: track.audioUrl ?? "",
          hasAudio: Boolean(track.hasAudio ?? track.audioUrl),
        } as Database["tracks"][number];
        const index = cache.tracks.findIndex((item) => item.id === track.id);
        if (index >= 0) cache.tracks[index] = normalized;
        else cache.tracks.push(normalized);
      }
    }
    await loadTracksByIds(own.flatMap((release) => release.trackIds ?? []));
    cache.payouts = pageResults(payouts);
  };

  const syncStaff = async (user: User) => {
    const requests = await request<{ results: VerificationRequest[] }>(
      "/support/verification-requests/",
    );
    cache.verificationRequests = pageResults(requests);
    if (user.kind === "admin") {
      const [reports, payouts] = await Promise.all([
        request<AdminReports>("/admin/reports/overview/"),
        request<{ results: Payout[] }>("/admin/payouts/"),
      ]);
      cache.adminReports = reports;
      cache.payouts = pageResults(payouts);
    } else {
      cache.adminReports = null;
      cache.payouts = [];
    }
    pageResults(requests).forEach((request) => {
      if (!cache.users.some((user) => user.id === request.userId)) {
        const artistName =
          (request as VerificationRequest & { artistName?: string })
            .artistName ?? "Artist";
        cache.users.push(
          publicToUser({
            id: request.userId,
            username:
              artistName.toLowerCase().replace(/[^a-z0-9]+/g, "") || "artist",
            displayName: artistName,
            avatarUrl: null,
            kind: "artist",
            followerCount: 0,
            followingCount: 0,
            isFollowing: false,
            publicPlaylistCount: 0,
          }),
        );
      }
    });
  };

  void withOnce("bootstrap", async () => {
    try {
      await syncAll({ pullQueue: true });
    } catch {
      // Keep a cached session if /me/ already restored it; only drop auth when
      // we have no usable access token and refresh also failed.
      if (!me()) clearSession();
    } finally {
      authReady = true;
      notify();
    }
  });

  const api = {
    usesApi: true,
    authReady: () => authReady,
    loadSettingsData,
    loadLibraryData,
    loadProfileData,
    loadCatalogData,
    loadPlaylistData,
    loadReleaseData,
    loadTracksByIds,
    refreshSession: () => syncMe(),
    loadNotificationsData,
    refreshUnreadCount,
    loadTicketsData,
    loadSearchData,
    loadStudioData,
    loadSupportData,
    loadAdminData,
    async artistAnalytics() {
      return withOnce("artist-analytics", () =>
        request<ArtistAnalytics>("/artist/analytics/"),
      );
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    revision: () => revision,
    database: () => clone(cache),
    reset: () => {
      clearSession();
      cache = emptyDatabase();
      studioLoaded = false;
      inFlight.delete("studio");
      authReady = true;
      notify();
    },
    sessionUser: () => clone(me()),
    async login(email: string, password: string) {
      const payload = await request<{
        access: string;
        refresh?: string;
        user: User;
      }>(
        "/auth/login/",
        { method: "POST", body: JSON.stringify({ email, password }) },
        false,
      );
      tokens = { access: payload.access };
      saveTokens();
      if (payload.refresh) storeRefreshToken(payload.refresh);
      setActiveUser(payload.user);
      await syncAll({ pullQueue: true });
      authReady = true;
      notify();
      return clone(payload.user);
    },
    async requestPasswordReset(email: string) {
      await request(
        "/auth/password-reset/request/",
        { method: "POST", body: JSON.stringify({ email }) },
        false,
      );
    },
    async logout() {
      const accessToken = tokens?.access;
      const refreshToken = loadRefreshToken();
      clearSession();
      grants.clear();
      writeQueueCache(emptyQueue());
      authReady = true;
      notify();
      void import("../store/player").then((mod) => mod.hydratePlayerQueue());
      await fetch(`${API_BASE}/auth/logout/`, {
        method: "POST",
        headers: accessToken
          ? {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            }
          : { "Content-Type": "application/json" },
        body: JSON.stringify(refreshToken ? { refresh: refreshToken } : {}),
        credentials: "include",
      }).catch(() => undefined);
    },
    async register(input: RegistrationInput, artist: boolean) {
      const payload = await request<{
        access: string;
        refresh?: string;
        user: User;
      }>(
        artist ? "/auth/register/artist/" : "/auth/register/",
        { method: "POST", body: JSON.stringify(input) },
        false,
      );
      tokens = { access: payload.access };
      saveTokens();
      if (payload.refresh) storeRefreshToken(payload.refresh);
      setActiveUser(payload.user);
      await syncAll({ pullQueue: true });
      authReady = true;
      notify();
      return clone(payload.user);
    },
    users: () => clone(cache.users.filter((user) => !user.deletedAt)),
    profile(username: string) {
      const user = cache.users.find(
        (candidate) => candidate.username === username && !candidate.deletedAt,
      );
      if (!user) return null;
      const viewer = me();
      const isFollowing = viewer?.followingIds.includes(user.id) ?? false;
      return {
        user: clone(user),
        profile: {
          id: user.id,
          username: user.username,
          displayName: user.artistProfile?.stageName ?? user.displayName,
          avatarUrl: user.avatarUrl,
          kind: user.artistProfile ? "artist" : "consumer",
          followerCount: user.followerIds.length,
          followingCount: user.followingIds.length,
          isFollowing,
          publicPlaylistCount: (profilePlaylists.get(user.username) ?? [])
            .length,
        },
        playlists: clone(profilePlaylists.get(user.username) ?? []),
        releases: clone(profileReleases.get(user.username) ?? []),
        artistStats: profileArtistStats.has(user.username)
          ? clone(profileArtistStats.get(user.username) ?? null)
          : null,
      };
    },
    follow(userId: string) {
      const target = cache.users.find((user) => user.id === userId);
      const viewer = me();
      if (!target || !viewer) return;
      const following = viewer.followingIds.includes(userId);
      const nextViewer = normalizeUser({
        ...viewer,
        followingIds: following
          ? viewer.followingIds.filter((id) => id !== userId)
          : [...viewer.followingIds, userId],
      });
      const nextTarget = normalizeUser({
        ...target,
        followerIds: following
          ? target.followerIds.filter((id) => id !== viewer.id)
          : [...target.followerIds, viewer.id],
      });
      setActiveUser(nextViewer);
      upsertUser(nextTarget);
      notify();
      void request(`/profiles/${target.username}/follow/`, {
        method: following ? "DELETE" : "POST",
      })
        .then(async () => {
          await loadProfileData(target.username);
        })
        .catch(() => {
          setActiveUser(viewer);
          upsertUser(target);
          notify();
        });
    },
    tracks: () => clone(cache.tracks) as TrackView[],
    like(trackId: string) {
      const track = cache.tracks.find((item) => item.id === trackId);
      const liked = Boolean((track as TrackView | undefined)?.isLiked);
      const user = me();
      const previousUser = user;
      const previousLiked = liked;
      if (user) {
        setActiveUser({
          ...user,
          likedTrackIds: liked
            ? user.likedTrackIds.filter((id) => id !== trackId)
            : [...user.likedTrackIds, trackId],
        });
      }
      if (track) (track as TrackView).isLiked = !liked;
      notify();
      void request(`/tracks/${trackId}/like/`, {
        method: liked ? "DELETE" : "POST",
      }).catch(() => {
        if (previousUser) setActiveUser(previousUser);
        if (track) (track as TrackView).isLiked = previousLiked;
        notify();
      });
    },
    recordRecentlyPlayed(trackId: string) {
      void trackId;
    },
    recordRecentlyPlayedPlaylist(playlistId: string) {
      void playlistId;
    },
    recordValidStream: () => false,
    playlists: () => clone(cache.playlists),
    visiblePlaylists: () => clone(cache.playlists),
    library: () => {
      const user = me();
      const owned = cache.playlists.filter(
        (playlist) => playlist.ownerId === user?.id,
      );
      const saved = cache.playlists.filter((playlist) =>
        user?.savedPlaylistIds.includes(playlist.id),
      );
      const liked = cache.tracks.filter(
        (track) =>
          user?.likedTrackIds.includes(track.id) ||
          (track as TrackView).isLiked,
      ) as TrackView[];
      return { owned: clone(owned), saved: clone(saved), liked: clone(liked) };
    },
    playlist(playlistId: string) {
      return clone(
        cache.playlists.find((playlist) => playlist.id === playlistId) ?? null,
      );
    },
    release(releaseId: string) {
      return clone(
        cache.releases.find(
          (item) => item.id === releaseId && item.status !== "archived",
        ) ?? null,
      );
    },
    async createPlaylist(
      title: string,
      visibility: "private" | "public" = "private",
    ) {
      const playlist = await request<Playlist>("/playlists/", {
        method: "POST",
        body: JSON.stringify({ title, visibility }),
      });
      cache.playlists = [playlist, ...cache.playlists];
      notify();
      return clone(playlist);
    },
    updatePlaylist(
      playlistId: string,
      patch: Partial<
        Pick<Playlist, "title" | "description" | "visibility" | "trackIds">
      >,
    ) {
      const playlist = cache.playlists.find((item) => item.id === playlistId);
      void request<Playlist>(`/playlists/${playlistId}/`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }).then((updated) => {
        cache.playlists = [
          updated,
          ...cache.playlists.filter((item) => item.id !== playlistId),
        ];
        notify();
      });
      return clone(playlist!);
    },
    deletePlaylist(playlistId: string) {
      cache.playlists = cache.playlists.filter(
        (item) => item.id !== playlistId,
      );
      notify();
      void request(`/playlists/${playlistId}/`, { method: "DELETE" })
        .catch(() => {
          // Already removed locally; 404 means it was already gone server-side.
        })
        .then(async () => {
          await loadLibraryData();
        });
    },
    syncTrackPlaylists(trackIds: string[], playlistIds: string[]) {
      if (!trackIds.length) return;
      const user = me();
      if (!user) return;
      const selected = new Set(playlistIds);
      const owned = cache.playlists.filter(
        (playlist) => playlist.ownerId === user.id,
      );
      void Promise.all(
        owned.map(async (playlist) => {
          const shouldContain = selected.has(playlist.id);
          let next = [...playlist.trackIds];
          if (shouldContain) {
            trackIds.forEach((trackId) => {
              if (!next.includes(trackId)) next.push(trackId);
            });
          } else {
            next = next.filter((id) => !trackIds.includes(id));
          }
          const same =
            next.length === playlist.trackIds.length &&
            next.every((id, index) => id === playlist.trackIds[index]);
          if (same) return;
          const updated = await request<Playlist>(
            `/playlists/${playlist.id}/`,
            {
              method: "PATCH",
              body: JSON.stringify({ trackIds: next }),
            },
          );
          cache.playlists = [
            updated,
            ...cache.playlists.filter((item) => item.id !== playlist.id),
          ];
        }),
      ).then(notify);
    },
    savePlaylist(playlistId: string) {
      const user = me();
      if (!user) return;
      const saved = user.savedPlaylistIds.includes(playlistId);
      void request(`/playlists/${playlistId}/save/`, {
        method: saved ? "DELETE" : "POST",
      }).then(async () => {
        await loadLibraryData();
      });
    },
    notifications: () => clone(cache.notifications),
    readNotification(notificationId: string) {
      void request<{ unreadCount?: number }>(
        `/notifications/${notificationId}/read/`,
        { method: "POST" },
      ).then(async (payload) => {
        await loadNotificationsData();
        if (typeof payload.unreadCount === "number")
          setUnreadCount(payload.unreadCount);
        else await refreshUnreadCount();
      });
    },
    readAllNotifications() {
      void request<{ unreadCount?: number }>("/notifications/mark-all-read/", {
        method: "POST",
      }).then(async (payload) => {
        await loadNotificationsData();
        if (typeof payload.unreadCount === "number")
          setUnreadCount(payload.unreadCount);
        else await refreshUnreadCount();
      });
    },
    deleteNotification(notificationId: string) {
      void request(`/notifications/${notificationId}/`, {
        method: "DELETE",
      }).then(async () => {
        await loadNotificationsData();
        await refreshUnreadCount();
      });
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
    ) {
      const current = me();
      if (current) {
        setActiveUser({ ...current, ...patch });
        notify();
      }
      void request<User>("/me/", {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
        .then((updated) => {
          applySession({ ...updated, ...patch });
          notify();
        })
        .catch(() => {
          if (current) {
            setActiveUser(current);
            notify();
          }
        });
    },
    updateAvatar(avatar: string | File) {
      if (!(avatar instanceof File))
        throw new RepositoryError(
          "api_file_required",
          "Choose an image file to upload.",
        );
      const form = new FormData();
      form.set("avatar", avatar);
      return request<User>("/me/", { method: "PATCH", body: form }).then(
        (updated) => {
          applySession(updated);
          notify();
        },
      );
    },
    updateUsername(username: string) {
      void request<User>("/me/", {
        method: "PATCH",
        body: JSON.stringify({ username }),
      }).then((updated) => {
        applySession(updated);
        notify();
      });
    },
    deleteAccount() {
      return request("/me/delete/", { method: "POST" }).then(() => {
        tokens = null;
        activeUserId = null;
        saveTokens();
        localStorage.removeItem("sonora:api:active-user");
        notify();
      });
    },
    purchase(planId: string) {
      return request<Payment>("/subscription/purchases/", {
        method: "POST",
        body: JSON.stringify({ planId }),
      }).then(async (payment) => {
        if (payment.paymentUrl) {
          window.location.assign(payment.paymentUrl);
          return payment;
        }
        await syncMe();
        await loadSettingsData();
        return payment;
      });
    },
    verificationRequests: () => clone(cache.verificationRequests),
    submitVerification(portfolioUrls: string[], note: string) {
      void request<VerificationRequest>("/artist/verification-requests/", {
        method: "POST",
        body: JSON.stringify({ portfolioUrls, note }),
      }).then(() => loadStudioData({ force: true }));
    },
    decideVerification(requestId: string, approved: boolean, reason: string) {
      void request<VerificationRequest>(
        `/support/verification-requests/${requestId}/${approved ? "approve" : "reject"}/`,
        { method: "POST", body: JSON.stringify({ reason }) },
      ).then(loadSupportData);
    },
    tickets: () => clone(cache.tickets),
    createTicket(subject: string, body: string) {
      void request<{ results: Ticket[] }>("/tickets/", {
        method: "POST",
        body: JSON.stringify({ subject, body }),
      }).then((payload) => {
        cache.tickets = pageResults(payload);
        notify();
      });
    },
    replyTicket(ticketId: string, body: string) {
      void request<{ results: Ticket[] }>(`/tickets/${ticketId}/messages/`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }).then((payload) => {
        cache.tickets = pageResults(payload);
        notify();
      });
    },
    closeTicket(ticketId: string) {
      void request<{ results: Ticket[] }>(`/tickets/${ticketId}/close/`, {
        method: "POST",
      }).then((payload) => {
        cache.tickets = pageResults(payload);
        notify();
      });
    },
    updatePlan(planId: string, patch: Partial<SubscriptionPlan>) {
      void request<SubscriptionPlan>("/admin/subscription-plans/", {
        method: "PATCH",
        body: JSON.stringify({ id: planId, ...patch }),
      }).then(loadAdminData);
    },
    settlePayout(payoutId: string) {
      void request(`/admin/payouts/${payoutId}/settle/`, {
        method: "POST",
      }).then(loadAdminData);
    },
    saveDraft(_draft: Omit<DraftRelease, "id" | "userId" | "createdAt">) {
      void _draft;
      throw new RepositoryError(
        "backend_upload_required",
        "Release drafts use the backend media workflow in integrated mode.",
      );
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
    ) {
      if (
        patch.status &&
        Object.keys(patch).every((key) => key === "status")
      ) {
        if (patch.status === "archived") {
          return request(`/artist/releases/${releaseId}/`, {
            method: "DELETE",
          }).then(() => {
            cache.releases = cache.releases.filter(
              (release) => release.id !== releaseId,
            );
            notify();
            return loadStudioData({ force: true });
          });
        }
        return request<Release>(`/artist/releases/${releaseId}/`, {
          method: "PATCH",
          body: JSON.stringify({ status: patch.status }),
        }).then(() => loadStudioData({ force: true }));
      }
      void patch;
      return loadStudioData({ force: true });
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
      status?: string,
    ) {
      void form.collaborators;
      const body = new FormData();
      body.set("title", form.title);
      body.set("type", form.type);
      body.set("genre", form.genre);
      const releaseAt = form.releaseDate
        ? new Date(form.releaseDate).toISOString()
        : new Date(`${form.year}-01-01T00:00:00.000Z`).toISOString();
      body.set("publicReleaseAt", releaseAt);
      if (form.earlyAccess)
        body.set("earlyAccessStartsAt", new Date().toISOString());
      else if (releaseId) body.set("earlyAccessStartsAt", "");
      if (status) body.set("status", status);
      if (cover) body.set("cover", cover);

      let release: Release;
      if (releaseId) {
        release = await request<Release>(`/artist/releases/${releaseId}/`, {
          method: "PATCH",
          body,
        });
      } else {
        release = await request<Release>("/artist/releases/", {
          method: "POST",
          body,
        });
      }

      for (const trackId of removedTrackIds) {
        await request(`/artist/tracks/${trackId}/`, { method: "DELETE" });
      }

      for (const draft of tracks) {
        if (draft.id) {
          const trackBody = new FormData();
          trackBody.set("title", draft.title);
          trackBody.set("lyrics", draft.lyrics);
          if (draft.audio) trackBody.set("audio", draft.audio);
          await request(`/artist/tracks/${draft.id}/`, {
            method: "PATCH",
            body: trackBody,
          });
          continue;
        }
        if (!draft.audio) continue;
        const trackBody = new FormData();
        trackBody.set("title", draft.title);
        trackBody.set("lyrics", draft.lyrics);
        trackBody.set("isExplicit", "false");
        trackBody.set("audio", draft.audio);
        await request(`/artist/releases/${release.id}/tracks/`, {
          method: "POST",
          body: trackBody,
        });
      }

      const publishBody = new FormData();
      publishBody.set(
        "status",
        form.earlyAccess || new Date(releaseAt) > new Date()
          ? "scheduled"
          : "published",
      );
      await request<Release>(`/artist/releases/${release.id}/`, {
        method: "PATCH",
        body: publishBody,
      });

      await syncCatalog();
      await loadStudioData({ force: true });
    },
    async publishReleaseDraft(
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
    ) {
      await api.saveRelease(null, form, tracks, cover);
    },
    queue: (): QueueState => readQueueCache(),
    saveQueue: (queue: QueueState) => {
      writeQueueCache(queue);
      if (queueSaveTimer) clearTimeout(queueSaveTimer);
      queueSaveTimer = setTimeout(() => {
        if (!tokens) return;
        void request<QueueState>("/me/queue/", {
          method: "PUT",
          body: JSON.stringify(queue),
        })
          .then((saved) => writeQueueCache(saved))
          .catch(() => undefined);
      }, 350);
    },
    async playbackSource(trackId: string, options?: { force?: boolean }) {
      if (options?.force) {
        grants.delete(trackId);
        const grant = await request<PlaybackGrant>(
          `/tracks/${trackId}/playback-sessions/`,
          { method: "POST" },
        );
        grants.set(trackId, grant);
        return grant;
      }
      const existing = grants.get(trackId);
      if (
        existing &&
        new Date(existing.expiresAt) > new Date(Date.now() + 30_000)
      )
        return existing;
      const grant = await withOnce(`playback-source:${trackId}`, async () => {
        const cached = grants.get(trackId);
        if (
          cached &&
          new Date(cached.expiresAt) > new Date(Date.now() + 30_000)
        )
          return cached;
        const created = await request<PlaybackGrant>(
          `/tracks/${trackId}/playback-sessions/`,
          { method: "POST" },
        );
        grants.set(trackId, created);
        return created;
      });
      return grant as PlaybackGrant;
    },
    recordPlaybackProgress(
      trackId: string,
      positionSeconds: number,
      options: { finalize?: boolean; playbackSessionId: string },
    ) {
      const sessionId = options.playbackSessionId;
      if (!sessionId) return Promise.resolve();
      return request<{
        validStreamRecorded?: boolean;
        streamCount?: number;
        listeningStats?: User["listeningStats"];
      }>(`/playback-sessions/${sessionId}/progress/`, {
        method: "POST",
        body: JSON.stringify({
          positionSeconds,
          finalize: Boolean(options?.finalize),
        }),
      })
        .then((result) => {
          let changed = false;
          const track = cache.tracks.find((item) => item.id === trackId);
          if (track && typeof result.streamCount === "number") {
            if (track.streamCount !== result.streamCount) {
              track.streamCount = result.streamCount;
              changed = true;
            }
          } else if (result.validStreamRecorded && track) {
            track.streamCount += 1;
            changed = true;
          }
          if (result.listeningStats) {
            const active = me();
            if (active) {
              cache.users = cache.users.map((user) =>
                user.id === active.id
                  ? { ...user, listeningStats: result.listeningStats }
                  : user,
              );
              changed = true;
            }
          }
          if (changed) notify();
        })
        .catch(() => undefined);
    },
    async downloadSource(trackId: string) {
      const ticket = await request<DownloadTicket>(
        `/tracks/${trackId}/download-tickets/`,
        { method: "POST" },
      );
      return ticket.downloadUrl;
    },
    async createRoom() {
      return request<ListeningRoom>("/rooms/", { method: "POST" });
    },
    async joinRoom(inviteCode: string) {
      return request<ListeningRoom>(
        `/rooms/${inviteCode.trim().toUpperCase()}/join/`,
        { method: "POST" },
      );
    },
    async getRoom(inviteCode: string) {
      return request<ListeningRoom>(
        `/rooms/${inviteCode.trim().toUpperCase()}/`,
      );
    },
    async addRoomTrack(roomId: string, trackId: string) {
      return request<ListeningRoom>(`/rooms/${roomId}/queue/`, {
        method: "POST",
        body: JSON.stringify({ trackId }),
      });
    },
    roomSocketUrl(inviteCode: string) {
      const token = tokens?.access ?? "";
      const base = API_BASE.startsWith("http")
        ? new URL(API_BASE)
        : new URL(API_BASE, window.location.origin);
      base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
      base.pathname = `/ws/rooms/${inviteCode.trim().toUpperCase()}/`;
      base.search = token ? `token=${encodeURIComponent(token)}` : "";
      return base.toString();
    },
  };

  return api as unknown as RepositoryShape;
}
