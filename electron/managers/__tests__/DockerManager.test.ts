// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
vi.mock('../SSHConnectionManager', () => ({ sshConnectionManager: {} }))
import { DockerManager } from '../DockerManager'
import {
  OPERATION_DONE,
  OVERVIEW_START,
  OVERVIEW_END,
  RESULT_PREFIX
} from '../../utils/docker-scripts'

const id = 'a'.repeat(64),
  id2 = 'b'.repeat(64),
  id3 = 'c'.repeat(64)
const imageId = 'sha256:' + 'd'.repeat(64),
  networkId = 'e'.repeat(64)
const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\sh.exe' : '/bin/sh'
const container = {
  id,
  name: 'demo-web',
  image: 'app:latest',
  state: 'running',
  status: 'Up 1 minute',
  ports: '',
  createdAt: '',
  composeProject: 'demo',
  composeService: 'web',
  composeWorkingDir: '/srv/demo',
  composeConfigFiles: '/srv/demo/compose.yml'
}
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
function shellClient(mode = 'ready') {
  const mock = `
mode=${quote(mode)}
installed=false
started=false
command() {
  if [ "$1" = -v ]; then
    case "$2" in
      docker) if [ "$mode" = not-installed ] || { [ "$mode" = install-fresh ] && [ "$installed" = false ]; }; then return 1; fi; echo docker; return 0 ;;
      apt-get) echo apt-get; return 0 ;;
      systemctl) if [ "$mode" = openrc ]; then return 1; fi; echo systemctl; return 0 ;;
    esac
  fi
  type "$2" >/dev/null 2>&1
}
docker() {
  case "$1" in
    --version) echo 'Docker version fixture'; return 0 ;;
    compose) if [ "$mode" = compose-failed ]; then echo 'compose missing' >&2; return 1; fi; echo 'Compose fixture'; return 0 ;;
    version) echo '27.0.0'; return 0 ;;
    ps)
      if [ "$mode" = permission ]; then echo 'permission denied on docker.sock' >&2; return 1; fi
      if [ "$mode" = unavailable ]; then echo 'Cannot connect to the Docker daemon' >&2; return 1; fi
      if [ "$mode" = service-failed ]; then echo 'daemon not running' >&2; return 1; fi
      if [ "$mode" = openrc ] && [ "$started" = false ]; then return 1; fi
      if [ "$mode" = sudo ] && [ "$via_sudo" != true ]; then echo 'permission denied' >&2; return 1; fi
      if [ "$2" = -a ]; then
        if [ "$mode" = list-failed ]; then echo 'list failed' >&2; return 1; fi
        printf '%s\\n' ${quote(JSON.stringify(container))}
      fi
      return 0 ;;
    stats)
      if [ "$mode" = stats-failed ]; then echo 'stats unavailable' >&2; return 1; fi
      printf '%s\\n' ${quote(JSON.stringify({ ID: id, CPUPerc: '3.00%', MemUsage: '10MiB / 1GiB', NetIO: '1kB / 2kB' }))}
      return 0 ;;
    container)
      case "$2" in
        inspect)
          if [ "$mode" = inspect-failed ]; then echo 'container disappeared' >&2; return 1; fi
          case "$4" in
            '{{.Image}}') echo '${imageId}' ;;
            *NetworkID*) echo '${networkId}' ;;
            *) echo 'unexpected inspect' >&2; return 99 ;;
          esac ;;
        rm)
          if [ "$mode" = batch-failed ] && [ "$4" = '${id2}' ]; then echo 'second removal failed' >&2; return 1; fi
          echo "removed $4" ;;
        start|pause|unpause|restart|stop)
          if [ "$mode" = batch-failed ] && [ "$3" = '${id2}' ]; then echo 'second action failed' >&2; return 1; fi
          echo "$2 $3" ;;
        *) echo 'unexpected container command' >&2; return 99 ;;
      esac
      return 0 ;;
    image)
      if [ "$2" = rm ]; then
        if [ "$3" != '${imageId}' ]; then echo 'wrong image deleted' >&2; return 99; fi
        if [ "$mode" = resources-failed ]; then echo 'image used by another container' >&2; return 1; fi
        echo "removed immutable image $3"
      else echo 'images cleaned'; fi
      return 0 ;;
    network)
      if [ "$3" != '${networkId}' ]; then echo 'wrong network target' >&2; return 99; fi
      if [ "$mode" = resources-failed ]; then echo 'network has active endpoints' >&2; return 1; fi
      echo "removed network $3"; return 0 ;;
    volume)
      if [ "$mode" = cleanup-failed ]; then echo 'volume cleanup denied' >&2; return 1; fi
      echo 'volumes cleaned'; return 0 ;;
    builder) echo 'cache cleaned'; return 0 ;;
    *) echo 'unexpected Docker call' >&2; return 99 ;;
  esac
}
sudo() {
  [ "$1" = -n ] || { echo 'sudo must be noninteractive' >&2; return 99; }
  shift
  if [ "$mode" = sudo-failed ]; then echo 'sudo: a password is required' >&2; return 1; fi
  via_sudo=true "$@"
}
systemctl() {
  case "$1" in
    is-active) echo inactive ;;
    start) if [ "$mode" = service-failed ]; then echo 'service start failed' >&2; return 1; fi; started=true ;;
    enable) return 0 ;;
    *) return 99 ;;
  esac
}
rc-service() { started=true; }
rc-update() { return 0; }
docker-compose() { return 1; }
id() { if [ "$mode" = sudo-failed ]; then echo 1000; else echo 0; fi; }
env() { shift; "$@"; }
apt-get() { installed=true; echo 'mock packages installed'; }
`
  const executeCommandDetailed = vi.fn(async (_id: string, script: string) => {
    // Only shell text and explicit mock functions execute; no real Docker/package manager is invoked.
    const result = spawnSync(shell, ['-s'], {
      input:
        'export PATH=/usr/bin:/bin\n' +
        script.replace("sh <<'MSHELL_DOCKER_SCRIPT'\n", "sh <<'MSHELL_DOCKER_SCRIPT'\n" + mock),
      encoding: 'utf8',
      timeout: 20000
    })
    if (result.error) throw result.error
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status }
  })
  return {
    manager: new DockerManager({ executeCommandDetailed } as any),
    execute: executeCommandDetailed
  }
}

describe.skipIf(!existsSync(shell))('Docker scripts executed with isolated shell mocks', () => {
  it.each(['ready', 'sudo'])(
    'reads Compose groups and live stats with %s access',
    async (mode) => {
      const data = await shellClient(mode).manager.getOverview('ssh')
      expect(data.environment.socketAccessible).toBe(true)
      expect(data.environment.needsSudo).toBe(mode === 'sudo')
      expect(data.containers[0]).toMatchObject({
        ...container,
        cpu: '3.00%',
        memory: '10MiB / 1GiB'
      })
    },
    20000
  )
  it.each(['permission', 'unavailable', 'not-installed'])(
    'distinguishes %s from an empty container list',
    async (mode) => {
      const data = await shellClient(mode).manager.getOverview('ssh')
      expect(data.environment.accessStatus).toBe(mode === 'permission' ? 'permission-denied' : mode)
      expect(data.environment.socketAccessible).toBe(false)
    },
    20000
  )
  it('rejects failed list collection and preserves stats errors as warnings', async () => {
    await expect(shellClient('list-failed').manager.getOverview('ssh')).rejects.toThrow(
      'list failed'
    )
    const data = await shellClient('stats-failed').manager.getOverview('ssh')
    expect(data.containers).toHaveLength(1)
    expect(data.containers[0].cpu).toBe('-')
    expect(data.warnings[0]).toContain('stats unavailable')
  }, 20000)
  it('removes immutable image and network IDs even after an image tag changes', async () => {
    const data = await shellClient().manager.executeContainerAction('ssh', 'remove', id, {
      removeImage: true,
      removeNetworks: true
    })
    expect(data.status).toBe('success')
    expect(data.items.map((item) => item.target)).toEqual([id, imageId, networkId])
    expect(data.output).not.toContain('app:latest')
  }, 20000)
  it('reports optional image and network deletion failures as partial success', async () => {
    const data = await shellClient('resources-failed').manager.executeContainerAction(
      'ssh',
      'remove',
      id,
      { removeImage: true, removeNetworks: true }
    )
    expect(data.status).toBe('partial')
    expect(data.items.map((item) => item.status)).toEqual(['success', 'failed', 'failed'])
  }, 20000)
  it.each(['remove', 'stop'] as const)(
    'continues %s after a container fails and reports every target',
    async (action) => {
      const data = await shellClient('batch-failed').manager.executeContainerBatchAction(
        'ssh',
        action,
        [id, id2, id3]
      )
      expect(data.status).toBe('partial')
      expect(data.items.map((item) => [item.target, item.status])).toEqual([
        [id, 'success'],
        [id2, 'failed'],
        [id3, 'success']
      ])
    },
    20000
  )
  it('does not delete a container when requested resource inspection fails', async () => {
    const data = await shellClient('inspect-failed').manager.executeContainerAction(
      'ssh',
      'remove',
      id,
      { removeImage: true }
    )
    expect(data.status).toBe('failed')
    expect(data.output).toContain('未删除容器')
    expect(data.output).not.toContain('removed')
  }, 20000)
  it('continues cleanup and reports partial failure', async () => {
    const data = await shellClient('cleanup-failed').manager.cleanupUnused('ssh')
    expect(data.status).toBe('partial')
    expect(data.items.map((item) => item.status)).toEqual(['success', 'failed', 'success'])
  }, 20000)
  it.each(['service-failed', 'compose-failed', 'sudo-failed'])(
    'does not report installation success for %s',
    async (mode) => {
      const data = await shellClient(mode).manager.install('ssh')
      expect(data.status).toBe('failed')
    },
    20000
  )
  it.each(['install-fresh', 'openrc'])(
    'verifies the service and Compose after %s installation',
    async (mode) => {
      const data = await shellClient(mode).manager.install('ssh')
      expect(data.status).toBe('success')
      expect(data.output).toContain('已验证可用')
    },
    20000
  )
})

describe('Docker manager boundaries', () => {
  it('serializes mutations per connection and releases the lock after uncertain errors', async () => {
    let reject!: (error: Error) => void
    const execute = vi.fn().mockImplementationOnce(
      () =>
        new Promise((_r, fail) => {
          reject = fail
        })
    )
    const manager = new DockerManager({ executeCommandDetailed: execute })
    const first = manager.install('ssh')
    await expect(manager.cleanupUnused('ssh')).rejects.toThrow('正在进行')
    reject(new Error('timeout'))
    await expect(first).rejects.toThrow('结果未确认')
    execute.mockResolvedValue({ stdout: OPERATION_DONE, stderr: '', exitCode: 0 })
    expect((await manager.install('ssh')).status).toBe('success')
  })
  it('rejects unsupported actions, invalid IDs and oversized batches before SSH', async () => {
    const execute = vi.fn(),
      manager = new DockerManager({ executeCommandDetailed: execute })
    await expect(manager.executeContainerAction('ssh', 'evil' as any, id)).rejects.toThrow('不支持')
    await expect(manager.executeContainerAction('ssh', 'remove', '; rm')).rejects.toThrow('ID')
    await expect(
      manager.executeContainerBatchAction('ssh', 'remove', Array(101).fill(id))
    ).rejects.toThrow('100')
    expect(execute).not.toHaveBeenCalled()
  })
  it('does not treat malformed or incomplete results as success', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({
        stdout: RESULT_PREFIX + 'broken\n' + OPERATION_DONE,
        stderr: '',
        exitCode: 0
      })
    const manager = new DockerManager({ executeCommandDetailed: execute })
    expect((await manager.cleanupUnused('ssh')).status).toBe('failed')
    execute.mockResolvedValue({
      stdout:
        RESULT_PREFIX +
        JSON.stringify({ kind: 'container', target: id, status: 'success', message: 'removed' }),
      stderr: 'channel interrupted',
      exitCode: null
    })
    expect((await manager.executeContainerAction('ssh', 'remove', id)).status).toBe('partial')
  })
  it('rejects malformed overview instead of silently clearing the list', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({
        stdout: OVERVIEW_START + '{"containers":[]}' + OVERVIEW_END,
        stderr: '',
        exitCode: 0
      })
    await expect(
      new DockerManager({ executeCommandDetailed: execute }).getOverview('ssh')
    ).rejects.toThrow('格式异常')
  })
})
