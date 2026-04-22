FROM php:8.2-fpm-alpine

# Install PostgreSQL driver + nginx
RUN apk add --no-cache nginx postgresql-dev libpq gettext \
 && docker-php-ext-install pdo pdo_pgsql \
 && apk del postgresql-dev

# Copy application
COPY api/      /var/www/api/
COPY cron/     /var/www/cron/
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Storage directory (mount a volume over this in production)
RUN mkdir -p /var/www/storage/attachments \
 && chown -R www-data:www-data /var/www/storage

WORKDIR /var/www

EXPOSE 8080

CMD ["/entrypoint.sh"]
