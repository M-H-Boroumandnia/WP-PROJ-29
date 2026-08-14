from __future__ import annotations

from django.contrib import admin

from billing.models import ArtistRewardStatement, Payment, Payout, Subscription, SubscriptionPlan

for model in [SubscriptionPlan, Payment, Subscription, ArtistRewardStatement, Payout]:
    admin.site.register(model)
