from __future__ import annotations

from django.db import models

from accounts.models import User
from core.models import TimeStampedModel


class Ticket(TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ANSWERED = "answered", "Answered"
        CLOSED = "closed", "Closed"

    creator = models.ForeignKey(User, related_name="tickets", on_delete=models.CASCADE)
    subject = models.CharField(max_length=180)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    claimed_by = models.ForeignKey(
        User, null=True, blank=True, related_name="claimed_tickets", on_delete=models.SET_NULL
    )


class TicketMessage(TimeStampedModel):
    ticket = models.ForeignKey(Ticket, related_name="messages", on_delete=models.CASCADE)
    author = models.ForeignKey(User, related_name="ticket_messages", on_delete=models.PROTECT)
    body = models.TextField()


class TicketAttachment(TimeStampedModel):
    ticket = models.ForeignKey(Ticket, related_name="attachments", on_delete=models.CASCADE)
    uploaded_by = models.ForeignKey(User, on_delete=models.PROTECT)
    file = models.FileField(upload_to="ticket_attachments/")
    content_type = models.CharField(max_length=120)


class AuditEvent(TimeStampedModel):
    actor = models.ForeignKey(
        User, null=True, blank=True, related_name="audit_events", on_delete=models.SET_NULL
    )
    action = models.CharField(max_length=120)
    target = models.CharField(max_length=180)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    request_id = models.CharField(max_length=80)

    class Meta:
        ordering = ["-created_at"]
