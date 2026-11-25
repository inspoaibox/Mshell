export type DockerContainerAction = 'start' | 'pause' | 'unpause' | 'restart' | 'stop' | 'remove'

export interface DockerContainerActionOptions {
  removeImage?: boolean
  removeNetworks?: boolean
}

export interface DockerEnvironment {
  installed: boolean
  dockerVersion: string
  composeInstalled: boolean
  composeVersion: string
  serviceStatus: string
  socketAccessible: boolean
  needsSudo: boolean
  accessError: string
  accessStatus: 'ready' | 'not-installed' | 'permission-denied' | 'unavailable'
  os: { id: string; versionId: string; prettyName: string; packageManager: string }
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string
  createdAt: string
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
  warnings: string[]
}

export interface DockerOperationItem {
  kind: 'container' | 'image' | 'network' | 'cleanup' | 'installation' | 'operation'
  target: string
  status: 'success' | 'failed' | 'skipped'
  message: string
}

export interface DockerOperationResult {
  status: 'success' | 'partial' | 'failed'
  items: DockerOperationItem[]
  output: string
}

export const isDockerActionTarget = (action: DockerContainerAction, container: DockerContainer) => {
  if (action === 'start') return ['created', 'exited'].includes(container.state)
  if (action === 'pause') return container.state === 'running'
  if (action === 'unpause') return container.state === 'paused'
  if (action === 'stop') return ['running', 'paused', 'restarting'].includes(container.state)
  if (action === 'restart')
    return ['running', 'paused', 'restarting', 'exited', 'created'].includes(container.state)
  return container.state !== 'removing'
}
