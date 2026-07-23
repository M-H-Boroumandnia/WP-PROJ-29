FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SONORA_DEBUG=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libjpeg62-turbo zlib1g libwebp7 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend /app
COPY frontend/public/media /app/seed_media
EXPOSE 8000
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "sonora.asgi:application"]
