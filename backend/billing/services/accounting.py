from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from django.db.models import Count, Sum
from django.utils import timezone

from accounts.models import (
    ArtistProfile,
    User,
)
from billing.models import (
    ArtistRewardStatement,
    Payment,
    Payout,
    Subscription,
    SubscriptionPlan,
)
from catalog.models import (
    Release,
    StreamEvent,
    Track,
)
from .billing import reward_amount_rial

REPORTING_TZ = ZoneInfo("Asia/Tehran")


def reporting_period(at: datetime | None = None) -> tuple[str, datetime, datetime]:
    now = (at or timezone.now()).astimezone(REPORTING_TZ)
    start = datetime(now.year, now.month, 1, tzinfo=REPORTING_TZ)
    if now.month == 12:
        next_start = datetime(now.year + 1, 1, 1, tzinfo=REPORTING_TZ)
    else:
        next_start = datetime(now.year, now.month + 1, 1, tzinfo=REPORTING_TZ)
    return start.strftime("%Y-%m"), start, next_start


def _catalog_totals(owner: User) -> tuple[int, int]:
    tracks = Track.objects.filter(release__owner=owner).exclude(
        release__status=Release.Status.ARCHIVED
    )
    totals = tracks.aggregate(
        streams=Sum("stream_count"),
        listeners=Sum("unique_listener_count"),
    )
    return int(totals["listeners"] or 0), int(totals["streams"] or 0)


def artist_period_stats(owner: User, start: datetime, end: datetime) -> tuple[int, int]:
    events = StreamEvent.objects.filter(
        track__release__owner=owner,
        created_at__gte=start,
        created_at__lt=end,
    )
    catalog_unique, catalog_streams = _catalog_totals(owner)
    return (
        max(events.values("user_id").distinct().count(), catalog_unique),
        max(events.count(), catalog_streams),
    )


def release_period_stats(release: Release, start: datetime, end: datetime) -> tuple[int, int]:
    events = StreamEvent.objects.filter(
        track__release=release,
        created_at__gte=start,
        created_at__lt=end,
    )
    tracks = list(release.tracks.all())
    catalog_unique = sum(track.unique_listener_count for track in tracks)
    catalog_streams = sum(track.stream_count for track in tracks)
    return (
        max(events.values("user_id").distinct().count(), catalog_unique),
        max(events.count(), catalog_streams),
    )


def _payout_row(
    payout: Payout,
    profile: ArtistProfile,
    unique: int,
    streams: int,
) -> dict[str, Any]:
    return {
        "id": str(payout.id),
        "artistUserId": str(profile.user_id),
        "artistName": profile.stage_name,
        "username": profile.user.username,
        "uniqueListeners": unique,
        "validStreams": streams,
        "amountRial": payout.amount_rial,
        "status": payout.status,
        "period": payout.period,
    }


def sync_artist_ledger(at: datetime | None = None) -> list[dict[str, Any]]:
    period, start, end = reporting_period(at)
    rows: list[dict[str, Any]] = []
    profiles = (
        ArtistProfile.objects.filter(verified_at__isnull=False)
        .select_related("user")
        .order_by("stage_name")
    )
    for profile in profiles:
        unique, streams = artist_period_stats(profile.user, start, end)
        amount = reward_amount_rial(unique, streams)
        statement = ArtistRewardStatement.objects.filter(artist=profile, period=period).first()
        if statement:
            statement.unique_listeners = unique
            statement.valid_streams = streams
            statement.amount_rial = amount
            statement.save(
                update_fields=["unique_listeners", "valid_streams", "amount_rial", "updated_at"]
            )
        else:
            statement = ArtistRewardStatement.objects.create(
                artist=profile,
                period=period,
                unique_listeners=unique,
                valid_streams=streams,
                amount_rial=amount,
            )
        payout = Payout.objects.filter(artist=profile, period=period).first()
        if amount <= 0:
            if payout and payout.status != Payout.Status.SETTLED:
                payout.delete()
                payout = None
            rows.append(
                {
                    "id": str(statement.id) if statement else str(profile.id),
                    "artistUserId": str(profile.user_id),
                    "artistName": profile.stage_name,
                    "username": profile.user.username,
                    "uniqueListeners": unique,
                    "validStreams": streams,
                    "amountRial": 0,
                    "status": "none",
                    "period": period,
                }
            )
            continue
        if payout is None:
            payout = Payout.objects.create(
                artist=profile,
                period=period,
                amount_rial=amount,
                status=Payout.Status.PENDING,
            )
        elif payout.status != Payout.Status.SETTLED and payout.amount_rial != amount:
            payout.amount_rial = amount
            payout.save(update_fields=["amount_rial", "updated_at"])
        rows.append(_payout_row(payout, profile, unique, streams))
    return rows


def artist_revenue_split(user: User, reward_rial: int, period: str) -> tuple[int, int]:
    profile = getattr(user, "artist_profile", None)
    if not profile:
        return 0, 0
    paid = (
        Payout.objects.filter(artist=profile, status=Payout.Status.SETTLED).aggregate(
            total=Sum("amount_rial")
        )["total"]
        or 0
    )
    current = Payout.objects.filter(artist=profile, period=period).first()
    unpaid = 0 if current and current.status == Payout.Status.SETTLED else reward_rial
    return int(paid), int(unpaid)


def artist_reward_snapshot(user: User, at: datetime | None = None) -> dict[str, Any]:
    period, start, end = reporting_period(at)
    unique, streams = artist_period_stats(user, start, end)
    reward = reward_amount_rial(unique, streams)
    paid, unpaid = artist_revenue_split(user, reward, period)
    return {
        "period": period,
        "uniqueListeners": unique,
        "validStreams": streams,
        "rewardRial": reward,
        "paidRial": paid,
        "unpaidRial": unpaid,
    }


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def monthly_revenue_series(at: datetime | None = None, months: int = 6) -> list[dict[str, Any]]:
    now = (at or timezone.now()).astimezone(REPORTING_TZ)
    start_year, start_month = _shift_month(now.year, now.month, -(months - 1))
    window_start = datetime(start_year, start_month, 1, tzinfo=REPORTING_TZ)
    buckets: dict[str, int] = {}
    for created_at, amount in Payment.objects.filter(
        status=Payment.Status.SUCCEEDED,
        created_at__gte=window_start,
    ).values_list("created_at", "final_price_rial"):
        key = created_at.astimezone(REPORTING_TZ).strftime("%Y-%m")
        buckets[key] = buckets.get(key, 0) + int(amount)
    series: list[dict[str, Any]] = []
    for offset in range(months):
        year, month = _shift_month(start_year, start_month, offset)
        key = f"{year:04d}-{month:02d}"
        series.append({"period": key, "revenueRial": buckets.get(key, 0)})
    return series


def _plan_for_subscription(sub: Subscription) -> SubscriptionPlan | None:
    months = 1
    if sub.expires_at and sub.starts_at:
        days = (sub.expires_at - sub.starts_at).days
        approx = max(1, round(days / 30))
        months = min((1, 3, 6, 12), key=lambda value: abs(value - approx))
    return SubscriptionPlan.objects.filter(tier=sub.tier, duration_months=months).first()


def ensure_subscription_payments(at: datetime | None = None) -> None:
    paid = (
        Subscription.objects.filter(
            status=Subscription.Status.ACTIVE,
            tier__in=[Subscription.Tier.SILVER, Subscription.Tier.GOLD],
        )
        .select_related("user", "source_payment")
        .order_by("user__username")
    )
    period_start = reporting_period(at)[1]
    missing = [
        sub
        for sub in paid
        if not Payment.objects.filter(user=sub.user, status=Payment.Status.SUCCEEDED).exists()
    ]
    for index, sub in enumerate(missing):
        plan = _plan_for_subscription(sub)
        if plan is None:
            continue
        year, month = _shift_month(period_start.year, period_start.month, -(index % 6))
        created = datetime(year, month, 12, 10, 0, tzinfo=REPORTING_TZ)
        payment = Payment.objects.create(
            user=sub.user,
            plan=plan,
            tier=plan.tier,
            duration_months=plan.duration_months,
            monthly_price_rial=plan.monthly_price_rial,
            discount_percent=plan.discount_percent,
            final_price_rial=plan.final_price_rial,
            provider=Payment.Provider.MOCK,
            provider_reference=f"sub-{sub.user.username}",
            status=Payment.Status.SUCCEEDED,
            created_at=created,
        )
        sub.source_payment = payment
        sub.save(update_fields=["source_payment", "updated_at"])


def admin_report_payload(at: datetime | None = None) -> dict[str, Any]:
    ensure_subscription_payments(at)
    period, start, end = reporting_period(at)
    active = Subscription.objects.filter(status=Subscription.Status.ACTIVE)
    mix = {tier: 0 for tier in Subscription.Tier.values}
    for row in active.values("tier").annotate(count=Count("id")):
        mix[row["tier"]] = row["count"]
    succeeded = Payment.objects.filter(status=Payment.Status.SUCCEEDED)
    month_revenue = (
        succeeded.filter(created_at__gte=start, created_at__lt=end).aggregate(
            total=Sum("final_price_rial")
        )["total"]
        or 0
    )
    total_revenue = succeeded.aggregate(total=Sum("final_price_rial"))["total"] or 0
    pending = (
        Payout.objects.filter(
            status=Payout.Status.PENDING, period=period, amount_rial__gt=0
        ).aggregate(total=Sum("amount_rial"))["total"]
        or 0
    )
    return {
        "period": period,
        "timezone": "Asia/Tehran",
        "subscriptions": active.count(),
        "subscriptionMix": [
            {"tier": "basic", "count": mix.get("basic", 0)},
            {"tier": "silver", "count": mix.get("silver", 0)},
            {"tier": "gold", "count": mix.get("gold", 0)},
        ],
        "revenueRial": total_revenue,
        "monthRevenueRial": month_revenue,
        "revenueByMonth": monthly_revenue_series(at),
        "pendingPayoutsRial": pending,
        "validStreams": Track.objects.aggregate(total=Sum("stream_count"))["total"] or 0,
    }
