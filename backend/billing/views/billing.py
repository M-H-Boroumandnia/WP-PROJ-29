from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils.http import urlencode

from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.serializers import ActiveSubscriptionSerializer
from billing.models import (
    Payment,
    SubscriptionPlan,
)
from billing.serializers import (
    PaymentSerializer,
    PlanSerializer,
)
from billing.services.billing import (
    activate_paid_subscription,
    payment_provider,
    purchase_plan,
    zarinpal_callback_url,
)
from billing.services.zarinpal import verify_authority
from core.exceptions import SonoraError
from core.services.access import active_subscription
from core.views import (
    SonoraAPIView,
    page,
)


def _frontend_payment_redirect(result: str, **extra: str) -> HttpResponseRedirect:
    query = urlencode({"payment": result, **extra})
    return HttpResponseRedirect(f"{settings.SONORA_FRONTEND_URL.rstrip('/')}/settings?{query}")


class PlansView(SonoraAPIView):
    serializer_class = PlanSerializer

    def get(self, request: Request) -> Response:
        return Response(
            page(
                PlanSerializer(
                    list(SubscriptionPlan.objects.all().order_by("tier", "duration_months")),
                    many=True,
                ).data
            )
        )


class SubscriptionView(SonoraAPIView):
    serializer_class = ActiveSubscriptionSerializer

    def get(self, request: Request) -> Response:
        return Response(ActiveSubscriptionSerializer(active_subscription(request.user)).data)


class PaymentConfigView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request: Request) -> Response:
        return Response(
            {
                "zarinpalEnabled": settings.SONORA_ZARINPAL_ENABLED,
                "sandbox": settings.SONORA_ZARINPAL_SANDBOX,
                "provider": payment_provider(),
            }
        )


class PurchaseView(SonoraAPIView):
    serializer_class = PaymentSerializer

    def post(self, request: Request) -> Response:
        plan = get_object_or_404(SubscriptionPlan, pk=request.data.get("planId"), is_available=True)
        payment = purchase_plan(
            request.user,
            plan,
            payment_provider(),
            callback_url=zarinpal_callback_url(request),
        )
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class PaymentsView(SonoraAPIView):
    serializer_class = PaymentSerializer

    def get(self, request: Request) -> Response:
        return Response(
            page(
                PaymentSerializer(
                    list(request.user.payments.all().order_by("-created_at")), many=True
                ).data
            )
        )


class PaymentCallbackView(SonoraAPIView):
    """Zarinpal returns here first; we verify, then redirect to the frontend."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request: Request, provider: str) -> HttpResponseRedirect:
        if provider != "zarinpal":
            return _frontend_payment_redirect("failed", reason="unknown_provider")
        authority = str(request.query_params.get("Authority") or "").strip()
        gateway_status = str(request.query_params.get("Status") or "").strip().upper()
        if not authority:
            return _frontend_payment_redirect("failed", reason="missing_authority")

        with transaction.atomic():
            payment = (
                Payment.objects.select_for_update()
                .filter(
                    provider=Payment.Provider.ZARINPAL,
                    provider_reference=authority,
                )
                .select_related("user", "plan")
                .first()
            )
            if payment is None:
                return _frontend_payment_redirect("failed", reason="payment_not_found")
            if payment.status == Payment.Status.SUCCEEDED:
                return _frontend_payment_redirect("success", paymentId=str(payment.id))
            if payment.status == Payment.Status.FAILED:
                return _frontend_payment_redirect(
                    "failed", paymentId=str(payment.id), reason="already_failed"
                )

            # Pending only from here — cancel / verify failure never upgrades the plan.
            if gateway_status != "OK":
                payment.status = Payment.Status.FAILED
                payment.save(update_fields=["status", "updated_at"])
                return _frontend_payment_redirect(
                    "failed", paymentId=str(payment.id), reason="cancelled"
                )
            try:
                verify_authority(authority=authority, amount_rial=payment.final_price_rial)
            except SonoraError:
                payment.status = Payment.Status.FAILED
                payment.save(update_fields=["status", "updated_at"])
                return _frontend_payment_redirect(
                    "failed", paymentId=str(payment.id), reason="verify"
                )
            payment.status = Payment.Status.SUCCEEDED
            payment.save(update_fields=["status", "updated_at"])
            activate_paid_subscription(payment)
            return _frontend_payment_redirect("success", paymentId=str(payment.id))

    def post(self, request: Request, provider: str) -> Response:
        # Keep POST for API clients; browser returns use GET.
        redirect = self.get(request, provider)
        return Response(
            {
                "ok": True,
                "provider": provider,
                "redirect": redirect.url,
            }
        )
