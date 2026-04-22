FROM php:8.2-fpm-alpine

# Install PostgreSQL driver + nginx
RUN apk add --no-cache nginx postgresql-dev libpq gettext \
 && docker-php-ext-install pdo pdo_pgsql \
 && apk del postgresql-dev

# Copy application
COPY api/      /var/www/api/
COPY cron/     /var/www/cron/
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Storage directory (mount a volume over this in production)
RUN mkdir -p /var/www/storage/attachments \
 && chown -R www-data:www-data /var/www/storage

WORKDIR /var/www

EXPOSE $PORT

CMD sh -c "php-fpm -D && envsubst '\$PORT' < /etc/nginx/nginx.conf > /tmp/nginx.conf && nginx -c /tmp/nginx.conf -g 'daemon off;'"
