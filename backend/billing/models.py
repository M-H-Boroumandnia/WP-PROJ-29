from __future__ import annotations

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from core.models import TimeStampedModel
from accounts.models import User


class SubscriptionPlan(TimeStampedModel):
    class Tier(models.TextChoices):
        SILVER = "silver", "Silver"
        GOLD = "gold", "Gold"

    tier = models.CharField(max_length=12, choices=Tier.choices)
    duration_months = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    monthly_price_rial = models.PositiveIntegerField()
    discount_percent = models.PositiveSmallIntegerField(
        default=0, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    is_available = models.BooleanField(default=True)
    label = models.CharField(max_length=120, null=True, blank=True)
    campaign_starts_at = models.DateTimeField(null=True, blank=True)
    campaign_ends_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [("tier", "duration_months", "label")]

    @property
    def final_price_rial(self) -> int:
        return round(
            self.monthly_price_rial * self.duration_months * (1 - self.discount_percent / 100)
        )


class Payment(TimeStampedModel):
    class Provider(models.TextChoices):
        MOCK = "mock", "Mock"
        ZARINPAL = "zarinpal", "Zarinpal"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    user = models.ForeignKey(User, related_name="payments", on_delete=models.PROTECT)
    plan = models.ForeignKey(SubscriptionPlan, null=True, blank=True, on_delete=models.SET_NULL)
    tier = models.CharField(max_length=12)
    duration_months = models.PositiveSmallIntegerField()
    monthly_price_rial = models.PositiveIntegerField()
    discount_percent = models.PositiveSmallIntegerField()
    final_price_rial = models.PositiveIntegerField()
    provider = models.CharField(max_length=20, choices=Provider.choices, default=Provider.MOCK)
    provider_reference = models.CharField(max_length=140, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)


class Subscription(TimeStampedModel):
    class Tier(models.TextChoices):
        BASIC = "basic", "Basic"
        SILVER = "silver", "Silver"
        GOLD = "gold", "Gold"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        EXPIRED = "expired", "Expired"
        SUPERSEDED = "superseded", "Superseded"
        CANCELLED = "cancelled", "Cancelled"

    user = models.ForeignKey(User, related_name="subscriptions", on_delete=models.CASCADE)
    tier = models.CharField(max_length=12, choices=Tier.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    starts_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    source_payment = models.ForeignKey(
        Payment, null=True, blank=True, related_name="subscriptions", on_delete=models.SET_NULL
    )

    class Meta:
        indexes = [models.Index(fields=["user", "status"])]

    @property
    def can_upgrade_to_gold(self) -> bool:
        return self.tier != self.Tier.GOLD

    @classmethod
    def basic_for(cls, user: User) -> "Subscription":
        return cls.objects.create(
            user=user, tier=cls.Tier.BASIC, status=cls.Status.ACTIVE, starts_at=timezone.now()
        )


class ArtistRewardStatement(TimeStampedModel):
    artist = models.ForeignKey(
        "accounts.ArtistProfile", related_name="reward_statements", on_delete=models.CASCADE
    )
    period = models.CharField(max_length=7)
    unique_listeners = models.PositiveIntegerField(default=0)
    valid_streams = models.PositiveIntegerField(default=0)
    amount_rial = models.PositiveIntegerField(default=0)


class Payout(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SETTLED = "settled", "Settled"

    artist = models.ForeignKey(
        "accounts.ArtistProfile", related_name="payouts", on_delete=models.PROTECT
    )
    amount_rial = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    period = models.CharField(max_length=7)
    settled_at = models.DateTimeField(null=True, blank=True)
