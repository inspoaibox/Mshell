# Sourced only inside a root transaction. WORK is a private mktemp directory.
# --noflush preserves all unrelated chains, including Docker/NAT. Each COMMIT is atomic.
prepare_family() {
  family=$1; bin=$2; restore=$3
  if ! command -v "$bin" >/dev/null 2>&1; then
    if grep -q "^$family|" "$PERMANENT" "$RUNTIME"; then echo "缺少 $bin" >&2;return 1;fi
    return 0
  fi
  command -v "$restore" >/dev/null 2>&1 || { echo "缺少 $restore" >&2;return 1; }
  "$bin" -w 5 -S INPUT > "$WORK/input-$family"
  existed=no
  if "$bin" -w 5 -S MSHELL-INPUT > "$WORK/old-$family" 2>/dev/null; then existed=yes;fi
  jump=no
  if "$bin" -w 5 -C INPUT -j MSHELL-INPUT 2>/dev/null; then jump=yes;fi
  {
    printf '*filter\n:MSHELL-INPUT - [0:0]\n-F MSHELL-INPUT\n'
    if [ "$jump" = no ]; then printf '%s\n' '-I INPUT 1 -j MSHELL-INPUT';fi
    while IFS='|' read -r f proto port source extra; do
      [ -n "$f" ] || continue
      [ "$f" = "$family" ] || continue
      [ -z "$extra" ] || { echo '规则字段无效' >&2;return 1; }
      case "$proto" in tcp|udp) ;; *) return 1;;esac
      case "$port" in ''|*[!0-9-]*) return 1;;esac
      case "$source" in ''|*[!0-9A-Fa-f:./*]*) return 1;;esac
      port=$(printf '%s' "$port" | tr '-' ':')
      if [ "$source" = '*' ]; then printf '%s\n' "-A MSHELL-INPUT -p $proto --dport $port -j ACCEPT"
      else printf '%s\n' "-A MSHELL-INPUT -p $proto -s $source --dport $port -j ACCEPT";fi
    done < "$WORK/combined"
    printf 'COMMIT\n'
  } > "$WORK/new-$family"
  {
    printf '*filter\n:MSHELL-INPUT - [0:0]\n-F MSHELL-INPUT\n'
    sed -n '/^-A MSHELL-INPUT /p' "$WORK/old-$family"
    if [ "$jump" = no ]; then printf '%s\n' '-D INPUT -j MSHELL-INPUT';fi
    if [ "$existed" = no ]; then printf '%s\n' '-X MSHELL-INPUT';fi
    printf 'COMMIT\n'
  } > "$WORK/rollback-$family"
  "$restore" -w 5 --test --noflush < "$WORK/new-$family"
}
prepare_tables() {
  cat "$PERMANENT" "$RUNTIME" > "$WORK/all"
  sort -u "$WORK/all" > "$WORK/combined"
  prepare_family 4 iptables iptables-restore
  prepare_family 6 ip6tables ip6tables-restore
}
apply_tables() {
  for family in 4 6; do
    [ -f "$WORK/new-$family" ] || continue
    bin=iptables-restore;[ "$family" = 6 ] && bin=ip6tables-restore
    # Mark before applying, so even an interrupted client response triggers compensation.
    touch "$WORK/applied-$family"
    "$bin" -w 5 --noflush < "$WORK/new-$family"
  done
}
rollback_tables() {
  tables_failed=no
  for family in 6 4; do
    [ -f "$WORK/applied-$family" ] || continue
    bin=iptables-restore;[ "$family" = 6 ] && bin=ip6tables-restore
    inspect=iptables;[ "$family" = 6 ] && inspect=ip6tables
    if ! "$inspect" -w 5 -C INPUT -j MSHELL-INPUT 2>/dev/null;then
      sed '/^-D INPUT -j MSHELL-INPUT$/d' "$WORK/rollback-$family" > "$WORK/rollback-current-$family"
    else cp "$WORK/rollback-$family" "$WORK/rollback-current-$family";fi
    if ! "$bin" -w 5 --noflush < "$WORK/rollback-current-$family";then echo "警告：IPv$family 回滚失败，请立即检查" >&2;tables_failed=yes;fi
  done
  [ "$tables_failed" = no ]
}
