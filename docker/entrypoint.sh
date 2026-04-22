#!/bin/sh
set -e

# Start PHP-FPM in background
php-fpm -D

# Substitute the port placeholder and start nginx
sed "s/NGINX_PORT/${PORT:-80}/g" /etc/nginx/nginx.conf > /tmp/nginx.conf

echo "Starting nginx on port ${PORT:-80}"
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
