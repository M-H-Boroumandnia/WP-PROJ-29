from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework.request import Request
from rest_framework.response import Response

from accounts.models import ArtistVerificationRequest
from notifications.models import Notification
from support.serializers import VerificationRequestSerializer
from core.services.access import ensure_staff
from notifications.services import (
    create_audit,
    create_notification,
)
from core.views import (
    SonoraAPIView,
    page,
    request_id,
)


class SupportVerificationView(SonoraAPIView):
    serializer_class = VerificationRequestSerializer

    def get(self, request: Request) -> Response:
        ensure_staff(request.user)
        return Response(
            page(
                VerificationRequestSerializer(
                    list(
                        ArtistVerificationRequest.objects.select_related(
                            "artist__user"
                        ).order_by("-created_at")
                    ),
                    many=True,
                ).data
            )
        )


class VerificationDecisionView(SonoraAPIView):
    serializer_class = VerificationRequestSerializer

    @transaction.atomic
    def post(self, request: Request, pk: str, approved: bool) -> Response:
        ensure_staff(request.user)
        req = get_object_or_404(
            ArtistVerificationRequest, pk=pk, status=ArtistVerificationRequest.Status.PENDING
        )
        before = {"status": req.status}
        req.status = (
            ArtistVerificationRequest.Status.APPROVED
            if approved
            else ArtistVerificationRequest.Status.REJECTED
        )
        req.reason = request.data.get("reason", "")
        req.reviewer = request.user
        req.decided_at = timezone.now()
        req.save()
        if approved:
            req.artist.verified_at = req.decided_at
            req.artist.save(update_fields=["verified_at", "updated_at"])
        create_audit(
            request.user,
            f"verification.{req.status}",
            req.id,
            before,
            {"status": req.status, "reason": req.reason},
            request_id(request),
        )
        reason = (req.reason or "").strip()
        if approved:
            create_notification(
                req.artist.user,
                "Verification approved",
                "Your artist account is verified. You can publish releases in Studio.",
                Notification.Kind.CRITICAL,
                "noticeVerificationApprovedTitle",
                "noticeVerificationApprovedBody",
                {"reason": reason, "link": "/studio"},
            )
        else:
            create_notification(
                req.artist.user,
                "Verification rejected",
                reason or "Your verification request was rejected.",
                Notification.Kind.CRITICAL,
                "noticeVerificationRejectedTitle",
                "noticeVerificationRejectedBody",
                {"reason": reason or "No reason provided.", "link": "/studio"},
            )
        return Response(VerificationRequestSerializer(req).data)
