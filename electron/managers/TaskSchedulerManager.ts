import * as cron from 'node-cron'
import { EventEmitter } from 'events'
import { sshConnectionManager } from './SSHConnectionManager'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export enum TaskType {
  COMMAND = 'command',
  SCRIPT = 'script',
  BACKUP = 'backup',
  FILE_SYNC = 'file_sync'
}

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  DISABLED = 'disabled'
}

export interface TaskExecution {
  id: string
  taskId: string
  startTime: string
  endTime?: string
  status: TaskStatus
  output?: string
  error?: string
  duration?: number
}

export interface ScheduledTask {
  id: string
  name: string
  description?: string
  type: TaskType
  enabled: boolean
  cronExpression: string
  sessionId?: string
  command?: string
  script?: string
  timeout?: number
  retryOnFailure: boolean
  maxRetries: number
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  lastExecution?: string
  nextExecution?: string
  executionCount: number
  successCount: number
  failureCount: number
  createdAt: string
  updatedAt: string
  tags?: string[]
}

export class TaskSchedulerManager {
  private tasks: Map<string, ScheduledTask>
  private tasksPath: string
  private scheduledJobs: Map<string, cron.ScheduledTask>
  private executions: Map<string, TaskExecution[]>
  private executionsPath: string
  private eventEmitter: EventEmitter
  private maxExecutionHistory: number = 100

  constructor() {
    const userDataPath = app.getPath('userData')
    this.tasksPath = join(userDataPath, 'scheduled-tasks.json')
    this.tasks = new Map()
    this.scheduledJobs = new Map()
    this.executions = new Map()
    this.executionsPath = join(userDataPath, 'task-executions.json')
    this.eventEmitter = new EventEmitter()

    this.loadTasks()
    this.loadExecutions()
    this.startAllEnabledTasks()
  }

  private loadTasks(): void {
    try {
      if (existsSync(this.tasksPath)) {
        const data = readFileSync(this.tasksPath, 'utf-8')
        const tasksArray: ScheduledTask[] = JSON.parse(data)
        tasksArray.forEach(task => this.tasks.set(task.id, task))
      }
    } catch (error) {
      console.error('Failed to load tasks:', error)
    }
  }

  private saveTasks(): void {
    try {
      const tasksArray = Array.from(this.tasks.values())
      writeFileSync(this.tasksPath, JSON.stringify(tasksArray, null, 2))
    } catch (error) {
      console.error('Failed to save tasks:', error)
    }
  }

  private loadExecutions(): void {
    try {
      if (existsSync(this.executionsPath)) {
        const data = readFileSync(this.executionsPath, 'utf-8')
        const executionsArray: Array<{ taskId: string; executions: TaskExecution[] }> = JSON.parse(data)
        executionsArray.forEach(item => this.executions.set(item.taskId, item.executions))
      }
    } catch (error) {
      console.error('Failed to load executions:', error)
    }
  }

  private saveExecutions(): void {
    try {
      const executionsArray = Array.from(this.executions.entries()).map(([taskId, executions]) => ({
        taskId,
        executions
      }))
      writeFileSync(this.executionsPath, JSON.stringify(executionsArray, null, 2))
    } catch (error) {
      console.error('Failed to save executions:', error)
    }
  }

  create(data: any): ScheduledTask {
    if (!cron.validate(data.cronExpression)) {
      throw new Error('Invalid cron expression')
    }

    const task: ScheduledTask = {
      ...data,
      id: `task_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      nextExecution: new Date(Date.now() + 60000).toISOString()
    }

    this.tasks.set(task.id, task)
    this.saveTasks()

    if (task.enabled) {
      this.scheduleTask(task)
    }

    return task
  }

  getAll(): ScheduledTask[] {
    return Array.from(this.tasks.values())
  }

  get(id: string): ScheduledTask | undefined {
    return this.tasks.get(id)
  }

  update(id: string, updates: Partial<ScheduledTask>): void {
    const task = this.get(id)
    if (!task) throw new Error('Task not found')

    if (updates.cronExpression && !cron.validate(updates.cronExpression)) {
      throw new Error('Invalid cron expression')
    }

    this.unscheduleTask(id)

    const updatedTask = { ...task, ...updates, updatedAt: new Date().toISOString() }
    this.tasks.set(id, updatedTask)
    this.saveTasks()

    if (updatedTask.enabled) {
      this.scheduleTask(updatedTask)
    }
  }

  delete(id: string): void {
    this.unscheduleTask(id)
    this.executions.delete(id)
    this.saveExecutions()
    this.tasks.delete(id)
    this.saveTasks()
  }

  enableTask(id: string): void {
    this.update(id, { enabled: true })
  }

  disableTask(id: string): void {
    this.update(id, { enabled: false })
  }

  private scheduleTask(task: ScheduledTask): void {
    try {
      const job = cron.schedule(task.cronExpression, () => {
        this.executeTask(task.id)
      })
      this.scheduledJobs.set(task.id, job)
    } catch (error) {
      console.error(`Failed to schedule task ${task.id}:`, error)
    }
  }

  private unscheduleTask(id: string): void {
    const job = this.scheduledJobs.get(id)
    if (job) {
      job.stop()
      this.scheduledJobs.delete(id)
    }
  }

  async executeTask(id: string): Promise<TaskExecution> {
    const task = this.get(id)
    if (!task) throw new Error('Task not found')

    const execution: TaskExecution = {
      id: `exec_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      taskId: id,
      startTime: new Date().toISOString(),
      status: TaskStatus.RUNNING
    }

    this.addExecution(id, execution)
    this.eventEmitter.emit('task-started', { task, execution })

    try {
      let output = ''
      
      if (task.type === TaskType.COMMAND && task.sessionId && task.command) {
        output = await this.executeCommand(task)
      }

      execution.endTime = new Date().toISOString()
      execution.status = TaskStatus.SUCCESS
      execution.output = output
      execution.duration = new Date(execution.endTime).getTime() - new Date(execution.startTime).getTime()

      const updatedTask = this.get(id)
      if (updatedTask) {
        updatedTask.lastExecution = execution.endTime
        updatedTask.executionCount++
        updatedTask.successCount++
        this.tasks.set(id, updatedTask)
        this.saveTasks()
      }

      this.eventEmitter.emit('task-completed', { task, execution })
    } catch (error) {
      execution.endTime = new Date().toISOString()
      execution.status = TaskStatus.FAILED
      execution.error = (error as Error).message
      execution.duration = new Date(execution.endTime).getTime() - new Date(execution.startTime).getTime()

      const updatedTask = this.get(id)
      if (updatedTask) {
        updatedTask.lastExecution = execution.endTime
        updatedTask.executionCount++
        updatedTask.failureCount++
        this.tasks.set(id, updatedTask)
        this.saveTasks()
      }

      this.eventEmitter.emit('task-failed', { task, execution, error })
    }

    this.updateExecution(id, execution)
    return execution
  }

  private async executeCommand(task: ScheduledTask): Promise<string> {
    const connection = sshConnectionManager.getConnection(task.sessionId!)
    if (!connection || !connection.client) {
      throw new Error('SSH connection not found')
    }

    return new Promise((resolve, reject) => {
      const timeout = task.timeout ? task.timeout * 1000 : 30000
      const timer = setTimeout(() => reject(new Error('Timeout')), timeout)

      connection.client!.exec(task.command!, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          reject(err)
          return
        }

        let output = ''
        stream.on('data', (data: Buffer) => { output += data.toString() })
        stream.on('close', (code: number) => {
          clearTimeout(timer)
          code === 0 ? resolve(output) : reject(new Error(`Exit code ${code}`))
        })
      })
    })
  }

  private addExecution(taskId: string, execution: TaskExecution): void {
    if (!this.executions.has(taskId)) {
      this.executions.set(taskId, [])
    }
    const executions = this.executions.get(taskId)!
    executions.unshift(execution)
    if (executions.length > this.maxExecutionHistory) {
      executions.splice(this.maxExecutionHistory)
    }
    this.saveExecutions()
  }

  private updateExecution(taskId: string, execution: TaskExecution): void {
    const executions = this.executions.get(taskId)
    if (executions) {
      const index = executions.findIndex(e => e.id === execution.id)
      if (index !== -1) {
        executions[index] = execution
        this.saveExecutions()
      }
    }
  }

  getExecutions(taskId: string, limit?: number): TaskExecution[] {
    const executions = this.executions.get(taskId) || []
    return limit ? executions.slice(0, limit) : executions
  }

  getAllExecutions(): Map<string, TaskExecution[]> {
    return new Map(this.executions)
  }

  clearExecutions(taskId: string): void {
    this.executions.delete(taskId)
    this.saveExecutions()
  }

  private startAllEnabledTasks(): void {
    this.getAll().forEach(task => {
      if (task.enabled) {
        try {
          this.scheduleTask(task)
        } catch (error) {
          console.error(`Failed to start task ${task.id}:`, error)
        }
      }
    })
  }

  search(query: string): ScheduledTask[] {
    const lowerQuery = query.toLowerCase()
    return this.getAll().filter(task =>
      task.name.toLowerCase().includes(lowerQuery) ||
      task.description?.toLowerCase().includes(lowerQuery) ||
      task.command?.toLowerCase().includes(lowerQuery)
    )
  }

  getByTag(tag: string): ScheduledTask[] {
    return this.getAll().filter(task => task.tags?.includes(tag))
  }

  getStatistics() {
    const tasks = this.getAll()
    return {
      total: tasks.length,
      enabled: tasks.filter(t => t.enabled).length,
      disabled: tasks.filter(t => !t.enabled).length,
      byType: {
        command: tasks.filter(t => t.type === TaskType.COMMAND).length,
        script: tasks.filter(t => t.type === TaskType.SCRIPT).length,
        backup: tasks.filter(t => t.type === TaskType.BACKUP).length,
        fileSync: tasks.filter(t => t.type === TaskType.FILE_SYNC).length
      },
      totalExecutions: tasks.reduce((sum, t) => sum + t.executionCount, 0),
      totalSuccesses: tasks.reduce((sum, t) => sum + t.successCount, 0),
      totalFailures: tasks.reduce((sum, t) => sum + t.failureCount, 0)
    }
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener)
  }

  cleanup(): void {
    this.scheduledJobs.forEach(job => job.stop())
    this.scheduledJobs.clear()
  }
}

export const taskSchedulerManager = new TaskSchedulerManager()
