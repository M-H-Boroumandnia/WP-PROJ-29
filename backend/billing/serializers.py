from __future__ import annotations

from rest_framework import serializers

from billing.models import (
    Payment,
    SubscriptionPlan,
)


class PlanSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    durationMonths = serializers.IntegerField(source="duration_months")
    monthlyPriceRial = serializers.IntegerField(source="monthly_price_rial")
    discountPercent = serializers.IntegerField(source="discount_percent")
    finalPriceRial = serializers.IntegerField(source="final_price_rial")
    isAvailable = serializers.BooleanField(source="is_available")
    startsAt = serializers.DateTimeField(source="campaign_starts_at", allow_null=True)
    endsAt = serializers.DateTimeField(source="campaign_ends_at", allow_null=True)

    class Meta:
        model = SubscriptionPlan
        fields = [
            "id",
            "tier",
            "durationMonths",
            "monthlyPriceRial",
            "discountPercent",
            "finalPriceRial",
            "isAvailable",
            "label",
            "startsAt",
            "endsAt",
        ]


class PaymentSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    userId = serializers.CharField(source="user_id")
    planId = serializers.CharField(source="plan_id", allow_null=True)
    durationMonths = serializers.IntegerField(source="duration_months")
    monthlyPriceRial = serializers.IntegerField(source="monthly_price_rial")
    discountPercent = serializers.IntegerField(source="discount_percent")
    finalPriceRial = serializers.IntegerField(source="final_price_rial")
    createdAt = serializers.DateTimeField(source="created_at")
    paymentUrl = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id",
            "userId",
            "planId",
            "tier",
            "durationMonths",
            "monthlyPriceRial",
            "discountPercent",
            "finalPriceRial",
            "provider",
            "status",
            "createdAt",
            "paymentUrl",
        ]

    def get_paymentUrl(self, obj: Payment) -> str | None:
        from billing.services.billing import payment_url_for

        return payment_url_for(obj)
