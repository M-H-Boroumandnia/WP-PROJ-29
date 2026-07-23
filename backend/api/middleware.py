from __future__ import annotations

import uuid
from collections.abc import Callable

from django.http import HttpRequest, HttpResponse


class RequestIdMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        request.request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))  # type: ignore[attr-defined]
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id  # type: ignore[attr-defined]
        return response
