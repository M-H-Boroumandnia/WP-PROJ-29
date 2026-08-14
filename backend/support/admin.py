from __future__ import annotations

from django.contrib import admin

from support.models import AuditEvent, Ticket, TicketAttachment, TicketMessage

for model in [Ticket, TicketMessage, TicketAttachment, AuditEvent]:
    admin.site.register(model)
