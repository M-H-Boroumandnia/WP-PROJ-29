from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from rest_framework import status

from core.exceptions import SonoraError
from accounts.models import User
from billing.models import Subscription
from catalog.models import (
    StreamEvent,
    Track,
)
from core.services.common import BASIC_DAILY_STREAM_LIMIT, is_early_access_active, now_utc


def active_subscription(user: User) -> Subscription:
    """Return the user's current plan, expiring paid tiers to Basic when due."""
    from datetime import timedelta

    from notifications.models import Notification
    from notifications.services import create_notification

    sub = (
        user.subscriptions.filter(status=Subscription.Status.ACTIVE).order_by("-starts_at").first()
    )
    if not sub:
        return Subscription.basic_for(user)
    if (
        sub.tier != Subscription.Tier.BASIC
        and sub.expires_at is not None
        and sub.expires_at <= now_utc()
    ):
        tier = sub.tier
        sub.status = Subscription.Status.EXPIRED
        sub.save(update_fields=["status", "updated_at"])
        create_notification(
            user,
            "Subscription expired",
            f"Your {tier} plan ended. You are back on Basic.",
            Notification.Kind.CRITICAL,
            "noticeSubscriptionExpiredTitle",
            "noticeSubscriptionExpiredBody",
            {"tier": tier.title(), "link": "/settings"},
        )
        return Subscription.basic_for(user)
    if (
        sub.tier != Subscription.Tier.BASIC
        and sub.expires_at is not None
        and now_utc() < sub.expires_at <= now_utc() + timedelta(days=7)
    ):
        already = user.notifications.filter(
            title_key="noticeSubscriptionExpiringTitle",
            values__subscriptionId=str(sub.id),
        ).exists()
        if not already:
            days = max(1, (sub.expires_at - now_utc()).days)
            create_notification(
                user,
                "Subscription ending soon",
                f"Your {sub.tier} plan ends in {days} day(s).",
                Notification.Kind.IMPORTANT,
                "noticeSubscriptionExpiringTitle",
                "noticeSubscriptionExpiringBody",
                {
                    "tier": sub.tier.title(),
                    "days": days,
                    "subscriptionId": str(sub.id),
                    "link": "/settings",
                },
            )
    return sub


def playlist_limit(tier: str) -> int:
    if tier == Subscription.Tier.BASIC:
        return 6
    if tier == Subscription.Tier.SILVER:
        return 100
    return 1_000_000


def age_from_birth_date(birth_date: date, at: datetime | None = None) -> int:
    at = at or now_utc()
    today = at.date()
    age = today.year - birth_date.year
    if (today.month, today.day) < (birth_date.month, birth_date.day):
        age -= 1
    return age


def local_day(user: User, at: datetime | None = None) -> str:
    at = at or now_utc()
    try:
        zone = ZoneInfo(user.timezone)
    except Exception:
        zone = ZoneInfo("UTC")
    return at.astimezone(zone).strftime("%Y-%m-%d")


def track_lock(user: User, track: Track, at: datetime | None = None) -> str | None:
    at = at or now_utc()
    sub = active_subscription(user)
    if track.is_explicit and (
        age_from_birth_date(user.birth_date, at) < 18 or not user.explicit_content_enabled
    ):
        return "explicit_restricted"
    if is_early_access_active(track.release, at) and sub.tier != Subscription.Tier.GOLD:
        return "gold_required"
    if sub.tier == Subscription.Tier.BASIC:
        day = local_day(user, at)
        count = (
            StreamEvent.objects.filter(user=user, local_day=day)
            .values("track_id")
            .distinct()
            .count()
        )
        already = StreamEvent.objects.filter(user=user, track=track, local_day=day).exists()
        if count >= BASIC_DAILY_STREAM_LIMIT and not already:
            return "daily_stream_limit"
    return None


def ensure_consumer(user: User) -> None:
    if user.kind != User.Kind.CONSUMER:
        raise SonoraError(
            "forbidden",
            "This action is not available for staff accounts.",
            status.HTTP_403_FORBIDDEN,
        )


def ensure_staff(user: User) -> None:
    if user.kind not in {User.Kind.SUPPORT, User.Kind.ADMIN}:
        raise SonoraError("forbidden", "Staff access required.", status.HTTP_403_FORBIDDEN)


def ensure_admin(user: User) -> None:
    if user.kind != User.Kind.ADMIN:
        raise SonoraError("forbidden", "Admin access required.", status.HTTP_403_FORBIDDEN)


def ensure_verified_artist(user: User) -> None:
    profile = getattr(user, "artist_profile", None)
    if not profile or not profile.verified_at:
        raise SonoraError(
            "verified_required",
            "Only verified artists can manage releases.",
            status.HTTP_403_FORBIDDEN,
        )


def can_open_ticket(user: User) -> bool:
    sub = active_subscription(user)
    return sub.tier != Subscription.Tier.BASIC or bool(
        getattr(getattr(user, "artist_profile", None), "verified_at", None)
    )


def can_edit_avatar(user: User) -> bool:
    return active_subscription(user).tier in {Subscription.Tier.SILVER, Subscription.Tier.GOLD}


def can_download(user: User) -> bool:
    return active_subscription(user).tier in {Subscription.Tier.SILVER, Subscription.Tier.GOLD}
