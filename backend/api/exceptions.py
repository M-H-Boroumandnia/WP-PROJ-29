from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.exceptions import ErrorDetail, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class SonoraError(Exception):
    def __init__(self, code: str, message: str, http_status: int = status.HTTP_400_BAD_REQUEST, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.details = details or {}


def error_response(code: str, message: str, http_status: int = status.HTTP_400_BAD_REQUEST, details: dict[str, Any] | None = None, request_id: str | None = None) -> Response:
    return Response(
        {"error": {"code": code, "message": message, "details": details or {}}, "request_id": request_id},
        status=http_status,
    )


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    request = context.get("request")
    request_id = getattr(request, "request_id", None)
    if isinstance(exc, SonoraError):
        return error_response(exc.code, exc.message, exc.http_status, exc.details, request_id)
    if isinstance(exc, ValidationError):
        def normalize(value: Any) -> Any:
            if isinstance(value, ErrorDetail):
                return {"message": str(value), "code": str(value.code)}
            if isinstance(value, list):
                return [normalize(item) for item in value]
            if isinstance(value, dict):
                return {str(key): normalize(item) for key, item in value.items()}
            return value

        details = normalize(exc.detail)
        first_code = "validation_error"
        first_message = "Please check the highlighted fields."
        if isinstance(details, dict):
            for field_errors in details.values():
                items = field_errors if isinstance(field_errors, list) else [field_errors]
                if items and isinstance(items[0], dict):
                    first_code = str(items[0].get("code") or first_code)
                    first_message = str(items[0].get("message") or first_message)
                    break
        return error_response(first_code, first_message, status.HTTP_400_BAD_REQUEST, details, request_id)
    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    code = getattr(exc, "default_code", "invalid")
    message = response.data.get("detail", response.data) if isinstance(response.data, dict) else response.data
    response.data = {"error": {"code": str(code), "message": str(message), "details": response.data}, "request_id": request_id}
    return response
