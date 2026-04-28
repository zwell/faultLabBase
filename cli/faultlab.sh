#!/bin/sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
FAULTLAB_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
SCENARIOS_DIR="$FAULTLAB_ROOT/scenarios"

usage() {
  cat <<'EOF'
Usage:
  ./cli/faultlab.sh <start|inject|verify|clean>

Required environment variable:
  FAULTLAB_SCENARIO=scenarios/<tech>/<id>

Examples:
  FAULTLAB_SCENARIO=scenarios/kafka/001-rebalance-slow-timeout ./cli/faultlab.sh start
  FAULTLAB_SCENARIO=scenarios/kafka/001-rebalance-slow-timeout ./cli/faultlab.sh inject
EOF
}

resolve_scenario_dir() {
  if [ "${FAULTLAB_SCENARIO:-}" = "" ]; then
    echo "ERROR: FAULTLAB_SCENARIO is not set."
    echo "Set it like: FAULTLAB_SCENARIO=scenarios/kafka/001-rebalance-slow-timeout"
    exit 1
  fi

  case "$FAULTLAB_SCENARIO" in
    scenarios/*) SCENARIO_DIR="$FAULTLAB_ROOT/$FAULTLAB_SCENARIO" ;;
    *) SCENARIO_DIR="$FAULTLAB_ROOT/scenarios/$FAULTLAB_SCENARIO" ;;
  esac

  if [ ! -d "$SCENARIO_DIR" ]; then
    echo "ERROR: Scenario directory not found: $SCENARIO_DIR"
    exit 1
  fi
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker is not installed or not in PATH."
    exit 1
  fi
  if ! docker version >/dev/null 2>&1; then
    echo "ERROR: docker daemon is not available."
    exit 1
  fi
}

load_env_file_if_exists() {
  ENV_FILE="$FAULTLAB_ROOT/.env"
  if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        ''|\#*) continue ;;
      esac
      key=$(printf "%s" "$line" | awk -F= '{print $1}')
      val=$(printf "%s" "$line" | awk -F= '{
        $1=""
        sub(/^=/,"")
        print
      }')
      key=$(printf "%s" "$key" | awk '{gsub(/\r/,""); print}')
      val=$(printf "%s" "$val" | awk '{gsub(/\r/,""); print}')
      [ -n "$key" ] || continue
      eval "current=\${$key:-}"
      if [ "${current:-}" = "" ]; then
        eval "$key=\$val"
        eval "export $key"
      fi
    done < "$ENV_FILE"
  fi
}

json_escape() {
  awk '
    BEGIN { ORS=""; first=1 }
    {
      line=$0
      gsub(/\\/,"\\\\",line)
      gsub(/"/,"\\\"",line)
      gsub(/\r/,"\\r",line)
      gsub(/\t/,"\\t",line)
      if (!first) printf "\\n"
      printf "%s", line
      first=0
    }
  '
}

compose_file() {
  COMPOSE_FILE="$SCENARIO_DIR/docker-compose.yml"
  if [ ! -f "$COMPOSE_FILE" ]; then
    echo "ERROR: docker-compose.yml not found in $SCENARIO_DIR"
    exit 1
  fi
}

compose_project_name() {
  SCENARIO_BASENAME=$(basename "$SCENARIO_DIR")
  COMPOSE_PROJECT="faultlab-${SCENARIO_BASENAME}"
}

detect_compose_images_if_needed() {
  # Generic image detector:
  # Parse docker-compose image templates like ${VAR:-repo:tag}.
  # If VAR is unset, try local default image first, then pull it.
  unresolved=0
  found_any=0

  while IFS="$(printf '\t')" read -r var_name default_image; do
    [ -n "${var_name:-}" ] || continue
    [ -n "${default_image:-}" ] || continue
    found_any=1

    eval "current_value=\${$var_name:-}"
    if [ "$current_value" != "" ]; then
      continue
    fi

    if docker image inspect "$default_image" >/dev/null 2>&1; then
      eval "$var_name=\$default_image"
      eval "export $var_name"
      echo "[faultlab] selected local image for $var_name: $default_image"
      continue
    fi

    default_repo=$(printf "%s" "$default_image" | awk -F: '{print $1}')
    fallback_local_image=$(
      docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | awk -v repo="$default_repo" '$0 ~ ("^" repo ":") && $0 !~ /:<none>$/ {print; exit}'
    )
    if [ "${fallback_local_image:-}" != "" ]; then
      eval "$var_name=\$fallback_local_image"
      eval "export $var_name"
      echo "[faultlab] selected local fallback image for $var_name: $fallback_local_image"
      continue
    fi

    if docker pull "$default_image" >/dev/null 2>&1; then
      eval "$var_name=\$default_image"
      eval "export $var_name"
      echo "[faultlab] selected pulled image for $var_name: $default_image"
      continue
    fi

    echo "[faultlab] failed to prepare image for $var_name: $default_image"
    unresolved=1
  done <<EOF
$(awk '
  {
    line=$0
    while (match(line, /\$\{[A-Za-z_][A-Za-z0-9_]*:-[^}]+\}/)) {
      token=substr(line, RSTART + 2, RLENGTH - 3)
      split(token, pair, ":-")
      if (length(pair[1]) > 0 && length(pair[2]) > 0) {
        printf "%s\t%s\n", pair[1], pair[2]
      }
      line=substr(line, RSTART + RLENGTH)
    }
  }
' "$COMPOSE_FILE" | awk '!seen[$0]++')
EOF

  if [ "$found_any" -eq 1 ] && [ "$unresolved" -ne 0 ]; then
    echo "ERROR: one or more compose default images are unavailable."
    echo "Set corresponding image env vars manually and retry."
    exit 1
  fi
}

wait_for_health() {
  # Wait for health checks when present. Containers without healthchecks are treated as running.
  timeout_sec="${WAIT_TIMEOUT_SEC:-120}"
  start_ts=$(date +%s)

  while :; do
    all_ready=1
    container_ids=$(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" ps -q 2>/dev/null || true)

    if [ -z "$container_ids" ]; then
      all_ready=0
    else
      for cid in $container_ids; do
        running=$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo "false")
        if [ "$running" != "true" ]; then
          all_ready=0
          break
        fi

        health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "unknown")
        if [ "$health" = "starting" ] || [ "$health" = "unhealthy" ] || [ "$health" = "unknown" ]; then
          all_ready=0
          break
        fi
      done
    fi

    if [ "$all_ready" -eq 1 ]; then
      return 0
    fi

    now_ts=$(date +%s)
    elapsed=$((now_ts - start_ts))
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      return 1
    fi
    sleep 2
  done
}

cmd_start() {
  require_docker
  resolve_scenario_dir
  compose_file
  compose_project_name
  detect_compose_images_if_needed

  echo "[faultlab] scenario: $FAULTLAB_SCENARIO"
  echo "[faultlab] start: docker compose up -d"
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d

  echo "[faultlab] waiting containers to be ready..."
  if wait_for_health; then
    echo "✅ Environment ready"
  else
    echo "⚠️ Environment started but not fully healthy in timeout."
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" ps
    exit 1
  fi
}

cmd_inject() {
  resolve_scenario_dir
  INJECT_SCRIPT="$SCENARIO_DIR/inject.sh"
  if [ ! -f "$INJECT_SCRIPT" ]; then
    echo "ERROR: inject.sh not found in $SCENARIO_DIR"
    exit 1
  fi
  echo "[faultlab] scenario: $FAULTLAB_SCENARIO"
  echo "[faultlab] inject: $INJECT_SCRIPT"
  (cd "$SCENARIO_DIR" && sh "$INJECT_SCRIPT")
}

cmd_verify() {
  resolve_scenario_dir
  load_env_file_if_exists
  SOLUTION_FILE="$SCENARIO_DIR/SOLUTION.md"
  if [ ! -f "$SOLUTION_FILE" ]; then
    echo "ERROR: SOLUTION.md not found in $SCENARIO_DIR"
    exit 1
  fi

  provider=$(printf "%s" "${VERIFY_PROVIDER:-qwen}" | awk '{gsub(/\r/,""); gsub(/^[ \t]+|[ \t]+$/,""); print}')
  model=$(printf "%s" "${VERIFY_MODEL:-qwen-plus}" | awk '{gsub(/\r/,""); gsub(/^[ \t]+|[ \t]+$/,""); print}')
  case "$provider" in
    qwen)
      api_url="${VERIFY_API_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions}"
      api_key="${VERIFY_API_KEY:-${DASHSCOPE_API_KEY:-}}"
      ;;
    openai)
      api_url="${VERIFY_API_URL:-https://api.openai.com/v1/chat/completions}"
      api_key="${VERIFY_API_KEY:-${OPENAI_API_KEY:-}}"
      ;;
    *)
      api_url="${VERIFY_API_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions}"
      api_key="${VERIFY_API_KEY:-${DASHSCOPE_API_KEY:-}}"
      provider="qwen"
      ;;
  esac

  if [ "$api_url" = "" ]; then
    echo "ERROR: verify API url is empty."
    echo "Set VERIFY_API_URL or use VERIFY_PROVIDER=qwen/openai."
    exit 1
  fi

  if [ "$api_key" = "" ]; then
    echo "ERROR: verify API key is empty."
    echo "For qwen, set DASHSCOPE_API_KEY (or VERIFY_API_KEY)."
    echo "For openai, set OPENAI_API_KEY (or VERIFY_API_KEY)."
    exit 1
  fi

  if [ "$model" = "" ]; then
    echo "ERROR: verify model is empty."
    echo "Set VERIFY_MODEL, for example: qwen-plus / qwen-turbo."
    exit 1
  fi

  echo "[faultlab] scenario: $FAULTLAB_SCENARIO"
  echo "[faultlab] verify provider: $provider"
  echo "[faultlab] verify model: $model"
  echo
  echo "Please input your root cause analysis and fix plan."
  echo "Finish input with Ctrl+D (Linux/macOS) or Ctrl+Z then Enter (PowerShell)."
  user_text=$(awk 'BEGIN{first=1} {if(!first) printf "\n"; printf "%s", $0; first=0}')
  if [ "${user_text:-}" = "" ]; then
    echo "ERROR: empty input."
    exit 1
  fi

  solution_text=$(awk 'BEGIN{first=1} {if(!first) printf "\n"; printf "%s", $0; first=0}' "$SOLUTION_FILE")
  system_prompt="You are a fault diagnosis reviewer. Grade the learner response strictly against the provided solution rubric. Output concise markdown with sections: Result, Missing Evidence, Next Steps."
  user_prompt=$(printf "SOLUTION.md:\n%s\n\nLearner analysis:\n%s" "$solution_text" "$user_text")

  model_escaped=$(printf "%s" "$model" | json_escape)
  system_escaped=$(printf "%s" "$system_prompt" | json_escape)
  user_escaped=$(printf "%s" "$user_prompt" | json_escape)
  verify_payload=$(printf '{"model":"%s","messages":[{"role":"system","content":"%s"},{"role":"user","content":"%s"}]}' \
    "$model_escaped" "$system_escaped" "$user_escaped")
  payload_file=$(mktemp)
  printf "%s" "$verify_payload" > "$payload_file"

  response_file=$(mktemp)
  http_code=$(curl -sS -o "$response_file" -w "%{http_code}" \
    -X POST "$api_url" \
    -H "Authorization: Bearer $api_key" \
    -H "Content-Type: application/json" \
    --data-binary "@$payload_file")
  rm -f "$payload_file"

  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    echo "ERROR: verify request failed, http_code=$http_code"
    echo "[debug] verify payload (first 400 chars):"
    printf "%s\n" "$verify_payload" | awk '{print substr($0,1,400)}'
    awk '{print}' "$response_file"
    if awk '/model_not_found|Model not exist/ {found=1} END{exit found?0:1}' "$response_file" >/dev/null 2>&1; then
      echo "Hint: current VERIFY_MODEL may be invalid for this provider."
      echo "Try VERIFY_MODEL=qwen-plus (or qwen-turbo) in .env."
    fi
    rm -f "$response_file"
    exit 1
  fi

  content=$(awk '
    {
      if (match($0,/"content":"([^"]|\\")*"/)) {
        s=substr($0,RSTART+11,RLENGTH-12)
        gsub(/\\"/,"\"",s)
        gsub(/\\n/,"\n",s)
        gsub(/\\r/,"",s)
        gsub(/\\\\/,"\\",s)
        print s
        found=1
        exit
      }
      if (match($0,/"text":"([^"]|\\")*"/)) {
        s=substr($0,RSTART+8,RLENGTH-9)
        gsub(/\\"/,"\"",s)
        gsub(/\\n/,"\n",s)
        gsub(/\\r/,"",s)
        gsub(/\\\\/,"\\",s)
        print s
        found=1
        exit
      }
    }
    END {
      if (!found) exit 1
    }
  ' "$response_file" 2>/dev/null || true)
  rm -f "$response_file"

  if [ "${content:-}" = "" ]; then
    echo "ERROR: cannot parse LLM response content."
    exit 1
  fi

  echo
  echo "=== FaultLab Verify Result ==="
  printf "%s\n" "$content"
  echo "=============================="
}

cmd_clean() {
  require_docker
  resolve_scenario_dir
  compose_file
  compose_project_name

  echo "[faultlab] scenario: $FAULTLAB_SCENARIO"
  echo "[faultlab] clean: docker compose down -v --remove-orphans"
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" down -v --remove-orphans
}

if [ "$#" -ne 1 ]; then
  usage
  exit 1
fi

case "$1" in
  start) cmd_start ;;
  inject) cmd_inject ;;
  verify) cmd_verify ;;
  clean) cmd_clean ;;
  -h|--help|help) usage ;;
  *)
    echo "ERROR: unknown command: $1"
    usage
    exit 1
    ;;
esac
