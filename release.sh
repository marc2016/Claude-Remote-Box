#!/usr/bin/env bash
# Release manager: tests, version bump, commit, tag, push. The tag vX.Y.Z makes
# the image workflow publish the three images (box, dashboard, agent) as X.Y.Z and latest.
#
#   ./release.sh                 asks for patch / minor / major or a version
#   ./release.sh 0.4.0           releases that version
#   ./release.sh --quick 0.4.0   skips the container tests (Docker, ~4 min)
#   ./release.sh --no-tests ...  skips all tests (not recommended)
#   ./release.sh --dry-run ...   shows what would change, touches nothing
set -euo pipefail

cd "$(dirname "$0")"

QUICK=0 NO_TESTS=0 DRY=0 TARGET=""
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    --no-tests) NO_TESTS=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) echo "Unbekannte Option: $arg" >&2; exit 64 ;;
    *) TARGET=$arg ;;
  esac
done

echo "📦 Claude-Remote-Box Release"
echo "============================"

# --- Preconditions -------------------------------------------------------------

command -v git >/dev/null || { echo "git fehlt" >&2; exit 1; }
command -v node >/dev/null || { echo "node fehlt" >&2; exit 1; }
if [ "$(git rev-parse --abbrev-ref HEAD)" != main ]; then
  echo "❌ Bitte von main releasen (aktuell: $(git rev-parse --abbrev-ref HEAD))." >&2; exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  if [ "$DRY" -eq 1 ]; then echo "⚠️  Arbeitsbaum ist nicht sauber (im Dry-Run nur ein Hinweis)."; else
    echo "❌ Arbeitsbaum ist nicht sauber. Erst committen oder stashen." >&2
    git status --short; exit 1
  fi
fi
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] && [ "$DRY" -eq 0 ]; then
  echo "❌ main und origin/main unterscheiden sich. Erst pullen oder pushen." >&2; exit 1
fi

# --- Versions ----------------------------------------------------------------------

LAST_TAG=$(git tag --list 'v[0-9]*' --sort=-v:refname | head -n 1)
CURRENT=${LAST_TAG#v}; CURRENT=${CURRENT:-0.0.0}
DOC_VER=$(sed -n -E 's#.*claude-remote-box:([0-9]+\.[0-9]+\.[0-9]+).*#\1#p' compose.example.yaml | head -n 1)
echo "📌 Letztes Release: v$CURRENT   (Doku nennt: ${DOC_VER:-?})"

bump() { node -e "const [a,b,c]='$1'.split('.').map(Number); console.log({patch:[a,b,c+1],minor:[a,b+1,0],major:[a+1,0,0]}['$2'].join('.'))"; }

if [ -z "$TARGET" ]; then
  echo ""
  echo "Versions-Typ wählen oder Version eingeben:"
  echo "  1) patch  -> v$(bump "$CURRENT" patch)"
  echo "  2) minor  -> v$(bump "$CURRENT" minor)"
  echo "  3) major  -> v$(bump "$CURRENT" major)"
  read -r -p "Auswahl [1-3 oder z. B. 0.4.0]: " CHOICE
  case "$CHOICE" in
    1|patch) TARGET=$(bump "$CURRENT" patch) ;;
    2|minor) TARGET=$(bump "$CURRENT" minor) ;;
    3|major) TARGET=$(bump "$CURRENT" major) ;;
    *) TARGET=$CHOICE ;;
  esac
fi
TARGET=${TARGET#v}
if ! [[ "$TARGET" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "❌ Ungültige Version: $TARGET" >&2; exit 1; fi
if git rev-parse -q --verify "refs/tags/v$TARGET" >/dev/null; then echo "❌ Tag v$TARGET gibt es schon." >&2; exit 1; fi

echo ""
echo "🚀 Release v$TARGET"
[ "$DRY" -eq 1 ] && echo "   (Dry-Run: es wird nichts geändert)"

# --- Tests -----------------------------------------------------------------------------

if [ "$NO_TESTS" -eq 0 ]; then
  echo ""
  echo "🧪 1/3 crb-Tests (docker compose config)..."
  tests/crb.test.sh
  echo ""
  echo "🧪 1/3 Watcher-Tests (node)..."
  tests/watch.test.sh
  echo ""
  echo "🧪 1/3 Dashboard: Typecheck, Tests, Build..."
  (cd dashboard && npm ci --no-audit --no-fund >/dev/null && npm run typecheck && npm test && npm run build >/dev/null)
  if [ "$QUICK" -eq 0 ]; then
    echo ""
    echo "🧪 1/3 Container-Tests (Docker, dauert ein paar Minuten; --quick überspringt sie)..."
    tests/setup.test.sh
  fi
else
  echo ""
  echo "⚠️  Tests übersprungen (--no-tests)."
fi

# --- Version bump -------------------------------------------------------------------

echo ""
echo "✍️  2/3 Setze Version v$TARGET..."
FILES=(README.md compose.example.yaml dashboard/package.json dashboard/package-lock.json)
if [ "$DRY" -eq 1 ]; then
  echo "   würde ändern: ${FILES[*]}"
  grep -n -E "claude-remote-box(-dashboard|-agent)?:$DOC_VER|CRB_VERSION=$DOC_VER|\`$DOC_VER\`" README.md compose.example.yaml | sed 's/^/   /'
else
  # Image tags and version examples in the docs (not the "Upgrading to" history).
  if [ -n "$DOC_VER" ]; then
    sed -i.bak -E \
      -e "s#(claude-remote-box(-dashboard|-agent)?:)$DOC_VER#\1$TARGET#g" \
      -e "s#CRB_VERSION=$DOC_VER#CRB_VERSION=$TARGET#g" \
      -e "s#(for example )\`$DOC_VER\`#\1\`$TARGET\`#g" \
      -e "s#^\| \`$DOC_VER\` \| One release#| \`$TARGET\` | One release#" \
      README.md compose.example.yaml
    rm -f README.md.bak compose.example.yaml.bak
  fi
  (cd dashboard && npm version "$TARGET" --no-git-tag-version --allow-same-version >/dev/null)
  docker compose -f compose.example.yaml config -q
  git --no-pager diff --stat
fi

# --- Commit, tag, push --------------------------------------------------------------

echo ""
if [ "$DRY" -eq 1 ]; then
  echo "3/3 Dry-Run: kein Commit, kein Tag, kein Push."
  echo "✨ Fertig (nichts geändert)."
  exit 0
fi

read -r -p "Committen und Tag v$TARGET erstellen? (y/N): " CONFIRM
if ! [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
  git checkout -- "${FILES[@]}" 2>/dev/null || true
  echo "Abgebrochen, Versionsänderungen zurückgenommen."
  exit 0
fi
read -r -p "Commit-Nachricht [Release v$TARGET]: " MSG
MSG=${MSG:-"Release v$TARGET"}
git add "${FILES[@]}"
git commit -q -m "$MSG"
git tag -a "v$TARGET" -m "$MSG"
echo "✅ Commit und Tag v$TARGET erstellt."

read -r -p "Nach GitHub pushen? Der Tag startet den Image-Build. (y/N): " PUSH
if [[ "$PUSH" =~ ^[Yy]$ ]]; then
  git push origin main
  git push origin "v$TARGET"
  echo ""
  echo "🎉 v$TARGET gepusht. Der Workflow baut jetzt beide Images:"
  echo "   https://github.com/marc2016/Claude-Remote-Box/actions"
  if command -v gh >/dev/null; then
    echo "   verfolgen:  gh run watch"
  fi
  echo "   prüfen:     docker manifest inspect ghcr.io/marc2016/claude-remote-box:$TARGET | grep architecture"
  echo "   ausrollen:  ./crb update   (auf dem Mini-PC; box.yaml auf latest, dann pull)"
else
  echo "Nicht gepusht. Später: git push origin main && git push origin v$TARGET"
fi

echo ""
echo "✨ Release v$TARGET abgeschlossen."
