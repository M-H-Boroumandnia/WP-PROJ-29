import type { localRepository } from "./localRepository";
import type {
  AuditEvent,
  Database,
  DraftRelease,
  ListeningRoom,
  Notification,
  Payment,
  Playlist,
  PublicProfile,
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
    const access = sessionStorage.getItem(ACCESS_KEY);
    localStorage.removeItem(LEGACY_TOKENS_KEY);
    return access ? { access } : null;
  } catch {
    return null;
  }
}

function publicToUser(profile: PublicProfile, existing?: User): User {
  return {
    id: profile.id,
    email: existing?.email ?? "",
    password: "",
    kind: "consumer",
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
        : null,
    followerIds: existing?.followerIds ?? [],
    followingIds: existing?.followingIds ?? [],
    likedTrackIds: existing?.likedTrackIds ?? [],
    savedPlaylistIds: existing?.savedPlaylistIds ?? [],
    recentlyPlayedIds: existing?.recentlyPlayedIds ?? [],
    recentlyPlayedPlaylistIds: existing?.recentlyPlayedPlaylistIds ?? [],
    streamDates: existing?.streamDates ?? {},
    usernameChangedAt: existing?.usernameChangedAt ?? null,
    deletedAt: existing?.deletedAt ?? null,
  };
}

export function createDjangoApiRepository(
  _fallback: RepositoryShape,
): RepositoryShape {
  void _fallback;
  let revision = 0;
  let cache = loadJson<Database>(CACHE_KEY, emptyDatabase());
  let tokens = loadAccessToken();
  let activeUserId = localStorage.getItem("sonora:api:active-user");
  const grants = new Map<string, PlaybackGrant>();
  const inFlight = new Map<string, Promise<unknown>>();

  const saveCache = () =>
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  const saveTokens = () => {
    localStorage.removeItem(LEGACY_TOKENS_KEY);
    try {
      if (tokens?.access) sessionStorage.setItem(ACCESS_KEY, tokens.access);
      else sessionStorage.removeItem(ACCESS_KEY);
    } catch {
      // Session storage can be unavailable in hardened/private contexts; the HTTP-only refresh cookie still recovers sessions.
    }
  };
  const notify = () => {
    revision += 1;
    saveCache();
    listeners.forEach((listener) => listener());
  };
  const upsertUser = (user: User) => {
    cache.users = [user, ...cache.users.filter((item) => item.id !== user.id)];
  };
  const setActiveUser = (user: User) => {
    upsertUser(user);
    activeUserId = user.id;
    localStorage.setItem("sonora:api:active-user", user.id);
  };
  const me = () =>
    cache.users.find((user) => user.id === activeUserId && !user.deletedAt) ??
    null;
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
    if (tokens?.access) headers.set("Authorization", `Bearer ${tokens.access}`);
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
    try {
      const payload = await request<{ access: string; user: User }>(
        "/auth/token/refresh/",
        { method: "POST" },
        false,
      );
      tokens = { access: payload.access };
      saveTokens();
      setActiveUser(payload.user);
      notify();
      return true;
    } catch {
      tokens = null;
      activeUserId = null;
      saveTokens();
      localStorage.removeItem("sonora:api:active-user");
      notify();
      return false;
    }
  };

  const syncAll = async () => {
    if (!tokens && !(await refresh())) return;
    const user = await request<User>("/me/");
    setActiveUser(user);
    const [
      tracks,
      releases,
      playlists,
      plans,
      notices,
      library,
      search,
      tickets,
      payments,
    ] = await Promise.all([
      request<{ results: TrackView[] }>("/tracks/"),
      request<{ results: Release[] }>("/releases/"),
      request<{ results: Playlist[] }>("/playlists/"),
      request<{ results: SubscriptionPlan[] }>("/subscription/plans/"),
      request<{ results: Notification[] }>("/notifications/"),
      request<{
        owned: Playlist[];
        saved: Playlist[];
        liked: TrackView[];
        recent: TrackView[];
      }>("/me/library/"),
      request<{ people: PublicProfile[]; artists: PublicProfile[] }>(
        "/search/",
      ),
      request<{ results: Ticket[] }>("/tickets/"),
      request<{ results: Payment[] }>("/payments/"),
    ]);
    cache.tracks = pageResults(tracks).map((track) => ({
      ...track,
      audioUrl: track.audioUrl ?? "",
    })) as Database["tracks"];
    cache.releases = pageResults(releases);
    const mergedPlaylists = [
      ...library.owned,
      ...library.saved,
      ...pageResults(playlists),
    ];
    cache.playlists = mergedPlaylists.filter(
      (playlist, index, list) =>
        list.findIndex((item) => item.id === playlist.id) === index,
    );
    cache.plans = pageResults(plans);
    cache.notifications = pageResults(notices);
    cache.tickets = pageResults(tickets);
    cache.payments = pageResults(payments);
    cache.users = [
      user,
      ...[...search.people, ...search.artists]
        .map((profile) =>
          publicToUser(
            profile,
            cache.users.find((item) => item.id === profile.id),
          ),
        )
        .filter((item) => item.id !== user.id),
    ];
    user.recentlyPlayedIds = library.recent.map((track) => track.id);
    user.likedTrackIds = library.liked.map((track) => track.id);
    user.savedPlaylistIds = library.saved.map((playlist) => playlist.id);
    setActiveUser(user);
    if (user.artistProfile) await syncArtist();
    if (user.kind === "support" || user.kind === "admin") await syncStaff(user);
    notify();
  };

  const syncArtist = async () => {
    const [requests, releases, payouts] = await Promise.all([
      request<{ results: VerificationRequest[] }>(
        "/artist/verification-requests/",
      ),
      request<{ results: Release[] }>("/artist/releases/"),
      request<{
        results: {
          id: string;
          artistUserId: string;
          amountRial: number;
          status: "pending" | "settled";
          period: string;
        }[];
      }>("/artist/payouts/"),
    ]);
    cache.verificationRequests = pageResults(requests);
    const own = pageResults(releases);
    cache.releases = [
      ...own,
      ...cache.releases.filter(
        (release) => !own.some((item) => item.id === release.id),
      ),
    ];
    cache.payouts = pageResults(payouts);
  };

  const syncStaff = async (user: User) => {
    const requests = await request<{ results: VerificationRequest[] }>(
      "/support/verification-requests/",
    );
    cache.verificationRequests = pageResults(requests);
    if (user.kind === "admin") {
      const [audit, payouts] = await Promise.all([
        request<{ results: AuditEvent[] }>("/admin/audit-events/"),
        request<{
          results: {
            id: string;
            artistUserId: string;
            amountRial: number;
            status: "pending" | "settled";
            period: string;
          }[];
        }>("/admin/payouts/"),
      ]);
      cache.auditEvents = pageResults(audit);
      cache.payouts = pageResults(payouts);
    } else {
      cache.auditEvents = [];
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
      await syncAll();
    } catch {
      tokens = null;
      activeUserId = null;
      saveTokens();
      localStorage.removeItem("sonora:api:active-user");
      notify();
    }
  });

  const api = {
    usesApi: true,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    revision: () => revision,
    database: () => clone(cache),
    reset: () => {
      tokens = null;
      activeUserId = null;
      cache = emptyDatabase();
      saveTokens();
      localStorage.removeItem("sonora:api:active-user");
      notify();
    },
    sessionUser: () => clone(me()),
    async login(email: string, password: string) {
      const payload = await request<{ access: string; user: User }>(
        "/auth/login/",
        { method: "POST", body: JSON.stringify({ email, password }) },
        false,
      );
      tokens = { access: payload.access };
      saveTokens();
      setActiveUser(payload.user);
      await syncAll();
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
      tokens = null;
      activeUserId = null;
      grants.clear();
      saveTokens();
      localStorage.removeItem("sonora:api:active-user");
      notify();
      await fetch(`${API_BASE}/auth/logout/`, {
        method: "POST",
        headers: accessToken
          ? {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            }
          : { "Content-Type": "application/json" },
        credentials: "include",
      }).catch(() => undefined);
    },
    async register(input: RegistrationInput, artist: boolean) {
      const payload = await request<{ access: string; user: User }>(
        artist ? "/auth/register/artist/" : "/auth/register/",
        { method: "POST", body: JSON.stringify(input) },
        false,
      );
      tokens = { access: payload.access };
      saveTokens();
      setActiveUser(payload.user);
      await syncAll();
      return clone(payload.user);
    },
    users: () => clone(cache.users.filter((user) => !user.deletedAt)),
    profile(username: string) {
      void withOnce(`profile:${username}`, async () => {
        const payload = await request<{
          user: Partial<User>;
          profile: PublicProfile;
          playlists: Playlist[];
        }>(`/profiles/${username}/`);
        const existing = cache.users.find(
          (item) => item.id === payload.profile.id,
        );
        const publicUser = publicToUser(payload.profile, existing);
        if (payload.user.artistProfile !== undefined)
          publicUser.artistProfile = payload.user.artistProfile ?? null;
        upsertUser(publicUser);
        cache.playlists = [
          ...payload.playlists,
          ...cache.playlists.filter(
            (item) =>
              !payload.playlists.some((playlist) => playlist.id === item.id),
          ),
        ];
        notify();
      });
      const user = cache.users.find(
        (candidate) => candidate.username === username && !candidate.deletedAt,
      );
      if (!user) return null;
      const viewer = me();
      const profile = publicToUser(
        {
          id: user.id,
          username: user.username,
          displayName: user.artistProfile?.stageName ?? user.displayName,
          avatarUrl: user.avatarUrl,
          kind: user.artistProfile ? "artist" : "consumer",
          followerCount: user.followerIds.length,
          followingCount: user.followingIds.length,
          isFollowing: viewer?.followingIds.includes(user.id) ?? false,
          publicPlaylistCount: cache.playlists.filter(
            (playlist) =>
              playlist.ownerId === user.id && playlist.visibility === "public",
          ).length,
        },
        user,
      );
      return {
        user: clone(user),
        profile: {
          id: profile.id,
          username: profile.username,
          displayName: profile.artistProfile?.stageName ?? profile.displayName,
          avatarUrl: profile.avatarUrl,
          kind: profile.artistProfile ? "artist" : "consumer",
          followerCount: profile.followerIds.length,
          followingCount: profile.followingIds.length,
          isFollowing: viewer?.followingIds.includes(profile.id) ?? false,
          publicPlaylistCount: cache.playlists.filter(
            (playlist) =>
              playlist.ownerId === profile.id &&
              playlist.visibility === "public",
          ).length,
        },
        playlists: clone(
          cache.playlists.filter(
            (playlist) =>
              playlist.ownerId === user.id && playlist.visibility === "public",
          ),
        ),
      };
    },
    follow(userId: string) {
      const target = cache.users.find((user) => user.id === userId);
      if (!target) return;
      const following = me()?.followingIds.includes(userId);
      void request(`/profiles/${target.username}/follow/`, {
        method: following ? "DELETE" : "POST",
      }).then(syncAll);
    },
    tracks: () => clone(cache.tracks) as TrackView[],
    like(trackId: string) {
      const track = cache.tracks.find((item) => item.id === trackId);
      const liked = Boolean((track as TrackView | undefined)?.isLiked);
      void request(`/tracks/${trackId}/like/`, {
        method: liked ? "DELETE" : "POST",
      }).then(syncAll);
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
      void withOnce(`playlist:${playlistId}`, async () => {
        const playlist = await request<Playlist>(`/playlists/${playlistId}/`);
        cache.playlists = [
          playlist,
          ...cache.playlists.filter((item) => item.id !== playlist.id),
        ];
        notify();
      });
      return clone(
        cache.playlists.find((playlist) => playlist.id === playlistId) ?? null,
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
      void request(`/playlists/${playlistId}/`, { method: "DELETE" }).then(
        syncAll,
      );
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
      }).then(syncAll);
    },
    notifications: () => clone(cache.notifications),
    readNotification(notificationId: string) {
      void request(`/notifications/${notificationId}/read/`, {
        method: "POST",
      }).then(syncAll);
    },
    readAllNotifications() {
      void request("/notifications/mark-all-read/", { method: "POST" }).then(
        syncAll,
      );
    },
    deleteNotification(notificationId: string) {
      void request(`/notifications/${notificationId}/`, {
        method: "DELETE",
      }).then(syncAll);
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
      void request<User>("/me/", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }).then((updated) => {
        setActiveUser(updated);
        notify();
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
          setActiveUser(updated);
          notify();
        },
      );
    },
    updateUsername(username: string) {
      void request<User>("/me/", {
        method: "PATCH",
        body: JSON.stringify({ username }),
      }).then((updated) => {
        setActiveUser(updated);
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
      }).then(syncAll);
    },
    verificationRequests: () => clone(cache.verificationRequests),
    submitVerification(portfolioUrls: string[], note: string) {
      void request<VerificationRequest>("/artist/verification-requests/", {
        method: "POST",
        body: JSON.stringify({ portfolioUrls, note }),
      }).then(syncAll);
    },
    decideVerification(requestId: string, approved: boolean, reason: string) {
      void request<VerificationRequest>(
        `/support/verification-requests/${requestId}/${approved ? "approve" : "reject"}/`,
        { method: "POST", body: JSON.stringify({ reason }) },
      ).then(syncAll);
    },
    tickets: () => clone(cache.tickets),
    createTicket(subject: string, body: string) {
      void request<Ticket>("/tickets/", {
        method: "POST",
        body: JSON.stringify({ subject, body }),
      }).then(syncAll);
    },
    replyTicket(ticketId: string, body: string) {
      void request<Ticket>(`/tickets/${ticketId}/messages/`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }).then(syncAll);
    },
    claimTicket(ticketId: string) {
      void request<Ticket>(`/tickets/${ticketId}/claim/`, {
        method: "POST",
      }).then(syncAll);
    },
    closeTicket(ticketId: string) {
      void request<Ticket>(`/tickets/${ticketId}/close/`, {
        method: "POST",
      }).then(syncAll);
    },
    updatePlan(planId: string, patch: Partial<SubscriptionPlan>) {
      void request<SubscriptionPlan>("/admin/subscription-plans/", {
        method: "PATCH",
        body: JSON.stringify({ id: planId, ...patch }),
      }).then(syncAll);
    },
    settlePayout(payoutId: string) {
      void request(`/admin/payouts/${payoutId}/settle/`, {
        method: "POST",
      }).then(syncAll);
    },
    moderateRelease(releaseId: string, reason: string) {
      void request(`/admin/releases/${releaseId}/archive/`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }).then(syncAll);
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
      patch: { title?: string; status?: "published" | "archived" },
    ) {
      void request<Release>(`/artist/releases/${releaseId}/`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }).then(syncAll);
    },
    queue: (): QueueState =>
      loadJson<QueueState>(QUEUE_KEY, {
        trackIds: [],
        currentIndex: -1,
        repeatMode: "off",
        shuffleEnabled: false,
        volume: 0.75,
      }),
    saveQueue: (queue: QueueState) =>
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)),
    async playbackSource(trackId: string) {
      const existing = grants.get(trackId);
      if (
        existing &&
        new Date(existing.expiresAt) > new Date(Date.now() + 30_000)
      )
        return existing.streamUrl;
      const grant = await request<PlaybackGrant>(
        `/tracks/${trackId}/playback-sessions/`,
        { method: "POST" },
      );
      grants.set(trackId, grant);
      void syncAll();
      return grant.streamUrl;
    },
    recordPlaybackProgress(trackId: string, positionSeconds: number) {
      const grant = grants.get(trackId);
      if (!grant) return;
      void request(`/playback-sessions/${grant.playbackSessionId}/progress/`, {
        method: "POST",
        body: JSON.stringify({ positionSeconds }),
      }).then(syncAll);
    },
    async downloadSource(trackId: string) {
      const ticket = await request<DownloadTicket>(
        `/tracks/${trackId}/download-tickets/`,
        { method: "POST" },
      );
      return ticket.downloadUrl;
    },
    async publishReleaseDraft(
      form: {
        title: string;
        type: "single" | "album";
        genre: string;
        releaseDate: string;
        lyrics: string;
        earlyAccess: boolean;
      },
      audio: File | null,
      cover: File | null,
    ) {
      const body = new FormData();
      body.set("title", form.title);
      body.set("type", form.type);
      body.set("genre", form.genre);
      if (form.releaseDate)
        body.set("publicReleaseAt", new Date(form.releaseDate).toISOString());
      if (form.earlyAccess)
        body.set("earlyAccessStartsAt", new Date().toISOString());
      if (cover) body.set("cover", cover);
      const release = await request<Release>("/artist/releases/", {
        method: "POST",
        body,
      });
      if (audio) {
        const trackBody = new FormData();
        trackBody.set("title", form.title);
        trackBody.set("lyrics", form.lyrics);
        trackBody.set("isExplicit", "false");
        trackBody.set("audio", audio);
        await request(`/artist/releases/${release.id}/tracks/`, {
          method: "POST",
          body: trackBody,
        });
      }
      await syncAll();
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
