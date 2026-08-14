from __future__ import annotations

from typing import Any

from django.http import HttpRequest

from rest_framework import serializers as drf_serializers
from rest_framework.request import Request
from rest_framework.views import APIView


def page(results: list[Any]) -> dict[str, Any]:
    return {"count": len(results), "next": None, "previous": None, "results": results}


def request_id(request: Request | HttpRequest) -> str:
    return getattr(request, "request_id", "")


class EmptySerializer(drf_serializers.Serializer):
    pass


class SonoraAPIView(APIView):
    serializer_class = EmptySerializer
