from __future__ import annotations

from django.urls import path

from billing import views

urlpatterns = [
    path("subscription/plans/", views.PlansView.as_view(), name="plans"),
    path("subscription/", views.SubscriptionView.as_view(), name="subscription"),
    path("subscription/purchases/", views.PurchaseView.as_view(), name="purchase"),
    path(
        "subscription/payment-config/",
        views.PaymentConfigView.as_view(),
        name="payment-config",
    ),
    path("payments/", views.PaymentsView.as_view(), name="payments"),
    path(
        "payments/<str:provider>/callback/",
        views.PaymentCallbackView.as_view(),
        name="payment-callback",
    ),
    path("admin/subscription-plans/", views.AdminPlansView.as_view(), name="admin-plans"),
    path("admin/reports/overview/", views.AdminReportsView.as_view(), name="admin-reports"),
    path("admin/payouts/", views.AdminPayoutsView.as_view(), name="admin-payouts"),
    path("admin/payouts/<uuid:pk>/settle/", views.PayoutSettleView.as_view(), name="payout-settle"),
]
