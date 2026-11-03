#!/usr/bin/env bash
# Adds a project service to a claude-remote-box setup.
# Run it in the directory that holds compose.yaml, or in an empty directory
# to start a new setup. Usage: ./add-project.sh [git-url]
#
# Layout: compose.yaml lists services/<name>.yaml under `include:`, and each of
# those files extends the hardened `box` service from box.yaml.
# Needs bash 3.2+ (macOS), git, and Docker Compose 2.20+.

set -euo pipefail

CRB_VERSION="0.2.0"
CRB_IMAGE="ghcr.io/marc2016/claude-remote-box:${CRB_VERSION}"

die() { echo "❌ $*" >&2; exit 1; }
warn() { echo "⚠️  $*"; }

# ask VAR "Question" [default]: empty input takes the default.
ask() {
  local __var=$1 __q=$2 __def=${3-} __ans=""
  if [ -n "$__def" ]; then __q="$__q [$__def]"; fi
  if ! read -r -p "$__q: " __ans; then echo; die "Abgebrochen (keine Eingabe mehr)."; fi
  if [ -z "$__ans" ]; then __ans=$__def; fi
  printf -v "$__var" '%s' "$__ans"
}

# confirm "Question": yes only for y/Y, default no.
confirm() {
  local a=""
  read -r -p "$1 (y/N): " a || a=""
  [[ "$a" =~ ^[Yy]$ ]]
}

# confirm_yes "Question": no only for n/N, default yes.
confirm_yes() {
  local a=""
  read -r -p "$1 (Y/n): " a || a=""
  ! [[ "$a" =~ ^[Nn]$ ]]
}

# Double-quoted YAML scalar; `$` is doubled so Compose does not interpolate it.
yaml_str() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//\$/\$\$}
  printf '"%s"' "$s"
}

echo "🧰 Claude-Remote-Box: Projekt hinzufügen"
echo "========================================"

# --- Checks (nothing is changed before the confirmation) ---------------------

if [ "$(id -u)" -eq 0 ]; then
  die "Bitte nicht als root ausführen: Der Config-Ordner gehört sonst root, und der Container kann ihn nicht beschreiben."
fi
command -v git >/dev/null 2>&1 || die "git ist nicht installiert."
command -v docker >/dev/null 2>&1 || die "docker ist nicht installiert."
compose_ver=$(docker compose version --short 2>/dev/null) || die "Docker Compose v2 fehlt (docker compose version schlägt fehl)."
compose_ver=${compose_ver#v}
compose_major=${compose_ver%%.*}
compose_minor=${compose_ver#*.}
compose_minor=${compose_minor%%.*}
compose_minor=${compose_minor%%[!0-9]*}
if ! [[ "$compose_major" =~ ^[0-9]+$ && "$compose_minor" =~ ^[0-9]+$ ]]; then
  die "Unbekannte Docker-Compose-Version: $compose_ver"
fi
if [ "$compose_major" -lt 2 ] || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -lt 20 ]; }; then
  die "Docker Compose $compose_ver ist zu alt, nötig ist 2.20 oder neuer (für include:)."
fi

for f in compose.yml docker-compose.yml docker-compose.yaml; do
  if [ -f "$f" ] && [ ! -f compose.yaml ]; then
    die "Hier liegt $f. Das Skript arbeitet mit compose.yaml; bitte umbenennen."
  fi
done

include_mode=create
existing_services=""
if [ -f compose.yaml ]; then
  if grep -qE '^include:[[:space:]]*$' compose.yaml; then
    include_mode=insert
  elif grep -qE '^include:' compose.yaml; then
    die "compose.yaml: 'include:' muss allein in seiner Zeile stehen, mit den Einträgen als Liste darunter."
  else
    include_mode=append
  fi
  if ! existing_services=$(docker compose config --services 2>&1); then
    echo "$existing_services" >&2
    die "Die bestehende Compose-Konfiguration ist ungültig. Bitte erst reparieren."
  fi
fi

# --- Questions ---------------------------------------------------------------

# Set by ask() through printf -v.
name="" dir="" choice="" git_name="" git_email=""
url=${1-}
while [ -z "$url" ]; do
  ask url "Git-URL des Projekts"
done

repo=${url%/}
repo=${repo%.git}
repo=${repo##*/}
repo=${repo##*:}
default_name=$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[-_]*//')

while :; do
  ask name "Service-Name (auch Name in der Claude-App)" "$default_name"
  if ! [[ "$name" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    warn "Erlaubt sind a-z, 0-9, - und _, am Anfang ein Buchstabe oder eine Ziffer."
    continue
  fi
  if [ -e "services/$name.yaml" ] || printf '%s\n' "$existing_services" | grep -qxF "$name"; then
    warn "Der Name '$name' ist schon vergeben."
    continue
  fi
  break
done

reuse_dir=0
while :; do
  # shellcheck disable=SC2088  # literal ~ is shown as default and expanded below
  ask dir "Zielordner für das Repository" "~/code/$name"
  dir=${dir/#\~/$HOME}
  case "$dir" in /*) ;; *) dir="$PWD/$dir" ;; esac
  dir=${dir%/}
  if [[ "$dir" == *:* ]]; then
    warn "Der Pfad darf keinen Doppelpunkt enthalten."
    continue
  fi
  if [ -e "$dir" ]; then
    if [ ! -d "$dir" ]; then
      warn "$dir existiert und ist kein Ordner."
      continue
    fi
    if confirm "$dir existiert schon. Ohne Klonen als Projektordner verwenden?"; then
      reuse_dir=1
    else
      echo "Abgebrochen, nichts geändert."
      exit 1
    fi
  fi
  break
done

echo ""
echo "Spawn-Modus:"
echo "  1) worktree  (jede Session bekommt einen eigenen Git-Worktree, empfohlen)"
echo "  2) same-dir  (alle Sessions teilen /workspace)"
while :; do
  ask choice "Auswahl" "1"
  case "$choice" in
    1|worktree) spawn=worktree ;;
    2|same-dir) spawn=same-dir ;;
    *) warn "Bitte 1 oder 2 eingeben."; continue ;;
  esac
  break
done

echo ""
browsers=0
if confirm_yes "Browser-Cache für Screenshots anlegen?"; then browsers=1; fi

git_name_default=$(git config --global user.name 2>/dev/null || true)
git_email_default=$(git config --global user.email 2>/dev/null || true)
ask git_name "Git-Name für Commits von Claude (leer = keiner)" "$git_name_default"
ask git_email "Git-E-Mail für Commits von Claude (leer = keine)" "$git_email_default"

config_dir="$name/config"
if [ -d "$config_dir" ] && [ -n "$(ls -A "$config_dir" 2>/dev/null)" ]; then
  if ! confirm "$config_dir existiert und ist nicht leer (vorhandener Login?). Weiterverwenden?"; then
    echo "Abgebrochen, nichts geändert."
    exit 1
  fi
fi

# --- Summary -----------------------------------------------------------------

service_file="services/$name.yaml"
echo ""
echo "📋 Zusammenfassung"
echo "  Service:      $name"
if [ "$reuse_dir" -eq 1 ]; then
  echo "  Projekt:      $dir (vorhanden, wird nicht geklont)"
else
  echo "  Projekt:      $dir  <- $url"
fi
echo "  Spawn-Modus:  $spawn"
echo "  Git:          ${git_name:-<keiner>} <${git_email:-keine}>"
echo "  Config:       ./$config_dir (chmod 700)"
if [ "$browsers" -eq 1 ]; then echo "  Browser:      Volume $name-browsers"; fi
echo "  Compose:      $service_file, eingetragen in compose.yaml"
for f in compose.yaml box.yaml; do
  if [ ! -f "$f" ]; then echo "  Neu:          $f"; fi
done
if [ ! -f .env ] && [ "$include_mode" = create ]; then
  echo "  Neu:          .env (UID=$(id -u), GID=$(id -g))"
fi
echo ""
if ! confirm "Anlegen?"; then
  echo "Abgebrochen, nichts geändert."
  exit 0
fi

# --- Changes -----------------------------------------------------------------

echo ""
if [ "$reuse_dir" -eq 1 ]; then
  echo "📥 1/4 Verwende vorhandenen Ordner $dir"
else
  echo "📥 1/4 Klone Repository..."
  mkdir -p "$(dirname "$dir")"
  git clone "$url" "$dir" || die "Klonen fehlgeschlagen. Es wurde nichts weiter angelegt."
fi

echo ""
echo "📁 2/4 Lege Config-Ordner an..."
mkdir -p "$config_dir"
chmod 700 "$config_dir"

echo ""
echo "✍️  3/4 Trage Service ein..."
# Only a fresh setup gets a .env: in an existing one it would silently change
# the user of the services that are already running.
if [ ! -f .env ] && [ "$include_mode" = create ]; then
  printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env
elif [ ! -f .env ]; then
  warn "Keine .env vorhanden: Alle Services laufen als UID/GID 1000. Für deinen Benutzer: printf 'UID=%s\\nGID=%s\\n' \"\$(id -u)\" \"\$(id -g)\" > .env"
fi
if [ ! -f box.yaml ]; then
  cat > box.yaml <<EOF
# Shared base for all project services. Not started itself: each file in
# services/ extends the \`box\` service from here.
services:
  box:
    image: ${CRB_IMAGE}
    restart: unless-stopped
    user: "\${UID:-1000}:\${GID:-1000}"
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    ulimits:
      core: 0                     # no core dumps in /workspace
    # No ports and no Docker socket: Remote Control only needs outbound HTTPS.
EOF
fi

mkdir -p services
{
  echo "# Created by add-project.sh. Relative paths resolve against this directory."
  echo "services:"
  echo "  $name:"
  echo "    extends:"
  echo "      file: ../box.yaml"
  echo "      service: box"
  echo "    environment:"
  echo "      CRB_NAME: \"$name\""
  if [ "$spawn" = same-dir ]; then echo "      CRB_SPAWN: \"same-dir\""; fi
  if [ -n "$git_name" ]; then
    echo "      GIT_AUTHOR_NAME: $(yaml_str "$git_name")"
    echo "      GIT_COMMITTER_NAME: $(yaml_str "$git_name")"
  fi
  if [ -n "$git_email" ]; then
    echo "      GIT_AUTHOR_EMAIL: $(yaml_str "$git_email")"
    echo "      GIT_COMMITTER_EMAIL: $(yaml_str "$git_email")"
  fi
  echo "    volumes:"
  echo "      - $(yaml_str "$dir:/workspace")"
  echo "      - \"../$name/config:/home/node/.claude\"   # login token"
  if [ "$browsers" -eq 1 ]; then
    echo "      - \"$name-browsers:/home/node/.cache/ms-playwright\""
    echo ""
    echo "volumes:"
    echo "  $name-browsers: {}"
  fi
} > "$service_file"

# Keep the original compose.yaml to restore it exactly if the check fails.
compose_backup=""
if [ -f compose.yaml ]; then
  compose_backup=$(mktemp)
  cat compose.yaml > "$compose_backup"
fi
entry="  - $service_file"
case "$include_mode" in
  create)
    printf 'include:\n%s\n' "$entry" > compose.yaml
    ;;
  insert)
    tmp=$(mktemp)
    awk -v line="$entry" '{ print } !done && /^include:[[:space:]]*$/ { print line; done = 1 }' compose.yaml > "$tmp"
    cat "$tmp" > compose.yaml
    rm -f "$tmp"
    ;;
  append)
    if [ -n "$(tail -c 1 compose.yaml)" ]; then echo >> compose.yaml; fi
    printf '\ninclude:\n%s\n' "$entry" >> compose.yaml
    ;;
esac

echo ""
echo "🔍 4/4 Prüfe mit docker compose config..."
if ! check=$(docker compose config -q 2>&1); then
  echo "$check" >&2
  rm -f "$service_file"
  if [ -n "$compose_backup" ]; then
    cat "$compose_backup" > compose.yaml
  else
    rm -f compose.yaml
  fi
  rm -f "$compose_backup"
  die "Die Compose-Konfiguration ist ungültig. $service_file und der Eintrag in compose.yaml wurden entfernt; Projektordner und ./$config_dir bleiben."
fi
rm -f "$compose_backup"

echo ""
echo "✨ $name ist angelegt. Weiter mit:"
echo "   docker compose up -d $name"
echo "   docker compose exec -it $name setup"
