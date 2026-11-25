import { promises as fs } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { BaseManager } from './BaseManager'
import { extractScriptVariables, renderScriptText } from '../../src/utils/lazy-script-template'

export type LazyScriptType = 'command' | 'shell' | 'steps'
export type LazyScriptRunMode = 'copy' | 'paste' | 'execute'
export type LazyScriptRiskLevel = 'low' | 'medium' | 'high'
export type LazyScriptVariableType =
  | 'text'
  | 'number'
  | 'password'
  | 'textarea'
  | 'select'
  | 'multiselect'

export interface LazyScriptVariable {
  name: string
  label: string
  type: LazyScriptVariableType
  defaultValue?: string
  required?: boolean
  options?: string[]
}

export interface LazyScript {
  id: string
  name: string
  fileName: string
  description: string
  category: string
  tags: string[]
  type: LazyScriptType
  content: string
  variables: LazyScriptVariable[]
  riskLevel: LazyScriptRiskLevel
  runMode: LazyScriptRunMode
  usageCount: number
  createdAt: string
  updatedAt: string
}

const VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const CHANGE_SSH_PORT_SCRIPT_DESCRIPTION =
  '修改 sshd 监听端口，并自动检测本机防火墙与 SELinux 放行。'
const REPLACE_SSH_PUBLIC_KEY_SCRIPT_DESCRIPTION =
  '为指定用户替换 authorized_keys 中的 SSH 公钥，自动备份并修正权限。'
const DISABLE_SSH_PASSWORD_SCRIPT_DESCRIPTION =
  '禁用 SSH 密码与交互式密码认证，仅允许已配置公钥的用户使用密钥登录。'
const ENABLE_SSH_PASSWORD_SCRIPT_DESCRIPTION =
  '开启 SSH 密码与交互式密码认证，可同时设置 SSH 端口，适合临时测试后再关闭。'
const CHANGE_LOGIN_PASSWORD_SCRIPT_DESCRIPTION =
  '为指定 Linux 用户修改登录密码，适合临时重置或初始化账号密码。'
const INSTALL_BASIC_TOOLS_SCRIPT_DESCRIPTION =
  '按分类选择单个工具安装 sudo、网络诊断、压缩解压、监控排障等常用基础工具，并支持额外包名。'
const INSTALL_BASIC_TOOLS_DEFAULT_TOOLS = 'sudo,curl,wget,tar,gzip,vim,nano'
const INSTALL_BASIC_TOOLS_SCRIPT_VARIABLES: LazyScriptVariable[] = [
  {
    name: 'tools',
    label: '工具',
    type: 'multiselect',
    defaultValue: INSTALL_BASIC_TOOLS_DEFAULT_TOOLS,
    required: true,
    options: [
      'sudo|基础工具|sudo',
      'curl|基础工具|curl',
      'wget|基础工具|wget',
      'ca-certificates|基础工具|CA 证书',
      'gnupg|基础工具|GnuPG',
      'vim|基础工具|vim',
      'nano|基础工具|nano',
      'less|基础工具|less',
      'bash-completion|基础工具|bash-completion',
      'git|基础工具|git',
      'jq|基础工具|jq',
      'tree|基础工具|tree',
      'rsync|基础工具|rsync',
      'tar|基础工具|tar',
      'gzip|基础工具|gzip',
      'openssh-client|管理权限|SSH 客户端',
      'openssh-server|管理权限|SSH 服务端',
      'cron|管理权限|cron 定时任务',
      'acl|管理权限|ACL 权限工具',
      'passwd|管理权限|passwd/shadow',
      'adduser|管理权限|用户创建工具',
      'dig|网络诊断|dig/nslookup',
      'ping|网络诊断|ping',
      'iproute|网络诊断|ip/ss',
      'net-tools|网络诊断|ifconfig/netstat',
      'traceroute|网络诊断|traceroute',
      'tcpdump|网络诊断|tcpdump',
      'nmap|网络诊断|nmap',
      'socat|网络诊断|socat',
      'telnet|网络诊断|telnet',
      'mtr|网络诊断|mtr',
      'netcat|网络诊断|netcat',
      'zip|压缩解压|zip',
      'unzip|压缩解压|unzip',
      'xz|压缩解压|xz',
      'bzip2|压缩解压|bzip2',
      'p7zip|压缩解压|7z/p7zip',
      'htop|监控排障|htop',
      'iotop|监控排障|iotop',
      'iftop|监控排障|iftop',
      'sysstat|监控排障|sysstat',
      'lsof|监控排障|lsof',
      'strace|监控排障|strace',
      'psmisc|监控排障|psmisc',
      'procps|监控排障|procps',
      'ncdu|监控排障|ncdu',
      'parted|磁盘工具|parted',
      'gdisk|磁盘工具|gdisk',
      'smartmontools|磁盘工具|smartmontools',
      'build-essential|编译工具|编译基础套件',
      'make|编译工具|make',
      'gcc|编译工具|gcc',
      'gpp|编译工具|g++',
      'pkg-config|编译工具|pkg-config',
      'cmake|编译工具|cmake',
      'autoconf|编译工具|autoconf',
      'automake|编译工具|automake',
      'python3|Python|python3',
      'python3-pip|Python|pip',
      'python3-venv|Python|venv',
      'python3-dev|Python|dev headers',
      'nodejs|Node.js|nodejs',
      'npm|Node.js|npm',
      'fail2ban|安全辅助|fail2ban',
      'ufw|安全辅助|ufw',
      'firewalld|安全辅助|firewalld',
      'openssl|安全辅助|openssl'
    ]
  },
  {
    name: 'extra_packages',
    label: '额外包名',
    type: 'text',
    defaultValue: ''
  }
]
const AUTO_CHANGE_MIRROR_SCRIPT_DESCRIPTION =
  '自动检测 Linux 发行版与公网 IP 地区，基于内置规则更换合适的软件源。'
const AUTO_CHANGE_MIRROR_SCRIPT_VARIABLES: LazyScriptVariable[] = [
  {
    name: 'region_mode',
    label: '地区模式',
    type: 'select',
    defaultValue: 'auto',
    required: true,
    options: ['auto', 'cn', 'abroad', 'edu']
  },
  {
    name: 'mirror_source',
    label: '镜像站',
    type: 'select',
    defaultValue: 'auto',
    required: true,
    options: ['auto', 'aliyun', 'ustc', 'tencent', 'huawei', 'tsinghua', 'official', 'custom']
  },
  {
    name: 'custom_source',
    label: '自定义源域名',
    type: 'text',
    defaultValue: ''
  },
  {
    name: 'upgrade_software',
    label: '升级软件包',
    type: 'select',
    defaultValue: 'false',
    required: true,
    options: ['false', 'true']
  },
  {
    name: 'print_diff',
    label: '打印源文件差异',
    type: 'select',
    defaultValue: 'false',
    required: true,
    options: ['false', 'true']
  }
]
const SSH_PORT_VARIABLE: LazyScriptVariable = {
  name: 'ssh_port',
  label: 'SSH 端口',
  type: 'number',
  defaultValue: '22',
  required: true
}

const CHANGE_SSH_PORT_SCRIPT_CONTENT = `set -e
NEW_PORT="{{ssh_port}}"
PROTOCOL="tcp"
FIREWALL_FOUND=0
FIREWALL_ERRORS=0
FIREWALL_CHANGED=0

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

if ! printf '%s' "$NEW_PORT" | grep -Eq '^[0-9]+$' || [ "$NEW_PORT" -lt 1 ] || [ "$NEW_PORT" -gt 65535 ]; then
  echo "SSH 端口必须是 1-65535 的数字。"
  exit 1
fi

SSHD_BIN="$(command -v sshd || true)"
if [ -z "$SSHD_BIN" ] && [ -x /usr/sbin/sshd ]; then
  SSHD_BIN="/usr/sbin/sshd"
fi
if [ -z "$SSHD_BIN" ]; then
  echo "未检测到 sshd，请先确认系统 SSH 服务。"
  exit 1
fi

SSHD_CONFIG="/etc/ssh/sshd_config"
if [ ! -f "$SSHD_CONFIG" ]; then
  echo "未找到 SSH 配置文件: $SSHD_CONFIG"
  exit 1
fi

mark_firewall_error() {
  FIREWALL_ERRORS=1
  echo "防火墙/安全策略放行失败: $1"
}

mark_firewall_changed() {
  FIREWALL_CHANGED=1
}

ensure_selinux_port() {
  if ! command -v getenforce >/dev/null 2>&1; then
    return
  fi

  SELINUX_MODE="$(getenforce 2>/dev/null || echo Disabled)"
  if [ "$SELINUX_MODE" = "Disabled" ]; then
    return
  fi

  if ! command -v semanage >/dev/null 2>&1; then
    if [ "$SELINUX_MODE" = "Enforcing" ]; then
      echo "SELinux 处于 Enforcing，但未安装 semanage，无法确认新端口是否允许。"
      echo "请先安装 policycoreutils-python-utils 或手动放行 ssh_port_t 后再执行。"
      FIREWALL_ERRORS=1
    else
      echo "SELinux 处于 $SELINUX_MODE，未检测到 semanage，跳过 SELinux 端口策略。"
    fi
    return
  fi

  if semanage port -l 2>/dev/null | awk '$1 == "ssh_port_t" && $2 == "tcp" {print $0}' | grep -Eq "(^|[ ,])$NEW_PORT([, ]|$)"; then
    echo "SELinux 已允许 SSH 端口 $NEW_PORT/tcp"
    return
  fi

  echo "检测到 SELinux，正在允许 SSH 端口 $NEW_PORT/tcp"
  if semanage port -a -t ssh_port_t -p tcp "$NEW_PORT" 2>/dev/null; then
    echo "已添加 SELinux SSH 端口策略: $NEW_PORT/tcp"
    mark_firewall_changed
  elif semanage port -m -t ssh_port_t -p tcp "$NEW_PORT" 2>/dev/null; then
    echo "已更新 SELinux SSH 端口策略: $NEW_PORT/tcp"
    mark_firewall_changed
  else
    mark_firewall_error "SELinux ssh_port_t $NEW_PORT/tcp"
  fi
}

allow_ufw() {
  if ! command -v ufw >/dev/null 2>&1; then
    return 1
  fi

  if ! ufw status 2>/dev/null | grep -qi "Status: active"; then
    echo "检测到 UFW，但当前未启用，跳过。"
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 UFW，正在放行 $NEW_PORT/$PROTOCOL"
  if ufw allow "$NEW_PORT/$PROTOCOL"; then
    mark_firewall_changed
  else
    mark_firewall_error "UFW $NEW_PORT/$PROTOCOL"
  fi
  return 0
}

allow_firewalld() {
  if ! command -v firewall-cmd >/dev/null 2>&1 || ! firewall-cmd --state >/dev/null 2>&1; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 firewalld，正在放行 $NEW_PORT/$PROTOCOL"
  ACTIVE_ZONES="$(firewall-cmd --get-active-zones 2>/dev/null | awk 'NR % 2 == 1 {print $1}' || true)"
  if [ -z "$ACTIVE_ZONES" ]; then
    DEFAULT_ZONE="$(firewall-cmd --get-default-zone 2>/dev/null || true)"
    ACTIVE_ZONES="$DEFAULT_ZONE"
  fi

  for ZONE in $ACTIVE_ZONES; do
    [ -n "$ZONE" ] || continue
    echo "firewalld zone: $ZONE"
    if firewall-cmd --zone="$ZONE" --query-port="$NEW_PORT/$PROTOCOL" >/dev/null 2>&1; then
      echo "firewalld 运行时规则已存在: $ZONE $NEW_PORT/$PROTOCOL"
    elif firewall-cmd --zone="$ZONE" --add-port="$NEW_PORT/$PROTOCOL"; then
      mark_firewall_changed
    else
      mark_firewall_error "firewalld runtime $ZONE $NEW_PORT/$PROTOCOL"
    fi

    if firewall-cmd --permanent --zone="$ZONE" --query-port="$NEW_PORT/$PROTOCOL" >/dev/null 2>&1; then
      echo "firewalld 永久规则已存在: $ZONE $NEW_PORT/$PROTOCOL"
    elif firewall-cmd --permanent --zone="$ZONE" --add-port="$NEW_PORT/$PROTOCOL"; then
      mark_firewall_changed
    else
      mark_firewall_error "firewalld permanent $ZONE $NEW_PORT/$PROTOCOL"
    fi
  done

  firewall-cmd --reload || mark_firewall_error "firewalld reload"
  return 0
}

allow_nftables() {
  if ! command -v nft >/dev/null 2>&1; then
    return 1
  fi

  NFT_RULESET="$(nft list ruleset 2>/dev/null || true)"
  if ! printf '%s\\n' "$NFT_RULESET" | grep -Eq 'hook input'; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 nftables input 规则，正在添加运行时放行 $NEW_PORT/$PROTOCOL"
  nft list table inet mshell_ssh >/dev/null 2>&1 || nft add table inet mshell_ssh || mark_firewall_error "nft add table"
  nft list chain inet mshell_ssh input >/dev/null 2>&1 || nft add chain inet mshell_ssh input '{ type filter hook input priority -200; policy accept; }' || mark_firewall_error "nft add input chain"
  if nft list chain inet mshell_ssh input 2>/dev/null | grep -q "tcp dport $NEW_PORT accept"; then
    echo "nftables 规则已存在: $NEW_PORT/$PROTOCOL"
  elif nft add rule inet mshell_ssh input tcp dport "$NEW_PORT" accept; then
    mark_firewall_changed
  else
    mark_firewall_error "nft add rule $NEW_PORT/$PROTOCOL"
  fi

  if [ -f /etc/nftables.conf ] && [ -w /etc/nftables.conf ]; then
    NFT_BACKUP="/etc/nftables.conf.bak.$(date +%Y%m%d%H%M%S)"
    if cp /etc/nftables.conf "$NFT_BACKUP"; then
      if nft list ruleset > /etc/nftables.conf; then
        echo "已备份 nftables 配置: $NFT_BACKUP"
        echo "nftables 规则已保存到 /etc/nftables.conf，重启后仍会生效。"
      else
        mark_firewall_error "nftables 持久化到 /etc/nftables.conf"
      fi
    else
      mark_firewall_error "备份 /etc/nftables.conf"
    fi
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet nftables 2>/dev/null; then
    mark_firewall_error "nftables 服务已启用，但无法写入 /etc/nftables.conf 持久化规则"
  else
    mark_firewall_error "未找到可确认的 nftables 持久化配置，规则可能重启后丢失"
  fi
  return 0
}

allow_iptables() {
  if ! command -v iptables >/dev/null 2>&1; then
    return 1
  fi

  IPTABLES_INPUT="$(iptables -S INPUT 2>/dev/null || true)"
  if [ -z "$IPTABLES_INPUT" ]; then
    return 1
  fi

  if ! printf '%s\\n' "$IPTABLES_INPUT" | grep -Eq '^-P INPUT (DROP|REJECT)|^-A INPUT'; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 iptables INPUT 规则，正在放行 $NEW_PORT/$PROTOCOL"
  if iptables -C INPUT -p tcp --dport "$NEW_PORT" -j ACCEPT 2>/dev/null; then
    echo "iptables 规则已存在: $NEW_PORT/$PROTOCOL"
  elif iptables -I INPUT -p tcp --dport "$NEW_PORT" -j ACCEPT; then
    mark_firewall_changed
  else
    mark_firewall_error "iptables $NEW_PORT/$PROTOCOL"
  fi

  if command -v netfilter-persistent >/dev/null 2>&1; then
    if netfilter-persistent save; then
      echo "iptables 规则已通过 netfilter-persistent 保存，重启后仍会生效。"
    else
      mark_firewall_error "netfilter-persistent save"
    fi
  elif [ -d /etc/iptables ] && command -v iptables-save >/dev/null 2>&1; then
    if iptables-save > /etc/iptables/rules.v4; then
      echo "iptables 规则已保存到 /etc/iptables/rules.v4，重启后仍会生效。"
    else
      mark_firewall_error "iptables-save > /etc/iptables/rules.v4"
    fi
  elif command -v service >/dev/null 2>&1; then
    if service iptables save 2>/dev/null; then
      echo "iptables 规则已通过 service iptables save 保存，重启后仍会生效。"
    else
      mark_firewall_error "iptables 未找到可确认的持久化方式"
    fi
  else
    mark_firewall_error "iptables 未找到可确认的持久化方式"
  fi
  return 0
}

allow_firewalls() {
  ensure_selinux_port

  if allow_ufw; then
    :
  elif allow_firewalld; then
    :
  elif allow_nftables; then
    :
  else
    allow_iptables || true
  fi

  if [ "$FIREWALL_FOUND" -eq 0 ]; then
    echo "未检测到已启用或可识别的本机防火墙。若云厂商安全组存在限制，请手动放行 $NEW_PORT/$PROTOCOL。"
  fi

  if [ "$FIREWALL_ERRORS" -ne 0 ]; then
    echo "检测到防火墙或 SELinux 放行失败，已停止修改 SSH 配置，避免锁定服务器。"
    exit 1
  fi

  if [ "$FIREWALL_CHANGED" -eq 0 ]; then
    echo "本机防火墙/安全策略未发现需要新增的规则。"
  fi
}

restart_sshd() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart sshd 2>/dev/null && return 0
    systemctl restart ssh 2>/dev/null && return 0
  fi
  service sshd restart 2>/dev/null && return 0
  service ssh restart 2>/dev/null && return 0
  return 1
}

allow_firewalls

BACKUP_FILE="$SSHD_CONFIG.bak.$(date +%Y%m%d%H%M%S)"
cp "$SSHD_CONFIG" "$BACKUP_FILE"
echo "已备份 SSH 配置: $BACKUP_FILE"

if grep -qE '^[[:space:]]*#?[[:space:]]*Port[[:space:]]+' "$SSHD_CONFIG"; then
  sed -i -E "s/^[[:space:]]*#?[[:space:]]*Port[[:space:]]+.*/Port $NEW_PORT/" "$SSHD_CONFIG"
else
  printf '\\nPort %s\\n' "$NEW_PORT" >> "$SSHD_CONFIG"
fi

if [ -d /etc/ssh/sshd_config.d ] && grep -RIsnE '^[[:space:]]*Port[[:space:]]+' /etc/ssh/sshd_config.d >/dev/null 2>&1; then
  echo "注意：/etc/ssh/sshd_config.d 中也存在 Port 配置，请确认最终生效端口。"
  grep -RIsnE '^[[:space:]]*Port[[:space:]]+' /etc/ssh/sshd_config.d || true
fi

if ! "$SSHD_BIN" -t -f "$SSHD_CONFIG"; then
  cp "$BACKUP_FILE" "$SSHD_CONFIG"
  echo "sshd 配置校验失败，已恢复备份，未重启 SSH 服务。"
  exit 1
fi

if ! restart_sshd; then
  cp "$BACKUP_FILE" "$SSHD_CONFIG"
  restart_sshd || true
  echo "SSH 服务重启失败，已恢复旧配置。请检查服务名称和系统日志。"
  exit 1
fi

if [ "$FIREWALL_FOUND" -eq 0 ]; then
  echo "SSH 端口已修改为 $NEW_PORT，未检测到本机防火墙规则，无需写入本机放行规则。"
else
  echo "SSH 端口已修改为 $NEW_PORT，并已确认可识别防火墙的放行规则持久化。"
fi
echo "请先打开新连接测试 $NEW_PORT 端口，再关闭当前连接。"
echo "如果服务器还有云厂商安全组/外部防火墙，请同时放行 $NEW_PORT/$PROTOCOL。"`

const FIREWALL_PORT_SCRIPT_DESCRIPTION =
  '自动识别 UFW、firewalld、nftables 或 iptables，按单个/多个端口、全端口和来源 IP/IP 段放行，并确认规则持久化。'
const FIREWALL_PORT_SCRIPT_VARIABLES: LazyScriptVariable[] = [
  {
    name: 'ports',
    label: '端口',
    type: 'text',
    defaultValue: '22,80,443',
    required: true
  },
  {
    name: 'protocol',
    label: '协议',
    type: 'multiselect',
    defaultValue: 'tcp',
    required: true,
    options: ['tcp', 'udp']
  },
  {
    name: 'sources',
    label: '来源 IP/IP 段',
    type: 'textarea',
    defaultValue: 'any',
    required: true
  }
]

const FIREWALL_PORT_SCRIPT_CONTENT = `set -e
set -f
PORTS="{{ports}}"
PROTOCOL="{{protocol}}"
SOURCES_RAW="$(cat <<'MSHELL_SOURCES'
{{sources}}
MSHELL_SOURCES
)"
FIREWALL_FOUND=0
FIREWALL_ERRORS=0
FIREWALL_CHANGED=0
PORT_LIST=""
PROTOCOL_LIST=""
SOURCE_LIST=""
HAS_ANY_SOURCE=0
HAS_ANY_PORT=0
ANY_PORT_TOKEN="__ANY_PORT__"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

normalize_words() {
  printf '%s' "$1" | tr ',，;；\\n\\r\\t' '      '
}

add_unique_word() {
  LIST_VALUE="$1"
  ITEM_VALUE="$2"
  case " $LIST_VALUE " in
    *" $ITEM_VALUE "*) printf '%s\\n' "$LIST_VALUE" ;;
    *) printf '%s %s\\n' "$LIST_VALUE" "$ITEM_VALUE" | xargs ;;
  esac
}

for PORT_ITEM in $(normalize_words "$PORTS"); do
  case "$PORT_ITEM" in
    '*'|any|all|ANY|ALL)
      HAS_ANY_PORT=1
      ;;
    *)
      if ! printf '%s' "$PORT_ITEM" | grep -Eq '^[0-9]+$' || [ "$PORT_ITEM" -lt 1 ] || [ "$PORT_ITEM" -gt 65535 ]; then
        echo "端口必须是 1-65535 的数字，或使用 * 表示全部端口，当前值: $PORT_ITEM"
        exit 1
      fi
      PORT_LIST="$(add_unique_word "$PORT_LIST" "$PORT_ITEM")"
      ;;
  esac
done

if [ "$HAS_ANY_PORT" -eq 1 ]; then
  PORT_LIST="$ANY_PORT_TOKEN"
fi

if [ -z "$PORT_LIST" ]; then
  echo "请至少填写一个端口。"
  exit 1
fi

for PROTOCOL_ITEM in $(normalize_words "$PROTOCOL"); do
  case "$PROTOCOL_ITEM" in
    tcp|udp) PROTOCOL_LIST="$(add_unique_word "$PROTOCOL_LIST" "$PROTOCOL_ITEM")" ;;
    *)
      echo "协议只支持 tcp 或 udp，当前值: $PROTOCOL_ITEM"
      exit 1
      ;;
  esac
done

if [ -z "$PROTOCOL_LIST" ]; then
  echo "请至少选择一个协议。"
  exit 1
fi

for SOURCE_ITEM in $(normalize_words "$SOURCES_RAW"); do
  case "$SOURCE_ITEM" in
    ''|any|all|ANY|ALL|'*'|0.0.0.0/0|::/0)
      HAS_ANY_SOURCE=1
      ;;
    *)
      if printf '%s' "$SOURCE_ITEM" | grep -Eq '^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$'; then
        SOURCE_LIST="$(add_unique_word "$SOURCE_LIST" "$SOURCE_ITEM")"
      else
        echo "来源 IP/IP 段格式不支持: $SOURCE_ITEM"
        echo "请使用单个 IP 或 CIDR，例如 192.168.1.10、192.168.1.0/24、2001:db8::/32；任意来源填写 any。"
        exit 1
      fi
      ;;
  esac
done

if [ "$HAS_ANY_SOURCE" -eq 1 ] || [ -z "$SOURCE_LIST" ]; then
  SOURCE_LIST="__ANY__"
fi

mark_firewall_error() {
  FIREWALL_ERRORS=1
  echo "防火墙放行失败: $1"
}

mark_firewall_changed() {
  FIREWALL_CHANGED=1
}

source_label() {
  [ "$1" = "__ANY__" ] && printf '任意来源' || printf '%s' "$1"
}

port_label() {
  [ "$1" = "$ANY_PORT_TOKEN" ] && printf '全部端口' || printf '%s' "$1"
}

port_list_label() {
  printf '%s' "$PORT_LIST" | sed "s/$ANY_PORT_TOKEN/全部端口/g"
}

port_for_ufw() {
  [ "$1" = "$ANY_PORT_TOKEN" ] && printf '1:65535' || printf '%s' "$1"
}

port_for_firewalld() {
  [ "$1" = "$ANY_PORT_TOKEN" ] && printf '1-65535' || printf '%s' "$1"
}

source_family() {
  case "$1" in
    *:*) printf 'ipv6' ;;
    *) printf 'ipv4' ;;
  esac
}

allow_ufw() {
  if ! command -v ufw >/dev/null 2>&1; then
    return 1
  fi

  if ! ufw status 2>/dev/null | grep -qi "Status: active"; then
    echo "检测到 UFW，但当前未启用，跳过。"
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 UFW，正在放行端口。"
  for PORT in $PORT_LIST; do
    UFW_PORT="$(port_for_ufw "$PORT")"
    PORT_TEXT="$(port_label "$PORT")"
    for PROTOCOL_ITEM in $PROTOCOL_LIST; do
      for SOURCE in $SOURCE_LIST; do
        LABEL="$(source_label "$SOURCE")"
        if [ "$SOURCE" = "__ANY__" ]; then
          echo "UFW: $LABEL -> $PORT_TEXT/$PROTOCOL_ITEM"
          ufw allow "$UFW_PORT/$PROTOCOL_ITEM" && mark_firewall_changed || mark_firewall_error "UFW $PORT_TEXT/$PROTOCOL_ITEM"
        else
          echo "UFW: $LABEL -> $PORT_TEXT/$PROTOCOL_ITEM"
          ufw allow from "$SOURCE" to any port "$UFW_PORT" proto "$PROTOCOL_ITEM" && mark_firewall_changed || mark_firewall_error "UFW $SOURCE $PORT_TEXT/$PROTOCOL_ITEM"
        fi
      done
    done
  done
  echo "UFW 规则已保存，重启后仍会生效。"
  return 0
}

allow_firewalld() {
  if ! command -v firewall-cmd >/dev/null 2>&1 || ! firewall-cmd --state >/dev/null 2>&1; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 firewalld，正在放行端口。"
  ACTIVE_ZONES="$(firewall-cmd --get-active-zones 2>/dev/null | awk 'NR % 2 == 1 {print $1}' || true)"
  if [ -z "$ACTIVE_ZONES" ]; then
    DEFAULT_ZONE="$(firewall-cmd --get-default-zone 2>/dev/null || true)"
    ACTIVE_ZONES="$DEFAULT_ZONE"
  fi

  for ZONE in $ACTIVE_ZONES; do
    [ -n "$ZONE" ] || continue
    echo "firewalld zone: $ZONE"
    for PORT in $PORT_LIST; do
      FIREWALLD_PORT="$(port_for_firewalld "$PORT")"
      PORT_TEXT="$(port_label "$PORT")"
      for PROTOCOL_ITEM in $PROTOCOL_LIST; do
        for SOURCE in $SOURCE_LIST; do
          if [ "$SOURCE" = "__ANY__" ]; then
            if firewall-cmd --zone="$ZONE" --query-port="$FIREWALLD_PORT/$PROTOCOL_ITEM" >/dev/null 2>&1; then
              echo "firewalld 运行时规则已存在: $ZONE $PORT_TEXT/$PROTOCOL_ITEM"
            elif firewall-cmd --zone="$ZONE" --add-port="$FIREWALLD_PORT/$PROTOCOL_ITEM"; then
              mark_firewall_changed
            else
              mark_firewall_error "firewalld runtime $ZONE $PORT_TEXT/$PROTOCOL_ITEM"
            fi

            if firewall-cmd --permanent --zone="$ZONE" --query-port="$FIREWALLD_PORT/$PROTOCOL_ITEM" >/dev/null 2>&1; then
              echo "firewalld 永久规则已存在: $ZONE $PORT_TEXT/$PROTOCOL_ITEM"
            elif firewall-cmd --permanent --zone="$ZONE" --add-port="$FIREWALLD_PORT/$PROTOCOL_ITEM"; then
              mark_firewall_changed
            else
              mark_firewall_error "firewalld permanent $ZONE $PORT_TEXT/$PROTOCOL_ITEM"
            fi
          else
            FAMILY="$(source_family "$SOURCE")"
            RICH_RULE="rule family=\\"$FAMILY\\" source address=\\"$SOURCE\\" port port=\\"$FIREWALLD_PORT\\" protocol=\\"$PROTOCOL_ITEM\\" accept"
            if firewall-cmd --zone="$ZONE" --query-rich-rule="$RICH_RULE" >/dev/null 2>&1; then
              echo "firewalld 运行时规则已存在: $ZONE $SOURCE -> $PORT_TEXT/$PROTOCOL_ITEM"
            elif firewall-cmd --zone="$ZONE" --add-rich-rule="$RICH_RULE"; then
              mark_firewall_changed
            else
              mark_firewall_error "firewalld runtime $ZONE $SOURCE $PORT_TEXT/$PROTOCOL_ITEM"
            fi

            if firewall-cmd --permanent --zone="$ZONE" --query-rich-rule="$RICH_RULE" >/dev/null 2>&1; then
              echo "firewalld 永久规则已存在: $ZONE $SOURCE -> $PORT_TEXT/$PROTOCOL_ITEM"
            elif firewall-cmd --permanent --zone="$ZONE" --add-rich-rule="$RICH_RULE"; then
              mark_firewall_changed
            else
              mark_firewall_error "firewalld permanent $ZONE $SOURCE $PORT_TEXT/$PROTOCOL_ITEM"
            fi
          fi
        done
      done
    done
  done

  firewall-cmd --reload || mark_firewall_error "firewalld reload"
  return 0
}

allow_nftables() {
  if ! command -v nft >/dev/null 2>&1; then
    return 1
  fi

  NFT_RULESET="$(nft list ruleset 2>/dev/null || true)"
  if ! printf '%s\\n' "$NFT_RULESET" | grep -Eq 'hook input'; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 nftables input 规则，正在放行端口。"
  nft list table inet mshell_port >/dev/null 2>&1 || nft add table inet mshell_port || mark_firewall_error "nft add table"
  nft list chain inet mshell_port input >/dev/null 2>&1 || nft add chain inet mshell_port input '{ type filter hook input priority -200; policy accept; }' || mark_firewall_error "nft add input chain"
  for PORT in $PORT_LIST; do
    PORT_TEXT="$(port_label "$PORT")"
    for PROTOCOL_ITEM in $PROTOCOL_LIST; do
      for SOURCE in $SOURCE_LIST; do
        if [ "$SOURCE" = "__ANY__" ]; then
          if [ "$PORT" = "$ANY_PORT_TOKEN" ]; then
            RULE_TEXT="meta l4proto $PROTOCOL_ITEM accept"
            ADD_RULE_ARGS="meta l4proto $PROTOCOL_ITEM accept"
          else
            RULE_TEXT="$PROTOCOL_ITEM dport $PORT accept"
            ADD_RULE_ARGS="$PROTOCOL_ITEM dport $PORT accept"
          fi
          if nft list chain inet mshell_port input 2>/dev/null | grep -Fq "$RULE_TEXT"; then
            echo "nftables 规则已存在: $PORT_TEXT/$PROTOCOL_ITEM"
          elif nft add rule inet mshell_port input $ADD_RULE_ARGS; then
            mark_firewall_changed
          else
            mark_firewall_error "nft add rule $PORT_TEXT/$PROTOCOL_ITEM"
          fi
        elif [ "$(source_family "$SOURCE")" = "ipv6" ]; then
          if [ "$PORT" = "$ANY_PORT_TOKEN" ]; then
            RULE_TEXT="ip6 saddr $SOURCE meta l4proto $PROTOCOL_ITEM accept"
            ADD_RULE_ARGS="ip6 saddr $SOURCE meta l4proto $PROTOCOL_ITEM accept"
          else
            RULE_TEXT="ip6 saddr $SOURCE $PROTOCOL_ITEM dport $PORT accept"
            ADD_RULE_ARGS="ip6 saddr $SOURCE $PROTOCOL_ITEM dport $PORT accept"
          fi
          if nft list chain inet mshell_port input 2>/dev/null | grep -Fq "$RULE_TEXT"; then
            echo "nftables 规则已存在: $SOURCE -> $PORT_TEXT/$PROTOCOL_ITEM"
          elif nft add rule inet mshell_port input $ADD_RULE_ARGS; then
            mark_firewall_changed
          else
            mark_firewall_error "nft add rule $SOURCE $PORT_TEXT/$PROTOCOL_ITEM"
          fi
        else
          if [ "$PORT" = "$ANY_PORT_TOKEN" ]; then
            RULE_TEXT="ip saddr $SOURCE meta l4proto $PROTOCOL_ITEM accept"
            ADD_RULE_ARGS="ip saddr $SOURCE meta l4proto $PROTOCOL_ITEM accept"
          else
            RULE_TEXT="ip saddr $SOURCE $PROTOCOL_ITEM dport $PORT accept"
            ADD_RULE_ARGS="ip saddr $SOURCE $PROTOCOL_ITEM dport $PORT accept"
          fi
          if nft list chain inet mshell_port input 2>/dev/null | grep -Fq "$RULE_TEXT"; then
            echo "nftables 规则已存在: $SOURCE -> $PORT_TEXT/$PROTOCOL_ITEM"
          elif nft add rule inet mshell_port input $ADD_RULE_ARGS; then
            mark_firewall_changed
          else
            mark_firewall_error "nft add rule $SOURCE $PORT_TEXT/$PROTOCOL_ITEM"
          fi
        fi
      done
    done
  done

  if [ -f /etc/nftables.conf ] && [ -w /etc/nftables.conf ]; then
    NFT_BACKUP="/etc/nftables.conf.bak.$(date +%Y%m%d%H%M%S)"
    if cp /etc/nftables.conf "$NFT_BACKUP"; then
      if nft list ruleset > /etc/nftables.conf; then
        echo "已备份 nftables 配置: $NFT_BACKUP"
        echo "nftables 规则已保存到 /etc/nftables.conf，重启后仍会生效。"
      else
        mark_firewall_error "nftables 持久化到 /etc/nftables.conf"
      fi
    else
      mark_firewall_error "备份 /etc/nftables.conf"
    fi
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet nftables 2>/dev/null; then
    mark_firewall_error "nftables 服务已启用，但无法写入 /etc/nftables.conf 持久化规则"
  else
    mark_firewall_error "未找到可确认的 nftables 持久化配置，规则可能重启后丢失"
  fi
  return 0
}

persist_iptables_rules() {
  NEED_IPV6_SAVE="$1"
  if command -v netfilter-persistent >/dev/null 2>&1; then
    if netfilter-persistent save; then
      echo "iptables/ip6tables 规则已通过 netfilter-persistent 保存，重启后仍会生效。"
    else
      mark_firewall_error "netfilter-persistent save"
    fi
    return
  fi

  if [ -d /etc/iptables ] && command -v iptables-save >/dev/null 2>&1; then
    if iptables-save > /etc/iptables/rules.v4; then
      echo "iptables 规则已保存到 /etc/iptables/rules.v4，重启后仍会生效。"
    else
      mark_firewall_error "iptables-save > /etc/iptables/rules.v4"
    fi
    if [ "$NEED_IPV6_SAVE" -eq 1 ]; then
      if command -v ip6tables-save >/dev/null 2>&1 && ip6tables-save > /etc/iptables/rules.v6; then
        echo "ip6tables 规则已保存到 /etc/iptables/rules.v6，重启后仍会生效。"
      else
        mark_firewall_error "ip6tables-save > /etc/iptables/rules.v6"
      fi
    fi
    return
  fi

  if command -v service >/dev/null 2>&1; then
    if service iptables save 2>/dev/null; then
      echo "iptables 规则已通过 service iptables save 保存，重启后仍会生效。"
      [ "$NEED_IPV6_SAVE" -eq 1 ] && echo "请确认当前系统是否需要额外保存 ip6tables 规则。"
    else
      mark_firewall_error "iptables 未找到可确认的持久化方式"
    fi
  else
    mark_firewall_error "iptables 未找到可确认的持久化方式"
  fi
}

allow_iptables_rule() {
  TABLE_CMD="$1"
  SOURCE="$2"
  PORT="$3"
  PROTOCOL_ITEM="$4"
  LABEL="$5"
  PORT_TEXT="$(port_label "$PORT")"

  if [ "$SOURCE" = "__ANY__" ]; then
    if [ "$PORT" = "$ANY_PORT_TOKEN" ]; then
      if "$TABLE_CMD" -C INPUT -p "$PROTOCOL_ITEM" -j ACCEPT 2>/dev/null; then
        echo "$LABEL 规则已存在: $PORT_TEXT/$PROTOCOL_ITEM"
      elif "$TABLE_CMD" -I INPUT -p "$PROTOCOL_ITEM" -j ACCEPT; then
        mark_firewall_changed
      else
        mark_firewall_error "$LABEL $PORT_TEXT/$PROTOCOL_ITEM"
      fi
    else
      if "$TABLE_CMD" -C INPUT -p "$PROTOCOL_ITEM" --dport "$PORT" -j ACCEPT 2>/dev/null; then
        echo "$LABEL 规则已存在: $PORT_TEXT/$PROTOCOL_ITEM"
      elif "$TABLE_CMD" -I INPUT -p "$PROTOCOL_ITEM" --dport "$PORT" -j ACCEPT; then
        mark_firewall_changed
      else
        mark_firewall_error "$LABEL $PORT_TEXT/$PROTOCOL_ITEM"
      fi
    fi
  else
    if [ "$PORT" = "$ANY_PORT_TOKEN" ]; then
      if "$TABLE_CMD" -C INPUT -p "$PROTOCOL_ITEM" -s "$SOURCE" -j ACCEPT 2>/dev/null; then
        echo "$LABEL 规则已存在: $SOURCE -> $PORT_TEXT/$PROTOCOL_ITEM"
      elif "$TABLE_CMD" -I INPUT -p "$PROTOCOL_ITEM" -s "$SOURCE" -j ACCEPT; then
        mark_firewall_changed
      else
        mark_firewall_error "$LABEL $SOURCE $PORT_TEXT/$PROTOCOL_ITEM"
      fi
    else
      if "$TABLE_CMD" -C INPUT -p "$PROTOCOL_ITEM" -s "$SOURCE" --dport "$PORT" -j ACCEPT 2>/dev/null; then
        echo "$LABEL 规则已存在: $SOURCE -> $PORT_TEXT/$PROTOCOL_ITEM"
      elif "$TABLE_CMD" -I INPUT -p "$PROTOCOL_ITEM" -s "$SOURCE" --dport "$PORT" -j ACCEPT; then
        mark_firewall_changed
      else
        mark_firewall_error "$LABEL $SOURCE $PORT_TEXT/$PROTOCOL_ITEM"
      fi
    fi
  fi
}

allow_iptables() {
  if ! command -v iptables >/dev/null 2>&1; then
    return 1
  fi

  IPTABLES_INPUT="$(iptables -S INPUT 2>/dev/null || true)"
  if [ -z "$IPTABLES_INPUT" ]; then
    return 1
  fi

  if ! printf '%s\\n' "$IPTABLES_INPUT" | grep -Eq '^-P INPUT (DROP|REJECT)|^-A INPUT'; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 iptables INPUT 规则，正在放行端口。"
  NEED_IPV6_SAVE=0
  for PORT in $PORT_LIST; do
    for PROTOCOL_ITEM in $PROTOCOL_LIST; do
      for SOURCE in $SOURCE_LIST; do
        if [ "$SOURCE" = "__ANY__" ]; then
          allow_iptables_rule iptables "$SOURCE" "$PORT" "$PROTOCOL_ITEM" "iptables"
        elif [ "$(source_family "$SOURCE")" = "ipv6" ]; then
          if command -v ip6tables >/dev/null 2>&1; then
            allow_iptables_rule ip6tables "$SOURCE" "$PORT" "$PROTOCOL_ITEM" "ip6tables"
            NEED_IPV6_SAVE=1
          else
            mark_firewall_error "未检测到 ip6tables，无法放行 IPv6 来源 $SOURCE"
          fi
        else
          allow_iptables_rule iptables "$SOURCE" "$PORT" "$PROTOCOL_ITEM" "iptables"
        fi
      done
    done
  done

  persist_iptables_rules "$NEED_IPV6_SAVE"
  return 0
}

if allow_ufw; then
  :
elif allow_firewalld; then
  :
elif allow_nftables; then
  :
else
  allow_iptables || true
fi

if [ "$FIREWALL_FOUND" -eq 0 ]; then
  echo "未检测到已启用或可识别的本机防火墙。若云厂商安全组存在限制，请手动放行端口: $(port_list_label)。"
fi

if [ "$FIREWALL_ERRORS" -ne 0 ]; then
  echo "端口放行失败或无法确认重启后仍生效，请处理后重试。"
  exit 1
fi

if [ "$FIREWALL_CHANGED" -eq 0 ]; then
  echo "防火墙未发现需要新增的规则。"
fi

if [ "$FIREWALL_FOUND" -eq 0 ]; then
  echo "未检测到本机防火墙规则，无需写入本机放行规则。"
else
  echo "已放行端口: $(port_list_label)，协议: $PROTOCOL_LIST，来源: $(printf '%s' "$SOURCE_LIST" | sed 's/__ANY__/任意来源/g')。"
  echo "已确认可识别防火墙的规则持久化。"
fi`

const SYSTEM_INFO_SCRIPT_DESCRIPTION =
  '整理展示发行版、内核、CPU、内存、磁盘、网络和 SSH/防火墙状态。'

const SYSTEM_INFO_SCRIPT_CONTENT = `set -e

hr() {
  echo "----------------------------------------------------------------"
}

section() {
  echo
  echo "== $1 =="
  hr
}

kv() {
  LABEL="$1"
  VALUE="$2"
  if [ -z "$VALUE" ]; then
    VALUE="-"
  fi
  printf "  %-18s : %s\\n" "$LABEL" "$VALUE"
}

first_line() {
  sed -n '1p'
}

OS_NAME=""
OS_ID=""
OS_VERSION=""
if [ -r /etc/os-release ]; then
  . /etc/os-release
  OS_NAME="$PRETTY_NAME"
  OS_ID="$ID"
  OS_VERSION="$VERSION_ID"
fi

HOST_NAME="$(hostname 2>/dev/null || true)"
KERNEL="$(uname -r 2>/dev/null || true)"
ARCH="$(uname -m 2>/dev/null || true)"
UPTIME="$(uptime -p 2>/dev/null || awk '{printf "%.1f days", $1 / 86400}' /proc/uptime 2>/dev/null || true)"
LOAD_AVG="$(awk '{print $1 " / " $2 " / " $3}' /proc/loadavg 2>/dev/null || true)"
NOW_TIME="$(date '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || true)"

section "SUMMARY"
kv "Hostname" "$HOST_NAME"
kv "OS" "$OS_NAME"
kv "Kernel" "$KERNEL"
kv "Arch" "$ARCH"
kv "Uptime" "$UPTIME"
kv "Load 1/5/15" "$LOAD_AVG"
kv "Checked At" "$NOW_TIME"

section "SYSTEM"
kv "OS ID" "$OS_ID"
kv "OS Version" "$OS_VERSION"
if command -v systemctl >/dev/null 2>&1; then
  BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null | first_line || true)"
  kv "Boot ID" "$BOOT_ID"
fi
if command -v systemd-detect-virt >/dev/null 2>&1; then
  VIRT="$(systemd-detect-virt 2>/dev/null || true)"
  [ "$VIRT" = "none" ] && VIRT="physical / none"
  kv "Virtualization" "$VIRT"
fi

section "CPU"
CPU_MODEL="$(awk -F: '/model name|Hardware|Processor/ {gsub(/^[[:space:]]+/, "", $2); print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
CPU_CORES="$(nproc 2>/dev/null || true)"
CPU_SOCKETS="$(awk '/physical id/ {ids[$4]=1} END {count=0; for (id in ids) count++; if (count > 0) print count}' /proc/cpuinfo 2>/dev/null || true)"
kv "Model" "$CPU_MODEL"
kv "Cores" "$CPU_CORES"
kv "Sockets" "$CPU_SOCKETS"

section "MEMORY"
if command -v free >/dev/null 2>&1; then
  free -h 2>/dev/null | awk '
    /^Mem:/ {
      printf "  %-18s : %s\\n", "Memory Total", $2
      printf "  %-18s : %s\\n", "Memory Used", $3
      printf "  %-18s : %s\\n", "Memory Available", $7
    }
    /^Swap:/ {
      printf "  %-18s : %s\\n", "Swap Total", $2
      printf "  %-18s : %s\\n", "Swap Used", $3
    }
  '
else
  awk '/MemTotal|MemAvailable|SwapTotal|SwapFree/ {printf "  %-18s : %s %s\\n", $1, $2, $3}' /proc/meminfo 2>/dev/null || true
fi

section "DISK"
ROOT_DISK="$(df -hT / 2>/dev/null | awk 'NR == 2 {print $1 " (" $2 ")  size " $3 "  used " $4 "  avail " $5 "  use% " $6}' || true)"
kv "Root" "$ROOT_DISK"
echo
df -hT -x tmpfs -x devtmpfs 2>/dev/null | awk '
  NR == 1 {
    printf "  %-24s %-8s %8s %8s %7s  %s\\n", "Mount", "Type", "Size", "Used", "Use%", "Device"
    printf "  %-24s %-8s %8s %8s %7s  %s\\n", "------------------------", "--------", "--------", "--------", "-------", "----------------"
    next
  }
  NR <= 12 {
    printf "  %-24s %-8s %8s %8s %7s  %s\\n", $7, $2, $3, $4, $6, $1
  }
'

section "NETWORK"
DEFAULT_ROUTE="$(ip route show default 2>/dev/null | awk 'NR == 1 {print "gateway " $3 "  dev " $5}' || true)"
DEFAULT_ROUTE_V6="$(ip -6 route show default 2>/dev/null | awk 'NR == 1 {print "gateway " $3 "  dev " $5}' || true)"
PRIMARY_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}' || true)"
PRIMARY_IP_V6="$(ip -6 route get 2606:4700:4700::1111 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}' || true)"
kv "Default Route" "$DEFAULT_ROUTE"
kv "Primary IP" "$PRIMARY_IP"
kv "IPv6 Default" "$DEFAULT_ROUTE_V6"
kv "Primary IPv6" "$PRIMARY_IP_V6"
echo
if command -v ip >/dev/null 2>&1; then
  echo "  IPv4 Addresses"
  echo "  ----------------"
  ip -o -4 addr show scope global 2>/dev/null | awk '
    BEGIN { found = 0 }
    { found = 1; split($4, ip, "/"); printf "  %-14s %-18s / %s\\n", $2, ip[1], ip[2] }
    END { if (found == 0) print "  none" }
  ' || true
  echo
  echo "  IPv6 Addresses"
  echo "  ----------------"
  ip -o -6 addr show scope global 2>/dev/null | awk '
    BEGIN { found = 0 }
    { found = 1; split($4, ip, "/"); printf "  %-14s %-40s / %s\\n", $2, ip[1], ip[2] }
    END { if (found == 0) print "  none" }
  ' || true
  echo
  echo "  Listening Ports (top 20)"
  echo "  ------------------------"
  if command -v ss >/dev/null 2>&1; then
    ss -tulnH 2>/dev/null | awk '
      BEGIN {
        printf "  %-6s %-10s %-28s %s\\n", "Proto", "State", "Local", "Peer"
        printf "  %-6s %-10s %-28s %s\\n", "------", "----------", "----------------------------", "----------------------------"
      }
      NR <= 20 {
        printf "  %-6s %-10s %-28s %s\\n", $1, $2, $5, $6
      }
    '
  else
    echo "  ss command not found"
  fi
else
  echo "  ip command not found"
fi

section "SSH / FIREWALL"
if command -v sshd >/dev/null 2>&1; then
  SSH_PORTS="$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}' | sort -n | uniq | xargs 2>/dev/null || true)"
  kv "sshd Ports" "$SSH_PORTS"
else
  echo "  sshd not found"
fi

if command -v systemctl >/dev/null 2>&1; then
  SSH_STATUS="$(systemctl is-active sshd 2>/dev/null || systemctl is-active ssh 2>/dev/null || true)"
  kv "SSH Service" "$SSH_STATUS"
fi

if command -v ufw >/dev/null 2>&1; then
  kv "UFW" "$(ufw status 2>/dev/null | first_line || true)"
fi
if command -v firewall-cmd >/dev/null 2>&1; then
  FIREWALLD_STATE="$(firewall-cmd --state 2>/dev/null || true)"
  kv "firewalld" "$FIREWALLD_STATE"
fi
if command -v nft >/dev/null 2>&1; then
  NFT_TABLES="$(nft list tables 2>/dev/null | wc -l | awk '{print $1}' || true)"
  kv "nftables Tables" "$NFT_TABLES"
fi
if command -v iptables >/dev/null 2>&1; then
  IPTABLES_RULES="$(iptables -S INPUT 2>/dev/null | wc -l | awk '{print $1}' || true)"
  kv "iptables INPUT" "$IPTABLES_RULES rules"
fi

echo
hr
echo "Check completed."`

const DISABLE_SSH_PASSWORD_SCRIPT_CONTENT = `set -e
TARGET_USER="{{username}}"
SSHD_CONFIG="/etc/ssh/sshd_config"
BACKUP_SUFFIX="$(date +%Y%m%d%H%M%S)"
BACKUP_LIST="$(mktemp)"
VALIDATION_LOG="$(mktemp)"

cleanup() {
  rm -f "$BACKUP_LIST" "$VALIDATION_LOG"
}
trap cleanup EXIT

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

SSHD_BIN="$(command -v sshd || true)"
if [ -z "$SSHD_BIN" ] && [ -x /usr/sbin/sshd ]; then
  SSHD_BIN="/usr/sbin/sshd"
fi
if [ -z "$SSHD_BIN" ]; then
  echo "未检测到 sshd，请先确认系统 SSH 服务。"
  exit 1
fi

if [ ! -f "$SSHD_CONFIG" ]; then
  echo "未找到 SSH 配置文件: $SSHD_CONFIG"
  exit 1
fi

USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
if [ -z "$USER_HOME" ]; then
  echo "用户不存在: $TARGET_USER"
  exit 1
fi

AUTHORIZED_KEYS="$USER_HOME/.ssh/authorized_keys"
if [ ! -s "$AUTHORIZED_KEYS" ]; then
  echo "操作前检查未通过：未检测到 $TARGET_USER 的 authorized_keys。"
  echo "当前不会修改 SSH 配置。请先添加并测试 SSH 公钥登录，再关闭密码登录。"
  exit 1
fi

has_authorized_key() {
  awk '
    /^[[:space:]]*($|#)/ { next }
    {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-|sk-ssh-|sk-ecdsa-)/) {
          found = 1
          exit
        }
      }
    }
    END { exit found ? 0 : 1 }
  ' "$AUTHORIZED_KEYS"
}

if ! has_authorized_key; then
  echo "操作前检查未通过：$AUTHORIZED_KEYS 中未检测到有效 SSH 公钥。"
  echo "当前不会修改 SSH 配置。请先添加并测试 SSH 公钥登录，再关闭密码登录。"
  exit 1
fi

echo "操作前检查通过：已检测到 $TARGET_USER 的 SSH 公钥。"

backup_once() {
  FILE="$1"
  BACKUP="$FILE.bak.$BACKUP_SUFFIX"
  if grep -Fq "$FILE|" "$BACKUP_LIST" 2>/dev/null; then
    return
  fi
  cp "$FILE" "$BACKUP"
  printf '%s|%s\\n' "$FILE" "$BACKUP" >> "$BACKUP_LIST"
  echo "已备份: $BACKUP"
}

restore_backups() {
  echo "正在恢复 SSH 配置备份..."
  while IFS='|' read -r FILE BACKUP; do
    [ -n "$FILE" ] && [ -f "$BACKUP" ] && cp "$BACKUP" "$FILE"
  done < "$BACKUP_LIST"
}

restart_ssh() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart sshd 2>/dev/null && return 0
    systemctl restart ssh 2>/dev/null && return 0
  fi
  service sshd restart 2>/dev/null && return 0
  service ssh restart 2>/dev/null && return 0
  /etc/init.d/sshd restart 2>/dev/null && return 0
  /etc/init.d/ssh restart 2>/dev/null && return 0
  return 1
}

write_managed_block() {
  TMP_CONFIG="$(mktemp)"
  TMP_CLEAN="$(mktemp)"

  awk '
    /^# BEGIN MSHELL SSH KEY ONLY$/ { skip = 1; next }
    /^# END MSHELL SSH KEY ONLY$/ { skip = 0; next }
    /^# BEGIN MSHELL SSH PASSWORD LOGIN$/ { skip = 1; next }
    /^# END MSHELL SSH PASSWORD LOGIN$/ { skip = 0; next }
    skip != 1 { print }
  ' "$SSHD_CONFIG" > "$TMP_CLEAN"

  cat > "$TMP_CONFIG" <<'MSHELL_SSH_KEY_ONLY'
# BEGIN MSHELL SSH KEY ONLY
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
# END MSHELL SSH KEY ONLY

MSHELL_SSH_KEY_ONLY
  cat "$TMP_CLEAN" >> "$TMP_CONFIG"
  cat "$TMP_CONFIG" > "$SSHD_CONFIG"
  rm -f "$TMP_CONFIG" "$TMP_CLEAN"
}

backup_once "$SSHD_CONFIG"
write_managed_block

if ! "$SSHD_BIN" -t 2>"$VALIDATION_LOG"; then
  if grep -qi 'KbdInteractiveAuthentication' "$VALIDATION_LOG"; then
    echo "当前 sshd 不支持 KbdInteractiveAuthentication，正在使用兼容配置重试。"
    sed -i '/^KbdInteractiveAuthentication /d' "$SSHD_CONFIG"
  fi
  if grep -qi 'ChallengeResponseAuthentication' "$VALIDATION_LOG"; then
    echo "当前 sshd 不支持 ChallengeResponseAuthentication，正在使用兼容配置重试。"
    sed -i '/^ChallengeResponseAuthentication /d' "$SSHD_CONFIG"
  fi
fi

if ! "$SSHD_BIN" -t 2>"$VALIDATION_LOG"; then
  cat "$VALIDATION_LOG"
  restore_backups
  echo "sshd 配置校验失败，已恢复原配置。"
  exit 1
fi

EFFECTIVE_CONFIG="$("$SSHD_BIN" -T 2>/dev/null || true)"
PASSWORD_STATE="$(printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '$1 == "passwordauthentication" {print $2; exit}')"
PUBKEY_STATE="$(printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '$1 == "pubkeyauthentication" {print $2; exit}')"
KBD_STATE="$(printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '$1 == "kbdinteractiveauthentication" {print $2; exit}')"

if [ "$PASSWORD_STATE" != "no" ] || [ "$PUBKEY_STATE" != "yes" ]; then
  printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '
    $1 == "passwordauthentication" || $1 == "pubkeyauthentication" || $1 == "kbdinteractiveauthentication" { print }
  '
  restore_backups
  echo "未能确认 SSH 已切换为仅密钥登录，已恢复原配置。"
  exit 1
fi

if [ -n "$KBD_STATE" ] && [ "$KBD_STATE" != "no" ]; then
  printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '
    $1 == "passwordauthentication" || $1 == "pubkeyauthentication" || $1 == "kbdinteractiveauthentication" { print }
  '
  restore_backups
  echo "交互式密码认证仍未关闭，已恢复原配置。"
  exit 1
fi

if ! restart_ssh; then
  restore_backups
  restart_ssh >/dev/null 2>&1 || true
  echo "SSH 服务重启失败，已恢复原配置。"
  exit 1
fi

echo "已关闭 SSH 密码登录，仅允许密钥认证。"
echo "请保留当前连接，另开一个新窗口测试密钥登录后再断开。"`

const ENABLE_SSH_PASSWORD_SCRIPT_CONTENT = `set -e
NEW_PORT="{{ssh_port}}"
PROTOCOL="tcp"
SSHD_CONFIG="/etc/ssh/sshd_config"
BACKUP_SUFFIX="$(date +%Y%m%d%H%M%S)"
BACKUP_LIST="$(mktemp)"
VALIDATION_LOG="$(mktemp)"
FIREWALL_FOUND=0
FIREWALL_ERRORS=0
FIREWALL_CHANGED=0

cleanup() {
  rm -f "$BACKUP_LIST" "$VALIDATION_LOG"
}
trap cleanup EXIT

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

if ! printf '%s' "$NEW_PORT" | grep -Eq '^[0-9]+$' || [ "$NEW_PORT" -lt 1 ] || [ "$NEW_PORT" -gt 65535 ]; then
  echo "SSH 端口必须是 1-65535 的数字。"
  exit 1
fi

SSHD_BIN="$(command -v sshd || true)"
if [ -z "$SSHD_BIN" ] && [ -x /usr/sbin/sshd ]; then
  SSHD_BIN="/usr/sbin/sshd"
fi
if [ -z "$SSHD_BIN" ]; then
  echo "未检测到 sshd，请先确认系统 SSH 服务。"
  exit 1
fi

if [ ! -f "$SSHD_CONFIG" ]; then
  echo "未找到 SSH 配置文件: $SSHD_CONFIG"
  exit 1
fi

mark_firewall_error() {
  FIREWALL_ERRORS=1
  echo "防火墙/安全策略放行失败: $1"
}

mark_firewall_changed() {
  FIREWALL_CHANGED=1
}

backup_once() {
  FILE="$1"
  BACKUP="$FILE.bak.$BACKUP_SUFFIX"
  if grep -Fq "$FILE|" "$BACKUP_LIST" 2>/dev/null; then
    return
  fi
  cp "$FILE" "$BACKUP"
  printf '%s|%s\\n' "$FILE" "$BACKUP" >> "$BACKUP_LIST"
  echo "已备份: $BACKUP"
}

restore_backups() {
  echo "正在恢复 SSH 配置备份..."
  while IFS='|' read -r FILE BACKUP; do
    [ -n "$FILE" ] && [ -f "$BACKUP" ] && cp "$BACKUP" "$FILE"
  done < "$BACKUP_LIST"
}

restart_ssh() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart sshd 2>/dev/null && return 0
    systemctl restart ssh 2>/dev/null && return 0
  fi
  service sshd restart 2>/dev/null && return 0
  service ssh restart 2>/dev/null && return 0
  /etc/init.d/sshd restart 2>/dev/null && return 0
  /etc/init.d/ssh restart 2>/dev/null && return 0
  return 1
}

ensure_selinux_port() {
  if ! command -v getenforce >/dev/null 2>&1; then
    return
  fi

  SELINUX_MODE="$(getenforce 2>/dev/null || echo Disabled)"
  if [ "$SELINUX_MODE" = "Disabled" ]; then
    return
  fi

  if ! command -v semanage >/dev/null 2>&1; then
    if [ "$SELINUX_MODE" = "Enforcing" ]; then
      echo "SELinux 处于 Enforcing，但未安装 semanage，无法确认新端口是否允许。"
      echo "请先安装 policycoreutils-python-utils 或手动放行 ssh_port_t 后再执行。"
      FIREWALL_ERRORS=1
    else
      echo "SELinux 处于 $SELINUX_MODE，未检测到 semanage，跳过 SELinux 端口策略。"
    fi
    return
  fi

  if semanage port -l 2>/dev/null | awk '$1 == "ssh_port_t" && $2 == "tcp" {print $0}' | grep -Eq "(^|[ ,])$NEW_PORT([, ]|$)"; then
    echo "SELinux 已允许 SSH 端口 $NEW_PORT/tcp"
    return
  fi

  echo "检测到 SELinux，正在允许 SSH 端口 $NEW_PORT/tcp"
  if semanage port -a -t ssh_port_t -p tcp "$NEW_PORT" 2>/dev/null; then
    echo "已添加 SELinux SSH 端口策略: $NEW_PORT/tcp"
    mark_firewall_changed
  elif semanage port -m -t ssh_port_t -p tcp "$NEW_PORT" 2>/dev/null; then
    echo "已更新 SELinux SSH 端口策略: $NEW_PORT/tcp"
    mark_firewall_changed
  else
    mark_firewall_error "SELinux ssh_port_t $NEW_PORT/tcp"
  fi
}

allow_ufw() {
  if ! command -v ufw >/dev/null 2>&1; then
    return 1
  fi

  if ! ufw status 2>/dev/null | grep -qi "Status: active"; then
    echo "检测到 UFW，但当前未启用，跳过。"
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 UFW，正在放行 $NEW_PORT/$PROTOCOL"
  if ufw allow "$NEW_PORT/$PROTOCOL"; then
    mark_firewall_changed
  else
    mark_firewall_error "UFW $NEW_PORT/$PROTOCOL"
  fi
  return 0
}

allow_firewalld() {
  if ! command -v firewall-cmd >/dev/null 2>&1 || ! firewall-cmd --state >/dev/null 2>&1; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 firewalld，正在放行 $NEW_PORT/$PROTOCOL"
  ACTIVE_ZONES="$(firewall-cmd --get-active-zones 2>/dev/null | awk 'NR % 2 == 1 {print $1}' || true)"
  if [ -z "$ACTIVE_ZONES" ]; then
    ACTIVE_ZONES="$(firewall-cmd --get-default-zone 2>/dev/null || true)"
  fi

  for ZONE in $ACTIVE_ZONES; do
    [ -n "$ZONE" ] || continue
    echo "firewalld zone: $ZONE"
    firewall-cmd --zone="$ZONE" --query-port="$NEW_PORT/$PROTOCOL" >/dev/null 2>&1 || firewall-cmd --zone="$ZONE" --add-port="$NEW_PORT/$PROTOCOL" || mark_firewall_error "firewalld runtime $ZONE $NEW_PORT/$PROTOCOL"
    firewall-cmd --permanent --zone="$ZONE" --query-port="$NEW_PORT/$PROTOCOL" >/dev/null 2>&1 || firewall-cmd --permanent --zone="$ZONE" --add-port="$NEW_PORT/$PROTOCOL" || mark_firewall_error "firewalld permanent $ZONE $NEW_PORT/$PROTOCOL"
    mark_firewall_changed
  done

  firewall-cmd --reload || mark_firewall_error "firewalld reload"
  return 0
}

allow_nftables() {
  if ! command -v nft >/dev/null 2>&1; then
    return 1
  fi

  NFT_RULESET="$(nft list ruleset 2>/dev/null || true)"
  if ! printf '%s\\n' "$NFT_RULESET" | grep -Eq 'hook input'; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 nftables input 规则，正在添加运行时放行 $NEW_PORT/$PROTOCOL"
  nft list table inet mshell_ssh >/dev/null 2>&1 || nft add table inet mshell_ssh || mark_firewall_error "nft add table"
  nft list chain inet mshell_ssh input >/dev/null 2>&1 || nft add chain inet mshell_ssh input '{ type filter hook input priority -200; policy accept; }' || mark_firewall_error "nft add input chain"
  if nft list chain inet mshell_ssh input 2>/dev/null | grep -q "tcp dport $NEW_PORT accept"; then
    echo "nftables 规则已存在: $NEW_PORT/$PROTOCOL"
  elif nft add rule inet mshell_ssh input tcp dport "$NEW_PORT" accept; then
    mark_firewall_changed
  else
    mark_firewall_error "nft add rule $NEW_PORT/$PROTOCOL"
  fi

  if [ -f /etc/nftables.conf ] && [ -w /etc/nftables.conf ]; then
    NFT_BACKUP="/etc/nftables.conf.bak.$BACKUP_SUFFIX"
    cp /etc/nftables.conf "$NFT_BACKUP" && nft list ruleset > /etc/nftables.conf || mark_firewall_error "nftables 持久化到 /etc/nftables.conf"
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet nftables 2>/dev/null; then
    mark_firewall_error "nftables 服务已启用，但无法写入 /etc/nftables.conf 持久化规则"
  else
    mark_firewall_error "未找到可确认的 nftables 持久化配置，规则可能重启后丢失"
  fi
  return 0
}

allow_iptables() {
  if ! command -v iptables >/dev/null 2>&1; then
    return 1
  fi

  IPTABLES_INPUT="$(iptables -S INPUT 2>/dev/null || true)"
  if ! printf '%s\\n' "$IPTABLES_INPUT" | grep -Eq '^-P INPUT (DROP|REJECT)|^-A INPUT'; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 iptables INPUT 规则，正在放行 $NEW_PORT/$PROTOCOL"
  iptables -C INPUT -p tcp --dport "$NEW_PORT" -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport "$NEW_PORT" -j ACCEPT || mark_firewall_error "iptables $NEW_PORT/$PROTOCOL"

  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save || mark_firewall_error "netfilter-persistent save"
  elif [ -d /etc/iptables ] && command -v iptables-save >/dev/null 2>&1; then
    iptables-save > /etc/iptables/rules.v4 || mark_firewall_error "iptables-save > /etc/iptables/rules.v4"
  elif command -v service >/dev/null 2>&1; then
    service iptables save 2>/dev/null || mark_firewall_error "iptables 未找到可确认的持久化方式"
  else
    mark_firewall_error "iptables 未找到可确认的持久化方式"
  fi
  mark_firewall_changed
  return 0
}

allow_firewalls() {
  ensure_selinux_port

  if allow_ufw; then
    :
  elif allow_firewalld; then
    :
  elif allow_nftables; then
    :
  else
    allow_iptables || true
  fi

  if [ "$FIREWALL_FOUND" -eq 0 ]; then
    echo "未检测到已启用或可识别的本机防火墙。若云厂商安全组存在限制，请手动放行 $NEW_PORT/$PROTOCOL。"
  fi

  if [ "$FIREWALL_ERRORS" -ne 0 ]; then
    echo "检测到防火墙或 SELinux 放行失败，已停止修改 SSH 配置，避免锁定服务器。"
    exit 1
  fi

  if [ "$FIREWALL_CHANGED" -eq 0 ]; then
    echo "本机防火墙/安全策略未发现需要新增的规则。"
  fi
}

write_managed_block() {
  TMP_CONFIG="$(mktemp)"
  TMP_CLEAN="$(mktemp)"

  awk '
    /^# BEGIN MSHELL SSH KEY ONLY$/ { skip = 1; next }
    /^# END MSHELL SSH KEY ONLY$/ { skip = 0; next }
    /^# BEGIN MSHELL SSH PASSWORD LOGIN$/ { skip = 1; next }
    /^# END MSHELL SSH PASSWORD LOGIN$/ { skip = 0; next }
    skip != 1 { print }
  ' "$SSHD_CONFIG" > "$TMP_CLEAN"

  cat > "$TMP_CONFIG" <<'MSHELL_SSH_PASSWORD_LOGIN'
# BEGIN MSHELL SSH PASSWORD LOGIN
Port __MSHELL_NEW_PORT__
PubkeyAuthentication yes
PasswordAuthentication yes
KbdInteractiveAuthentication yes
ChallengeResponseAuthentication yes
# END MSHELL SSH PASSWORD LOGIN

MSHELL_SSH_PASSWORD_LOGIN
  sed -i "s/__MSHELL_NEW_PORT__/$NEW_PORT/" "$TMP_CONFIG"
  cat "$TMP_CLEAN" >> "$TMP_CONFIG"
  cat "$TMP_CONFIG" > "$SSHD_CONFIG"
  rm -f "$TMP_CONFIG" "$TMP_CLEAN"
}

allow_firewalls
backup_once "$SSHD_CONFIG"
write_managed_block

if ! "$SSHD_BIN" -t 2>"$VALIDATION_LOG"; then
  if grep -qi 'KbdInteractiveAuthentication' "$VALIDATION_LOG"; then
    echo "当前 sshd 不支持 KbdInteractiveAuthentication，正在使用兼容配置重试。"
    sed -i '/^KbdInteractiveAuthentication /d' "$SSHD_CONFIG"
  fi
  if grep -qi 'ChallengeResponseAuthentication' "$VALIDATION_LOG"; then
    echo "当前 sshd 不支持 ChallengeResponseAuthentication，正在使用兼容配置重试。"
    sed -i '/^ChallengeResponseAuthentication /d' "$SSHD_CONFIG"
  fi
fi

if ! "$SSHD_BIN" -t 2>"$VALIDATION_LOG"; then
  cat "$VALIDATION_LOG"
  restore_backups
  echo "sshd 配置校验失败，已恢复原配置。"
  exit 1
fi

EFFECTIVE_CONFIG="$("$SSHD_BIN" -T 2>/dev/null || true)"
PASSWORD_STATE="$(printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '$1 == "passwordauthentication" {print $2; exit}')"
PUBKEY_STATE="$(printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '$1 == "pubkeyauthentication" {print $2; exit}')"
KBD_STATE="$(printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '$1 == "kbdinteractiveauthentication" {print $2; exit}')"
PORT_STATE="$(printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '$1 == "port" {print $2}' | sort -n | uniq | xargs 2>/dev/null || true)"

if [ "$PASSWORD_STATE" != "yes" ] || [ "$PUBKEY_STATE" != "yes" ]; then
  printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '
    $1 == "passwordauthentication" || $1 == "pubkeyauthentication" || $1 == "kbdinteractiveauthentication" { print }
  '
  restore_backups
  echo "未能确认 SSH 密码登录已开启，已恢复原配置。"
  exit 1
fi

if [ -n "$KBD_STATE" ] && [ "$KBD_STATE" != "yes" ]; then
  printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '
    $1 == "passwordauthentication" || $1 == "pubkeyauthentication" || $1 == "kbdinteractiveauthentication" { print }
  '
  restore_backups
  echo "交互式密码认证仍未开启，已恢复原配置。"
  exit 1
fi

if ! printf '%s\\n' "$PORT_STATE" | tr ' ' '\\n' | grep -qx "$NEW_PORT"; then
  printf '%s\\n' "$EFFECTIVE_CONFIG" | awk '$1 == "port" { print }'
  restore_backups
  echo "未能确认 SSH 端口已设置为 $NEW_PORT，已恢复原配置。"
  exit 1
fi

if ! restart_ssh; then
  restore_backups
  restart_ssh >/dev/null 2>&1 || true
  echo "SSH 服务重启失败，已恢复原配置。"
  exit 1
fi

echo "已开启 SSH 密码登录，并将 SSH 端口设置为 $NEW_PORT。"
echo "请先打开新连接测试 $NEW_PORT 端口，再关闭当前连接。"
echo "如果服务器还有云厂商安全组/外部防火墙，请同时放行 $NEW_PORT/$PROTOCOL。"
echo "临时测试完成后，建议重新执行“关闭 SSH 密码登录”。"`

const CHANGE_LOGIN_PASSWORD_SCRIPT_CONTENT = `set -e
TARGET_USER="$(cat <<'MSHELL_USERNAME'
{{username}}
MSHELL_USERNAME
)"
NEW_PASSWORD="$(cat <<'MSHELL_PASSWORD'
{{new_password}}
MSHELL_PASSWORD
)"

TARGET_USER="$(printf '%s' "$TARGET_USER" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

if [ -z "$TARGET_USER" ]; then
  echo "用户名不能为空。"
  exit 1
fi

if printf '%s' "$TARGET_USER" | grep -q '[[:space:]:]'; then
  echo "用户名不能包含空白字符或冒号。"
  exit 1
fi

if ! getent passwd "$TARGET_USER" >/dev/null 2>&1; then
  echo "用户不存在: $TARGET_USER"
  exit 1
fi

if [ -z "$NEW_PASSWORD" ]; then
  echo "新密码不能为空。"
  exit 1
fi

if printf '%s' "$NEW_PASSWORD" | grep -q ':'; then
  echo "新密码不能包含冒号字符。"
  exit 1
fi

if [ "$(printf '%s' "$NEW_PASSWORD" | wc -l | awk '{print $1}')" -gt 0 ]; then
  echo "新密码不能包含换行。"
  exit 1
fi

if ! command -v chpasswd >/dev/null 2>&1; then
  echo "未检测到 chpasswd，无法自动修改密码。"
  exit 1
fi

printf '%s:%s\\n' "$TARGET_USER" "$NEW_PASSWORD" | chpasswd
echo "用户 $TARGET_USER 的登录密码已修改。"
echo "请使用新密码另开窗口测试登录后，再关闭当前连接。"`

const INSTALL_BASIC_TOOLS_SCRIPT_CONTENT = `set -e
TOOLS="{{tools}}"
EXTRA_PACKAGES="{{extra_packages}}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  PKG_MANAGER="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MANAGER="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MANAGER="yum"
elif command -v apk >/dev/null 2>&1; then
  PKG_MANAGER="apk"
else
  echo "未检测到已支持的包管理器。当前脚本支持 apt、dnf、yum、apk。"
  exit 1
fi

PACKAGES=""
FAILED_PACKAGES=""
INSTALLED_COUNT=0

add_pkg() {
  PKG="$1"
  [ -n "$PKG" ] || return 0
  case " $PACKAGES " in
    *" $PKG "*) ;;
    *) PACKAGES="$PACKAGES $PKG" ;;
  esac
}

add_pkg_list() {
  for PKG in $1; do
    add_pkg "$PKG"
  done
}

add_by_manager() {
  case "$PKG_MANAGER" in
    apt) add_pkg_list "$1" ;;
    dnf|yum) add_pkg_list "$2" ;;
    apk) add_pkg_list "$3" ;;
  esac
}

add_tool() {
  case "$1" in
    sudo) add_by_manager "sudo" "sudo" "sudo" ;;
    curl) add_by_manager "curl" "curl" "curl" ;;
    wget) add_by_manager "wget" "wget" "wget" ;;
    ca-certificates) add_by_manager "ca-certificates" "ca-certificates" "ca-certificates" ;;
    gnupg) add_by_manager "gnupg" "gnupg2" "gnupg" ;;
    vim) add_by_manager "vim" "vim" "vim" ;;
    nano) add_by_manager "nano" "nano" "nano" ;;
    less) add_by_manager "less" "less" "less" ;;
    bash-completion) add_by_manager "bash-completion" "bash-completion" "bash-completion" ;;
    git) add_by_manager "git" "git" "git" ;;
    jq) add_by_manager "jq" "jq" "jq" ;;
    tree) add_by_manager "tree" "tree" "tree" ;;
    rsync) add_by_manager "rsync" "rsync" "rsync" ;;
    tar) add_by_manager "tar" "tar" "tar" ;;
    gzip) add_by_manager "gzip" "gzip" "gzip" ;;
    openssh-client) add_by_manager "openssh-client" "openssh-clients" "openssh-client" ;;
    openssh-server) add_by_manager "openssh-server" "openssh-server" "openssh-server" ;;
    cron) add_by_manager "cron" "cronie" "dcron" ;;
    acl) add_by_manager "acl" "acl" "acl" ;;
    passwd) add_by_manager "passwd" "passwd" "shadow" ;;
    adduser) add_by_manager "adduser" "shadow-utils" "shadow" ;;
    dig) add_by_manager "dnsutils" "bind-utils" "bind-tools" ;;
    ping) add_by_manager "iputils-ping" "iputils" "iputils" ;;
    iproute) add_by_manager "iproute2" "iproute" "iproute2" ;;
    net-tools) add_by_manager "net-tools" "net-tools" "net-tools" ;;
    traceroute) add_by_manager "traceroute" "traceroute" "traceroute" ;;
    tcpdump) add_by_manager "tcpdump" "tcpdump" "tcpdump" ;;
    nmap) add_by_manager "nmap" "nmap" "nmap" ;;
    socat) add_by_manager "socat" "socat" "socat" ;;
    telnet) add_by_manager "telnet" "telnet" "busybox-extras" ;;
    mtr) add_by_manager "mtr" "mtr" "mtr" ;;
    netcat) add_by_manager "netcat-openbsd" "nc" "busybox-extras" ;;
    zip) add_by_manager "zip" "zip" "zip" ;;
    unzip) add_by_manager "unzip" "unzip" "unzip" ;;
    xz) add_by_manager "xz-utils" "xz" "xz" ;;
    bzip2) add_by_manager "bzip2" "bzip2" "bzip2" ;;
    p7zip) add_by_manager "p7zip-full" "p7zip p7zip-plugins" "p7zip" ;;
    htop) add_by_manager "htop" "htop" "htop" ;;
    iotop) add_by_manager "iotop" "iotop" "iotop" ;;
    iftop) add_by_manager "iftop" "iftop" "iftop" ;;
    sysstat) add_by_manager "sysstat" "sysstat" "sysstat" ;;
    lsof) add_by_manager "lsof" "lsof" "lsof" ;;
    strace) add_by_manager "strace" "strace" "strace" ;;
    psmisc) add_by_manager "psmisc" "psmisc" "psmisc" ;;
    procps) add_by_manager "procps" "procps-ng" "procps" ;;
    ncdu) add_by_manager "ncdu" "ncdu" "ncdu" ;;
    parted) add_by_manager "parted" "parted" "parted" ;;
    gdisk) add_by_manager "gdisk" "gdisk" "gptfdisk" ;;
    smartmontools) add_by_manager "smartmontools" "smartmontools" "smartmontools" ;;
    build-essential) add_by_manager "build-essential" "gcc gcc-c++ make redhat-rpm-config" "build-base" ;;
    make) add_by_manager "make" "make" "make" ;;
    gcc) add_by_manager "gcc" "gcc" "gcc" ;;
    gpp) add_by_manager "g++" "gcc-c++" "g++" ;;
    pkg-config) add_by_manager "pkg-config" "pkgconfig" "pkgconf" ;;
    cmake) add_by_manager "cmake" "cmake" "cmake" ;;
    autoconf) add_by_manager "autoconf" "autoconf" "autoconf" ;;
    automake) add_by_manager "automake" "automake" "automake" ;;
    python3) add_by_manager "python3" "python3" "python3" ;;
    python3-pip) add_by_manager "python3-pip" "python3-pip" "py3-pip" ;;
    python3-venv) add_by_manager "python3-venv" "python3" "py3-virtualenv" ;;
    python3-dev) add_by_manager "python3-dev" "python3-devel" "python3-dev" ;;
    nodejs) add_by_manager "nodejs" "nodejs" "nodejs" ;;
    npm) add_by_manager "npm" "npm" "npm" ;;
    fail2ban) add_by_manager "fail2ban" "fail2ban" "fail2ban" ;;
    ufw) add_by_manager "ufw" "ufw" "ufw" ;;
    firewalld) add_by_manager "firewalld" "firewalld" "firewalld" ;;
    openssl) add_by_manager "openssl" "openssl" "openssl" ;;
    "")
      ;;
    *)
      echo "跳过未知工具: $1"
      ;;
  esac
}

normalize_words() {
  printf '%s' "$1" | tr ',，;；\\n\\r\\t' '      '
}

for TOOL in $(normalize_words "$TOOLS"); do
  if printf '%s' "$TOOL" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._+:-]*$'; then
    add_tool "$TOOL"
  else
    echo "跳过不安全的工具标识: $TOOL"
  fi
done

for PKG in $(normalize_words "$EXTRA_PACKAGES"); do
  if printf '%s' "$PKG" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._+:-]*$'; then
    add_pkg "$PKG"
  else
    echo "跳过不安全的包名: $PKG"
  fi
done

PACKAGES="$(printf '%s' "$PACKAGES" | xargs)"
if [ -z "$PACKAGES" ]; then
  echo "没有选择任何工具，也没有填写额外包名。"
  exit 1
fi

echo "包管理器: $PKG_MANAGER"
echo "准备安装: $PACKAGES"
echo

case "$PKG_MANAGER" in
  apt)
    apt-get update
    ;;
  dnf)
    dnf makecache
    ;;
  yum)
    yum makecache
    ;;
  apk)
    apk update
    ;;
esac

install_one() {
  PKG="$1"
  echo
  echo "==> 安装 $PKG"
  case "$PKG_MANAGER" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y "$PKG"
      ;;
    dnf)
      dnf install -y "$PKG"
      ;;
    yum)
      yum install -y "$PKG"
      ;;
    apk)
      apk add --no-cache "$PKG"
      ;;
  esac
}

for PKG in $PACKAGES; do
  if install_one "$PKG"; then
    INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
  else
    FAILED_PACKAGES="$FAILED_PACKAGES $PKG"
    echo "安装失败，继续处理下一个包: $PKG"
  fi
done

echo
echo "安装完成，成功处理 $INSTALLED_COUNT 个包。"
if [ -n "$(printf '%s' "$FAILED_PACKAGES" | xargs)" ]; then
  echo "以下包未安装成功:$(printf '%s' "$FAILED_PACKAGES" | xargs | sed 's/^/ /')"
  echo "可能原因：当前系统源未提供该包、源未启用扩展仓库，或包名在该发行版下不同。"
  [ "$INSTALLED_COUNT" -gt 0 ] && exit 0
  exit 1
fi`

const AUTO_CHANGE_MIRROR_SCRIPT_CONTENT = `set -e
REGION_MODE="{{region_mode}}"
MIRROR_SOURCE="{{mirror_source}}"
CUSTOM_SOURCE="{{custom_source}}"
UPGRADE_SOFTWARE="{{upgrade_software}}"
PRINT_DIFF="{{print_diff}}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

case "$REGION_MODE" in
  auto|cn|abroad|edu) ;;
  *)
    echo "地区模式只能是 auto、cn、abroad 或 edu。"
    exit 1
    ;;
esac

case "$MIRROR_SOURCE" in
  auto|aliyun|ustc|tencent|huawei|tsinghua|official|custom) ;;
  *)
    echo "镜像站策略不支持: $MIRROR_SOURCE"
    exit 1
    ;;
esac

case "$UPGRADE_SOFTWARE" in
  true|false) ;;
  *)
    echo "是否升级软件包只能是 true 或 false。"
    exit 1
    ;;
esac

case "$PRINT_DIFF" in
  true|false) ;;
  *)
    echo "是否打印差异只能是 true 或 false。"
    exit 1
    ;;
esac

fetch_url() {
  URL="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 5 --max-time 8 "$URL"
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout=8 "$URL"
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$URL" <<'PY'
import sys
import urllib.request

try:
    with urllib.request.urlopen(sys.argv[1], timeout=8) as response:
        sys.stdout.write(response.read().decode("utf-8", "ignore"))
except Exception:
    sys.exit(1)
PY
    return $?
  fi
  return 1
}

detect_country() {
  for URL in \
    "https://ipapi.co/country/" \
    "https://ifconfig.co/country-iso" \
    "https://ipinfo.io/country"
  do
    COUNTRY="$(fetch_url "$URL" 2>/dev/null | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]' | cut -c 1-2 || true)"
    if printf '%s' "$COUNTRY" | grep -Eq '^[A-Z][A-Z]$'; then
      printf '%s\\n' "$COUNTRY"
      return 0
    fi
  done
  printf 'UNKNOWN\\n'
}

detect_system() {
  OS_NAME="Unknown Linux"
  OS_ID="unknown"
  OS_VERSION=""

  if [ -r /etc/os-release ]; then
    . /etc/os-release
    OS_NAME="$PRETTY_NAME"
    [ -n "$OS_NAME" ] || OS_NAME="$NAME"
    OS_ID="$ID"
    [ -n "$OS_ID" ] || OS_ID="unknown"
    OS_VERSION="$VERSION_ID"
  fi

  echo "系统: $OS_NAME"
  echo "发行版 ID: $OS_ID"
  [ -n "$OS_VERSION" ] && echo "版本: $OS_VERSION"
  echo "架构: $(uname -m 2>/dev/null || echo unknown)"
}

normalize_mirror_host() {
  HOST="$1"
  HOST="$(printf '%s' "$HOST" | sed -E 's#^https?://##; s#/*$##')"
  printf '%s\\n' "$HOST"
}

mirror_url() {
  PATH_PART="$1"
  if [ "$RESOLVED_SOURCE" = "official" ]; then
    printf '%s\\n' "$PATH_PART"
    return 0
  fi
  printf 'https://%s/%s\\n' "$RESOLVED_SOURCE" "$PATH_PART"
}

backup_file() {
  FILE="$1"
  if [ ! -e "$FILE" ]; then
    return 0
  fi

  BACKUP="$FILE.mshell.bak.$(date +%Y%m%d%H%M%S)"
  cp -a "$FILE" "$BACKUP"
  echo "已备份: $BACKUP"
}

disable_os_apt_source_files() {
  BACKUP_DIR="/etc/apt/sources.list.d/mshell-disabled-$(date +%Y%m%d%H%M%S)"
  CREATED=0

  for FILE in /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$FILE" ] || continue
    if grep -Eiq 'archive\\.ubuntu\\.com|security\\.ubuntu\\.com|ports\\.ubuntu\\.com|deb\\.debian\\.org|security\\.debian\\.org|mirrors\\..*/(ubuntu|debian)|repo\\.huaweicloud\\.com/(ubuntu|debian)|mirrors\\.cloud\\.tencent\\.com/(ubuntu|debian)' "$FILE"; then
      if [ "$CREATED" -eq 0 ]; then
        mkdir -p "$BACKUP_DIR"
        CREATED=1
      fi
      mv "$FILE" "$BACKUP_DIR/"
      echo "已禁用旧系统源文件: $FILE"
    fi
  done
}

detect_apt_codename() {
  CODENAME="$VERSION_CODENAME"
  if [ -n "$UBUNTU_CODENAME" ]; then
    CODENAME="$UBUNTU_CODENAME"
  fi
  if [ -z "$CODENAME" ] && command -v lsb_release >/dev/null 2>&1; then
    CODENAME="$(lsb_release -cs 2>/dev/null || true)"
  fi
  if [ -z "$CODENAME" ]; then
    case "$OS_ID:$OS_VERSION" in
      ubuntu:24.04) CODENAME="noble" ;;
      ubuntu:22.04) CODENAME="jammy" ;;
      ubuntu:20.04) CODENAME="focal" ;;
      ubuntu:18.04) CODENAME="bionic" ;;
      debian:13) CODENAME="trixie" ;;
      debian:12) CODENAME="bookworm" ;;
      debian:11) CODENAME="bullseye" ;;
      debian:10) CODENAME="buster" ;;
    esac
  fi
  printf '%s\\n' "$CODENAME"
}

configure_apt_sources() {
  CODENAME="$(detect_apt_codename)"
  if [ -z "$CODENAME" ]; then
    echo "无法识别 Debian/Ubuntu 版本代号，未修改 apt 源。"
    exit 1
  fi

  case "$OS_ID" in
    ubuntu|linuxmint|pop)
      ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
      if [ "$RESOLVED_SOURCE" = "official" ]; then
        if [ "$ARCH" = "amd64" ] || [ "$ARCH" = "i386" ]; then
          BASE="http://archive.ubuntu.com/ubuntu"
          SECURITY="http://security.ubuntu.com/ubuntu"
        else
          BASE="http://ports.ubuntu.com/ubuntu-ports"
          SECURITY="$BASE"
        fi
      else
        BASE="$(mirror_url ubuntu)"
        SECURITY="$BASE"
      fi
      COMPONENTS="main restricted universe multiverse"
      NEW_CONTENT="deb $BASE $CODENAME $COMPONENTS
deb $BASE $CODENAME-updates $COMPONENTS
deb $BASE $CODENAME-backports $COMPONENTS
deb $SECURITY $CODENAME-security $COMPONENTS"
      ;;
    debian)
      if [ "$RESOLVED_SOURCE" = "official" ]; then
        BASE="http://deb.debian.org/debian"
        SECURITY="http://security.debian.org/debian-security"
      else
        BASE="$(mirror_url debian)"
        SECURITY="$(mirror_url debian-security)"
      fi
      COMPONENTS="main contrib non-free"
      case "$CODENAME" in
        bookworm|trixie|forky|sid) COMPONENTS="$COMPONENTS non-free-firmware" ;;
      esac
      NEW_CONTENT="deb $BASE $CODENAME $COMPONENTS
deb $BASE $CODENAME-updates $COMPONENTS
deb $BASE $CODENAME-backports $COMPONENTS
deb $SECURITY $CODENAME-security $COMPONENTS"
      ;;
    *)
      echo "检测到 apt，但当前发行版 $OS_ID 暂未内置换源规则。"
      exit 1
      ;;
  esac

  TARGET="/etc/apt/sources.list"
  backup_file "$TARGET"
  disable_os_apt_source_files
  printf '%s\\n' "$NEW_CONTENT" > "$TARGET"
  echo "已写入 apt 源: $TARGET"

  if [ "$PRINT_DIFF" = "true" ] && command -v diff >/dev/null 2>&1; then
    LAST_BACKUP="$(ls -t /etc/apt/sources.list.mshell.bak.* 2>/dev/null | head -n 1 || true)"
    [ -n "$LAST_BACKUP" ] && diff -u "$LAST_BACKUP" "$TARGET" || true
  fi

  apt-get update
  if [ "$UPGRADE_SOFTWARE" = "true" ]; then
    apt-get upgrade -y
  fi
}

write_yum_repo() {
  TARGET="/etc/yum.repos.d/mshell-mirror.repo"
  mkdir -p /etc/yum.repos.d
  backup_file "$TARGET"
  printf '%s\\n' "$1" > "$TARGET"
  echo "已写入 yum/dnf 源: $TARGET"

  if [ "$PRINT_DIFF" = "true" ] && command -v diff >/dev/null 2>&1; then
    LAST_BACKUP="$(ls -t /etc/yum.repos.d/mshell-mirror.repo.mshell.bak.* 2>/dev/null | head -n 1 || true)"
    [ -n "$LAST_BACKUP" ] && diff -u "$LAST_BACKUP" "$TARGET" || true
  fi
}

configure_yum_sources() {
  if [ "$RESOLVED_SOURCE" = "official" ]; then
    echo "RHEL 系发行版不建议自动切换到 official，保持系统原有官方源。"
    if command -v dnf >/dev/null 2>&1; then
      dnf makecache
    else
      yum makecache
    fi
    return 0
  fi

  YUM_RELEASE='$releasever'
  YUM_BASEARCH='$basearch'

  case "$OS_ID" in
    rocky)
      BASE="$(mirror_url rockylinux)"
      REPO_CONTENT="[baseos]
name=Rocky Linux $YUM_RELEASE - BaseOS
baseurl=$BASE/$YUM_RELEASE/BaseOS/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0

[appstream]
name=Rocky Linux $YUM_RELEASE - AppStream
baseurl=$BASE/$YUM_RELEASE/AppStream/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0

[extras]
name=Rocky Linux $YUM_RELEASE - Extras
baseurl=$BASE/$YUM_RELEASE/extras/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0"
      ;;
    almalinux)
      BASE="$(mirror_url almalinux)"
      REPO_CONTENT="[baseos]
name=AlmaLinux $YUM_RELEASE - BaseOS
baseurl=$BASE/$YUM_RELEASE/BaseOS/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0

[appstream]
name=AlmaLinux $YUM_RELEASE - AppStream
baseurl=$BASE/$YUM_RELEASE/AppStream/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0

[extras]
name=AlmaLinux $YUM_RELEASE - Extras
baseurl=$BASE/$YUM_RELEASE/extras/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0"
      ;;
    centos)
      BASE="$(mirror_url centos-stream)"
      REPO_CONTENT="[baseos]
name=CentOS Stream $YUM_RELEASE - BaseOS
baseurl=$BASE/$YUM_RELEASE-stream/BaseOS/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0

[appstream]
name=CentOS Stream $YUM_RELEASE - AppStream
baseurl=$BASE/$YUM_RELEASE-stream/AppStream/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0"
      ;;
    fedora)
      BASE="$(mirror_url fedora)"
      REPO_CONTENT="[fedora]
name=Fedora $YUM_RELEASE - Everything
baseurl=$BASE/releases/$YUM_RELEASE/Everything/$YUM_BASEARCH/os/
enabled=1
gpgcheck=0

[updates]
name=Fedora $YUM_RELEASE - Updates
baseurl=$BASE/updates/$YUM_RELEASE/Everything/$YUM_BASEARCH/
enabled=1
gpgcheck=0"
      ;;
    *)
      echo "检测到 dnf/yum，但当前发行版 $OS_ID 暂未内置换源规则。"
      exit 1
      ;;
  esac

  write_yum_repo "$REPO_CONTENT"
  if command -v dnf >/dev/null 2>&1; then
    dnf clean all
    dnf makecache
    [ "$UPGRADE_SOFTWARE" = "true" ] && dnf upgrade -y
  else
    yum clean all
    yum makecache
    [ "$UPGRADE_SOFTWARE" = "true" ] && yum upgrade -y
  fi
}

configure_apk_sources() {
  if [ -r /etc/alpine-release ]; then
    ALPINE_VERSION="$(cut -d. -f1,2 /etc/alpine-release)"
  else
    ALPINE_VERSION="$OS_VERSION"
  fi
  if [ -z "$ALPINE_VERSION" ]; then
    echo "无法识别 Alpine 版本，未修改 apk 源。"
    exit 1
  fi

  if [ "$RESOLVED_SOURCE" = "official" ]; then
    BASE="https://dl-cdn.alpinelinux.org/alpine"
  else
    BASE="$(mirror_url alpine)"
  fi

  TARGET="/etc/apk/repositories"
  backup_file "$TARGET"
  printf '%s\\n%s\\n' "$BASE/v$ALPINE_VERSION/main" "$BASE/v$ALPINE_VERSION/community" > "$TARGET"
  echo "已写入 apk 源: $TARGET"

  if [ "$PRINT_DIFF" = "true" ] && command -v diff >/dev/null 2>&1; then
    LAST_BACKUP="$(ls -t /etc/apk/repositories.mshell.bak.* 2>/dev/null | head -n 1 || true)"
    [ -n "$LAST_BACKUP" ] && diff -u "$LAST_BACKUP" "$TARGET" || true
  fi

  apk update
  [ "$UPGRADE_SOFTWARE" = "true" ] && apk upgrade
}

resolve_region() {
  COUNTRY="$1"
  if [ "$REGION_MODE" = "auto" ]; then
    if [ "$COUNTRY" = "CN" ]; then
      printf 'cn\\n'
    else
      printf 'abroad\\n'
    fi
    return 0
  fi
  printf '%s\\n' "$REGION_MODE"
}

resolve_source() {
  REGION="$1"
  SOURCE_KIND="$MIRROR_SOURCE"

  if [ "$SOURCE_KIND" = "auto" ]; then
    case "$REGION" in
      cn) SOURCE_KIND="aliyun" ;;
      edu) SOURCE_KIND="ustc" ;;
      *) SOURCE_KIND="official" ;;
    esac
  fi

  case "$SOURCE_KIND" in
    aliyun) printf 'mirrors.aliyun.com\\n' ;;
    ustc) printf 'mirrors.ustc.edu.cn\\n' ;;
    tencent) printf 'mirrors.cloud.tencent.com\\n' ;;
    huawei) printf 'repo.huaweicloud.com\\n' ;;
    tsinghua) printf 'mirrors.tuna.tsinghua.edu.cn\\n' ;;
    official) printf 'official\\n' ;;
    custom)
      if [ -z "$CUSTOM_SOURCE" ]; then
        echo "选择 custom 时必须填写自定义镜像站域名，例如 mirrors.example.com。" >&2
        exit 1
      fi
      printf '%s\\n' "$CUSTOM_SOURCE"
      ;;
  esac
}

if [ "$REGION_MODE" = "auto" ]; then
  COUNTRY_CODE="$(detect_country)"
else
  COUNTRY_CODE="MANUAL"
fi
RESOLVED_REGION="$(resolve_region "$COUNTRY_CODE")"
RESOLVED_SOURCE_RAW="$(resolve_source "$RESOLVED_REGION")"
RESOLVED_SOURCE="$(normalize_mirror_host "$RESOLVED_SOURCE_RAW")"

echo "== MShell 自动换源 =="
detect_system
echo "公网地区: $COUNTRY_CODE"
echo "换源区域: $RESOLVED_REGION"
echo "目标源: $RESOLVED_SOURCE"
echo

if [ -r /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
  OS_ID_LIKE="$ID_LIKE"
  OS_VERSION="$VERSION_ID"
  OS_NAME="$PRETTY_NAME"
fi

if command -v apt-get >/dev/null 2>&1; then
  configure_apt_sources
elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
  configure_yum_sources
elif command -v apk >/dev/null 2>&1; then
  configure_apk_sources
else
  echo "未检测到已支持的包管理器。当前脚本支持 apt、dnf、yum、apk。"
  exit 1
fi

echo
echo "换源流程完成。"`

const DEFAULT_LAZY_SCRIPTS: Array<
  Omit<LazyScript, 'id' | 'usageCount' | 'createdAt' | 'updatedAt'>
> = [
  {
    name: '查看系统基础信息',
    fileName: 'system-info.sh',
    description: SYSTEM_INFO_SCRIPT_DESCRIPTION,
    category: '巡检',
    tags: ['system', 'check'],
    type: 'shell',
    content: SYSTEM_INFO_SCRIPT_CONTENT,
    variables: [],
    riskLevel: 'low',
    runMode: 'paste'
  },
  {
    name: '修改 SSH 端口并重启',
    fileName: 'change-ssh-port.sh',
    description: CHANGE_SSH_PORT_SCRIPT_DESCRIPTION,
    category: 'SSH 加固',
    tags: ['ssh', 'port'],
    type: 'shell',
    content: CHANGE_SSH_PORT_SCRIPT_CONTENT,
    variables: [
      {
        name: 'ssh_port',
        label: 'SSH 端口',
        type: 'number',
        defaultValue: '2222',
        required: true
      }
    ],
    riskLevel: 'high',
    runMode: 'paste'
  },
  {
    name: '添加 SSH 公钥',
    fileName: 'add-ssh-key.sh',
    description: '为指定用户写入 authorized_keys，并修正权限。',
    category: 'SSH 加固',
    tags: ['ssh', 'key'],
    type: 'shell',
    content: `set -e
TARGET_USER="{{username}}"
PUBLIC_KEY="{{public_key}}"

USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
if [ -z "$USER_HOME" ]; then
  echo "用户不存在: $TARGET_USER"
  exit 1
fi

install -d -m 700 -o "$TARGET_USER" -g "$TARGET_USER" "$USER_HOME/.ssh"
touch "$USER_HOME/.ssh/authorized_keys"
grep -qxF "$PUBLIC_KEY" "$USER_HOME/.ssh/authorized_keys" || echo "$PUBLIC_KEY" >> "$USER_HOME/.ssh/authorized_keys"
chown "$TARGET_USER:$TARGET_USER" "$USER_HOME/.ssh/authorized_keys"
chmod 600 "$USER_HOME/.ssh/authorized_keys"
echo "公钥已添加到 $TARGET_USER"`,
    variables: [
      { name: 'username', label: '用户名', type: 'text', defaultValue: 'root', required: true },
      { name: 'public_key', label: '公钥内容', type: 'textarea', required: true }
    ],
    riskLevel: 'medium',
    runMode: 'paste'
  },
  {
    name: '替换 SSH 公钥',
    fileName: 'replace-ssh-public-key.sh',
    description: REPLACE_SSH_PUBLIC_KEY_SCRIPT_DESCRIPTION,
    category: 'SSH 加固',
    tags: ['ssh', 'key', 'authorized_keys'],
    type: 'shell',
    content: `set -e
TARGET_USER="{{username}}"
DELETE_KEY_INDEX="{{delete_key_index}}"
OLD_PUBLIC_KEY="$(cat <<'MSHELL_OLD_PUBLIC_KEY'
{{old_public_key}}
MSHELL_OLD_PUBLIC_KEY
)"
NEW_PUBLIC_KEY="$(cat <<'MSHELL_NEW_PUBLIC_KEY'
{{public_key}}
MSHELL_NEW_PUBLIC_KEY
)"

normalize_key_id() {
  printf '%s\\n' "$1" | awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-[^[:space:]]+|sk-ssh-[^[:space:]]+|sk-ecdsa-[^[:space:]]+)$/ && i < NF) {
          print $i " " $(i + 1)
          exit
        }
      }
    }
  '
}

print_key_list() {
  awk '
    function key_comment(start,    i, value) {
      value = ""
      for (i = start; i <= NF; i++) {
        value = value (value ? " " : "") $i
      }
      return value
    }
    {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-[^[:space:]]+|sk-ssh-[^[:space:]]+|sk-ecdsa-[^[:space:]]+)$/ && i < NF) {
          key_count += 1
          comment = key_comment(i + 2)
          if (comment == "") comment = "(无备注)"
          printf "%d) %s %s\\n   备注: %s\\n", key_count, $i, $(i + 1), comment
          break
        }
      }
    }
    END {
      if (key_count == 0) print "(未检测到有效 SSH 公钥)"
    }
  ' "$AUTHORIZED_KEYS"
}

key_id_by_index() {
  awk -v selected="$1" '
    {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-[^[:space:]]+|sk-ssh-[^[:space:]]+|sk-ecdsa-[^[:space:]]+)$/ && i < NF) {
          key_count += 1
          if (key_count == selected) {
            print $i " " $(i + 1)
            found = 1
            exit
          }
        }
      }
    }
    END { exit(found ? 0 : 1) }
  ' "$AUTHORIZED_KEYS"
}

key_exists() {
  awk -v target="$1" '
    function line_key_id(    i) {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-[^[:space:]]+|sk-ssh-[^[:space:]]+|sk-ecdsa-[^[:space:]]+)$/ && i < NF) {
          return $i " " $(i + 1)
        }
      }
      return ""
    }
    line_key_id() == target { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$AUTHORIZED_KEYS"
}

remove_key() {
  TMP_FILE="$(mktemp)"
  if awk -v target="$1" '
    function line_key_id(    i) {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-[^[:space:]]+|sk-ssh-[^[:space:]]+|sk-ecdsa-[^[:space:]]+)$/ && i < NF) {
          return $i " " $(i + 1)
        }
      }
      return ""
    }
    line_key_id() == target { removed = 1; next }
    { print }
    END { exit(removed ? 0 : 2) }
  ' "$AUTHORIZED_KEYS" > "$TMP_FILE"; then
    mv "$TMP_FILE" "$AUTHORIZED_KEYS"
    return 0
  else
    STATUS="$?"
    rm -f "$TMP_FILE"
    return "$STATUS"
  fi
}

NEW_KEY_ID="$(normalize_key_id "$NEW_PUBLIC_KEY")"
if [ -z "$NEW_KEY_ID" ]; then
  echo "新公钥格式不正确，请填写 ssh-rsa、ssh-ed25519、ecdsa-sha2-* 或安全密钥公钥。"
  exit 1
fi

OLD_KEY_ID=""
if [ -n "$(printf '%s' "$OLD_PUBLIC_KEY" | tr -d '[:space:]')" ]; then
  OLD_KEY_ID="$(normalize_key_id "$OLD_PUBLIC_KEY")"
  if [ -z "$OLD_KEY_ID" ]; then
    echo "旧公钥格式不正确，已停止操作。"
    exit 1
  fi
fi

DELETE_KEY_INDEX="$(printf '%s' "$DELETE_KEY_INDEX" | tr -d '[:space:]')"
if [ -z "$DELETE_KEY_INDEX" ]; then
  DELETE_KEY_INDEX="0"
fi
if ! printf '%s' "$DELETE_KEY_INDEX" | grep -Eq '^[0-9]+$'; then
  echo "删除序号必须是数字。填写 0 表示只新增，不删除旧公钥。"
  exit 1
fi

USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
if [ -z "$USER_HOME" ]; then
  echo "用户不存在: $TARGET_USER"
  exit 1
fi

USER_GROUP="$(id -gn "$TARGET_USER")"
AUTHORIZED_KEYS="$USER_HOME/.ssh/authorized_keys"

install -d -m 700 -o "$TARGET_USER" -g "$USER_GROUP" "$USER_HOME/.ssh"
touch "$AUTHORIZED_KEYS"
chown "$TARGET_USER:$USER_GROUP" "$AUTHORIZED_KEYS"
chmod 600 "$AUTHORIZED_KEYS"

BACKUP_FILE="$AUTHORIZED_KEYS.bak.$(date +%Y%m%d%H%M%S)"
cp "$AUTHORIZED_KEYS" "$BACKUP_FILE"

echo "当前 $TARGET_USER 的 authorized_keys 有效公钥列表："
print_key_list
echo

if key_exists "$NEW_KEY_ID"; then
  echo "新公钥已存在，跳过重复写入。"
else
  printf '%s\\n' "$NEW_PUBLIC_KEY" >> "$AUTHORIZED_KEYS"
  echo "新公钥已写入。"
fi

DELETE_KEY_ID="$OLD_KEY_ID"
if [ -z "$DELETE_KEY_ID" ] && [ "$DELETE_KEY_INDEX" -gt 0 ]; then
  DELETE_KEY_ID="$(key_id_by_index "$DELETE_KEY_INDEX" || true)"
  if [ -z "$DELETE_KEY_ID" ]; then
    echo "未找到序号 $DELETE_KEY_INDEX 对应的公钥，已停止操作。"
    echo "备份文件: $BACKUP_FILE"
    exit 1
  fi
fi

if [ -n "$DELETE_KEY_ID" ]; then
  if [ "$DELETE_KEY_ID" = "$NEW_KEY_ID" ]; then
    echo "选择删除的公钥和新公钥相同，未删除任何公钥。"
  elif remove_key "$DELETE_KEY_ID"; then
    echo "旧公钥已从 authorized_keys 移除。"
  else
    STATUS="$?"
    if [ "$STATUS" -eq 2 ]; then
      echo "未在 authorized_keys 中找到旧公钥，已保留现有内容。"
    else
      echo "删除旧公钥失败，备份文件: $BACKUP_FILE"
      exit 1
    fi
  fi
else
  echo "未选择要删除的旧公钥。本次仅确保新公钥存在，不删除旧公钥。"
fi

chown "$TARGET_USER:$USER_GROUP" "$AUTHORIZED_KEYS"
chmod 600 "$AUTHORIZED_KEYS"

echo "操作完成。备份文件: $BACKUP_FILE"
echo "变更后的有效公钥列表："
print_key_list
echo "请先确认新密钥可以登录，再关闭当前 SSH 连接。"`,
    variables: [
      { name: 'username', label: '用户名', type: 'text', defaultValue: 'root', required: true },
      {
        name: 'delete_key_index',
        label: '删除序号（0 只新增）',
        type: 'number',
        defaultValue: '0'
      },
      { name: 'old_public_key', label: '旧公钥内容', type: 'textarea', defaultValue: '' },
      { name: 'public_key', label: '新公钥内容', type: 'textarea', required: true }
    ],
    riskLevel: 'high',
    runMode: 'paste'
  },
  {
    name: '关闭 SSH 密码登录',
    fileName: 'disable-ssh-password-login.sh',
    description: DISABLE_SSH_PASSWORD_SCRIPT_DESCRIPTION,
    category: 'SSH 加固',
    tags: ['ssh', 'key', 'password', 'hardening'],
    type: 'shell',
    content: DISABLE_SSH_PASSWORD_SCRIPT_CONTENT,
    variables: [
      { name: 'username', label: '校验用户', type: 'text', defaultValue: 'root', required: true }
    ],
    riskLevel: 'high',
    runMode: 'paste'
  },
  {
    name: '开启 SSH 密码登录',
    fileName: 'enable-ssh-password-login.sh',
    description: ENABLE_SSH_PASSWORD_SCRIPT_DESCRIPTION,
    category: 'SSH 加固',
    tags: ['ssh', 'password', 'temporary-access'],
    type: 'shell',
    content: ENABLE_SSH_PASSWORD_SCRIPT_CONTENT,
    variables: [SSH_PORT_VARIABLE],
    riskLevel: 'high',
    runMode: 'paste'
  },
  {
    name: '创建 sudo 用户',
    fileName: 'create-sudo-user.sh',
    description: '创建新用户、设置密码并加入 sudo/wheel 权限组。',
    category: '用户管理',
    tags: ['user', 'sudo'],
    type: 'shell',
    content: `set -e
NEW_USER="{{username}}"
NEW_PASSWORD="{{password}}"

id "$NEW_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$NEW_USER"
echo "$NEW_USER:$NEW_PASSWORD" | chpasswd

if getent group sudo >/dev/null 2>&1; then
  usermod -aG sudo "$NEW_USER"
elif getent group wheel >/dev/null 2>&1; then
  usermod -aG wheel "$NEW_USER"
fi

echo "用户 $NEW_USER 已创建并授予 sudo 权限。"`,
    variables: [
      { name: 'username', label: '用户名', type: 'text', defaultValue: 'deploy', required: true },
      { name: 'password', label: '初始密码', type: 'password', required: true }
    ],
    riskLevel: 'high',
    runMode: 'paste'
  },
  {
    name: '修改用户登录密码',
    fileName: 'change-login-password.sh',
    description: CHANGE_LOGIN_PASSWORD_SCRIPT_DESCRIPTION,
    category: '用户管理',
    tags: ['user', 'password'],
    type: 'shell',
    content: CHANGE_LOGIN_PASSWORD_SCRIPT_CONTENT,
    variables: [
      { name: 'username', label: '用户名', type: 'text', defaultValue: 'root', required: true },
      { name: 'new_password', label: '新登录密码', type: 'password', required: true }
    ],
    riskLevel: 'high',
    runMode: 'paste'
  },
  {
    name: '放行防火墙端口',
    fileName: 'allow-firewall-port.sh',
    description: FIREWALL_PORT_SCRIPT_DESCRIPTION,
    category: '防火墙',
    tags: ['firewall', 'port'],
    type: 'shell',
    content: FIREWALL_PORT_SCRIPT_CONTENT,
    variables: FIREWALL_PORT_SCRIPT_VARIABLES,
    riskLevel: 'medium',
    runMode: 'paste'
  },
  {
    name: '安装常用工具',
    fileName: 'install-basic-tools.sh',
    description: INSTALL_BASIC_TOOLS_SCRIPT_DESCRIPTION,
    category: '环境初始化',
    tags: ['install', 'tools', 'sudo'],
    type: 'shell',
    content: INSTALL_BASIC_TOOLS_SCRIPT_CONTENT,
    variables: INSTALL_BASIC_TOOLS_SCRIPT_VARIABLES,
    riskLevel: 'medium',
    runMode: 'paste'
  },
  {
    name: '自动更换系统软件源',
    fileName: 'auto-change-mirror.sh',
    description: AUTO_CHANGE_MIRROR_SCRIPT_DESCRIPTION,
    category: '环境初始化',
    tags: ['mirror', 'repo', 'source'],
    type: 'shell',
    content: AUTO_CHANGE_MIRROR_SCRIPT_CONTENT,
    variables: AUTO_CHANGE_MIRROR_SCRIPT_VARIABLES,
    riskLevel: 'high',
    runMode: 'paste'
  },
  {
    name: '检查磁盘大目录',
    fileName: 'check-disk-usage.sh',
    description: '列出当前路径下占用最大的目录和文件。',
    category: '巡检',
    tags: ['disk', 'du'],
    type: 'command',
    content: `du -ah {{target_path}} 2>/dev/null | sort -hr | head -n {{limit}}`,
    variables: [
      { name: 'target_path', label: '检查路径', type: 'text', defaultValue: '.', required: true },
      { name: 'limit', label: '显示数量', type: 'number', defaultValue: '30', required: true }
    ],
    riskLevel: 'low',
    runMode: 'paste'
  },
  {
    name: '安装 Docker',
    fileName: 'install-docker.sh',
    description: '使用官方脚本安装 Docker，并启动服务。',
    category: '环境初始化',
    tags: ['docker'],
    type: 'shell',
    content: `set -e
curl -fsSL https://get.docker.com | sh
systemctl enable docker 2>/dev/null || true
systemctl start docker 2>/dev/null || service docker start
docker --version`,
    variables: [],
    riskLevel: 'high',
    runMode: 'paste'
  }
]

export class LazyScriptManager extends BaseManager<LazyScript> {
  private initializePromise: Promise<void> | null = null
  private saveQueue = Promise.resolve()
  private changeListeners = new Set<() => void>()
  private removedPasswordDefaults = false

  onChanged(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  protected async save(): Promise<void> {
    const snapshot = JSON.stringify(
      this.getAll().map((script) => this.serialize(script)),
      null,
      2
    )
    const operation = this.saveQueue.then(async () => {
      const temporary = `${this.dataPath}.${uuidv4()}.tmp`
      await fs.mkdir(require('path').dirname(this.dataPath), { recursive: true })
      try {
        await fs.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temporary, this.dataPath)
      } finally {
        await fs.unlink(temporary).catch(() => {})
      }
      this.changeListeners.forEach((listener) => listener())
    })
    this.saveQueue = operation.catch(() => {})
    return operation
  }

  constructor() {
    super('lazy-scripts.json')
  }

  async initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise
    if (this.initialized) return

    this.initializePromise = this.initializeOnce().finally(() => {
      this.initializePromise = null
    })

    return this.initializePromise
  }

  private async initializeOnce(): Promise<void> {
    let dataFileExists = true
    try {
      await fs.access(this.dataPath)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        dataFileExists = false
      }
    }

    // A corrupt/unreadable library must never be replaced with an empty/default library.
    this.data.clear()
    await this.load()

    if (!dataFileExists && this.count() === 0) {
      await this.seedDefaultScripts()
      this.initialized = true
      return
    }

    // Existing libraries belong to the user. Never infer template ownership from a filename,
    // rewrite customized templates, or resurrect deleted templates during startup.
    if (this.removedPasswordDefaults) await this.save()
    this.initialized = true
  }

  async create(data: {
    id?: string
    name: string
    fileName?: string
    description?: string
    category?: string
    tags?: string[]
    type?: LazyScriptType
    content: string
    variables?: LazyScriptVariable[]
    riskLevel?: LazyScriptRiskLevel
    runMode?: LazyScriptRunMode
  }): Promise<LazyScript> {
    if (!data.name?.trim()) {
      throw new Error('脚本名称不能为空')
    }
    if (!data.content?.trim()) {
      throw new Error('脚本内容不能为空')
    }

    const now = new Date().toISOString()
    const script: LazyScript = {
      id: data.id || uuidv4(),
      name: data.name.trim(),
      fileName: this.normalizeFileName(data.fileName || data.name),
      description: data.description || '',
      category: data.category || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      type: this.normalizeType(data.type),
      content: data.content,
      variables: this.normalizeVariables(data.variables || []),
      riskLevel: this.normalizeRiskLevel(data.riskLevel),
      runMode: this.normalizeRunMode(data.runMode),
      usageCount: 0,
      createdAt: now,
      updatedAt: now
    }

    return super.create(script)
  }

  async update(id: string, data: Partial<LazyScript>): Promise<void> {
    const script = this.get(id)
    if (!script) {
      throw new Error('懒人脚本不存在')
    }

    const updates: Partial<LazyScript> = {
      ...data,
      id: script.id,
      createdAt: script.createdAt,
      updatedAt: new Date().toISOString()
    }

    if (data.name !== undefined) {
      if (!data.name.trim()) {
        throw new Error('脚本名称不能为空')
      }
      updates.name = data.name.trim()
    }
    if (data.fileName !== undefined || data.name !== undefined) {
      updates.fileName = this.normalizeFileName(data.fileName || updates.name || script.name)
    }
    if (data.content !== undefined && !data.content.trim()) {
      throw new Error('脚本内容不能为空')
    }
    if (data.variables !== undefined) {
      updates.variables = this.normalizeVariables(data.variables)
    }
    if (data.type !== undefined) {
      updates.type = this.normalizeType(data.type)
    }
    if (data.riskLevel !== undefined) {
      updates.riskLevel = this.normalizeRiskLevel(data.riskLevel)
    }
    if (data.runMode !== undefined) {
      updates.runMode = this.normalizeRunMode(data.runMode)
    }
    if (data.tags !== undefined) {
      updates.tags = Array.isArray(data.tags) ? data.tags : []
    }

    await super.update(id, updates)
  }

  async incrementUsage(id: string): Promise<void> {
    const script = this.get(id)
    if (script) {
      await this.update(id, { usageCount: script.usageCount + 1 })
    }
  }

  getByCategory(category: string): LazyScript[] {
    return this.getAll().filter((script) => script.category === category)
  }

  getByTag(tag: string): LazyScript[] {
    return this.getAll().filter((script) => script.tags.includes(tag))
  }

  search(query: string): LazyScript[] {
    if (!query?.trim()) return this.getAll()

    const lowerQuery = query.toLowerCase().trim()
    return this.getAll().filter((script) =>
      [
        script.name,
        script.fileName,
        script.description,
        script.category,
        script.content,
        script.tags.join(' ')
      ].some((value) => value.toLowerCase().includes(lowerQuery))
    )
  }

  getAllCategories(): string[] {
    const categories = new Set<string>()
    this.getAll().forEach((script) => {
      if (script.category) categories.add(script.category)
    })
    return Array.from(categories)
  }

  extractVariables(content: string): string[] {
    return extractScriptVariables(content)
  }

  render(content: string, values: Record<string, string | string[]>): string {
    return renderScriptText(
      content,
      values,
      Object.keys(values || {})
        .filter((key) => VARIABLE_NAME_PATTERN.test(key))
        .map((name) => ({ name }))
    )
  }

  private async seedDefaultScripts(): Promise<void> {
    const now = new Date().toISOString()
    for (const template of DEFAULT_LAZY_SCRIPTS) {
      await super.create({
        ...template,
        id: uuidv4(),
        usageCount: 0,
        createdAt: now,
        updatedAt: now
      })
    }
  }

  protected serialize(script: LazyScript): any {
    return {
      ...script,
      fileName: this.normalizeFileName(script.fileName || script.name)
    }
  }

  protected deserialize(data: any): LazyScript {
    const now = new Date().toISOString()
    const name = String(data.name || '未命名脚本').trim() || '未命名脚本'
    const usageCount = Number(data.usageCount || 0)

    return {
      id: String(data.id || uuidv4()),
      name,
      fileName: this.normalizeFileName(data.fileName || name),
      description: String(data.description || ''),
      category: String(data.category || ''),
      tags: Array.isArray(data.tags)
        ? data.tags.map((tag: any) => String(tag)).filter(Boolean)
        : [],
      type: this.normalizeType(data.type),
      content: String(data.content || ''),
      variables: this.normalizeVariables(data.variables || []),
      riskLevel: this.normalizeRiskLevel(data.riskLevel),
      runMode: this.normalizeRunMode(data.runMode),
      usageCount: Number.isFinite(usageCount) ? usageCount : 0,
      createdAt: String(data.createdAt || now),
      updatedAt: String(data.updatedAt || now)
    }
  }

  private normalizeVariables(variables: LazyScriptVariable[]): LazyScriptVariable[] {
    if (!Array.isArray(variables)) return []
    if (variables.some((variable) => variable?.type === 'password' && variable.defaultValue))
      this.removedPasswordDefaults = true

    return variables
      .map((variable) => ({
        name: String(variable.name || '').trim(),
        label: String(variable.label || variable.name || '').trim(),
        type: this.normalizeVariableType(variable.type),
        defaultValue:
          variable.type === 'password' || variable.defaultValue === undefined
            ? undefined
            : String(variable.defaultValue),
        required: Boolean(variable.required),
        options: Array.isArray(variable.options)
          ? variable.options.map((option) => String(option)).filter(Boolean)
          : undefined
      }))
      .filter((variable) => VARIABLE_NAME_PATTERN.test(variable.name))
  }

  private normalizeType(type?: LazyScriptType): LazyScriptType {
    return type === 'command' || type === 'steps' || type === 'shell' ? type : 'shell'
  }

  private normalizeRunMode(runMode?: LazyScriptRunMode): LazyScriptRunMode {
    return runMode === 'copy' || runMode === 'execute' || runMode === 'paste' ? runMode : 'paste'
  }

  private normalizeRiskLevel(riskLevel?: LazyScriptRiskLevel): LazyScriptRiskLevel {
    return riskLevel === 'low' || riskLevel === 'high' || riskLevel === 'medium'
      ? riskLevel
      : 'medium'
  }

  private normalizeVariableType(type?: LazyScriptVariableType): LazyScriptVariableType {
    return type === 'number' ||
      type === 'password' ||
      type === 'textarea' ||
      type === 'multiselect' ||
      type === 'select' ||
      type === 'text'
      ? type
      : 'text'
  }

  private normalizeFileName(value: string): string {
    const baseName =
      String(value || 'script')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'script'

    const safeName = baseName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '-')
    return /\.[a-zA-Z0-9]{1,8}$/.test(safeName) ? safeName : `${safeName}.sh`
  }
}

export const lazyScriptManager = new LazyScriptManager()
