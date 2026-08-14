from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from django.conf import settings

from core.exceptions import SonoraError


def zarinpal_origin() -> str:
    if settings.SONORA_ZARINPAL_SANDBOX:
        return "https://sandbox.zarinpal.com"
    return "https://payment.zarinpal.com"


def zarinpal_start_pay_url(authority: str) -> str:
    return f"{zarinpal_origin()}/pg/StartPay/{authority}"


def _post_json(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{zarinpal_origin()}{path}"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8") if exc.fp else ""
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError as decode_exc:
            raise SonoraError(
                "payment_gateway_error",
                "Zarinpal gateway returned an unexpected error.",
                details={"status": exc.code},
            ) from decode_exc
        errors = parsed.get("errors") or parsed
        raise SonoraError(
            "payment_gateway_error",
            "Zarinpal rejected the payment request.",
            details=errors if isinstance(errors, dict) else {"errors": errors},
        ) from exc
    except urllib.error.URLError as exc:
        raise SonoraError(
            "payment_gateway_unreachable",
            "Could not reach Zarinpal payment gateway.",
            details={"reason": str(exc.reason)},
        ) from exc
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SonoraError(
            "payment_gateway_error",
            "Zarinpal gateway returned invalid JSON.",
        ) from exc


def request_authority(
    *,
    amount_rial: int,
    description: str,
    callback_url: str,
    email: str | None = None,
    mobile: str | None = None,
) -> str:
    merchant_id = settings.SONORA_ZARINPAL_MERCHANT_ID.strip()
    if not merchant_id:
        raise SonoraError(
            "payment_not_configured",
            "Zarinpal merchant id is not configured.",
        )
    metadata: dict[str, str] = {}
    if email:
        metadata["email"] = email
    if mobile:
        metadata["mobile"] = mobile
    payload: dict[str, Any] = {
        "merchant_id": merchant_id,
        "amount": int(amount_rial),
        "currency": "IRR",
        "description": description,
        "callback_url": callback_url,
    }
    if metadata:
        payload["metadata"] = metadata
    response = _post_json("/pg/v4/payment/request.json", payload)
    data = response.get("data") or {}
    errors = response.get("errors")
    code = data.get("code")
    authority = data.get("authority")
    if code != 100 or not authority:
        raise SonoraError(
            "payment_gateway_error",
            "Zarinpal did not issue a payment authority.",
            details={"code": code, "errors": errors, "data": data},
        )
    return str(authority)


def verify_authority(*, authority: str, amount_rial: int) -> dict[str, Any]:
    merchant_id = settings.SONORA_ZARINPAL_MERCHANT_ID.strip()
    response = _post_json(
        "/pg/v4/payment/verify.json",
        {
            "merchant_id": merchant_id,
            "amount": int(amount_rial),
            "authority": authority,
        },
    )
    data = response.get("data") or {}
    code = data.get("code")
    if code not in {100, 101}:
        raise SonoraError(
            "payment_verify_failed",
            "Zarinpal could not verify this payment.",
            details={"code": code, "errors": response.get("errors"), "data": data},
        )
    return data
