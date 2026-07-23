from __future__ import annotations

from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from django.views.static import serve
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/v1/", include("api.urls")),
    path("media/covers/<path:path>", serve, {"document_root": settings.MEDIA_ROOT / "covers"}, name="public-covers"),
    path("media/avatars/<path:path>", serve, {"document_root": settings.MEDIA_ROOT / "avatars"}, name="public-avatars"),
]
