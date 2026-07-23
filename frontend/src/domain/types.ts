export type UserKind = "consumer" | "support" | "admin";
export type SubscriptionTier = "basic" | "silver" | "gold";
export type PlaylistVisibility = "private" | "public";
export type ReleaseType = "album" | "single";
export type ReleaseStatus =
  | "draft"
  | "processing"
  | "ready"
  | "scheduled"
  | "published"
  | "archived";
export type RepeatMode = "off" | "all" | "one";
export type NotificationPreference =
  | "all"
  | "important_only"
  | "max_five_daily"
  | "muted";
export type Locale = "en" | "es" | "de" | "fr" | "ru" | "zh-CN";

export interface ActiveSubscription {
  id: string;
  tier: SubscriptionTier;
  status: "active" | "expired" | "superseded" | "cancelled";
  startsAt: string;
  expiresAt: string | null;
  canUpgradeToGold: boolean;
}

export interface ArtistProfile {
  id: string;
  stageName: string;
  bio: string;
  verifiedAt: string | null;
  genre: string;
}

export interface User {
  id: string;
  email: string;
  password: string;
  kind: UserKind;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  birthDate: string;
  gender: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  locale: Locale;
  timezone: string;
  theme: "dark" | "light" | "system";
  explicitContentEnabled: boolean;
  notificationPreference: NotificationPreference;
  subscription: ActiveSubscription;
  artistProfile: ArtistProfile | null;
  followerIds: string[];
  followingIds: string[];
  likedTrackIds: string[];
  savedPlaylistIds: string[];
  recentlyPlayedIds: string[];
  recentlyPlayedPlaylistIds: string[];
  streamDates: Record<string, string>;
  usernameChangedAt: string | null;
  deletedAt: string | null;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  kind: "consumer" | "artist";
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  publicPlaylistCount: number;
}

export interface ArtistCredit {
  artistId: string;
  username: string;
  stageName: string;
  role: "primary" | "featured" | "producer";
}

export interface Track {
  id: string;
  releaseId: string;
  title: string;
  coverUrl: string | null;
  audioUrl: string;
  artists: ArtistCredit[];
  releaseTitle: string;
  durationSeconds: number;
  isExplicit: boolean;
  isGoldEarlyAccess: boolean;
  publicReleaseAt: string;
  genre: string;
  lyrics: string | null;
  streamCount: number;
  uniqueListenerCount: number;
}

export interface TrackView extends Track {
  isPlayableForViewer: boolean;
  lockReason:
    | "gold_required"
    | "explicit_restricted"
    | "daily_stream_limit"
    | null;
  isLiked: boolean;
}

export interface Release {
  id: string;
  type: ReleaseType;
  title: string;
  coverUrl: string | null;
  primaryArtist: ArtistCredit;
  publicReleaseAt: string;
  isEarlyAccess: boolean;
  status: ReleaseStatus;
  trackIds: string[];
  genre: string;
  ownerUserId: string;
}

export interface Playlist {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  visibility: PlaylistVisibility;
  coverUrl: string | null;
  generatedCover: boolean;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  titleKey?: string;
  bodyKey?: string;
  values?: Record<string, string | number>;
  kind: "critical" | "important" | "social" | "release";
  readAt: string | null;
  createdAt: string;
}

export interface VerificationRequest {
  id: string;
  userId: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  portfolioUrls: string[];
  note: string;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TicketMessage {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  creatorId: string;
  subject: string;
  status: "open" | "answered" | "closed";
  claimedById: string | null;
  messages: TicketMessage[];
  createdAt: string;
}

export interface SubscriptionPlan {
  id: string;
  tier: "silver" | "gold";
  durationMonths: 1 | 3 | 6 | 12;
  monthlyPriceRial: number;
  discountPercent: number;
  finalPriceRial: number;
  isAvailable: boolean;
  label?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  target: string;
  before: string | null;
  after: string | null;
  createdAt: string;
  requestId: string;
}

export interface Payout {
  id: string;
  artistUserId: string;
  amountRial: number;
  status: "pending" | "settled";
  period: string;
}

export interface Payment {
  id: string;
  userId: string;
  planId: string | null;
  tier: "silver" | "gold";
  durationMonths: 1 | 3 | 6 | 12;
  monthlyPriceRial: number;
  discountPercent: number;
  finalPriceRial: number;
  provider: "demo" | "mock" | "zarinpal";
  status: "pending" | "succeeded" | "failed";
  createdAt: string;
}

export interface QueueState {
  trackIds: string[];
  currentIndex: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  volume: number;
}

export interface RoomQueueItem {
  id: string;
  trackId: string;
  addedByUserId: string;
  addedAt: string;
}
export interface RoomParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  isHost: boolean;
  canControl: boolean;
  accessState: "playable" | "tier_locked" | "explicit_locked";
}
export interface ListeningRoom {
  id: string;
  inviteCode: string;
  hostUserId: string;
  status: "active" | "closed";
  queue: RoomQueueItem[];
  currentQueueItemId: string | null;
  positionSeconds: number;
  isPlaying: boolean;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  participants: RoomParticipant[];
  updatedAt: string;
}

export interface DraftRelease {
  id: string;
  userId: string;
  title: string;
  type: ReleaseType;
  genre: string;
  year: number;
  releaseDate: string;
  lyrics: string;
  collaborators: string;
  earlyAccess: boolean;
  audioFileInfo: string | null;
  coverFileInfo: string | null;
  createdAt: string;
}

export interface Database {
  version: number;
  users: User[];
  tracks: Track[];
  releases: Release[];
  playlists: Playlist[];
  notifications: Notification[];
  verificationRequests: VerificationRequest[];
  tickets: Ticket[];
  plans: SubscriptionPlan[];
  auditEvents: AuditEvent[];
  payouts: Payout[];
  payments: Payment[];
  drafts: DraftRelease[];
}

export interface RegistrationInput {
  displayName: string;
  stageName?: string;
  email: string;
  password: string;
  birthDate: string;
  gender: User["gender"];
  locale: Locale;
  timezone: string;
}
