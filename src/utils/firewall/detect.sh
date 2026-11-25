set -u
export LC_ALL=C
meta() { printf 'META|%s|%s\n' "$1" "$2"; }
tool() { printf 'TOOL|%s|%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" "$5"; }
error() { printf 'ERROR|%s|%s\n' "$1" "$2"; }
raw() { while IFS= read -r line; do printf '%s|%s|%s\n' "$1" "$2" "$line"; done; }
printf '__MSHELL_FIREWALL_V3__\n'
meta needs_privilege "$2"
meta can_sudo "$3"
set -- $1
meta ssh_client_ip "${1:-}"
if [ -n "${4:-}" ];then meta ssh_server_ip "$3";else meta ssh_server_ip '';fi
if [ -n "${4:-}" ]; then meta ssh_server_port "$4"; else meta ssh_server_port "${3:-}"; fi
ssh_interface=''
if command -v ip >/dev/null 2>&1 && [ -n "${1:-}" ]; then
  route=$(ip -o route get "$1" ${4:+from "$3"} 2>/dev/null || true)
  ssh_interface=$(printf '%s\n' "$route" | awk '{for(i=1;i<NF;i++) if($i=="dev") {print $(i+1);exit}}')
fi
meta ssh_interface "$ssh_interface"
if [ -r /etc/os-release ]; then
  meta os_id "$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"' | head -n1)"
  meta os_name "$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"' | head -n1)"
fi
pkg=unknown
for bin in apt-get dnf yum zypper pacman apk; do if command -v "$bin" >/dev/null 2>&1; then pkg=$bin;break;fi;done
meta package_manager "$pkg"
systemd=no
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then systemd=yes;fi
meta systemd "$systemd"
watchdog=no
if [ "$systemd" = yes ] && command -v systemd-run >/dev/null 2>&1; then watchdog=yes;fi
meta watchdog "$watchdog"
persist=no
if [ -x /usr/local/sbin/mshell-firewall-restore ] && [ "$systemd" = yes ] && systemctl is-enabled --quiet mshell-firewall.service 2>/dev/null; then persist=yes;fi
meta mshell_persistence "$persist"

if command -v ufw >/dev/null 2>&1; then
  active=no;status=unknown
  if listing=$(ufw status numbered 2>/dev/null); then
    case "$listing" in *'Status: active'*) active=yes;status=active;; *'Status: inactive'*) status=inactive;; *) error ufw '无法识别 UFW 状态';;esac
    printf '%s\n' "$listing" | raw RULE_RAW ufw
  else error ufw '读取 UFW 失败，请检查权限与服务';fi
  tool ufw yes "$active" "$status" "$(ufw --version 2>/dev/null | head -n1)"
else tool ufw no no absent '';fi

if command -v firewall-cmd >/dev/null 2>&1; then
  active=no;status=unknown;fw=firewall-cmd;runtime='';permanent=''
  if state=$(firewall-cmd --state 2>&1); then active=yes;status=active
  else case "$state" in *'not running'*) status=inactive;fw=firewall-offline-cmd;; *) error firewalld '无法读取 Firewalld 状态';;esac;fi
  tool firewalld yes "$active" "$status" "$(firewall-cmd --version 2>/dev/null | head -n1)"
  if [ "$status" != unknown ] && command -v "$fw" >/dev/null 2>&1; then
    if zone=$($fw --get-default-zone 2>/dev/null); then meta default_zone "$zone";else error firewalld '读取默认 zone 失败';fi
    if [ "$active" = yes ]; then
      if runtime=$(firewall-cmd --list-all-zones 2>/dev/null); then printf '%s\n' "$runtime" | raw FW_DUMP runtime;else error firewalld '读取运行时 zone 失败';fi
      if permanent=$(firewall-cmd --permanent --list-all-zones 2>/dev/null); then printf '%s\n' "$permanent" | raw FW_DUMP permanent;else error firewalld '读取永久 zone 失败';fi
    else
      if permanent=$(firewall-offline-cmd --list-all-zones 2>/dev/null); then printf '%s\n' "$permanent" | raw FW_DUMP permanent;else error firewalld '读取离线 zone 配置失败';fi
    fi
    services=$({ printf '%s\n%s\n' "$runtime" "$permanent" | awk '/^[[:space:]]+services:/ {for(i=2;i<=NF;i++) print $i}'; printf '%s\n%s\n' "$runtime" "$permanent" | sed -n 's/.*service name="\([^"]*\)".*/\1/p'; } | sort -u)
    for service in $services; do
      for scope in runtime permanent; do
        [ "$scope" = runtime ] && [ "$active" != yes ] && continue
        args='';[ "$scope" = permanent ] && [ "$active" = yes ] && args=--permanent
        info=$($fw $args --info-service="$service" 2>/dev/null || true)
        ports=$(printf '%s\n' "$info" | sed -n 's/^[[:space:]]*ports:[[:space:]]*//p')
        includes=$(printf '%s\n' "$info" | sed -n 's/^[[:space:]]*includes:[[:space:]]*//p')
        [ -z "$ports" ] || [ -z "$includes" ] || ports=unknown
        printf 'SERVICE|%s|%s|%s\n' "$scope" "$service" "${ports:-unknown}"
      done
    done
  elif [ "$status" = inactive ]; then error firewalld '缺少离线管理工具，无法读取 zone';fi
else tool firewalld no no absent '';fi

if command -v iptables >/dev/null 2>&1; then
  version=$(iptables --version 2>/dev/null || true);backend=unknown
  case "$version" in *nf_tables*) backend=nf_tables;; *legacy*) backend=legacy;;esac
  meta iptables_backend "$backend"
  active=no;status=inactive
  for family in 4 6; do
    bin=iptables;policykey=iptables_policy_v4
    [ "$family" = 6 ] && { bin=ip6tables;policykey=iptables_policy_v6; }
    command -v "$bin" >/dev/null 2>&1 || continue
    if input=$($bin -w 5 -S INPUT 2>/dev/null); then
      policy=$(printf '%s\n' "$input" | sed -n 's/^-P INPUT //p');meta "$policykey" "$policy"
      case "$policy" in DROP|REJECT) active=yes;status=active;;esac
      printf '%s\n' "$input" | while IFS= read -r line; do printf 'RULE_RAW|iptables|%s|%s\n' "$family" "$line";done
      own=$($bin -w 5 -S MSHELL-INPUT 2>/dev/null || true)
      printf '%s\n' "$own" | while IFS= read -r line; do [ -n "$line" ] && printf 'RULE_RAW|iptables|%s|%s\n' "$family" "$line";done
    else status=unknown;error iptables "无法读取 $bin INPUT";fi
  done
  tool iptables yes "$active" "$status" "$version"
else tool iptables no no absent '';fi
for scope in persistent runtime; do
  file=/etc/mshell/firewall.rules;[ "$scope" = runtime ] && file=/run/mshell-firewall/runtime.rules
  if [ -e "$file" ]; then
    if [ -r "$file" ]; then raw CONFIG "$scope" < "$file";else error iptables "无法读取 $scope 规则文件";fi
  fi
done
if command -v nft >/dev/null 2>&1; then
  if nft_json=$(nft -j list ruleset 2>/dev/null); then
    printf '%s\n' "$nft_json" | while IFS= read -r line; do printf 'NFT_JSON|%s\n' "$line";done
    if nft_rules=$(nft list ruleset 2>/dev/null); then printf '%s\n' "$nft_rules" | raw RULE_RAW nftables;fi
    tool nftables yes no kernel "$(nft --version 2>/dev/null)"
  else tool nftables yes no unknown '';error nftables '无法读取内核规则';fi
else tool nftables no no absent '';fi
if command -v docker >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1;then
    ports=$(timeout 5 docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null || true)
    printf '%s\n' "$ports" | while IFS='|' read -r name published; do [ -n "$published" ] && printf 'CONTAINER_PORT|%s|%s\n' "$name" "$published";done
  fi
fi
printf '__MSHELL_FIREWALL_END__\n'
