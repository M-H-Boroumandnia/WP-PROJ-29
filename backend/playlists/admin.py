from __future__ import annotations

from django.contrib import admin

from playlists.models import Playlist, PlaylistItem, SavedPlaylist

for model in [Playlist, PlaylistItem, SavedPlaylist]:
    admin.site.register(model)
