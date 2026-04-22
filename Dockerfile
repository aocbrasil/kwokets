FROM php:8.2-alpine

# Install PostgreSQL driver
RUN apk add --no-cache postgresql-dev libpq \
 && docker-php-ext-install pdo pdo_pgsql \
 && apk del postgresql-dev

# Copy application
COPY api/      /var/www/api/
COPY cron/     /var/www/cron/
COPY storage/  /var/www/storage/

RUN mkdir -p /var/www/storage/attachments

WORKDIR /var/www/api

EXPOSE 8080

CMD sh -c "echo Starting on port $PORT && php -S 0.0.0.0:${PORT:-8080} index.php"
