from __future__ import annotations

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    ArtistProfile,
    ArtistRewardStatement,
    ArtistVerificationRequest,
    AuditEvent,
    Follow,
    Like,
    ListeningRoom,
    Notification,
    Payment,
    PlaybackSession,
    Payout,
    Playlist,
    PlaylistItem,
    RecentlyPlayed,
    Release,
    RoomParticipant,
    RoomQueueItem,
    SavedPlaylist,
    StreamEvent,
    Subscription,
    SubscriptionPlan,
    Ticket,
    TicketAttachment,
    TicketMessage,
    Track,
    TrackArtistCredit,
    User,
)


@admin.register(User)
class SonoraUserAdmin(UserAdmin):
    model = User
    ordering = ("email",)
    list_display = ("email", "username", "display_name", "kind", "locale", "deleted_at")
    fieldsets = UserAdmin.fieldsets + (
        ("Sonora", {"fields": ("kind", "display_name", "birth_date", "gender", "avatar_original", "avatar_256", "avatar_64", "avatar_url_external", "locale", "timezone", "theme", "explicit_content_enabled", "notification_preference", "username_changed_at", "deleted_at")}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Sonora", {"fields": ("email", "display_name", "birth_date", "kind")}),
    )


for model in [
    ArtistProfile,
    ArtistVerificationRequest,
    SubscriptionPlan,
    Payment,
    Subscription,
    Release,
    Track,
    TrackArtistCredit,
    Follow,
    Playlist,
    PlaylistItem,
    SavedPlaylist,
    Like,
    RecentlyPlayed,
    PlaybackSession,
    StreamEvent,
    Notification,
    Ticket,
    TicketMessage,
    TicketAttachment,
    AuditEvent,
    ArtistRewardStatement,
    Payout,
    ListeningRoom,
    RoomParticipant,
    RoomQueueItem,
]:
    admin.site.register(model)
