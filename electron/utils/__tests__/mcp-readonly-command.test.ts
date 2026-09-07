import { describe, expect, it } from 'vitest'
import { validateMcpReadOnlyCommand } from '../mcp-readonly-command'

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
    'hostname -F/etc/hostname'
  ])('rejects the non-query command %s', (command) => {
    expect(() => validateMcpReadOnlyCommand(command)).toThrow()
  })
})
