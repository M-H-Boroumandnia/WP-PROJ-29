import type { SubscriptionTier, Track, User } from "./types";

export const playlistLimit = (tier: SubscriptionTier): number =>
  tier === "basic" ? 6 : tier === "silver" ? 100 : Number.POSITIVE_INFINITY;

export const canUseRooms = (tier: SubscriptionTier): boolean =>
  tier !== "basic";
export const canDownload = (tier: SubscriptionTier): boolean =>
  tier !== "basic";
export const canEditAvatar = (tier: SubscriptionTier): boolean =>
  tier !== "basic";
export const canOpenTicket = (user: User): boolean =>
  user.subscription.tier !== "basic" || Boolean(user.artistProfile?.verifiedAt);

export const ageFromBirthDate = (
  birthDate: string,
  now = new Date(),
): number => {
  const birth = new Date(`${birthDate}T00:00:00`);
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
};

export const localDay = (timezone: string, now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

export const getTrackLock = (
  user: User,
  track: Track,
  now = new Date(),
): TrackViewLock => {
  if (
    track.isExplicit &&
    (ageFromBirthDate(user.birthDate, now) < 18 || !user.explicitContentEnabled)
  ) {
    return "explicit_restricted";
  }
  if (
    track.isGoldEarlyAccess &&
    user.subscription.tier !== "gold" &&
    new Date(track.publicReleaseAt) > now
  ) {
    return "gold_required";
  }
  if (user.subscription.tier === "basic") {
    const day = localDay(user.timezone, now);
    const count = Object.values(user.streamDates).filter(
      (value) => value === day,
    ).length;
    if (count >= 60 && user.streamDates[track.id] !== day)
      return "daily_stream_limit";
  }
  return null;
};

export type TrackViewLock =
  | "gold_required"
  | "explicit_restricted"
  | "daily_stream_limit"
  | null;

export const finalPriceRial = (
  monthlyPriceRial: number,
  months: number,
  discountPercent: number,
): number =>
  Math.round(monthlyPriceRial * months * (1 - discountPercent / 100));
