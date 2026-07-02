import { promises as fs } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { BaseManager } from './BaseManager'

export type LazyScriptType = 'command' | 'shell' | 'steps'
export type LazyScriptRunMode = 'copy' | 'paste' | 'execute'
export type LazyScriptRiskLevel = 'low' | 'medium' | 'high'
export type LazyScriptVariableType = 'text' | 'number' | 'password' | 'textarea' | 'select'

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

const OLD_CHANGE_SSH_PORT_SCRIPT_CONTENT = `set -e
NEW_PORT="{{ssh_port}}"

if ! command -v sshd >/dev/null 2>&1; then
  echo "未检测到 sshd，请先确认系统 SSH 服务。"
  exit 1
fi

SSHD_CONFIG="/etc/ssh/sshd_config"
cp "$SSHD_CONFIG" "$SSHD_CONFIG.bak.$(date +%Y%m%d%H%M%S)"

if grep -qE '^#?Port\\s+' "$SSHD_CONFIG"; then
  sed -i -E "s/^#?Port\\s+.*/Port $NEW_PORT/" "$SSHD_CONFIG"
else
  printf '\\nPort %s\\n' "$NEW_PORT" >> "$SSHD_CONFIG"
fi

sshd -t
systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service sshd restart || service ssh restart
echo "SSH 端口已修改为 $NEW_PORT，请先用新端口测试后再关闭当前连接。"`

const PREVIOUS_CHANGE_SSH_PORT_SCRIPT_CONTENT = `set -e
NEW_PORT="{{ssh_port}}"
PROTOCOL="tcp"
FIREWALL_FOUND=0
FIREWALL_ERRORS=0

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
  echo "防火墙放行失败: $1"
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

  if semanage port -a -t ssh_port_t -p tcp "$NEW_PORT" 2>/dev/null; then
    echo "已添加 SELinux SSH 端口策略: $NEW_PORT/tcp"
  elif semanage port -m -t ssh_port_t -p tcp "$NEW_PORT" 2>/dev/null; then
    echo "已更新 SELinux SSH 端口策略: $NEW_PORT/tcp"
  else
    mark_firewall_error "SELinux ssh_port_t $NEW_PORT/tcp"
  fi
}

allow_firewalls() {
  ensure_selinux_port

  if command -v ufw >/dev/null 2>&1; then
    if ufw status 2>/dev/null | grep -qi "Status: active"; then
      FIREWALL_FOUND=1
      echo "检测到 UFW，正在放行 $NEW_PORT/$PROTOCOL"
      ufw allow "$NEW_PORT/$PROTOCOL" || mark_firewall_error "UFW $NEW_PORT/$PROTOCOL"
    else
      echo "检测到 UFW，但当前未启用，跳过。"
    fi
  fi

  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    FIREWALL_FOUND=1
    echo "检测到 firewalld，正在放行 $NEW_PORT/$PROTOCOL"
    firewall-cmd --add-port="$NEW_PORT/$PROTOCOL" || mark_firewall_error "firewalld runtime $NEW_PORT/$PROTOCOL"
    firewall-cmd --permanent --add-port="$NEW_PORT/$PROTOCOL" || mark_firewall_error "firewalld permanent $NEW_PORT/$PROTOCOL"
    firewall-cmd --reload || mark_firewall_error "firewalld reload"
  fi

  if command -v nft >/dev/null 2>&1; then
    NFT_RULESET="$(nft list ruleset 2>/dev/null || true)"
    if [ -n "$NFT_RULESET" ] || { command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nftables; }; then
      FIREWALL_FOUND=1
      echo "检测到 nftables，正在放行 $NEW_PORT/$PROTOCOL"
      nft list table inet mshell >/dev/null 2>&1 || nft add table inet mshell || mark_firewall_error "nft add table"
      nft list chain inet mshell input >/dev/null 2>&1 || nft add chain inet mshell input '{ type filter hook input priority -100; policy accept; }' || mark_firewall_error "nft add input chain"
      if ! nft list chain inet mshell input 2>/dev/null | grep -q "tcp dport $NEW_PORT accept"; then
        nft add rule inet mshell input tcp dport "$NEW_PORT" accept || mark_firewall_error "nft add rule $NEW_PORT/$PROTOCOL"
      fi
      echo "nftables 已添加运行时规则。如系统依赖 /etc/nftables.conf，请确认规则持久化。"
    fi
  fi

  if command -v iptables >/dev/null 2>&1; then
    IPTABLES_INPUT="$(iptables -S INPUT 2>/dev/null || true)"
    if printf '%s\\n' "$IPTABLES_INPUT" | grep -Eq '^-P INPUT (DROP|REJECT)|^-A INPUT'; then
      FIREWALL_FOUND=1
      echo "检测到 iptables，正在放行 $NEW_PORT/$PROTOCOL"
      if iptables -C INPUT -p tcp --dport "$NEW_PORT" -j ACCEPT 2>/dev/null; then
        echo "iptables 已存在 $NEW_PORT/$PROTOCOL 放行规则"
      else
        iptables -I INPUT -p tcp --dport "$NEW_PORT" -j ACCEPT || mark_firewall_error "iptables $NEW_PORT/$PROTOCOL"
      fi

      if command -v netfilter-persistent >/dev/null 2>&1; then
        netfilter-persistent save || echo "iptables 规则持久化失败，请手动保存。"
      elif [ -d /etc/iptables ] && command -v iptables-save >/dev/null 2>&1; then
        iptables-save > /etc/iptables/rules.v4 || echo "iptables 规则持久化失败，请手动保存。"
      elif command -v service >/dev/null 2>&1; then
        service iptables save 2>/dev/null || echo "iptables 规则可能仅本次运行有效，请按系统方式持久化。"
      else
        echo "iptables 规则可能仅本次运行有效，请按系统方式持久化。"
      fi
    fi
  fi

  if [ "$FIREWALL_FOUND" -eq 0 ]; then
    echo "未检测到已启用的本机防火墙。若云厂商安全组存在限制，请手动放行 $NEW_PORT/$PROTOCOL。"
  fi

  if [ "$FIREWALL_ERRORS" -ne 0 ]; then
    echo "检测到防火墙或 SELinux 放行失败，已停止修改 SSH 配置，避免锁定服务器。"
    exit 1
  fi
}

allow_firewalls

cp "$SSHD_CONFIG" "$SSHD_CONFIG.bak.$(date +%Y%m%d%H%M%S)"

if grep -qE '^#?Port\\s+' "$SSHD_CONFIG"; then
  sed -i -E "s/^#?Port\\s+.*/Port $NEW_PORT/" "$SSHD_CONFIG"
else
  printf '\\nPort %s\\n' "$NEW_PORT" >> "$SSHD_CONFIG"
fi

"$SSHD_BIN" -t
systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service sshd restart || service ssh restart
echo "SSH 端口已修改为 $NEW_PORT，并已尝试放行本机防火墙。请先用新端口测试后再关闭当前连接。"`

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

const CHANGE_SSH_PORT_SCRIPT_MIGRATION_CONTENTS = [
  OLD_CHANGE_SSH_PORT_SCRIPT_CONTENT,
  PREVIOUS_CHANGE_SSH_PORT_SCRIPT_CONTENT
]

const FIREWALL_PORT_SCRIPT_DESCRIPTION =
  '自动识别 UFW、firewalld、nftables 或 iptables 放行端口，并确认规则持久化。'

const OLD_FIREWALL_PORT_SCRIPT_CONTENT = `set -e
PORT="{{port}}"
PROTOCOL="{{protocol}}"

if command -v ufw >/dev/null 2>&1; then
  ufw allow "$PORT/$PROTOCOL"
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="$PORT/$PROTOCOL"
  firewall-cmd --reload
elif command -v iptables >/dev/null 2>&1; then
  iptables -I INPUT -p "$PROTOCOL" --dport "$PORT" -j ACCEPT
else
  echo "未检测到已支持的防火墙工具。"
  exit 1
fi

echo "已放行 $PORT/$PROTOCOL"`

const FIREWALL_PORT_SCRIPT_CONTENT = `set -e
PORT="{{port}}"
PROTOCOL="{{protocol}}"
FIREWALL_FOUND=0
FIREWALL_ERRORS=0
FIREWALL_CHANGED=0

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

if ! printf '%s' "$PORT" | grep -Eq '^[0-9]+$' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "端口必须是 1-65535 的数字。"
  exit 1
fi

case "$PROTOCOL" in
  tcp|udp) ;;
  *)
    echo "协议只支持 tcp 或 udp。"
    exit 1
    ;;
esac

mark_firewall_error() {
  FIREWALL_ERRORS=1
  echo "防火墙放行失败: $1"
}

mark_firewall_changed() {
  FIREWALL_CHANGED=1
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
  echo "检测到 UFW，正在放行 $PORT/$PROTOCOL"
  if ufw allow "$PORT/$PROTOCOL"; then
    mark_firewall_changed
    echo "UFW 规则已保存，重启后仍会生效。"
  else
    mark_firewall_error "UFW $PORT/$PROTOCOL"
  fi
  return 0
}

allow_firewalld() {
  if ! command -v firewall-cmd >/dev/null 2>&1 || ! firewall-cmd --state >/dev/null 2>&1; then
    return 1
  fi

  FIREWALL_FOUND=1
  echo "检测到 firewalld，正在放行 $PORT/$PROTOCOL"
  ACTIVE_ZONES="$(firewall-cmd --get-active-zones 2>/dev/null | awk 'NR % 2 == 1 {print $1}' || true)"
  if [ -z "$ACTIVE_ZONES" ]; then
    DEFAULT_ZONE="$(firewall-cmd --get-default-zone 2>/dev/null || true)"
    ACTIVE_ZONES="$DEFAULT_ZONE"
  fi

  for ZONE in $ACTIVE_ZONES; do
    [ -n "$ZONE" ] || continue
    echo "firewalld zone: $ZONE"
    if firewall-cmd --zone="$ZONE" --query-port="$PORT/$PROTOCOL" >/dev/null 2>&1; then
      echo "firewalld 运行时规则已存在: $ZONE $PORT/$PROTOCOL"
    elif firewall-cmd --zone="$ZONE" --add-port="$PORT/$PROTOCOL"; then
      mark_firewall_changed
    else
      mark_firewall_error "firewalld runtime $ZONE $PORT/$PROTOCOL"
    fi

    if firewall-cmd --permanent --zone="$ZONE" --query-port="$PORT/$PROTOCOL" >/dev/null 2>&1; then
      echo "firewalld 永久规则已存在: $ZONE $PORT/$PROTOCOL"
    elif firewall-cmd --permanent --zone="$ZONE" --add-port="$PORT/$PROTOCOL"; then
      mark_firewall_changed
    else
      mark_firewall_error "firewalld permanent $ZONE $PORT/$PROTOCOL"
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
  echo "检测到 nftables input 规则，正在放行 $PORT/$PROTOCOL"
  nft list table inet mshell_port >/dev/null 2>&1 || nft add table inet mshell_port || mark_firewall_error "nft add table"
  nft list chain inet mshell_port input >/dev/null 2>&1 || nft add chain inet mshell_port input '{ type filter hook input priority -200; policy accept; }' || mark_firewall_error "nft add input chain"
  if nft list chain inet mshell_port input 2>/dev/null | grep -q "$PROTOCOL dport $PORT accept"; then
    echo "nftables 规则已存在: $PORT/$PROTOCOL"
  elif nft add rule inet mshell_port input "$PROTOCOL" dport "$PORT" accept; then
    mark_firewall_changed
  else
    mark_firewall_error "nft add rule $PORT/$PROTOCOL"
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
  echo "检测到 iptables INPUT 规则，正在放行 $PORT/$PROTOCOL"
  if iptables -C INPUT -p "$PROTOCOL" --dport "$PORT" -j ACCEPT 2>/dev/null; then
    echo "iptables 规则已存在: $PORT/$PROTOCOL"
  elif iptables -I INPUT -p "$PROTOCOL" --dport "$PORT" -j ACCEPT; then
    mark_firewall_changed
  else
    mark_firewall_error "iptables $PORT/$PROTOCOL"
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
  echo "未检测到已启用或可识别的本机防火墙。若云厂商安全组存在限制，请手动放行 $PORT/$PROTOCOL。"
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
  echo "已放行 $PORT/$PROTOCOL，并已确认可识别防火墙的规则持久化。"
fi`

const SYSTEM_INFO_SCRIPT_DESCRIPTION =
  '整理展示发行版、内核、CPU、内存、磁盘、网络和 SSH/防火墙状态。'

const OLD_SYSTEM_INFO_SCRIPT_CONTENT = `echo "== OS =="
cat /etc/os-release 2>/dev/null | sed -n '1,8p'
echo
echo "== Kernel =="
uname -a
echo
echo "== CPU =="
nproc
echo
echo "== Memory =="
free -h
echo
echo "== Disk =="
df -hT
echo
echo "== IP =="
ip addr show | sed -n '1,120p'`

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

const DEFAULT_LAZY_SCRIPTS: Array<Omit<LazyScript, 'id' | 'usageCount' | 'createdAt' | 'updatedAt'>> = [
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
    name: '放行防火墙端口',
    fileName: 'allow-firewall-port.sh',
    description: FIREWALL_PORT_SCRIPT_DESCRIPTION,
    category: '防火墙',
    tags: ['firewall', 'port'],
    type: 'shell',
    content: FIREWALL_PORT_SCRIPT_CONTENT,
    variables: [
      { name: 'port', label: '端口', type: 'number', defaultValue: '22', required: true },
      {
        name: 'protocol',
        label: '协议',
        type: 'select',
        defaultValue: 'tcp',
        required: true,
        options: ['tcp', 'udp']
      }
    ],
    riskLevel: 'medium',
    runMode: 'paste'
  },
  {
    name: '安装常用工具',
    fileName: 'install-basic-tools.sh',
    description: '按系统包管理器安装 curl、wget、vim、git、htop、unzip。',
    category: '环境初始化',
    tags: ['install', 'tools'],
    type: 'shell',
    content: `set -e
PACKAGES="{{packages}}"

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y $PACKAGES
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y $PACKAGES
elif command -v yum >/dev/null 2>&1; then
  yum install -y $PACKAGES
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache $PACKAGES
else
  echo "未检测到已支持的包管理器。"
  exit 1
fi`,
    variables: [
      {
        name: 'packages',
        label: '软件包',
        type: 'text',
        defaultValue: 'curl wget vim git htop unzip',
        required: true
      }
    ],
    riskLevel: 'medium',
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

  constructor() {
    super('lazy-scripts.json')
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializePromise) return this.initializePromise

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

    await super.initialize()

    if (!dataFileExists && this.count() === 0) {
      await this.seedDefaultScripts()
      return
    }

    await this.migrateDefaultScripts()
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
    const variables = new Set<string>()
    const braceMatches = content.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)
    for (const match of braceMatches) {
      variables.add(match[1])
    }

    const dollarMatches = content.matchAll(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)
    for (const match of dollarMatches) {
      variables.add(match[1])
    }

    return Array.from(variables)
  }

  render(content: string, values: Record<string, string>): string {
    let result = content
    for (const [key, value] of Object.entries(values || {})) {
      if (!VARIABLE_NAME_PATTERN.test(key)) continue
      result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value)
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value)
    }
    return result
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

  private async migrateDefaultScripts(): Promise<void> {
    const changeSshPortScript = this.getAll().find(
      (script) =>
        script.fileName === 'change-ssh-port.sh' || script.name === '修改 SSH 端口并重启'
    )

    if (changeSshPortScript && this.shouldMigrateChangeSshPortScript(changeSshPortScript.content)) {
      await this.update(changeSshPortScript.id, {
        description: CHANGE_SSH_PORT_SCRIPT_DESCRIPTION,
        content: CHANGE_SSH_PORT_SCRIPT_CONTENT
      })
    }

    const firewallPortScript = this.getAll().find(
      (script) => script.fileName === 'allow-firewall-port.sh' || script.name === '放行防火墙端口'
    )

    if (firewallPortScript && this.shouldMigrateFirewallPortScript(firewallPortScript.content)) {
      await this.update(firewallPortScript.id, {
        description: FIREWALL_PORT_SCRIPT_DESCRIPTION,
        content: FIREWALL_PORT_SCRIPT_CONTENT
      })
    }

    const systemInfoScript = this.getAll().find(
      (script) => script.fileName === 'system-info.sh' || script.name === '查看系统基础信息'
    )

    if (systemInfoScript && this.shouldMigrateSystemInfoScript(systemInfoScript.content)) {
      await this.update(systemInfoScript.id, {
        description: SYSTEM_INFO_SCRIPT_DESCRIPTION,
        content: SYSTEM_INFO_SCRIPT_CONTENT
      })
    }
  }

  private shouldMigrateChangeSshPortScript(content: string): boolean {
    if (
      CHANGE_SSH_PORT_SCRIPT_MIGRATION_CONTENTS.some((template) =>
        this.isSameScriptContent(content, template)
      )
    ) {
      return true
    }

    const normalized = content.replace(/\r\n/g, '\n')
    return (
      normalized.includes('nftables 已添加运行时规则。如系统使用 /etc/nftables.conf，请确认规则持久化。') ||
      normalized.includes('iptables 规则可能仅本次运行有效，请按系统方式持久化。') ||
      normalized.includes('iptables 规则持久化失败，请手动保存。')
    )
  }

  private shouldMigrateFirewallPortScript(content: string): boolean {
    if (this.isSameScriptContent(content, OLD_FIREWALL_PORT_SCRIPT_CONTENT)) {
      return true
    }

    const normalized = content.replace(/\r\n/g, '\n')
    return (
      normalized.includes('未检测到已支持的防火墙工具。') ||
      normalized.includes('iptables -I INPUT -p "$PROTOCOL" --dport "$PORT" -j ACCEPT')
    )
  }

  private shouldMigrateSystemInfoScript(content: string): boolean {
    if (this.isSameScriptContent(content, OLD_SYSTEM_INFO_SCRIPT_CONTENT)) {
      return true
    }

    const normalized = content.replace(/\r\n/g, '\n')
    return (
      normalized.includes('section "主机总览"') ||
      normalized.includes('kv "主机名"') ||
      normalized.includes('printf "%-16s %s\\n", "内存总量"') ||
      (normalized.includes('section "NETWORK"') &&
        normalized.includes('IPv4 Addresses') &&
        !normalized.includes('IPv6 Addresses')) ||
      normalized.includes('echo "== OS =="') &&
      normalized.includes('free -h') &&
      normalized.includes('df -hT') &&
      normalized.includes("ip addr show | sed -n '1,120p'")
    )
  }

  private isSameScriptContent(left: string, right: string): boolean {
    return left.replace(/\r\n/g, '\n').trim() === right.replace(/\r\n/g, '\n').trim()
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
      tags: Array.isArray(data.tags) ? data.tags.map((tag: any) => String(tag)).filter(Boolean) : [],
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

    return variables
      .map((variable) => ({
        name: String(variable.name || '').trim(),
        label: String(variable.label || variable.name || '').trim(),
        type: this.normalizeVariableType(variable.type),
        defaultValue:
          variable.defaultValue === undefined ? undefined : String(variable.defaultValue),
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
      type === 'select' ||
      type === 'text'
      ? type
      : 'text'
  }

  private normalizeFileName(value: string): string {
    const baseName = String(value || 'script')
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
