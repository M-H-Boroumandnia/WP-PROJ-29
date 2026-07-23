from __future__ import annotations

from rest_framework.throttling import UserRateThrottle


class LoginThrottle(UserRateThrottle):
    scope = "login"

    def allow_request(self, request, view) -> bool:  # type: ignore[no-untyped-def]
        return view.__class__.__name__ in {"LoginView", "PasswordResetRequestView", "PasswordResetConfirmView"} and super().allow_request(request, view) or view.__class__.__name__ not in {"LoginView", "PasswordResetRequestView", "PasswordResetConfirmView"}


class UploadThrottle(UserRateThrottle):
    scope = "upload"

    def allow_request(self, request, view) -> bool:  # type: ignore[no-untyped-def]
        if request.method in {"POST", "PATCH"} and any(key in request.FILES for key in ("avatar", "cover", "audio", "file")):
            return super().allow_request(request, view)
        return True


class TelemetryThrottle(UserRateThrottle):
    scope = "telemetry"

    def allow_request(self, request, view) -> bool:  # type: ignore[no-untyped-def]
        return view.__class__.__name__ == "PlaybackProgressView" and super().allow_request(request, view) or view.__class__.__name__ != "PlaybackProgressView"


class SensitiveActionThrottle(UserRateThrottle):
    scope = "sensitive"

    def allow_request(self, request, view) -> bool:  # type: ignore[no-untyped-def]
        sensitive = {"PurchaseView", "VerificationDecisionView", "TicketCloseView", "PlanAdminView", "PayoutSettleView", "ArchiveReleaseView"}
        return view.__class__.__name__ in sensitive and super().allow_request(request, view) or view.__class__.__name__ not in sensitive
