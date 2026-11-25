import type { DockerContainerAction, DockerContainerActionOptions } from '../../src/types/docker'

export const OVERVIEW_START = '__MSHELL_DOCKER_JSON_START__'
export const OVERVIEW_END = '__MSHELL_DOCKER_JSON_END__'
export const RESULT_PREFIX = '__MSHELL_DOCKER_RESULT__'
export const OPERATION_DONE = '__MSHELL_DOCKER_OPERATION_DONE__'

const jsonHelpers = String.raw`
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//'
}
json_lines() { awk 'NF { if (n++) printf ","; printf "%s", $0 }'; }
`

// A function keeps sudo argument handling independent of IFS.
const dockerResolver = String.raw`
needs_sudo=false
access_error=""
docker_run() {
  if [ "$needs_sudo" = true ]; then sudo -n docker "$@"; else docker "$@"; fi
}
resolve_docker() {
  if access_error="$(docker ps 2>&1)"; then access_error=""; return 0; fi
  if command -v sudo >/dev/null 2>&1; then
    if sudo_error="$(sudo -n docker ps 2>&1)"; then
      needs_sudo=true
      access_error=""
      return 0
    fi
    access_error="$access_error
sudo: $sudo_error"
  fi
  return 1
}
`

const operationHelpers = `${jsonHelpers}
${dockerResolver}
result() {
  printf '%s{"kind":"%s","target":"%s","status":"%s","message":"%s"}\\n' '${RESULT_PREFIX}' "$1" "$(json_escape "$2")" "$3" "$(json_escape "$4")"
}
if ! resolve_docker; then
  result operation Docker failed "$access_error"
  echo '${OPERATION_DONE}'
  exit 1
fi
`

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const wrap = (script: string) => `sh <<'MSHELL_DOCKER_SCRIPT'\n${script}\nMSHELL_DOCKER_SCRIPT`

export function buildDockerOverviewScript(): string {
  return wrap(`${jsonHelpers}
${dockerResolver}
set +e
installed=false
compose_installed=false
socket_accessible=false
docker_version=""
compose_version=""
service_status=unknown
access_status=not-installed
stats_error=""
ps_output=""
stats_output=""
if command -v docker >/dev/null 2>&1; then
  installed=true
  docker_version="$(docker --version 2>&1)"
  if resolve_docker; then
    socket_accessible=true
    access_status=ready
  else
    case "$access_error" in
      *'permission denied'*|*'Permission denied'*|*'access denied'*) access_status=permission-denied ;;
      *) access_status=unavailable ;;
    esac
  fi
  if compose_version="$(docker_run compose version 2>/dev/null)"; then
    compose_installed=true
  elif compose_version="$(docker-compose --version 2>/dev/null)"; then
    compose_installed=true
  else
    compose_version=""
  fi
  if command -v systemctl >/dev/null 2>&1; then
    service_status="$(systemctl is-active docker 2>/dev/null || true)"
  elif command -v rc-service >/dev/null 2>&1; then
    rc-service docker status >/dev/null 2>&1 && service_status=active || service_status=inactive
  elif command -v service >/dev/null 2>&1; then
    service docker status >/dev/null 2>&1 && service_status=active || service_status=inactive
  fi
fi
read_os_field() {
  if [ -f /etc/os-release ]; then
    grep -E "^$1=" /etc/os-release | head -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//'
  fi
}
package_manager=unknown
for candidate in apt-get dnf yum apk zypper; do
  if command -v "$candidate" >/dev/null 2>&1; then package_manager="$candidate"; break; fi
done
if [ "$socket_accessible" = true ]; then
  if ! ps_output="$(docker_run ps -a --no-trunc --format '{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},"status":{{json .Status}},"ports":{{json .Ports}},"createdAt":{{json .CreatedAt}},"composeProject":{{json (.Label "com.docker.compose.project")}},"composeService":{{json (.Label "com.docker.compose.service")}},"composeWorkingDir":{{json (.Label "com.docker.compose.project.working_dir")}},"composeConfigFiles":{{json (.Label "com.docker.compose.project.config_files")}}}' 2>&1)"; then
    printf '容器列表读取失败: %s\\n' "$ps_output" >&2
    exit 1
  fi
  if ! stats_output="$(docker_run stats --no-stream --no-trunc --format '{{json .}}' 2>&1)"; then
    stats_error="性能数据读取失败: $stats_output"
    stats_output=""
  fi
fi
printf '%s\\n' '${OVERVIEW_START}'
printf '{"environment":{'
printf '"installed":%s,"composeInstalled":%s,"socketAccessible":%s,"needsSudo":%s,' "$installed" "$compose_installed" "$socket_accessible" "$needs_sudo"
printf '"dockerVersion":"%s","composeVersion":"%s","serviceStatus":"%s",' "$(json_escape "$docker_version")" "$(json_escape "$compose_version")" "$(json_escape "$service_status")"
printf '"accessError":"%s","accessStatus":"%s",' "$(json_escape "$access_error")" "$access_status"
printf '"os":{"id":"%s","versionId":"%s","prettyName":"%s","packageManager":"%s"}},' "$(json_escape "$(read_os_field ID)")" "$(json_escape "$(read_os_field VERSION_ID)")" "$(json_escape "$(read_os_field PRETTY_NAME)")" "$package_manager"
printf '"containers":[%s],"stats":[%s],"warnings":[' "$(printf '%s\\n' "$ps_output" | json_lines)" "$(printf '%s\\n' "$stats_output" | json_lines)"
if [ -n "$stats_error" ]; then printf '"%s"' "$(json_escape "$stats_error")"; fi
printf ']}\\n%s\\n' '${OVERVIEW_END}'`)
}

export function buildDockerActionScript(
  action: DockerContainerAction,
  ids: string[],
  options: DockerContainerActionOptions
): string {
  const targets = ids.map(quote).join(' ')
  if (action !== 'remove') {
    return wrap(`${operationHelpers}
for target in ${targets}; do
  if output="$(docker_run container ${action} "$target" 2>&1)"; then
    result container "$target" success "$output"
  else
    result container "$target" failed "$output"
  fi
done
echo '${OPERATION_DONE}'`)
  }
  return wrap(`${operationHelpers}
images=""
networks=""
for target in ${targets}; do
  image=""
  target_networks=""
  if [ '${Boolean(options.removeImage)}' = true ]; then
    if ! image="$(docker_run container inspect -f '{{.Image}}' "$target" 2>&1)"; then
      result container "$target" failed "读取实际镜像 ID 失败，未删除容器: $image"
      continue
    fi
    case "$image" in sha256:*) ;; *) result container "$target" failed '镜像 ID 无效，未删除容器'; continue ;; esac
  fi
  if [ '${Boolean(options.removeNetworks)}' = true ]; then
    if ! target_networks="$(docker_run container inspect -f '{{range $name, $net := .NetworkSettings.Networks}}{{if and (ne $name "bridge") (ne $name "host") (ne $name "none")}}{{println $net.NetworkID}}{{end}}{{end}}' "$target" 2>&1)"; then
      result container "$target" failed "读取网络 ID 失败，未删除容器: $target_networks"
      continue
    fi
  fi
  if output="$(docker_run container rm -f "$target" 2>&1)"; then
    result container "$target" success "$output"
    images="$images
$image"
    networks="$networks
$target_networks"
  else
    result container "$target" failed "$output"
  fi
done
printf '%s\\n' "$images" | sort -u | while IFS= read -r image; do
  [ -z "$image" ] && continue
  if output="$(docker_run image rm "$image" 2>&1)"; then
    result image "$image" success "$output"
  else
    result image "$image" failed "$output"
  fi
done
printf '%s\\n' "$networks" | sort -u | while IFS= read -r network; do
  [ -z "$network" ] && continue
  if output="$(docker_run network rm "$network" 2>&1)"; then
    result network "$network" success "$output"
  else
    result network "$network" failed "$output"
  fi
done
echo '${OPERATION_DONE}'`)
}

export function buildDockerCleanupScript(): string {
  return wrap(`${operationHelpers}
cleanup() {
  label="$1"
  shift
  if output="$(docker_run "$@" 2>&1)"; then result cleanup "$label" success "$output"
  else result cleanup "$label" failed "$output"; fi
}
cleanup '未使用镜像' image prune -af
cleanup '未使用卷' volume prune -f
if docker_run builder prune --help >/dev/null 2>&1; then
  cleanup '构建缓存' builder prune -af
else
  result cleanup '构建缓存' skipped '当前 Docker 不支持 builder prune，已跳过'
fi
echo '${OPERATION_DONE}'`)
}

export function buildDockerInstallScript(): string {
  return wrap(`${dockerResolver}
set -e
run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo -n "$@"
  else echo '安装需要 root 或免密 sudo 权限' >&2; return 1; fi
}
run_as_root true
manager=""
for candidate in apt-get dnf yum apk zypper; do
  if command -v "$candidate" >/dev/null 2>&1; then manager="$candidate"; break; fi
done
if [ -z "$manager" ]; then echo '不支持当前包管理器，请手动安装 Docker 和 Compose' >&2; exit 1; fi
if [ "$manager" = apt-get ]; then run_as_root env DEBIAN_FRONTEND=noninteractive apt-get update; fi
if ! command -v docker >/dev/null 2>&1; then
  case "$manager" in
    apt-get) run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io ;;
    dnf) run_as_root dnf install -y docker || run_as_root dnf install -y moby-engine ;;
    yum) run_as_root yum install -y docker ;;
    apk) run_as_root apk add --no-cache docker ;;
    zypper) run_as_root zypper --non-interactive install docker ;;
  esac
fi
if ! docker compose version >/dev/null 2>&1 && ! docker-compose --version >/dev/null 2>&1; then
  case "$manager" in
    apt-get) run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin || run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-v2 || run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose ;;
    dnf) run_as_root dnf install -y docker-compose-plugin || run_as_root dnf install -y docker-compose ;;
    yum) run_as_root yum install -y docker-compose-plugin || run_as_root yum install -y docker-compose ;;
    apk) run_as_root apk add --no-cache docker-cli-compose ;;
    zypper) run_as_root zypper --non-interactive install docker-compose ;;
  esac
fi
if ! resolve_docker; then
  if command -v systemctl >/dev/null 2>&1; then
    run_as_root systemctl start docker
    run_as_root systemctl enable docker
  elif command -v rc-service >/dev/null 2>&1; then
    run_as_root rc-service docker start
    run_as_root rc-update add docker default
  elif command -v service >/dev/null 2>&1; then
    run_as_root service docker start
  else
    echo 'Docker 已安装，但无法自动启动服务，请手动启动后刷新' >&2
    exit 1
  fi
fi
if ! resolve_docker; then printf 'Docker 服务不可用: %s\\n' "$access_error" >&2; exit 1; fi
docker_run version --format '{{.Server.Version}}'
if docker_run compose version; then :
elif docker-compose --version; then :
else echo 'Docker 可用，但 Compose 验证失败' >&2; exit 1; fi
echo 'Docker 服务与 Compose 已验证可用'
echo '${OPERATION_DONE}'`)
}
