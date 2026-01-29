import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { EventEmitter } from 'events'
import { sshConnectionManager } from './SSHConnectionManager'

export enum StepType {
  COMMAND = 'command',
  SCRIPT = 'script',
  DELAY = 'delay',
  CONDITION = 'condition'
}

export enum WorkflowStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface WorkflowStep {
  id: string
  name: string
  type: StepType
  sessionId?: string
  command?: string
  script?: string
  delay?: number // 延迟时间（毫秒）
  condition?: string // 条件表达式
  continueOnError: boolean
  timeout?: number
  nextStepId?: string // 下一步ID
  onSuccess?: string // 成功时跳转的步骤ID
  onFailure?: string // 失败时跳转的步骤ID
}

export interface WorkflowExecution {
  id: string
  workflowId: string
  startTime: string
  endTime?: string
  status: WorkflowStatus
  currentStepId?: string
  steps: Array<{
    stepId: string
    startTime: string
    endTime?: string
    status: 'success' | 'failed' | 'skipped'
    output?: string
    error?: string
  }>
  variables: Record<string, any>
}

export interface Workflow {
  id: string
  name: string
  description?: string
  enabled: boolean
  steps: WorkflowStep[]
  startStepId: string
  variables?: Record<string, any>
  createdAt: string
  updatedAt: string
  lastExecution?: string
  executionCount: number
  successCount: number
  failureCount: number
  tags?: string[]
}

export class WorkflowManager {
  private workflows: Map<string, Workflow>
  private workflowsPath: string
  private executions: Map<string, WorkflowExecution[]>
  private executionsPath: string
  private eventEmitter: EventEmitter
  private runningExecutions: Map<string, WorkflowExecution>

  constructor() {
    const userDataPath = app.getPath('userData')
    this.workflowsPath = join(userDataPath, 'workflows.json')
    this.workflows = new Map()
    this.executions = new Map()
    this.executionsPath = join(userDataPath, 'workflow-executions.json')
    this.eventEmitter = new EventEmitter()
    this.runningExecutions = new Map()

    this.loadWorkflows()
    this.loadExecutions()
  }

  private loadWorkflows(): void {
    try {
      if (existsSync(this.workflowsPath)) {
        const data = readFileSync(this.workflowsPath, 'utf-8')
        const workflowsArray: Workflow[] = JSON.parse(data)
        workflowsArray.forEach(workflow => this.workflows.set(workflow.id, workflow))
      }
    } catch (error) {
      console.error('Failed to load workflows:', error)
    }
  }

  private saveWorkflows(): void {
    try {
      const workflowsArray = Array.from(this.workflows.values())
      writeFileSync(this.workflowsPath, JSON.stringify(workflowsArray, null, 2))
    } catch (error) {
      console.error('Failed to save workflows:', error)
    }
  }

  private loadExecutions(): void {
    try {
      if (existsSync(this.executionsPath)) {
        const data = readFileSync(this.executionsPath, 'utf-8')
        const executionsArray: Array<{ workflowId: string; executions: WorkflowExecution[] }> = JSON.parse(data)
        executionsArray.forEach(item => this.executions.set(item.workflowId, item.executions))
      }
    } catch (error) {
      console.error('Failed to load executions:', error)
    }
  }

  private saveExecutions(): void {
    try {
      const executionsArray = Array.from(this.executions.entries()).map(([workflowId, executions]) => ({
        workflowId,
        executions
      }))
      writeFileSync(this.executionsPath, JSON.stringify(executionsArray, null, 2))
    } catch (error) {
      console.error('Failed to save executions:', error)
    }
  }

  create(data: any): Workflow {
    const workflow: Workflow = {
      ...data,
      id: `workflow_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }

    this.workflows.set(workflow.id, workflow)
    this.saveWorkflows()
    return workflow
  }

  getAll(): Workflow[] {
    return Array.from(this.workflows.values())
  }

  get(id: string): Workflow | undefined {
    return this.workflows.get(id)
  }

  update(id: string, updates: Partial<Workflow>): void {
    const workflow = this.get(id)
    if (!workflow) throw new Error('Workflow not found')

    const updatedWorkflow = { ...workflow, ...updates, updatedAt: new Date().toISOString() }
    this.workflows.set(id, updatedWorkflow)
    this.saveWorkflows()
  }

  delete(id: string): void {
    this.workflows.delete(id)
    this.executions.delete(id)
    this.saveWorkflows()
    this.saveExecutions()
  }

  async execute(id: string, variables?: Record<string, any>): Promise<WorkflowExecution> {
    const workflow = this.get(id)
    if (!workflow) throw new Error('Workflow not found')

    const execution: WorkflowExecution = {
      id: `exec_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      workflowId: id,
      startTime: new Date().toISOString(),
      status: WorkflowStatus.RUNNING,
      steps: [],
      variables: { ...workflow.variables, ...variables }
    }

    this.runningExecutions.set(execution.id, execution)
    this.addExecution(id, execution)
    this.eventEmitter.emit('workflow-started', { workflow, execution })

    try {
      let currentStepId: string | undefined = workflow.startStepId

      while (currentStepId) {
        const step = workflow.steps.find(s => s.id === currentStepId)
        if (!step) break

        execution.currentStepId = currentStepId

        const stepResult = await this.executeStep(step, execution)
        execution.steps.push(stepResult)

        if (stepResult.status === 'failed' && !step.continueOnError) {
          throw new Error(`Step ${step.name} failed: ${stepResult.error}`)
        }

        // 确定下一步
        if (stepResult.status === 'success' && step.onSuccess) {
          currentStepId = step.onSuccess
        } else if (stepResult.status === 'failed' && step.onFailure) {
          currentStepId = step.onFailure
        } else {
          currentStepId = step.nextStepId
        }
      }

      execution.endTime = new Date().toISOString()
      execution.status = WorkflowStatus.COMPLETED

      workflow.lastExecution = execution.endTime
      workflow.executionCount++
      workflow.successCount++
      this.workflows.set(id, workflow)
      this.saveWorkflows()

      this.eventEmitter.emit('workflow-completed', { workflow, execution })
    } catch (error) {
      execution.endTime = new Date().toISOString()
      execution.status = WorkflowStatus.FAILED

      workflow.lastExecution = execution.endTime
      workflow.executionCount++
      workflow.failureCount++
      this.workflows.set(id, workflow)
      this.saveWorkflows()

      this.eventEmitter.emit('workflow-failed', { workflow, execution, error })
    }

    this.runningExecutions.delete(execution.id)
    this.updateExecution(id, execution)
    return execution
  }

  private async executeStep(step: WorkflowStep, execution: WorkflowExecution): Promise<any> {
    const stepExecution: any = {
      stepId: step.id,
      startTime: new Date().toISOString(),
      status: 'success' as 'success' | 'failed' | 'skipped',
      output: '',
      error: ''
    }

    try {
      switch (step.type) {
        case StepType.COMMAND:
          if (step.sessionId && step.command) {
            stepExecution.output = await this.executeCommand(step, execution)
          }
          break

        case StepType.DELAY:
          if (step.delay) {
            await new Promise(resolve => setTimeout(resolve, step.delay))
            stepExecution.output = `Delayed for ${step.delay}ms`
          }
          break

        case StepType.CONDITION:
          if (step.condition) {
            const result = this.evaluateCondition(step.condition, execution.variables)
            stepExecution.output = `Condition result: ${result}`
            if (!result) {
              stepExecution.status = 'skipped'
            }
          }
          break
      }

      stepExecution.endTime = new Date().toISOString()
    } catch (error) {
      stepExecution.endTime = new Date().toISOString()
      stepExecution.status = 'failed'
      stepExecution.error = (error as Error).message
    }

    return stepExecution
  }

  private async executeCommand(step: WorkflowStep, execution: WorkflowExecution): Promise<string> {
    const connection = sshConnectionManager.getConnection(step.sessionId!)
    if (!connection || !connection.client) {
      throw new Error('SSH connection not found')
    }

    // 替换变量
    let command = step.command!
    Object.keys(execution.variables).forEach(key => {
      command = command.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), execution.variables[key])
    })

    return new Promise((resolve, reject) => {
      const timeout = step.timeout ? step.timeout * 1000 : 30000
      const timer = setTimeout(() => reject(new Error('Timeout')), timeout)

      connection.client!.exec(command, (err, stream) => {
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

  private evaluateCondition(condition: string, variables: Record<string, any>): boolean {
    try {
      // 简单的条件评估（实际应该使用安全的表达式解析器）
      let expr = condition
      Object.keys(variables).forEach(key => {
        expr = expr.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), JSON.stringify(variables[key]))
      })
      return eval(expr)
    } catch {
      return false
    }
  }

  private addExecution(workflowId: string, execution: WorkflowExecution): void {
    if (!this.executions.has(workflowId)) {
      this.executions.set(workflowId, [])
    }
    const executions = this.executions.get(workflowId)!
    executions.unshift(execution)
    if (executions.length > 100) {
      executions.splice(100)
    }
    this.saveExecutions()
  }

  private updateExecution(workflowId: string, execution: WorkflowExecution): void {
    const executions = this.executions.get(workflowId)
    if (executions) {
      const index = executions.findIndex(e => e.id === execution.id)
      if (index !== -1) {
        executions[index] = execution
        this.saveExecutions()
      }
    }
  }

  getExecutions(workflowId: string, limit?: number): WorkflowExecution[] {
    const executions = this.executions.get(workflowId) || []
    return limit ? executions.slice(0, limit) : executions
  }

  search(query: string): Workflow[] {
    const lowerQuery = query.toLowerCase()
    return this.getAll().filter(workflow =>
      workflow.name.toLowerCase().includes(lowerQuery) ||
      workflow.description?.toLowerCase().includes(lowerQuery)
    )
  }

  getByTag(tag: string): Workflow[] {
    return this.getAll().filter(workflow => workflow.tags?.includes(tag))
  }

  getStatistics() {
    const workflows = this.getAll()
    return {
      total: workflows.length,
      enabled: workflows.filter(w => w.enabled).length,
      disabled: workflows.filter(w => !w.enabled).length,
      totalExecutions: workflows.reduce((sum, w) => sum + w.executionCount, 0),
      totalSuccesses: workflows.reduce((sum, w) => sum + w.successCount, 0),
      totalFailures: workflows.reduce((sum, w) => sum + w.failureCount, 0)
    }
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener)
  }
}

export const workflowManager = new WorkflowManager()
