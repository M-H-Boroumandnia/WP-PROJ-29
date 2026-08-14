from __future__ import annotations

from django.db import models

from catalog.models import Track
from core.models import TimeStampedModel
from accounts.models import User


class Playlist(TimeStampedModel):
    class Visibility(models.TextChoices):
        PRIVATE = "private", "Private"
        PUBLIC = "public", "Public"

    owner = models.ForeignKey(User, related_name="playlists", on_delete=models.CASCADE)
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    visibility = models.CharField(
        max_length=12, choices=Visibility.choices, default=Visibility.PRIVATE
    )
    cover = models.ImageField(upload_to="playlist_covers/", null=True, blank=True)
    generated_cover = models.BooleanField(default=True)


class PlaylistItem(TimeStampedModel):
    playlist = models.ForeignKey(Playlist, related_name="items", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, on_delete=models.PROTECT)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]
        unique_together = [("playlist", "track")]


class SavedPlaylist(TimeStampedModel):
    user = models.ForeignKey(User, related_name="saved_playlists", on_delete=models.CASCADE)
    playlist = models.ForeignKey(Playlist, related_name="saves", on_delete=models.CASCADE)

    class Meta:
        unique_together = [("user", "playlist")]
