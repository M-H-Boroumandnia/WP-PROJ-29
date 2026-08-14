from __future__ import annotations

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts import views

urlpatterns = [
    path("auth/register/", views.RegisterView.as_view(), name="register"),
    path(
        "auth/register/artist/",
        views.RegisterView.as_view(),
        {"artist": True},
        name="register-artist",
    ),
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("auth/logout/", views.LogoutView.as_view(), name="logout"),
    path("auth/token/refresh/", views.RefreshView.as_view(), name="token-refresh"),
    path("auth/jwt/refresh/", TokenRefreshView.as_view(), name="jwt-refresh"),
    path(
        "auth/password-reset/request/",
        views.PasswordResetRequestView.as_view(),
        name="password-reset-request",
    ),
    path(
        "auth/password-reset/confirm/",
        views.PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("me/", views.MeView.as_view(), name="me"),
    path("me/preferences/", views.MePreferencesView.as_view(), name="me-preferences"),
    path("me/delete/", views.DeleteMeView.as_view(), name="me-delete"),
    path("me/library/", views.LibraryView.as_view(), name="library"),
    path("me/queue/", views.MeQueueView.as_view(), name="me-queue"),
    path("profiles/<str:username>/", views.ProfileView.as_view(), name="profile"),
    path("profiles/<str:username>/follow/", views.FollowView.as_view(), name="profile-follow"),
    path("artists/<str:username>/", views.ProfileView.as_view(), name="artist-profile"),
    path("people/", views.PeopleDirectoryView.as_view(), name="people"),
]
