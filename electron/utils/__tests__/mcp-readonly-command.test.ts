import { describe, expect, it } from 'vitest'
import { parseMcpReadOnlyCommand, validateMcpReadOnlyCommand } from '../mcp-readonly-command'

describe('validateMcpReadOnlyCommand', () => {
  it.each([
    'ls -la /root',
    'df -h',
    'free -h',
    'ps aux',
    'systemctl status ssh',
    'docker ps -a',
    'docker stats --no-stream',
    'journalctl -n 100 --no-pager',
    'ip address show',
    'find /var/log -type f -name "*.log"'
  ])('allows the read-only query %s', (command) => {
    expect(validateMcpReadOnlyCommand(command)).toBe(command)
  })

  it.each([
    'rm -rf /tmp/example',
    'sudo ls /root',
    'bash check.sh',
    'ls /root | grep log',
    'cat /etc/os-release > /tmp/os-release',
    'systemctl restart ssh',
    'docker stop app',
    'docker exec app id',
    'docker logs --follow=true app',
    'docker compose config --output /tmp/compose.yml',
    'ip link set eth0 down',
    'iptables -F',
    'nft flush ruleset',
    'ufw enable',
    'crontab -e',
    'find /tmp -delete',
    'journalctl --vacuum-time=7d',
    'file --compile',
    'date --set=2026-01-01',
    'hostname new-name',
    'hostname -F/etc/hostname',
    'ip link {set,} eth0 down',
    'systemctl -p status stop nginx',
    'docker -l info stop app',
    'docker -H ps rm app',
    'docker compose -p ps up -d',
    'docker-compose -p ps down',
    'nft -I list flush ruleset',
    'nft list -f /tmp/rules',
    'find /nonexistent -fprint0 /etc/passwd',
    'date -us2020-01-01',
    'date --se=2020-01-01',
    'journalctl --rot',
    'journalctl -n -f',
    'journalctl -xef',
    'tail -50f /var/log/syslog',
    'tail --fol /var/log/syslog',
    'ss -K dst 10.0.0.1',
    'ss -tD /tmp/dump',
    'ss --ki dst 10.0.0.1',
    'ip -batch /tmp/cmds',
    'ip a fl dev eth0',
    'iptables -L -vZ',
    'iptables -L -X',
    'lastlog -C -u root',
    'lastlog --cl -u root',
    'hostname --fi',
    'crontab -l -r',
    'ufw status reset',
    'docker logs -tf app',
    'docker stats',
    'file -C -m /tmp/magic'
  ])('rejects the non-query command %s', (command) => {
    expect(() => validateMcpReadOnlyCommand(command)).toThrow()
  })

  it.each([
    'systemctl -p ActiveState show nginx',
    'systemctl --no-pager status nginx',
    'docker compose -f /srv/app/compose.yml ps',
    'docker-compose -p app logs --tail 20',
    'docker container logs -n 20 app',
    'ip -br -4 addr show',
    'iptables -t nat -L -n -v',
    'nft -a list ruleset',
    'date -u +%s',
    'tail -n 50 /var/log/syslog',
    'journalctl -u nginx -n 50 --no-pager',
    'crontab -l -u www-data',
    'hostname -I',
    'ss -tlnp',
    'ufw status verbose'
  ])('allows the hardened query %s', (command) => {
    expect(validateMcpReadOnlyCommand(command)).toBe(command)
  })

  it('quotes every word so the remote shell performs no expansion', () => {
    expect(parseMcpReadOnlyCommand('ls -la /var/log/*.log ~ {a,b}').shellCommand).toBe(
      "'ls' '-la' '/var/log/*.log' '~' '{a,b}'"
    )
    expect(parseMcpReadOnlyCommand(`grep -r "it's" /etc`).shellCommand).toBe(
      `'grep' '-r' 'it'"'"'s' '/etc'`
    )
    expect(parseMcpReadOnlyCommand(`grep "" /etc/hosts`).shellCommand).toBe(
      `'grep' '' '/etc/hosts'`
    )
    expect(parseMcpReadOnlyCommand('find /tmp/x -{delete,true}').shellCommand).toBe(
      "'find' '/tmp/x' '-{delete,true}'"
    )
  })
})
