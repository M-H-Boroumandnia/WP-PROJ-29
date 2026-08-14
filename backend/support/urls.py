from __future__ import annotations

from django.urls import path

from support import views

urlpatterns = [
    path("tickets/", views.TicketsView.as_view(), name="tickets"),
    path("tickets/<uuid:pk>/", views.TicketDetailView.as_view(), name="ticket-detail"),
    path("tickets/<uuid:pk>/messages/", views.TicketMessageView.as_view(), name="ticket-messages"),
    path("tickets/<uuid:pk>/close/", views.TicketCloseView.as_view(), name="ticket-close"),
    path(
        "support/verification-requests/",
        views.SupportVerificationView.as_view(),
        name="support-verification",
    ),
    path(
        "support/verification-requests/<uuid:pk>/approve/",
        views.VerificationDecisionView.as_view(),
        {"approved": True},
        name="verification-approve",
    ),
    path(
        "support/verification-requests/<uuid:pk>/reject/",
        views.VerificationDecisionView.as_view(),
        {"approved": False},
        name="verification-reject",
    ),
    path("admin/audit-events/", views.AdminAuditView.as_view(), name="admin-audit"),
]
