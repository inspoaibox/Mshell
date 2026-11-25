const shellQuote = (value: string) => "'" + String(value).replace(/'/g, "'\\''") + "'"

export const FAIL2BAN_DETECT_START = '__MSHELL_FAIL2BAN_V1__'
export const FAIL2BAN_DETECT_END = '__MSHELL_FAIL2BAN_END__'
export const FAIL2BAN_OPERATION_DONE = '__MSHELL_FAIL2BAN_OPERATION_DONE__'

export const buildFail2BanDetectCommand = () => `
set +e
export LC_ALL=C
printf '%s\\n' ${shellQuote(FAIL2BAN_DETECT_START)}

os_id='unknown'; os_name='unknown'; version_id=''
if [ -r /etc/os-release ]; then
  . /etc/os-release
  os_id="\${ID:-unknown}"
  os_name="\${PRETTY_NAME:-\${NAME:-\$os_id}}"
  version_id="\${VERSION_ID:-}"
fi
package_manager='unknown'
if command -v apt-get >/dev/null 2>&1; then package_manager='apt'
elif command -v dnf >/dev/null 2>&1; then package_manager='dnf'
elif command -v yum >/dev/null 2>&1; then package_manager='yum'
elif command -v zypper >/dev/null 2>&1; then package_manager='zypper'
elif command -v pacman >/dev/null 2>&1; then package_manager='pacman'
elif command -v apk >/dev/null 2>&1; then package_manager='apk'
fi

uid=\$(id -u 2>/dev/null || printf '1')
needs_privilege='yes'; [ "\$uid" = 0 ] && needs_privilege='no'
can_sudo='no'
if [ "\$uid" = 0 ] || (command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1); then can_sudo='yes'; fi
clean_field() { printf '%s' "\$1" | tr '\\r\\n|' '   '; }
printf 'ENV|%s|%s|%s|%s|%s|%s\\n' \\
  "\$(clean_field "\$os_id")" "\$(clean_field "\$os_name")" "\$(clean_field "\$version_id")" \\
  "\$(clean_field "\$package_manager")" "\$needs_privilege" "\$can_sudo"

installed='no'; version=''; status='not-installed'; running='no'; enabled='no'
service_error=''
if command -v fail2ban-client >/dev/null 2>&1; then
  installed='yes'
  version=\$(fail2ban-client --version 2>/dev/null | head -n 1 || true)
  if command -v systemctl >/dev/null 2>&1; then
    status=\$(systemctl is-active fail2ban 2>/dev/null || true)
    [ -z "\$status" ] && status='unknown'
    systemctl is-active --quiet fail2ban 2>/dev/null && running='yes'
    systemctl is-enabled --quiet fail2ban 2>/dev/null && enabled='yes'
    if [ "\$status" = failed ] && command -v journalctl >/dev/null 2>&1; then
      service_error=\$(journalctl -u fail2ban -n 8 --no-pager 2>/dev/null | tail -n 8 | tr '\\r\\n|' '   ' || true)
    fi
  elif command -v service >/dev/null 2>&1; then
    service fail2ban status >/dev/null 2>&1 && status='active' || status='inactive'
    [ "\$status" = active ] && running='yes'
  else
    status='unknown'
  fi
fi
printf 'META|%s|%s|%s|%s|%s|%s|%s\\n' \"\$installed\" \"\$version\" \"\$status\" \"\$running\" \"\$enabled\" \"\$uid\" \"\$(clean_field \"\$service_error\")\"

if [ "\$installed" = yes ]; then
  client='fail2ban-client'
  if [ "\$uid" != 0 ] && command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    client='sudo -n fail2ban-client'
  fi
  jail_output=\$(\$client status 2>/dev/null || true)
  jail_list=\$(printf '%s\\n' "\$jail_output" | sed -n 's/^[[:space:]]*Jail list:[[:space:]]*//p' | tr ',' '\\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d')
  while IFS= read -r jail; do
    [ -n "\$jail" ] || continue
    detail=\$(\$client status "\$jail" 2>/dev/null || true)
    failed=\$(printf '%s\\n' "\$detail" | sed -n 's/^[[:space:]]*Currently failed:[[:space:]]*//p' | head -n 1)
    total_failed=\$(printf '%s\\n' "\$detail" | sed -n 's/^[[:space:]]*Total failed:[[:space:]]*//p' | head -n 1)
    banned=\$(printf '%s\\n' "\$detail" | sed -n 's/^[[:space:]]*Currently banned:[[:space:]]*//p' | head -n 1)
    total_banned=\$(printf '%s\\n' "\$detail" | sed -n 's/^[[:space:]]*Total banned:[[:space:]]*//p' | head -n 1)
    ips=\$(printf '%s\\n' "\$detail" | sed -n 's/^[[:space:]]*Banned IP list:[[:space:]]*//p' | head -n 1)
    printf 'JAIL|%s|%s|%s|%s|%s|%s\\n' "\$jail" "\${failed:-0}" "\${total_failed:-0}" "\${banned:-0}" "\${total_banned:-0}" "\$ips"
  done <<EOF
\$jail_list
EOF
fi
printf '%s\\n' ${shellQuote(FAIL2BAN_DETECT_END)}
`

const privilegedScript = (body: string) => `
set -eu
export LC_ALL=C
if [ "\$(id -u)" = 0 ]; then
  sh -c ${shellQuote(body)}
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  sudo -n sh -c ${shellQuote(body)}
else
  echo '需要 root 或免密 sudo 权限' >&2
  exit 126
fi
`

export const buildFail2BanInstallCommand = () => privilegedScript(`
set -e
if command -v fail2ban-client >/dev/null 2>&1; then
  echo 'Fail2Ban 已安装，跳过安装'
else
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y fail2ban
  elif command -v yum >/dev/null 2>&1; then
    yum install -y fail2ban
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install fail2ban
  elif command -v pacman >/dev/null 2>&1; then
    pacman -S --needed --noconfirm fail2ban
  elif command -v apk >/dev/null 2>&1; then
    apk add fail2ban
  else
    echo '未识别可用的软件包管理器' >&2
    exit 2
  fi
fi

# Debian 系列经常只把 SSH 认证日志写入 journald，默认 sshd Jail 却引用
# /var/log/auth.log，导致 fail2ban-server 启动后立即退出。使用 99-* 覆盖文件
# 保留发行版配置，同时根据当前系统选择 systemd 或文件日志后端。
config_dir='/etc/fail2ban/jail.d'
config_file="\$config_dir/99-mshell-sshd.local"
mkdir -p "\$config_dir"

write_systemd_config() {
  cat > "\$config_file" <<EOF
[sshd]
enabled = true
backend = systemd
journalmatch = \$journal_match
EOF
}

write_file_config() {
  cat > "\$config_file" <<EOF
[sshd]
enabled = true
backend = auto
logpath = \$log_file
EOF
}

write_disabled_config() {
  cat > "\$config_file" <<'EOF'
[sshd]
enabled = false
EOF
}

repair_mode='disabled'
log_file=''
journal_match=''
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && command -v journalctl >/dev/null 2>&1; then
  ssh_unit=''
  for unit in ssh.service sshd.service; do
    if systemctl cat "\$unit" >/dev/null 2>&1; then
      ssh_unit="\$unit"
      break
    fi
  done
  if [ -n "\$ssh_unit" ]; then
    journal_match="_SYSTEMD_UNIT=\$ssh_unit"
  else
    journal_match='_COMM=sshd'
  fi
  write_systemd_config
  repair_mode='systemd'
else
  for candidate in /var/log/auth.log /var/log/secure /var/log/messages; do
    if [ -f "\$candidate" ]; then
      log_file="\$candidate"
      break
    fi
  done
  if [ -n "\$log_file" ]; then
    write_file_config
    repair_mode='file'
  else
    write_disabled_config
  fi
fi

# 先校验配置；某些精简系统没有 python-systemd 时回退到可用的文件日志，
# 仍然没有日志时禁用 sshd Jail，确保服务本身可以稳定启动并给出明确提示。
if ! validation_output=\$(fail2ban-client -t 2>&1); then
  if [ "\$repair_mode" = systemd ]; then
    for candidate in /var/log/auth.log /var/log/secure /var/log/messages; do
      if [ -f "\$candidate" ]; then
        log_file="\$candidate"
        write_file_config
        repair_mode='file'
        break
      fi
    done
    if [ "\$repair_mode" = systemd ]; then
      write_disabled_config
      repair_mode='disabled'
    fi
  fi
  if [ "\$repair_mode" = file ] && ! validation_output=\$(fail2ban-client -t 2>&1); then
    write_disabled_config
    repair_mode='disabled'
  fi
  if [ "\$repair_mode" = disabled ] && ! validation_output=\$(fail2ban-client -t 2>&1); then
    printf '%s\\n' "\$validation_output" >&2
    exit 1
  fi
fi

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl enable fail2ban
  systemctl restart fail2ban
  if ! systemctl is-active --quiet fail2ban; then
    systemctl status fail2ban --no-pager >&2 || true
    journalctl -u fail2ban -n 40 --no-pager >&2 || true
    exit 1
  fi
elif command -v service >/dev/null 2>&1; then
  service fail2ban restart || service fail2ban start
else
  fail2ban-client ping >/dev/null
fi
printf 'Fail2Ban 修复模式: %s\\n' "\$repair_mode"
printf '%s\\n' ${shellQuote(FAIL2BAN_OPERATION_DONE)}
`)

export const buildFail2BanUnbanCommand = (jail: string, ip: string) => {
  if (!/^[a-zA-Z0-9_.:@+/_-]+$/.test(jail)) throw new Error('Fail2Ban jail 名称无效')
  if (!/^[0-9a-fA-F:.]+(?:\/[0-9]{1,3})?$/.test(ip)) throw new Error('IP 地址无效')
  return privilegedScript(`
command -v fail2ban-client >/dev/null 2>&1 || { echo 'Fail2Ban 未安装' >&2; exit 2; }
fail2ban-client set ${shellQuote(jail)} unbanip ${shellQuote(ip)}
printf '%s\\n' ${shellQuote(FAIL2BAN_OPERATION_DONE)}
`)
}
