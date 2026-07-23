import { finalPriceRial, localDay } from "../domain/entitlements";
import type { Database, Release, SubscriptionPlan, Track, User } from "../domain/types";

const demoStreamDates = (timezone = "Asia/Tehran"): Record<string, string> => {
  const day = (ago: number) => {
    const date = new Date();
    date.setDate(date.getDate() - ago);
    return localDay(timezone, date);
  };
  return {
    "track-1": day(0),
    "track-2": day(0),
    "track-3": day(0),
    "track-4": day(0),
    "track-5": day(1),
    "track-6": day(1),
    "track-7": day(2),
    "track-8": day(3),
    "track-9": day(4),
    "track-10": day(5),
    "track-11": day(6),
    "track-12": day(7),
    "track-13": day(0),
  };
};

const now = "2026-07-06T08:00:00.000Z";
const future = "2026-08-01T00:00:00.000Z";
const password = "DemoPass123!";

const subscription = (tier: "basic" | "silver" | "gold") => ({
  id: `sub-${tier}`,
  tier,
  status: "active" as const,
  startsAt: now,
  expiresAt: tier === "basic" ? null : "2027-07-06T08:00:00.000Z",
  canUpgradeToGold: tier !== "gold",
});

const baseUser = (id: string, email: string, displayName: string, tier: "basic" | "silver" | "gold"): User => ({
  id,
  email,
  password,
  kind: "consumer",
  username: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "") + id.slice(-2),
  displayName,
  avatarUrl: `/media/avatars/${id}.svg`,
  birthDate: "1997-04-12",
  gender: "prefer_not_to_say",
  locale: "en",
  timezone: "Asia/Tehran",
  theme: "dark",
  explicitContentEnabled: true,
  notificationPreference: "all",
  subscription: subscription(tier),
  artistProfile: null,
  followerIds: [],
  followingIds: [],
  likedTrackIds: ["track-1", "track-5"],
  savedPlaylistIds: [],
  recentlyPlayedIds: ["track-3", "track-1", "track-8"],
  recentlyPlayedPlaylistIds: ["playlist-1", "playlist-2"],
  streamDates: demoStreamDates(),
  usernameChangedAt: null,
  deletedAt: null,
});

const basic = baseUser("user-basic", "listener.basic@sonora.demo", "Nila Ray", "basic");
const silver = baseUser("user-silver", "listener.silver@sonora.demo", "Milo Vale", "silver");
const gold = baseUser("user-gold", "listener.gold@sonora.demo", "Ari Noor", "gold");
const unverified = baseUser("user-artist-u", "artist.unverified@sonora.demo", "Cedar Bloom", "basic");
unverified.artistProfile = { id: "artist-u", stageName: "Cedar Bloom", bio: "Bedroom producer shaping quiet electronic sketches.", verifiedAt: null, genre: "Ambient" };
unverified.username = "cedarbloom";
const verified = baseUser("user-artist-v", "artist.verified@sonora.demo", "Nova Serein", "gold");
verified.artistProfile = { id: "artist-v", stageName: "Nova Serein", bio: "Luminous electronica assembled from night trains and warm circuitry.", verifiedAt: "2025-01-14T10:00:00.000Z", genre: "Electronic" };
verified.username = "novaserein";
verified.followerIds = [basic.id, silver.id, gold.id];
const artist2 = baseUser("user-artist-2", "lumen@sonora.demo", "Lumen Harbor", "silver");
artist2.artistProfile = { id: "artist-2", stageName: "Lumen Harbor", bio: "Organic textures and patient percussion.", verifiedAt: "2025-02-02T10:00:00.000Z", genre: "Downtempo" };
artist2.username = "lumenharbor";
const artist3 = baseUser("user-artist-3", "sol@sonora.demo", "Sol Circuit", "gold");
artist3.artistProfile = { id: "artist-3", stageName: "Sol Circuit", bio: "Bright synth music for long roads.", verifiedAt: "2025-03-02T10:00:00.000Z", genre: "Synthwave" };
artist3.username = "solcircuit";
const artist4 = baseUser("user-artist-4", "mira@sonora.demo", "Mira Moss", "silver");
artist4.artistProfile = { id: "artist-4", stageName: "Mira Moss", bio: "Acoustic fragments with an electronic pulse.", verifiedAt: "2025-04-02T10:00:00.000Z", genre: "Indie" };
artist4.username = "miramoss";
const listener1 = baseUser("user-listener-1", "listener.jade@sonora.demo", "Jade Quill", "basic");
listener1.username = "jadequill";
listener1.likedTrackIds = ["track-2", "track-8"];
listener1.recentlyPlayedIds = ["track-2", "track-5"];
listener1.recentlyPlayedPlaylistIds = ["playlist-1"];
const listener2 = baseUser("user-listener-2", "listener.oren@sonora.demo", "Oren Hale", "silver");
listener2.username = "orenhale";
listener2.likedTrackIds = ["track-3", "track-10"];
listener2.recentlyPlayedIds = ["track-10", "track-1"];
listener2.recentlyPlayedPlaylistIds = ["playlist-2", "playlist-1"];
const listener3 = baseUser("user-listener-3", "listener.sena@sonora.demo", "Sena Park", "gold");
listener3.username = "senapark";
listener3.likedTrackIds = ["track-1", "track-7", "track-11"];
listener3.recentlyPlayedIds = ["track-11", "track-7", "track-4"];
listener3.recentlyPlayedPlaylistIds = ["playlist-1", "playlist-2"];
const support = baseUser("user-support", "support@sonora.demo", "Sonora Support", "basic");
support.kind = "support";
support.avatarUrl = null;
support.username = "internal-support";
const admin = baseUser("user-admin", "admin@sonora.demo", "Sonora Admin", "gold");
admin.kind = "admin";
admin.avatarUrl = null;
admin.username = "internal-admin";

gold.followingIds = [verified.id, artist2.id, silver.id, basic.id, listener1.id];
gold.followerIds = [silver.id, basic.id, listener2.id];
silver.followingIds = [verified.id, basic.id, gold.id, listener3.id];
silver.followerIds = [basic.id, gold.id, listener1.id];
basic.followingIds = [verified.id, silver.id, gold.id];
basic.followerIds = [silver.id, gold.id, listener3.id];
verified.followingIds = [artist2.id, artist3.id];
artist2.followerIds = [gold.id, verified.id, listener2.id];
artist3.followerIds = [verified.id, listener3.id];
artist2.followingIds = [verified.id, artist4.id];
artist4.followerIds = [artist2.id, listener1.id];
listener1.followingIds = [verified.id, silver.id, artist4.id];
listener1.followerIds = [gold.id];
listener2.followingIds = [verified.id, artist2.id, gold.id];
listener2.followerIds = [];
listener3.followingIds = [verified.id, artist3.id, basic.id];
listener3.followerIds = [silver.id];

const credit = (user: User) => ({ artistId: user.artistProfile!.id, username: user.username, stageName: user.artistProfile!.stageName, role: "primary" as const });

export const seedTracks: Track[] = [
  ["track-1", "release-1", "Afterglow Index", verified, 50, false, "Electronic", "A signal folds into the night\nWe keep the quiet moving"],
  ["track-2", "release-1", "Soft Machines", verified, 56, false, "Electronic", "Soft machines breathe in time\nSilver circuits, open skies"],
  ["track-3", "release-1", "Night Geometry", verified, 43, false, "Electronic", "Lines of light / a borrowed city\nWe draw the dark in symmetry"],
  ["track-4", "release-1", "Window Seat", verified, 49, false, "Electronic", null],
  ["track-5", "release-2", "Tidal Memory", artist2, 50, false, "Downtempo", "Let the water keep the names\nWe were never standing still"],
  ["track-6", "release-2", "Driftwood Radio", artist2, 56, false, "Downtempo", null],
  ["track-7", "release-2", "Low Tide Lanterns", artist2, 43, false, "Ambient", null],
  ["track-8", "release-3", "Solar Arcade", artist3, 49, false, "Synthwave", "Turn the horizon up\nEvery mile becomes a color"],
  ["track-9", "release-3", "Chrome Sunrise", artist3, 47, true, "Synthwave", null],
  ["track-10", "release-4", "Fern Signals", artist4, 54, false, "Indie", "Green static in the trees\nA small world waking"],
  ["track-11", "release-5", "Second Weather", verified, 51, false, "Electronic", "There is another weather\nWaiting behind the rain"],
  ["track-12", "release-6", "Future Bloom", verified, 45, false, "Electronic", "Tomorrow opens slowly\nA brighter frequency"],
  ["track-13", "release-7", "Harbor Pulse", verified, 48, false, "Electronic", "One beat under the pier\nNo album, just the tide"],
].map(([id, releaseId, title, artist, duration, explicit, genre, lyrics], index) => ({
  id: String(id), releaseId: String(releaseId), title: String(title), coverUrl: index === 6 ? null : `/media/covers/${releaseId === "release-7" ? "release-5" : releaseId}.svg`,
  audioUrl: `/media/audio/sonora-${(index % 12) + 1}.wav`, artists: [credit(artist as User)],
  releaseTitle: index < 4 ? "Signals After Dark" : index < 7 ? "Tidal Memory" : index < 9 ? "Solar Arcade" : String(title),
  durationSeconds: Number(duration), isExplicit: Boolean(explicit), isGoldEarlyAccess: id === "track-12", publicReleaseAt: id === "track-12" ? future : "2026-05-10T00:00:00.000Z",
  genre: String(genre), lyrics: lyrics as string | null, streamCount: 24800 - index * 1270, uniqueListenerCount: 8800 - index * 391,
}));

export const seedReleases: Release[] = [
  { id: "release-1", type: "album", title: "Signals After Dark", coverUrl: "/media/covers/release-1.svg", primaryArtist: credit(verified), publicReleaseAt: "2026-05-10T00:00:00.000Z", isEarlyAccess: false, status: "published", trackIds: ["track-1", "track-2", "track-3", "track-4"], genre: "Electronic", ownerUserId: verified.id },
  { id: "release-2", type: "album", title: "Tidal Memory", coverUrl: "/media/covers/release-2.svg", primaryArtist: credit(artist2), publicReleaseAt: "2026-04-02T00:00:00.000Z", isEarlyAccess: false, status: "published", trackIds: ["track-5", "track-6", "track-7"], genre: "Downtempo", ownerUserId: artist2.id },
  { id: "release-3", type: "album", title: "Solar Arcade", coverUrl: "/media/covers/release-3.svg", primaryArtist: credit(artist3), publicReleaseAt: "2026-03-14T00:00:00.000Z", isEarlyAccess: false, status: "published", trackIds: ["track-8", "track-9"], genre: "Synthwave", ownerUserId: artist3.id },
  { id: "release-4", type: "single", title: "Fern Signals", coverUrl: "/media/covers/release-4.svg", primaryArtist: credit(artist4), publicReleaseAt: "2026-06-20T00:00:00.000Z", isEarlyAccess: false, status: "published", trackIds: ["track-10"], genre: "Indie", ownerUserId: artist4.id },
  { id: "release-5", type: "single", title: "Second Weather", coverUrl: "/media/covers/release-5.svg", primaryArtist: credit(verified), publicReleaseAt: "2026-06-28T00:00:00.000Z", isEarlyAccess: false, status: "published", trackIds: ["track-11"], genre: "Electronic", ownerUserId: verified.id },
  { id: "release-6", type: "single", title: "Future Bloom", coverUrl: "/media/covers/release-6.svg", primaryArtist: credit(verified), publicReleaseAt: future, isEarlyAccess: true, status: "scheduled", trackIds: ["track-12"], genre: "Electronic", ownerUserId: verified.id },
  { id: "release-7", type: "single", title: "Harbor Pulse", coverUrl: "/media/covers/release-5.svg", primaryArtist: credit(verified), publicReleaseAt: "2026-07-01T00:00:00.000Z", isEarlyAccess: false, status: "published", trackIds: ["track-13"], genre: "Electronic", ownerUserId: verified.id },
];

const plan = (tier: "silver" | "gold", months: 1 | 3 | 6 | 12, discount: number): SubscriptionPlan => {
  const monthly = tier === "silver" ? 790_000 : 1_290_000;
  return { id: `plan-${tier}-${months}`, tier, durationMonths: months, monthlyPriceRial: monthly, discountPercent: discount, finalPriceRial: finalPriceRial(monthly, months, discount), isAvailable: true };
};

export const createSeedDatabase = (): Database => ({
  version: 8,
  users: [basic, silver, gold, unverified, verified, artist2, artist3, artist4, listener1, listener2, listener3, support, admin],
  tracks: seedTracks,
  releases: seedReleases,
  playlists: [
    { id: "playlist-1", ownerId: verified.id, title: "Night Transit", description: "Glowing tracks for the last train home.", visibility: "public", coverUrl: null, generatedCover: true, trackIds: ["track-1", "track-8", "track-5", "track-11"], createdAt: now, updatedAt: now },
    { id: "playlist-2", ownerId: gold.id, title: "Low light focus", description: "Patient sounds, minimal interruption.", visibility: "public", coverUrl: null, generatedCover: true, trackIds: ["track-7", "track-2", "track-10"], createdAt: now, updatedAt: now },
    { id: "playlist-3", ownerId: basic.id, title: "Private sparks", description: "Just for me.", visibility: "private", coverUrl: null, generatedCover: true, trackIds: ["track-3", "track-9"], createdAt: now, updatedAt: now },
  ],
  notifications: [
    { id: "notice-1", userId: gold.id, title: "Future Bloom is here early", body: "Your Gold early-access window is open.", titleKey: "noticeGoldEarlyTitle", bodyKey: "noticeGoldEarlyBody", values: { releaseTitle: "Future Bloom" }, kind: "release", readAt: null, createdAt: "2026-07-06T07:00:00.000Z" },
    { id: "notice-2", userId: gold.id, title: "New follower", body: "Nila Ray followed you.", titleKey: "noticeNewFollowerTitle", bodyKey: "noticeNewFollowerBody", values: { name: "Nila Ray" }, kind: "social", readAt: null, createdAt: "2026-07-05T11:00:00.000Z" },
    { id: "notice-3", userId: basic.id, title: "Account protected", body: "Your security settings are up to date.", titleKey: "noticeAccountProtectedTitle", bodyKey: "noticeAccountProtectedBody", kind: "critical", readAt: null, createdAt: "2026-07-04T09:00:00.000Z" },
  ],
  verificationRequests: [
    { id: "verify-1", userId: unverified.id, status: "pending", portfolioUrls: ["https://example.com/cedar-bloom"], note: "Independent producer and live performer.", reason: null, createdAt: "2026-07-01T10:00:00.000Z", decidedAt: null },
    { id: "verify-2", userId: verified.id, status: "approved", portfolioUrls: ["https://example.com/nova-serein"], note: "Official portfolio.", reason: "Identity and catalog confirmed.", createdAt: "2025-01-12T10:00:00.000Z", decidedAt: "2025-01-14T10:00:00.000Z" },
  ],
  tickets: [
    { id: "ticket-1", creatorId: silver.id, subject: "Downloaded track unavailable", status: "open", claimedById: null, createdAt: "2026-07-05T10:00:00.000Z", messages: [{ id: "message-1", authorId: silver.id, body: "The download action stays disabled on one release.", createdAt: "2026-07-05T10:00:00.000Z" }] },
  ],
  plans: [plan("silver", 1, 0), plan("silver", 3, 5), plan("silver", 6, 10), plan("silver", 12, 18), plan("gold", 1, 0), plan("gold", 3, 5), plan("gold", 6, 10), plan("gold", 12, 18)],
  auditEvents: [
    { id: "audit-1", actorId: "user-support", action: "verification.approved", target: "verify-2", before: "pending", after: "approved", createdAt: "2025-01-14T10:00:00.000Z", requestId: "req-demo-1" },
    { id: "audit-2", actorId: "user-admin", action: "plan.updated", target: "plan-gold-12", before: "20%", after: "18%", createdAt: "2026-06-01T08:00:00.000Z", requestId: "req-demo-2" },
  ],
  payouts: [{ id: "payout-1", artistUserId: verified.id, amountRial: 48_600_000, status: "pending", period: "2026-06" }],
  payments: [],
  drafts: [],
});

export const DEMO_PASSWORD = password;
