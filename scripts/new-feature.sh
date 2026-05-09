#!/usr/bin/env bash
# Uso: bash scripts/new-feature.sh nombre-de-la-feature
# Crea una rama feat/<nombre>, actualizada desde main, lista para trabajar.
set -e

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Uso: bash scripts/new-feature.sh <nombre-de-la-feature>"
  echo "Ejemplo: bash scripts/new-feature.sh substack-draft-command"
  exit 1
fi

BRANCH="feat/${NAME}"

git fetch origin main --quiet
git checkout main
git pull origin main --quiet
git checkout -b "$BRANCH"

echo ""
echo "✅ Rama '$BRANCH' creada desde main actualizado."
echo ""
echo "Cuando termines:"
echo "  git add <archivos>"
echo "  git commit -m 'feat: descripción del cambio'"
echo "  git push origin $BRANCH"
echo "  gh pr create --fill"
