#!/bin/sh
# 켤 때마다 마이그레이션을 먼저 적용하고(이미 적용된 것은 건너뜀) 앱을 띄운다.
set -e
npx prisma migrate deploy
exec npx next start -p "${PORT:-3000}"
