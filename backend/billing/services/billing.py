from __future__ import annotations

import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction

from accounts.models import User
from billing.models import (
    Payment,
    Subscription,
    SubscriptionPlan,
)
from billing.services.zarinpal import request_authority, zarinpal_start_pay_url
from core.exceptions import SonoraError
from core.services.access import active_subscription
from core.services.common import now_utc
from notifications.models import Notification
from notifications.services import create_notification


def create_or_replace_subscription(user: User, payment: Payment) -> Subscription:
    active = active_subscription(user)
    if active.tier == payment.tier and active.status == Subscription.Status.ACTIVE:
        raise SonoraError(
            "same_tier_active", "An active subscription cannot be extended or stacked."
        )
    if (
        active.tier == Subscription.Tier.GOLD
        and payment.tier == Subscription.Tier.SILVER
        and active.expires_at
        and active.expires_at > now_utc()
    ):
        raise SonoraError(
            "downgrade_blocked", "Silver becomes available after your Gold plan expires."
        )
    if active.status == Subscription.Status.ACTIVE:
        active.status = Subscription.Status.SUPERSEDED
        active.save(update_fields=["status", "updated_at"])
    starts = now_utc()
    expires = starts + timedelta(days=30 * payment.duration_months)
    return Subscription.objects.create(
        user=user,
        tier=payment.tier,
        status=Subscription.Status.ACTIVE,
        starts_at=starts,
        expires_at=expires,
        source_payment=payment,
    )


def payment_provider() -> str:
    if settings.SONORA_ZARINPAL_ENABLED:
        return Payment.Provider.ZARINPAL
    return Payment.Provider.MOCK


def payment_url_for(payment: Payment) -> str | None:
    if (
        payment.provider == Payment.Provider.ZARINPAL
        and payment.status == Payment.Status.PENDING
        and payment.provider_reference
    ):
        return zarinpal_start_pay_url(payment.provider_reference)
    return None


def activate_paid_subscription(payment: Payment) -> Subscription:
    if payment.status != Payment.Status.SUCCEEDED:
        raise SonoraError(
            "payment_not_succeeded",
            "Subscription activates only after a successful payment.",
        )
    subscription = create_or_replace_subscription(payment.user, payment)
    create_notification(
        payment.user,
        f"{payment.tier.title()} activated",
        "Your subscription payment was confirmed.",
        Notification.Kind.CRITICAL,
        "noticePaymentTitle",
        "noticePaymentBody",
        {"tier": payment.tier.title()},
    )
    return subscription


@transaction.atomic
def purchase_plan(
    user: User,
    plan: SubscriptionPlan,
    provider: str | None = None,
    *,
    callback_url: str | None = None,
) -> Payment:
    provider = provider or payment_provider()
    final_price = plan.final_price_rial
    active = active_subscription(user)
    if active.tier == plan.tier and active.status == Subscription.Status.ACTIVE:
        raise SonoraError(
            "same_tier_active", "An active subscription cannot be extended or stacked."
        )
    if (
        active.tier == Subscription.Tier.GOLD
        and plan.tier == Subscription.Tier.SILVER
        and active.expires_at
        and active.expires_at > now_utc()
    ):
        raise SonoraError(
            "downgrade_blocked", "Silver becomes available after your Gold plan expires."
        )
    payment = Payment.objects.create(
        user=user,
        plan=plan,
        tier=plan.tier,
        duration_months=plan.duration_months,
        monthly_price_rial=plan.monthly_price_rial,
        discount_percent=plan.discount_percent,
        final_price_rial=final_price,
        provider=provider,
        provider_reference=f"demo-{secrets.token_urlsafe(8)}",
        status=Payment.Status.SUCCEEDED
        if provider == Payment.Provider.MOCK
        else Payment.Status.PENDING,
    )
    if payment.status == Payment.Status.SUCCEEDED:
        create_or_replace_subscription(user, payment)
        create_notification(
            user,
            f"{plan.tier.title()} activated",
            "Backend mock payment completed. No real payment was charged.",
            Notification.Kind.CRITICAL,
            "noticePaymentTitle",
            "noticePaymentBody",
            {"tier": plan.tier.title()},
        )
        return payment

    if provider != Payment.Provider.ZARINPAL:
        return payment

    if not callback_url:
        raise SonoraError(
            "payment_not_configured",
            "Payment callback URL is required for Zarinpal.",
        )
    try:
        authority = request_authority(
            amount_rial=final_price,
            description=f"Sonora {plan.tier} · {plan.duration_months} month(s)",
            callback_url=callback_url,
            email=user.email,
        )
    except SonoraError:
        payment.status = Payment.Status.FAILED
        payment.save(update_fields=["status", "updated_at"])
        raise
    payment.provider_reference = authority
    payment.save(update_fields=["provider_reference", "updated_at"])
    return payment


def zarinpal_callback_url(request) -> str:  # type: ignore[no-untyped-def]
    """Absolute callback URL from env; must be set by the operator."""
    return settings.SONORA_ZARINPAL_CALLBACK_URL.strip()


def reward_amount_rial(unique_listeners: int, valid_streams: int) -> int:
    toman = round(((unique_listeners * 150) + (valid_streams * 25)) / 1000) * 1000
    return toman * 10
