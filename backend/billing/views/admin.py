from __future__ import annotations

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from billing.models import (
    Payout,
    SubscriptionPlan,
)
from billing.serializers import PlanSerializer
from billing.services.accounting import (
    admin_report_payload,
    sync_artist_ledger,
)
from core.services.access import ensure_admin
from core.views import (
    SonoraAPIView,
    page,
    request_id,
)
from notifications.models import Notification
from notifications.services import create_audit, create_notification


class AdminPlansView(SonoraAPIView):
    serializer_class = PlanSerializer

    def get(self, request: Request) -> Response:
        ensure_admin(request.user)
        return Response(page(PlanSerializer(list(SubscriptionPlan.objects.all()), many=True).data))

    def post(self, request: Request) -> Response:
        ensure_admin(request.user)
        plan = SubscriptionPlan.objects.create(
            tier=request.data["tier"],
            duration_months=request.data["durationMonths"],
            monthly_price_rial=request.data["monthlyPriceRial"],
            discount_percent=request.data.get("discountPercent", 0),
            is_available=request.data.get("isAvailable", True),
            label=request.data.get("label"),
        )
        create_audit(
            request.user,
            "plan.created",
            plan.id,
            None,
            PlanSerializer(plan).data,
            request_id(request),
        )
        return Response(PlanSerializer(plan).data, status=status.HTTP_201_CREATED)

    def patch(self, request: Request) -> Response:
        ensure_admin(request.user)
        plan = get_object_or_404(SubscriptionPlan, pk=request.data.get("id"))
        before = PlanSerializer(plan).data
        for incoming, field in {
            "monthlyPriceRial": "monthly_price_rial",
            "discountPercent": "discount_percent",
            "isAvailable": "is_available",
            "label": "label",
        }.items():
            if incoming in request.data:
                setattr(plan, field, request.data[incoming])
        plan.save()
        create_audit(
            request.user,
            "plan.updated",
            plan.id,
            before,
            PlanSerializer(plan).data,
            request_id(request),
        )
        return Response(PlanSerializer(plan).data)


class AdminReportsView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        ensure_admin(request.user)
        sync_artist_ledger()
        return Response(admin_report_payload())


class AdminPayoutsView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        ensure_admin(request.user)
        return Response(page(sync_artist_ledger()))


class PayoutSettleView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        ensure_admin(request.user)
        payout = get_object_or_404(Payout, pk=pk)
        before = {"status": payout.status}
        payout.status = Payout.Status.SETTLED
        payout.settled_at = timezone.now()
        payout.save(update_fields=["status", "settled_at", "updated_at"])
        create_audit(
            request.user,
            "payout.settled",
            payout.id,
            before,
            {"status": payout.status},
            request_id(request),
        )
        artist_user = payout.artist.user
        create_notification(
            artist_user,
            "Monthly payout settled",
            f"Your reward for {payout.period} was marked settled.",
            Notification.Kind.IMPORTANT,
            "noticePayoutSettledTitle",
            "noticePayoutSettledBody",
            {
                "period": payout.period,
                "amount": payout.amount_rial,
                "link": "/studio",
            },
        )
        return Response(page(sync_artist_ledger()))
