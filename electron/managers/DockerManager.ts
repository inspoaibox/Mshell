import { sshConnectionManager } from './SSHConnectionManager'

export interface DockerEnvironment {
  installed: boolean
  dockerVersion: string
  composeInstalled: boolean
  composeVersion: string
  serviceStatus: string
  socketAccessible: boolean
  needsSudo: boolean
  os: {
    id: string
    versionId: string
    prettyName: string
    packageManager: string
  }
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string
  createdAt: string
  size: string
  cpu: string
  memory: string
  netIO: string
  composeProject: string
  composeService: string
  composeWorkingDir: string
  composeConfigFiles: string
}

export interface DockerOverview {
  environment: DockerEnvironment
  containers: DockerContainer[]
}

export type DockerContainerAction = 'start' | 'pause' | 'unpause' | 'restart' | 'stop' | 'remove'

export interface DockerContainerActionOptions {
  removeImage?: boolean
  removeNetworks?: boolean
}

const DOCKER_SENTINEL_START = '__MSHELL_DOCKER_JSON_START__'
const DOCKER_SENTINEL_END = '__MSHELL_DOCKER_JSON_END__'

class DockerManager {
  async getOverview(connectionId: string): Promise<DockerOverview> {
    const output = await sshConnectionManager.executeCommand(
      connectionId,
      buildDockerOverviewScript(),
      30000
    )
    return parseJsonPayload<DockerOverview>(output)
  }

  async install(connectionId: string): Promise<string> {
    return await sshConnectionManager.executeCommand(connectionId, buildDockerInstallScript(), 180000)
  }

  async cleanupUnused(connectionId: string): Promise<string> {
    return await sshConnectionManager.executeCommand(
      connectionId,
      buildDockerCleanupUnusedScript(),
      180000
    )
  }

  async executeContainerAction(
    connectionId: string,
    action: DockerContainerAction,
    containerId: string,
    options: DockerContainerActionOptions = {}
  ): Promise<string> {
    return await this.executeContainerBatchAction(connectionId, action, [containerId], options)
  }

  async executeContainerBatchAction(
    connectionId: string,
    action: DockerContainerAction,
    containerIds: string[],
    options: DockerContainerActionOptions = {}
  ): Promise<string> {
    const targets = containerIds.map(shellQuote).join(' ')
    const command = action === 'remove'
      ? buildDockerRemoveScript(targets, options)
      : `set -e\n${buildDockerCommandPrefix()} ${getDockerActionCommand(action)} ${targets}`

    const output = await sshConnectionManager.executeCommand(
      connectionId,
      command,
      60000
    )
    return output.trim()
  }
}

function buildDockerOverviewScript(): string {
  return `sh <<'MSHELL_DOCKER_SCRIPT'
set +e

json_escape() {
  printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g; s/\\t/\\\\t/g; s/\\r/\\\\r/g; s/$/\\\\n/' | tr -d '\\n' | sed 's/\\\\n$//'
}

json_bool() {
  if [ "$1" = "true" ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

read_os_field() {
  key="$1"
  if [ -f /etc/os-release ]; then
    value="$(grep -E "^\${key}=" /etc/os-release | head -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
    printf '%s' "$value"
  fi
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then echo "apt"
  elif command -v dnf >/dev/null 2>&1; then echo "dnf"
  elif command -v yum >/dev/null 2>&1; then echo "yum"
  elif command -v apk >/dev/null 2>&1; then echo "apk"
  elif command -v zypper >/dev/null 2>&1; then echo "zypper"
  else echo "unknown"
  fi
}

docker_cmd_prefix() {
  if docker ps >/dev/null 2>&1; then
    printf 'docker'
  elif command -v sudo >/dev/null 2>&1 && sudo -n docker ps >/dev/null 2>&1; then
    printf 'sudo -n docker'
  else
    printf 'docker'
  fi
}

installed=false
compose_installed=false
socket_accessible=false
needs_sudo=false
docker_version=""
compose_version=""
service_status="unknown"

if command -v docker >/dev/null 2>&1; then
  installed=true
  docker_version="$(docker --version 2>/dev/null | head -n 1)"
  if docker ps >/dev/null 2>&1; then
    socket_accessible=true
  elif command -v sudo >/dev/null 2>&1 && sudo -n docker ps >/dev/null 2>&1; then
    socket_accessible=true
    needs_sudo=true
  fi

  if docker compose version >/dev/null 2>&1; then
    compose_installed=true
    compose_version="$(docker compose version 2>/dev/null | head -n 1)"
  elif command -v docker-compose >/dev/null 2>&1; then
    compose_installed=true
    compose_version="$(docker-compose --version 2>/dev/null | head -n 1)"
  fi

  if command -v systemctl >/dev/null 2>&1; then
    service_status="$(systemctl is-active docker 2>/dev/null || true)"
  elif command -v service >/dev/null 2>&1; then
    service docker status >/dev/null 2>&1 && service_status="active" || service_status="inactive"
  fi
fi

os_id="$(read_os_field ID)"
version_id="$(read_os_field VERSION_ID)"
pretty_name="$(read_os_field PRETTY_NAME)"
package_manager="$(detect_package_manager)"

containers_json=""
if [ "$installed" = "true" ] && [ "$socket_accessible" = "true" ]; then
  docker_prefix="$(docker_cmd_prefix)"
  ps_output="$($docker_prefix ps -a --no-trunc --size --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}|{{.Size}}' 2>/dev/null)"
  stats_output="$($docker_prefix stats --no-stream --format '{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}' 2>/dev/null)"

  first=true
  old_ifs="$IFS"
  IFS='
'
  for line in $ps_output; do
    [ -z "$line" ] && continue
    id="$(printf '%s' "$line" | cut -d'|' -f1)"
    name="$(printf '%s' "$line" | cut -d'|' -f2)"
    image="$(printf '%s' "$line" | cut -d'|' -f3)"
    status="$(printf '%s' "$line" | cut -d'|' -f4)"
    ports="$(printf '%s' "$line" | cut -d'|' -f5)"
    created_at="$(printf '%s' "$line" | cut -d'|' -f6)"
    size="$(printf '%s' "$line" | cut -d'|' -f7-)"
    short_id="$(printf '%s' "$id" | cut -c1-12)"
    status_lower="$(printf '%s' "$status" | tr '[:upper:]' '[:lower:]')"
    if printf '%s' "$status_lower" | grep -q 'paused'; then
      state="paused"
    elif printf '%s' "$status_lower" | grep -q '^up'; then
      state="running"
    elif printf '%s' "$status_lower" | grep -q '^exited'; then
      state="exited"
    elif printf '%s' "$status_lower" | grep -q '^created'; then
      state="created"
    elif printf '%s' "$status_lower" | grep -q '^restarting'; then
      state="restarting"
    else
      state="$status_lower"
    fi
    stats_line="$(printf '%s\n' "$stats_output" | grep -E "^($id|$short_id)\\|" | head -n 1)"
    cpu="$(printf '%s' "$stats_line" | cut -d'|' -f2)"
    memory="$(printf '%s' "$stats_line" | cut -d'|' -f3)"
    net_io="$(printf '%s' "$stats_line" | cut -d'|' -f4)"
    labels_line="$($docker_prefix inspect -f '{{with index .Config.Labels "com.docker.compose.project"}}{{.}}{{end}}|{{with index .Config.Labels "com.docker.compose.service"}}{{.}}{{end}}|{{with index .Config.Labels "com.docker.compose.project.working_dir"}}{{.}}{{end}}|{{with index .Config.Labels "com.docker.compose.project.config_files"}}{{.}}{{end}}' "$id" 2>/dev/null)"
    compose_project="$(printf '%s' "$labels_line" | cut -d'|' -f1)"
    compose_service="$(printf '%s' "$labels_line" | cut -d'|' -f2)"
    compose_working_dir="$(printf '%s' "$labels_line" | cut -d'|' -f3)"
    compose_config_files="$(printf '%s' "$labels_line" | cut -d'|' -f4-)"

    item="{\\"id\\":\\"$(json_escape "$id")\\",\\"name\\":\\"$(json_escape "$name")\\",\\"image\\":\\"$(json_escape "$image")\\",\\"status\\":\\"$(json_escape "$status")\\",\\"state\\":\\"$(json_escape "$state")\\",\\"ports\\":\\"$(json_escape "$ports")\\",\\"createdAt\\":\\"$(json_escape "$created_at")\\",\\"size\\":\\"$(json_escape "$size")\\",\\"cpu\\":\\"$(json_escape "\${cpu:--}")\\",\\"memory\\":\\"$(json_escape "\${memory:--}")\\",\\"netIO\\":\\"$(json_escape "\${net_io:--}")\\",\\"composeProject\\":\\"$(json_escape "$compose_project")\\",\\"composeService\\":\\"$(json_escape "$compose_service")\\",\\"composeWorkingDir\\":\\"$(json_escape "$compose_working_dir")\\",\\"composeConfigFiles\\":\\"$(json_escape "$compose_config_files")\\"}"
    if [ "$first" = "true" ]; then
      containers_json="$item"
      first=false
    else
      containers_json="$containers_json,$item"
    fi
  done
  IFS="$old_ifs"
fi

printf '%s\\n' '${DOCKER_SENTINEL_START}'
printf '{'
printf '"environment":{'
printf '"installed":%s,' "$(json_bool "$installed")"
printf '"dockerVersion":"%s",' "$(json_escape "$docker_version")"
printf '"composeInstalled":%s,' "$(json_bool "$compose_installed")"
printf '"composeVersion":"%s",' "$(json_escape "$compose_version")"
printf '"serviceStatus":"%s",' "$(json_escape "$service_status")"
printf '"socketAccessible":%s,' "$(json_bool "$socket_accessible")"
printf '"needsSudo":%s,' "$(json_bool "$needs_sudo")"
printf '"os":{"id":"%s","versionId":"%s","prettyName":"%s","packageManager":"%s"}' "$(json_escape "$os_id")" "$(json_escape "$version_id")" "$(json_escape "$pretty_name")" "$(json_escape "$package_manager")"
printf '},'
printf '"containers":[%s]' "$containers_json"
printf '}\\n'
printf '%s\\n' '${DOCKER_SENTINEL_END}'
MSHELL_DOCKER_SCRIPT`
}

function buildDockerInstallScript(): string {
  return `sh <<'MSHELL_DOCKER_INSTALL'
set -e

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "需要 root 权限或 sudo 才能安装 Docker。"
    exit 1
  fi
}

start_docker() {
  if command -v systemctl >/dev/null 2>&1; then
    run_as_root systemctl enable docker 2>/dev/null || true
    run_as_root systemctl start docker 2>/dev/null || true
  elif command -v service >/dev/null 2>&1; then
    run_as_root service docker start 2>/dev/null || true
  fi
}

install_with_apt() {
  run_as_root apt-get update
  run_as_root apt-get install -y docker.io docker-compose-plugin || run_as_root apt-get install -y docker.io docker-compose
}

install_with_dnf() {
  run_as_root dnf install -y docker docker-compose-plugin || run_as_root dnf install -y moby-engine docker-compose-plugin || run_as_root dnf install -y docker
}

install_with_yum() {
  run_as_root yum install -y docker docker-compose-plugin || run_as_root yum install -y docker
}

install_with_apk() {
  run_as_root apk add --no-cache docker docker-cli-compose
}

install_with_zypper() {
  run_as_root zypper --non-interactive install docker docker-compose || run_as_root zypper --non-interactive install docker
}

if command -v docker >/dev/null 2>&1; then
  echo "Docker 已安装：$(docker --version 2>/dev/null || true)"
else
  if command -v apt-get >/dev/null 2>&1; then
    install_with_apt
  elif command -v dnf >/dev/null 2>&1; then
    install_with_dnf
  elif command -v yum >/dev/null 2>&1; then
    install_with_yum
  elif command -v apk >/dev/null 2>&1; then
    install_with_apk
  elif command -v zypper >/dev/null 2>&1; then
    install_with_zypper
  else
    echo "暂不支持当前系统的自动安装。请手动安装 docker 与 docker compose 插件。"
    exit 1
  fi
fi

start_docker

echo "Docker: $(docker --version 2>/dev/null || echo '未检测到')"
if docker compose version >/dev/null 2>&1; then
  echo "Compose: $(docker compose version)"
elif command -v docker-compose >/dev/null 2>&1; then
  echo "Compose: $(docker-compose --version)"
else
  echo "Compose: 未检测到，请检查当前发行版是否提供 docker-compose-plugin。"
fi
MSHELL_DOCKER_INSTALL`
}

function buildDockerCommandPrefix(): string {
  return `${buildDockerCommandResolverScript()}\n$DOCKER_CMD`
}

function buildDockerCommandResolverScript(): string {
  return 'if docker ps >/dev/null 2>&1; then DOCKER_CMD="docker"; elif command -v sudo >/dev/null 2>&1 && sudo -n docker ps >/dev/null 2>&1; then DOCKER_CMD="sudo -n docker"; else DOCKER_CMD="docker"; fi'
}

function buildDockerCleanupUnusedScript(): string {
  return `set +e
${buildDockerCommandResolverScript()}
failed=0

echo "== 清理未使用镜像 =="
$DOCKER_CMD image prune -af
[ $? -eq 0 ] || failed=1

echo
echo "== 清理未使用卷 =="
$DOCKER_CMD volume prune -f
[ $? -eq 0 ] || failed=1

echo
echo "== 清理构建缓存 =="
if $DOCKER_CMD builder prune --help >/dev/null 2>&1; then
  $DOCKER_CMD builder prune -af
  [ $? -eq 0 ] || failed=1
else
  echo "当前 Docker 版本不支持 builder prune，已跳过。"
fi

echo
echo "== 当前 Docker 空间占用 =="
$DOCKER_CMD system df 2>/dev/null || true

exit "$failed"`
}

function buildDockerRemoveScript(
  targets: string,
  options: DockerContainerActionOptions
): string {
  const removeImage = options.removeImage ? 'true' : 'false'
  const removeNetworks = options.removeNetworks ? 'true' : 'false'

  return `set -e
${buildDockerCommandResolverScript()}
REMOVE_IMAGE=${removeImage}
REMOVE_NETWORKS=${removeNetworks}
IMAGES=""
NETWORKS=""

for TARGET in ${targets}; do
  if [ "$REMOVE_IMAGE" = "true" ]; then
    IMAGE_NAME="$($DOCKER_CMD inspect -f '{{.Config.Image}}' "$TARGET" 2>/dev/null || true)"
    if [ -n "$IMAGE_NAME" ]; then
      IMAGES="$IMAGES
$IMAGE_NAME"
    fi
  fi

  if [ "$REMOVE_NETWORKS" = "true" ]; then
    TARGET_NETWORKS="$($DOCKER_CMD inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$TARGET" 2>/dev/null || true)"
    if [ -n "$TARGET_NETWORKS" ]; then
      NETWORKS="$NETWORKS
$TARGET_NETWORKS"
    fi
  fi

  $DOCKER_CMD rm -f "$TARGET"
done

if [ "$REMOVE_IMAGE" = "true" ] && [ -n "$IMAGES" ]; then
  printf '%s\\n' "$IMAGES" | sort -u | while IFS= read -r image; do
    [ -z "$image" ] && continue
    if $DOCKER_CMD rmi "$image"; then
      echo "已删除镜像: $image"
    else
      echo "镜像删除失败或仍被其他容器使用: $image"
    fi
  done
fi

if [ "$REMOVE_NETWORKS" = "true" ] && [ -n "$NETWORKS" ]; then
  printf '%s\\n' "$NETWORKS" | sort -u | while IFS= read -r network; do
    [ -z "$network" ] && continue
    case "$network" in
      bridge|host|none)
        echo "跳过默认网络: $network"
        continue
        ;;
    esac
    if $DOCKER_CMD network rm "$network"; then
      echo "已删除网络: $network"
    else
      echo "网络删除失败或仍被其他容器使用: $network"
    fi
  done
fi`
}

function getDockerActionCommand(action: DockerContainerAction): string {
  const commands: Record<DockerContainerAction, string> = {
    start: 'start',
    pause: 'pause',
    unpause: 'unpause',
    restart: 'restart',
    stop: 'stop',
    remove: 'rm -f'
  }
  return commands[action]
}

function parseJsonPayload<T>(output: string): T {
  const start = output.indexOf(DOCKER_SENTINEL_START)
  const end = output.indexOf(DOCKER_SENTINEL_END)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Docker 检测输出格式异常')
  }

  const json = output.slice(start + DOCKER_SENTINEL_START.length, end).trim()
  return JSON.parse(json) as T
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export const dockerManager = new DockerManager()
