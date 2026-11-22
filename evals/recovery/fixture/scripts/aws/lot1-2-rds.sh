#!/usr/bin/env bash
set -euo pipefail

password="$(aws secretsmanager get-random-password --password-length 32 --query RandomPassword --output text)"
aws rds modify-db-instance --db-instance-identifier lot1-2 --master-user-password "$password"
