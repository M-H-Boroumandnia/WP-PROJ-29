from __future__ import annotations

from rest_framework.request import Request
from rest_framework.response import Response

from core.services.access import ensure_admin
from core.views import SonoraAPIView, page
from support.models import AuditEvent
from support.serializers import AuditEventSerializer


class AdminAuditView(SonoraAPIView):
    serializer_class = AuditEventSerializer

    def get(self, request: Request) -> Response:
        ensure_admin(request.user)
        return Response(
            page(AuditEventSerializer(list(AuditEvent.objects.all()[:200]), many=True).data)
        )
