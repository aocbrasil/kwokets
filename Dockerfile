FROM php:8.2-fpm-alpine

# Install PostgreSQL driver + nginx
RUN apk add --no-cache nginx postgresql-dev libpq gettext \
 && docker-php-ext-install pdo pdo_pgsql \
 && apk del postgresql-dev

# Copy application
COPY api/      /var/www/api/
COPY cron/     /var/www/cron/
COPY docker/nginx.conf /etc/nginx/nginx.conf

RUN printf '#!/bin/sh\nset -e\nphp-fpm -D\nsed "s/NGINX_PORT/${PORT:-80}/g" /etc/nginx/nginx.conf > /tmp/nginx.conf\nexec nginx -c /tmp/nginx.conf -g "daemon off;"\n' > /entrypoint.sh \
 && chmod +x /entrypoint.sh

# Storage directory (mount a volume over this in production)
RUN mkdir -p /var/www/storage/attachments \
 && chown -R www-data:www-data /var/www/storage

WORKDIR /var/www

EXPOSE 8080

CMD ["/entrypoint.sh"]
