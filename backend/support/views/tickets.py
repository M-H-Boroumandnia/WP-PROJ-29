from __future__ import annotations

from django.db.models import Prefetch
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from core.exceptions import SonoraError
from accounts.models import User
from notifications.models import Notification
from support.models import (
    Ticket,
    TicketMessage,
)
from support.serializers import TicketSerializer
from core.services.access import can_open_ticket
from notifications.services import notify_staff
from core.views import (
    SonoraAPIView,
    page,
)


def tickets_queryset(user: User):
    base = (
        Ticket.objects.all()
        if user.kind in {User.Kind.SUPPORT, User.Kind.ADMIN}
        else Ticket.objects.filter(creator=user)
    )
    return base.prefetch_related(
        Prefetch("messages", queryset=TicketMessage.objects.order_by("created_at"))
    ).order_by("-created_at")


def tickets_payload(user: User) -> dict:
    return page(TicketSerializer(list(tickets_queryset(user)), many=True).data)


def _notify_staff_about_ticket(
    *,
    creator: User,
    subject: str,
    body: str,
    title: str,
    title_key: str,
    body_key: str,
) -> None:
    preview = (body or "").strip()
    if len(preview) > 160:
        preview = f"{preview[:157]}..."
    notify_staff(
        title,
        f"{creator.display_name}: {subject}",
        kind=Notification.Kind.IMPORTANT,
        title_key=title_key,
        body_key=body_key,
        values={
            "name": creator.display_name,
            "subject": subject,
            "preview": preview,
        },
    )


class TicketsView(SonoraAPIView):
    serializer_class = TicketSerializer

    def get(self, request: Request) -> Response:
        return Response(tickets_payload(request.user))

    def post(self, request: Request) -> Response:
        if not can_open_ticket(request.user):
            raise SonoraError(
                "ticket_entitlement",
                "Silver, Gold, or verified artist access is required.",
                status.HTTP_403_FORBIDDEN,
            )
        subject = request.data.get("subject", "Support request")[:180]
        body = request.data.get("body", "")
        ticket = Ticket.objects.create(creator=request.user, subject=subject)
        TicketMessage.objects.create(ticket=ticket, author=request.user, body=body)
        _notify_staff_about_ticket(
            creator=request.user,
            subject=subject,
            body=body,
            title="New support ticket",
            title_key="noticeTicketCreatedTitle",
            body_key="noticeTicketCreatedBody",
        )
        return Response(tickets_payload(request.user), status=status.HTTP_201_CREATED)


class TicketDetailView(SonoraAPIView):
    serializer_class = TicketSerializer

    def get_ticket(self, request: Request, pk: str) -> Ticket:
        ticket = get_object_or_404(Ticket, pk=pk)
        if request.user.kind == User.Kind.CONSUMER and ticket.creator_id != request.user.id:
            raise SonoraError(
                "forbidden", "You cannot access this ticket.", status.HTTP_403_FORBIDDEN
            )
        return ticket

    def get(self, request: Request, pk: str) -> Response:
        ticket = self.get_ticket(request, pk)
        full = tickets_queryset(request.user).filter(pk=ticket.pk).first()
        return Response(TicketSerializer(full).data)


class TicketMessageView(TicketDetailView):
    def post(self, request: Request, pk: str) -> Response:
        ticket = self.get_ticket(request, pk)
        body = request.data.get("body", "")
        TicketMessage.objects.create(ticket=ticket, author=request.user, body=body)
        if request.user.kind != User.Kind.CONSUMER:
            ticket.status = Ticket.Status.ANSWERED
            ticket.save(update_fields=["status", "updated_at"])
        else:
            _notify_staff_about_ticket(
                creator=request.user,
                subject=ticket.subject,
                body=body,
                title="Ticket reply",
                title_key="noticeTicketReplyTitle",
                body_key="noticeTicketReplyBody",
            )
        return Response(tickets_payload(request.user))


class TicketCloseView(TicketDetailView):
    def post(self, request: Request, pk: str) -> Response:
        ticket = self.get_ticket(request, pk)
        ticket.status = Ticket.Status.CLOSED
        ticket.save(update_fields=["status", "updated_at"])
        return Response(tickets_payload(request.user))
